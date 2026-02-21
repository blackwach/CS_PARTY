from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import GameRoom, RoomMembership

User = get_user_model()


def _validate_invite_permissions(host: User, invited_user: User) -> None:
    if invited_user.allowed_inviters.exists() and not invited_user.allowed_inviters.filter(id=host.id).exists():
        raise ValidationError(f'User {invited_user.nickname} has not allowed your invites.')


@transaction.atomic
def create_room_with_invites(host: User, title: str, scheduled_for, invited_user_ids: list[int]) -> GameRoom:
    invited_ids = set(invited_user_ids)
    invited_users = list(User.objects.filter(id__in=invited_ids, is_active=True).exclude(id=host.id))
    if len(invited_users) != len(invited_ids):
        raise ValidationError('One or more invited users were not found.')

    if len(invited_users) + 1 > 5:
        raise ValidationError('A room can contain up to 5 players.')

    for invited in invited_users:
        _validate_invite_permissions(host, invited)

    room = GameRoom.objects.create(host=host, title=title, scheduled_for=scheduled_for, max_players=5)
    RoomMembership.objects.create(room=room, user=host, state=RoomMembership.STATE_JOINED, joined_via=RoomMembership.VIA_WEB)

    for invited in invited_users:
        RoomMembership.objects.create(room=room, user=invited, state=RoomMembership.STATE_INVITED)

    from apps.notifications.services import notify_room_invitation

    for invited in invited_users:
        notify_room_invitation(room=room, invited_user=invited)

    return room


@transaction.atomic
def join_room(room: GameRoom, user: User, via: str = RoomMembership.VIA_WEB) -> RoomMembership:
    membership = RoomMembership.objects.filter(room=room, user=user).first()
    if membership is None:
        raise ValidationError('You were not invited to this room.')

    if membership.state == RoomMembership.STATE_DECLINED:
        membership.state = RoomMembership.STATE_JOINED

    if membership.state != RoomMembership.STATE_READY:
        membership.state = RoomMembership.STATE_JOINED

    membership.joined_via = via
    membership.save(update_fields=['state', 'joined_via', 'updated_at'])
    return membership


@transaction.atomic
def decline_room(room: GameRoom, user: User) -> RoomMembership:
    membership = RoomMembership.objects.filter(room=room, user=user).first()
    if not membership:
        membership = RoomMembership.objects.create(room=room, user=user)
    membership.state = RoomMembership.STATE_DECLINED
    membership.ready_at = None
    membership.save(update_fields=['state', 'ready_at', 'updated_at'])
    return membership


@transaction.atomic
def set_member_ready(room: GameRoom, user: User, via: str = RoomMembership.VIA_WEB) -> RoomMembership:
    membership = RoomMembership.objects.filter(room=room, user=user).first()
    if not membership:
        raise ValidationError('You are not in this room.')

    if membership.state == RoomMembership.STATE_DECLINED:
        raise ValidationError('You have declined this room invite.')

    membership.state = RoomMembership.STATE_READY
    membership.joined_via = via
    membership.ready_at = timezone.now()
    membership.save(update_fields=['state', 'joined_via', 'ready_at', 'updated_at'])

    active_count = room.memberships.exclude(state=RoomMembership.STATE_DECLINED).count()
    ready_count = room.memberships.filter(state=RoomMembership.STATE_READY).count()
    if active_count > 0 and ready_count == active_count:
        room.status = GameRoom.STATUS_READY
        room.save(update_fields=['status', 'updated_at'])

    return membership


def mark_member_ready_by_telegram(chat_id: int, room_code: str) -> tuple[bool, str]:
    user = User.objects.filter(telegram_chat_id=chat_id).first()
    if not user:
        return False, 'Link your Telegram account first with /link CODE.'

    room = GameRoom.objects.filter(code=room_code.upper()).first()
    if not room:
        return False, 'Room not found.'

    membership = RoomMembership.objects.filter(room=room, user=user).first()
    if not membership:
        return False, 'You are not invited to this room.'

    try:
        set_member_ready(room, user, via=RoomMembership.VIA_TELEGRAM)
    except ValidationError as exc:
        return False, str(exc.detail[0] if isinstance(exc.detail, list) else exc.detail)

    return True, f'Ready status updated for room {room.code}.'


def send_five_minute_reminders() -> int:
    now = timezone.now()
    window_end = now + timedelta(minutes=5)

    rooms = (
        GameRoom.objects.filter(
            status__in=[GameRoom.STATUS_OPEN, GameRoom.STATUS_READY],
            reminder_sent=False,
            scheduled_for__gt=now,
            scheduled_for__lte=window_end,
        )
        .prefetch_related('memberships__user', 'host')
        .all()
    )

    from apps.notifications.services import notify_room_reminder

    count = 0
    for room in rooms:
        for membership in room.memberships.exclude(state=RoomMembership.STATE_DECLINED):
            notify_room_reminder(room=room, member=membership)
        room.reminder_sent = True
        room.save(update_fields=['reminder_sent', 'updated_at'])
        count += 1

    return count
