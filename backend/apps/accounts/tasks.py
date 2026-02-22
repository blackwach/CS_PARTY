from datetime import timedelta

from celery import shared_task
from django.db import transaction
from django.utils import timezone

from apps.notifications.models import InAppNotification
from apps.notifications.services import create_notification, send_telegram_message
from .models import DirectMessage, EmailActionToken, User
from .services import CHAT_UNREAD_REMINDER_KIND


@shared_task
def enforce_email_verification_timeouts_task() -> dict[str, int]:
    now = timezone.now()
    register_cutoff = now - timedelta(minutes=10)

    stale_users = User.objects.filter(
        is_active=False,
        is_email_verified=False,
        is_superuser=False,
        date_joined__lte=register_cutoff,
    )
    stale_user_count = stale_users.count()
    stale_users.delete()

    expired_pending_users = list(
        User.objects.filter(
            pending_email__gt='',
            pending_email_expires_at__isnull=False,
            pending_email_expires_at__lte=now,
        ).only('id', 'email', 'pending_email_previous')
    )

    with transaction.atomic():
        for user in expired_pending_users:
            user.email = user.pending_email_previous or user.email
            user.pending_email = ''
            user.pending_email_previous = ''
            user.pending_email_expires_at = None
            user.save(update_fields=['email', 'pending_email', 'pending_email_previous', 'pending_email_expires_at'])

        if expired_pending_users:
            EmailActionToken.objects.filter(
                user_id__in=[u.id for u in expired_pending_users],
                action=EmailActionToken.VERIFY_EMAIL,
                used_at__isnull=True,
                payload__flow='email_change',
            ).update(used_at=now)

    return {
        'deleted_unverified_users': stale_user_count,
        'rolled_back_pending_email_changes': len(expired_pending_users),
    }


def _compact_preview(text: str, limit: int = 140) -> str:
    compact = ' '.join(str(text or '').split())
    if len(compact) <= limit:
        return compact
    return f'{compact[: limit - 1]}…'


def _message_recipient(message: DirectMessage):
    conversation = message.conversation
    return conversation.user_high if message.sender_id == conversation.user_low_id else conversation.user_low


@shared_task
def notify_unread_direct_messages_task() -> dict[str, int]:
    now = timezone.now()
    unread_cutoff = now - timedelta(hours=1)

    # Oldest unread message per conversation/recipient pair; one reminder per message id.
    unread_candidates = (
        DirectMessage.objects.filter(read_at__isnull=True, created_at__lte=unread_cutoff)
        .select_related('sender', 'conversation__user_low', 'conversation__user_high')
        .order_by('conversation_id', 'created_at')
    )

    checked_count = 0
    reminders_created = 0
    telegram_sent = 0
    processed_pairs: set[tuple[int, int]] = set()

    for message in unread_candidates.iterator():
        checked_count += 1
        recipient = _message_recipient(message)
        if not recipient or not recipient.is_active:
            continue

        pair_key = (message.conversation_id, recipient.id)
        if pair_key in processed_pairs:
            continue
        processed_pairs.add(pair_key)

        already_notified = InAppNotification.objects.filter(
            user=recipient,
            type=InAppNotification.TYPE_SYSTEM,
            payload__kind=CHAT_UNREAD_REMINDER_KIND,
            payload__message_id=message.id,
        ).exists()
        if already_notified:
            continue

        preview = _compact_preview(message.text)
        notification_text = f'Сообщение от {message.sender.nickname} не прочитано больше часа.'
        if preview:
            notification_text = f'{notification_text} Текст: {preview}'

        telegram_success = False
        if recipient.telegram_notifications_enabled and recipient.telegram_chat_id:
            telegram_text = (
                'Непрочитанное сообщение в CS Party больше 1 часа.\n'
                f'От: {message.sender.nickname}\n'
                f'Текст: {preview or "(без текста)"}\n'
                'Откройте раздел чатов в приложении.'
            )
            telegram_success = send_telegram_message(recipient.telegram_chat_id, telegram_text)
            if telegram_success:
                telegram_sent += 1

        create_notification(
            user=recipient,
            actor=message.sender,
            notification_type=InAppNotification.TYPE_SYSTEM,
            title='Сообщение не прочитано > 1 часа',
            message=notification_text,
            payload={
                'kind': CHAT_UNREAD_REMINDER_KIND,
                'message_id': message.id,
                'conversation_id': message.conversation_id,
                'sender_id': message.sender_id,
                'sender_nickname': message.sender.nickname,
                'chat_user_id': message.sender_id,
                'telegram_sent': telegram_success,
            },
        )
        reminders_created += 1

    return {
        'checked_unread_messages': checked_count,
        'reminder_notifications_created': reminders_created,
        'telegram_messages_sent': telegram_sent,
    }
