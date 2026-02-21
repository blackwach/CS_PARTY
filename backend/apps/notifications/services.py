import logging

import requests
from django.conf import settings
from django.core.mail import send_mail

from .models import InAppNotification
from .realtime import broadcast_notification

logger = logging.getLogger(__name__)


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
        title='Приглашение в комнату',
        message=f'{host.nickname} приглашает вас в комнату {room.code}.',
        payload={'room_code': room.code, 'room_title': room.title},
    )

    tg_text = (
        f'Приглашение в комнату CS2\n'
        f'Хост: {host.nickname}\n'
        f'Код комнаты: <b>{room.code}</b>\n'
        f'Время сбора: {schedule_text}\n'
        f'Отметиться готовым в Telegram: /ready {room.code}'
    )
    if invited_user.telegram_notifications_enabled and invited_user.telegram_chat_id:
        send_telegram_message(invited_user.telegram_chat_id, tg_text)

    email_subject = 'Приглашение в комнату CS2'
    email_message = (
        f'{host.nickname} приглашает вас в комнату CS2.\n'
        f'Код комнаты: {room.code}\n'
        f'Время сбора: {schedule_text}\n'
        f'Вы можете отметить готовность на сайте или командой /ready {room.code} в Telegram.'
    )
    try:
        send_email_message(recipient=invited_user.email, subject=email_subject, message=email_message)
    except Exception as exc:  # pragma: no cover - side effect only
        logger.warning('Failed to send room invitation email to %s: %s', invited_user.email, exc)


def notify_room_reminder(room, member) -> None:
    schedule_text = room.scheduled_for.strftime('%Y-%m-%d %H:%M UTC')
    tg_text = (
        f'Напоминание CS2: осталось 5 минут\n'
        f'Код комнаты: <b>{room.code}</b>\n'
        f'Время сбора: {schedule_text}\n'
        f'Отметить готовность: /ready {room.code}'
    )

    user = member.user
    if user.telegram_notifications_enabled and user.telegram_chat_id:
        send_telegram_message(user.telegram_chat_id, tg_text)

    try:
        send_email_message(
            recipient=user.email,
            subject='CS2: напоминание за 5 минут до матча',
            message=f'Комната {room.code}. Время сбора: {schedule_text}.',
        )
    except Exception as exc:  # pragma: no cover - side effect only
        logger.warning('Failed to send room reminder email to %s: %s', user.email, exc)
