import logging
import re
import ipaddress
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import GameRoom, RoomMembership
from .server_provisioning import (
    build_connect_command,
    build_steam_launch_url,
    configure_room_server_endpoint,
    provision_server_for_room,
    release_server_for_room,
)

User = get_user_model()
logger = logging.getLogger(__name__)
MAP_NAME_PATTERN = re.compile(r'^[A-Za-z0-9_./-]{3,64}$')


def _sanitize_cs2_map_name(value: str) -> str:
    candidate = str(value or '').strip()
    if MAP_NAME_PATTERN.fullmatch(candidate):
        return candidate
    return 'de_dust2'


def _schedule_room_broadcast(room_id: int) -> None:
    from .realtime import broadcast_room_state

    transaction.on_commit(lambda: broadcast_room_state(room_id))


def _parse_ip(value: str):
    candidate = str(value or '').strip()
    if not candidate:
        return None
    try:
        return ipaddress.ip_address(candidate)
    except ValueError:
        return None


def _is_likely_public_ip(ip_obj) -> bool:
    if not ip_obj:
        return False
    return not (
        ip_obj.is_private
        or ip_obj.is_loopback
        or ip_obj.is_link_local
        or ip_obj.is_multicast
        or ip_obj.is_reserved
        or ip_obj.is_unspecified
    )


def _validate_host_public_ip(host_public_ip: str) -> str:
    normalized = str(host_public_ip or '').strip()
    if not normalized:
        raise ValidationError('Укажите публичный IP хоста для host-auto режима.')

    parsed = _parse_ip(normalized)
    if not parsed:
        raise ValidationError('Публичный IP хоста имеет некорректный формат.')

    return normalized


def _validate_invite_permissions(host: User, invited_user: User) -> None:
    if invited_user.allowed_inviters.exists() and not invited_user.allowed_inviters.filter(id=host.id).exists():
        raise ValidationError(f'Пользователь {invited_user.nickname} не разрешил вам отправлять приглашения.')


@transaction.atomic
def create_room_with_invites(
    host: User,
    title: str,
    scheduled_for,
    invited_user_ids: list[int],
    host_auto_server: bool = False,
    host_server_host: str = '',
    host_server_port: int | None = None,
    host_server_password: str = '',
    host_server_map: str = 'de_dust2',
) -> GameRoom:
    invited_ids = set(invited_user_ids)
    invited_users = list(User.objects.filter(id__in=invited_ids, is_active=True).exclude(id=host.id))
    if len(invited_users) != len(invited_ids):
        raise ValidationError('Один или несколько приглашенных пользователей не найдены.')

    if len(invited_users) + 1 > 5:
        raise ValidationError('В комнате может быть не более 5 игроков.')

    for invited in invited_users:
        _validate_invite_permissions(host, invited)

    room = GameRoom.objects.create(host=host, title=title, scheduled_for=scheduled_for, max_players=5)
    RoomMembership.objects.create(room=room, user=host, state=RoomMembership.STATE_JOINED, joined_via=RoomMembership.VIA_WEB)

    for invited in invited_users:
        RoomMembership.objects.create(room=room, user=invited, state=RoomMembership.STATE_INVITED)

    from apps.notifications.services import notify_room_invitation

    for invited in invited_users:
        notify_room_invitation(room=room, invited_user=invited)

    if host_auto_server:
        room.server_host = ''
        room.server_port = int(host_server_port or 27015)
        room.server_password = host_server_password
        room.server_provider_payload = {'source': 'host-auto', 'map': host_server_map or 'de_dust2'}
        room.server_error = ''
        room.save(
            update_fields=[
                'server_host',
                'server_port',
                'server_password',
                'server_provider_payload',
                'server_error',
                'updated_at',
            ]
        )
    elif host_server_host and host_server_port:
        configure_room_server_endpoint(
            room,
            host=host_server_host,
            port=host_server_port,
            password=host_server_password,
            provider_payload={'source': 'host'},
        )

    _schedule_room_broadcast(room.id)
    return room


