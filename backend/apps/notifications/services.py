import requests
from django.conf import settings
from django.core.mail import send_mail

from .models import InAppNotification
from .realtime import broadcast_notification


def create_notification(
    *,
    user,
    notification_type: str,
    title: str,
    message: str = '',
    payload: dict | None = None,
    actor=None,
) -> InAppNotification:
    notification = InAppNotification.objects.create(
        user=user,
        actor=actor,
        type=notification_type,
        title=title,
        message=message,
        payload=payload or {},
    )
    broadcast_notification(notification)
    return notification


def send_telegram_message(chat_id: int, text: str) -> bool:
    if not settings.TELEGRAM_BOT_TOKEN:
        return False

    url = f'https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/sendMessage'
    payload = {
        'chat_id': chat_id,
        'text': text,
        'parse_mode': 'HTML',
        'disable_web_page_preview': True,
    }

    try:
        response = requests.post(url, json=payload, timeout=15)
        response.raise_for_status()
        return True
    except requests.RequestException:
        return False


def send_email_message(recipient: str, subject: str, message: str) -> None:
    send_mail(subject=subject, message=message, from_email=settings.DEFAULT_FROM_EMAIL, recipient_list=[recipient])


def notify_room_invitation(room, invited_user) -> None:
    host = room.host
    schedule_text = room.scheduled_for.strftime('%Y-%m-%d %H:%M UTC')
    create_notification(
        user=invited_user,
        actor=host,
        notification_type=InAppNotification.TYPE_ROOM_INVITE,
        title='Room invitation',
        message=f'{host.nickname} invited you to room {room.code}.',
        payload={'room_code': room.code, 'room_title': room.title},
    )
    text = (
        f'🎮 Приглашение в CS2\n'
        f'Хост: {host.nickname}\n'
        f'Комната: <b>{room.code}</b>\n'
        f'Сбор: {schedule_text}\n'
        f'Подтвердить готовность: /ready {room.code}'
    )

    if invited_user.telegram_notifications_enabled and invited_user.telegram_chat_id:
        send_telegram_message(invited_user.telegram_chat_id, text)

    send_email_message(
        recipient=invited_user.email,
        subject='Вас пригласили в CS2 комнату',
        message=(
            f'Вас пригласил {host.nickname}.\n'
            f'Комната: {room.code}\n'
            f'Время сбора: {schedule_text}\n'
            f'Подтвердить готовность можно на сайте или командой /ready {room.code} в Telegram.'
        ),
    )


def notify_room_reminder(room, member) -> None:
    schedule_text = room.scheduled_for.strftime('%Y-%m-%d %H:%M UTC')
    text = (
        f'⏰ До начала сбора 5 минут\n'
        f'Комната: <b>{room.code}</b>\n'
        f'Сбор: {schedule_text}\n'
        f'Если готовы, используйте /ready {room.code}'
    )

    user = member.user
    if user.telegram_notifications_enabled and user.telegram_chat_id:
        send_telegram_message(user.telegram_chat_id, text)

    send_email_message(
        recipient=user.email,
        subject='Напоминание о сборе CS2 через 5 минут',
        message=f'Комната {room.code}. Время сбора: {schedule_text}.',
    )