@transaction.atomic
def join_room(room: GameRoom, user: User, via: str = RoomMembership.VIA_WEB) -> RoomMembership:
    if room.status in {GameRoom.STATUS_CANCELLED, GameRoom.STATUS_FINISHED}:
        raise ValidationError('Эта комната закрыта.')

    membership = RoomMembership.objects.filter(room=room, user=user).first()
    if membership is None:
        raise ValidationError('Вы не приглашены в эту комнату.')

    if membership.state == RoomMembership.STATE_DECLINED:
        membership.state = RoomMembership.STATE_JOINED

    if membership.state != RoomMembership.STATE_READY:
        membership.state = RoomMembership.STATE_JOINED

    membership.joined_via = via
    membership.save(update_fields=['state', 'joined_via', 'updated_at'])
    _schedule_room_broadcast(room.id)
    return membership


@transaction.atomic
def decline_room(room: GameRoom, user: User) -> RoomMembership:
    membership = RoomMembership.objects.filter(room=room, user=user).first()
    if not membership:
        membership = RoomMembership.objects.create(room=room, user=user)
    membership.state = RoomMembership.STATE_DECLINED
    membership.ready_at = None
    membership.save(update_fields=['state', 'ready_at', 'updated_at'])
    _sync_room_status(room)
    _schedule_room_broadcast(room.id)
    return membership


@transaction.atomic
def set_member_ready(
    room: GameRoom,
    user: User,
    via: str = RoomMembership.VIA_WEB,
    host_public_ip: str = '',
) -> RoomMembership:
    if room.status in {GameRoom.STATUS_CANCELLED, GameRoom.STATUS_FINISHED}:
        raise ValidationError('Эта комната закрыта.')

    membership = RoomMembership.objects.filter(room=room, user=user).first()
    if not membership:
        raise ValidationError('Вы не состоите в этой комнате.')

    if membership.state == RoomMembership.STATE_DECLINED:
        raise ValidationError('Вы отклонили приглашение в эту комнату.')

    membership.state = RoomMembership.STATE_READY
    membership.joined_via = via
    membership.ready_at = timezone.now()
    membership.save(update_fields=['state', 'joined_via', 'ready_at', 'updated_at'])

    provider_source = str((room.server_provider_payload or {}).get('source') or '')
    host_public_ip = (host_public_ip or '').strip()
    if provider_source == 'host-auto' and user.id == room.host_id:
        resolved_ip = host_public_ip or str(room.server_host or '').strip()
        resolved_ip = _validate_host_public_ip(resolved_ip)
        room.server_host = resolved_ip
        room.server_error = ''
        room.save(update_fields=['server_host', 'server_error', 'updated_at'])

    _sync_room_status(room)
    _schedule_room_broadcast(room.id)
    return membership


@transaction.atomic
def set_member_unready(room: GameRoom, user: User, via: str = RoomMembership.VIA_WEB) -> RoomMembership:
    membership = RoomMembership.objects.filter(room=room, user=user).first()
    if not membership:
        raise ValidationError('Вы не состоите в этой комнате.')
    if membership.state != RoomMembership.STATE_READY:
        raise ValidationError('У вас не включена готовность.')
    if room.status == GameRoom.STATUS_STARTED:
        raise ValidationError('Запуск матча уже начался. Готовность отменить нельзя.')

    membership.state = RoomMembership.STATE_JOINED
    membership.joined_via = via
    membership.ready_at = None
    membership.save(update_fields=['state', 'joined_via', 'ready_at', 'updated_at'])
    _sync_room_status(room)
    _schedule_room_broadcast(room.id)
    return membership


@transaction.atomic
def close_room(room: GameRoom, user: User) -> GameRoom:
    if room.host_id != user.id:
        raise ValidationError('Только хост может закрыть комнату.')

    if room.status == GameRoom.STATUS_CANCELLED:
        return room

    room.status = GameRoom.STATUS_CANCELLED
    room.save(update_fields=['status', 'updated_at'])
    release_server_for_room(room)
    _schedule_room_broadcast(room.id)
    return room


@transaction.atomic
def cleanup_closed_rooms(user: User | None = None) -> int:
    queryset = GameRoom.objects.filter(status__in=[GameRoom.STATUS_CANCELLED, GameRoom.STATUS_FINISHED])
    if user is not None:
        queryset = queryset.filter(memberships__user=user)

    room_ids = list(queryset.values_list('id', flat=True).distinct())
    if not room_ids:
        return 0

    deleted_count, _ = GameRoom.objects.filter(id__in=room_ids).delete()
    return int(deleted_count or 0)


def _configure_host_auto_room_server(room: GameRoom) -> None:
    host = (room.server_host or '').strip()
    port = int(room.server_port or 0)
    password = (room.server_password or '').strip()
    room_map = _sanitize_cs2_map_name((room.server_provider_payload or {}).get('map') or 'de_dust2')

    if not host:
        raise ValidationError('Публичный IP хоста не задан. Хост должен нажать "Готов" в веб-клиенте.')
    if port <= 0:
        raise ValidationError('Порт сервера хоста не настроен.')

    connect_command = build_connect_command(host, port, password)
    connect_url = build_steam_launch_url(connect_command)

    # Host auto mode should launch CS2 straight into an internet listen server.
    launch_parts = [
        '+game_type 0',
        '+game_mode 1',
        f'+map {room_map}',
        '+sv_lan 0',
        f'+port {port}',
        f'+net_public_adr {host}',
    ]
    if password:
        launch_parts.append(f'+sv_password {password}')

    provider_payload = dict(room.server_provider_payload or {})
    provider_payload.update(
        {
            'source': 'host-auto',
            'map': room_map,
            'host_public_ip': host,
            'host_port': port,
        }
    )

    room.server_connect_url = connect_url
    room.server_launch_command = ' '.join(launch_parts)
    room.server_error = ''
    room.server_provider_payload = provider_payload
    room.server_provisioned_at = room.server_provisioned_at or timezone.now()
    room.save(
        update_fields=[
            'server_connect_url',
            'server_launch_command',
            'server_error',
            'server_provider_payload',
            'server_provisioned_at',
            'updated_at',
        ]
    )


def _sync_room_status(room: GameRoom) -> None:
    if room.status == GameRoom.STATUS_CANCELLED:
        return

    active_count = room.memberships.exclude(state=RoomMembership.STATE_DECLINED).count()
    ready_count = room.memberships.filter(state=RoomMembership.STATE_READY).count()

    if active_count == 0:
        room.status = GameRoom.STATUS_OPEN
        room.save(update_fields=['status', 'updated_at'])
        return

    if ready_count == active_count:
        room.status = GameRoom.STATUS_READY
        room.save(update_fields=['status', 'updated_at'])
        try:
            source = str((room.server_provider_payload or {}).get('source') or '')
            if source == 'host-auto':
                _configure_host_auto_room_server(room)
            else:
                provision_server_for_room(room)
            room.status = GameRoom.STATUS_STARTED
            room.save(update_fields=['status', 'updated_at'])
        except ValidationError as exc:
            room.server_error = str(exc.detail[0] if isinstance(exc.detail, list) else exc.detail)
            room.save(update_fields=['server_error', 'updated_at'])
        except Exception as exc:  # pragma: no cover - defensive fallback
            logger.exception('Unexpected CS2 server provisioning error for room %s: %s', room.code, exc)
            room.server_error = 'Непредвиденная ошибка при подготовке сервера.'
            room.save(update_fields=['server_error', 'updated_at'])
        return

    if room.status != GameRoom.STATUS_OPEN:
        room.status = GameRoom.STATUS_OPEN
        room.save(update_fields=['status', 'updated_at'])


def diagnose_host_auto_start(room: GameRoom, user: User, host_public_ip: str = '') -> dict:
    source = str((room.server_provider_payload or {}).get('source') or '')
    errors: list[str] = []
    warnings: list[str] = []
    checks: list[dict] = []

    if source != 'host-auto':
        errors.append('Комната не использует host-auto режим.')

    if user.id != room.host_id:
        errors.append('Диагностика host-auto доступна только хосту комнаты.')

    port = int(room.server_port or 0)
    if 1 <= port <= 65535:
        checks.append({'name': 'port', 'status': 'ok', 'detail': f'Порт сервера: {port}.'})
    else:
        errors.append('Порт host-auto сервера не настроен или вне диапазона 1-65535.')
        checks.append({'name': 'port', 'status': 'error', 'detail': 'Порт невалидный.'})

    candidate_ip = str(host_public_ip or room.server_host or '').strip()
    if not candidate_ip:
        errors.append('Публичный IP хоста не задан.')
        checks.append({'name': 'host_public_ip', 'status': 'error', 'detail': 'IP отсутствует.'})
    else:
        parsed_ip = _parse_ip(candidate_ip)
        if not parsed_ip:
            errors.append('Публичный IP хоста имеет некорректный формат.')
            checks.append({'name': 'host_public_ip', 'status': 'error', 'detail': f'IP "{candidate_ip}" не распознан.'})
        elif _is_likely_public_ip(parsed_ip):
            checks.append({'name': 'host_public_ip', 'status': 'ok', 'detail': f'Используется публичный IP: {candidate_ip}.'})
        else:
            warnings.append('Указанный IP не выглядит публичным. Для игры через интернет нужен внешний IP и проброс порта.')
            checks.append(
                {
                    'name': 'host_public_ip',
                    'status': 'warning',
                    'detail': f'IP "{candidate_ip}" валиден, но не является публичным.',
                }
            )

    active_count = room.memberships.exclude(state=RoomMembership.STATE_DECLINED).count()
    ready_count = room.memberships.filter(state=RoomMembership.STATE_READY).count()
    all_ready = active_count > 0 and active_count == ready_count
    checks.append(
        {
            'name': 'readiness',
            'status': 'ok' if all_ready else 'warning',
            'detail': f'Готовы {ready_count} из {active_count} активных участников.',
        }
    )

    can_start = not errors and all_ready
    if can_start:
        checks.append({'name': 'start', 'status': 'ok', 'detail': 'Комната готова к автоматическому запуску CS2.'})
    else:
        checks.append({'name': 'start', 'status': 'warning', 'detail': 'Перед стартом исправьте ошибки и дождитесь готовности всех игроков.'})

    return {
        'room_code': room.code,
        'mode': source or 'unknown',
        'status': room.status,
        'active_members': active_count,
        'ready_members': ready_count,
        'host_public_ip': candidate_ip,
        'can_start': can_start,
        'errors': errors,
        'warnings': warnings,
        'checks': checks,
    }


def mark_member_ready_by_telegram(chat_id: int, room_code: str) -> tuple[bool, str]:
    user = User.objects.filter(telegram_chat_id=chat_id).first()
    if not user:
        return False, 'Сначала привяжите Telegram-аккаунт через /link CODE.'

    room = GameRoom.objects.filter(code=room_code.upper()).first()
    if not room:
        return False, 'Комната не найдена.'

    membership = RoomMembership.objects.filter(room=room, user=user).first()
    if not membership:
        return False, 'Вы не приглашены в эту комнату.'

    try:
        set_member_ready(room, user, via=RoomMembership.VIA_TELEGRAM)
    except ValidationError as exc:
        return False, str(exc.detail[0] if isinstance(exc.detail, list) else exc.detail)

    return True, f'Статус готовности обновлен для комнаты {room.code}.'


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
