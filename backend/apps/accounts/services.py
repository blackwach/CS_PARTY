from datetime import timedelta
from typing import Iterable

from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone

from .models import EmailActionToken, User, generate_telegram_code


def create_action_token(user: User, action: str, ttl_seconds: int, payload: dict | None = None, token_override: str | None = None) -> EmailActionToken:
    payload = payload or {}
    expires_at = timezone.now() + timedelta(seconds=ttl_seconds)
    token_value = token_override or EmailActionToken._meta.get_field('token').default()
    return EmailActionToken.objects.create(
        user=user,
        action=action,
        token=token_value,
        payload=payload,
        expires_at=expires_at,
    )


def send_verification_email(user: User) -> EmailActionToken:
    token = create_action_token(user=user, action=EmailActionToken.VERIFY_EMAIL, ttl_seconds=24 * 3600)
    verify_url = f"{settings.FRONTEND_URL.rstrip('/')}/verify-email/{token.token}/"
    subject = 'Подтверждение почты в CS Party'
    message = (
        f'Привет, {user.nickname}!\n\n'
        'Подтвердите почту для активации аккаунта:\n'
        f'{verify_url}\n\n'
        'Если вы не регистрировались, просто проигнорируйте это письмо.'
    )
    send_mail(subject=subject, message=message, from_email=settings.DEFAULT_FROM_EMAIL, recipient_list=[user.email])
    return token


def send_password_reset_email(user: User) -> EmailActionToken:
    token = create_action_token(user=user, action=EmailActionToken.RESET_PASSWORD, ttl_seconds=5 * 60)
    reset_url = f"{settings.FRONTEND_URL.rstrip('/')}/reset-password?token={token.token}"
    subject = 'Сброс пароля в CS Party'
    message = (
        f'Привет, {user.nickname}!\n\n'
        'Для смены пароля перейдите по ссылке (действует 5 минут):\n'
        f'{reset_url}\n\n'
        'Если это были не вы, срочно смените пароль после входа.'
    )
    send_mail(subject=subject, message=message, from_email=settings.DEFAULT_FROM_EMAIL, recipient_list=[user.email])
    return token


def verify_email_by_token(token_value: str) -> tuple[bool, str]:
    token = EmailActionToken.objects.filter(token=token_value, action=EmailActionToken.VERIFY_EMAIL).select_related('user').first()
    if not token:
        return False, 'Токен подтверждения не найден.'
    if not token.is_valid():
        return False, 'Ссылка подтверждения истекла или уже использована.'

    with transaction.atomic():
        user = token.user
        user.is_email_verified = True
        user.is_active = True
        user.save(update_fields=['is_email_verified', 'is_active'])
        token.mark_used()
    return True, 'Почта успешно подтверждена.'


def reset_password_by_token(token_value: str, new_password: str) -> tuple[bool, str]:
    token = EmailActionToken.objects.filter(token=token_value, action=EmailActionToken.RESET_PASSWORD).select_related('user').first()
    if not token:
        return False, 'Токен сброса не найден.'
    if not token.is_valid():
        return False, 'Ссылка для сброса истекла или уже использована.'

    with transaction.atomic():
        user = token.user
        user.set_password(new_password)
        user.save(update_fields=['password'])
        token.mark_used()
    return True, 'Пароль успешно обновлен.'


def generate_telegram_link_code(user: User) -> EmailActionToken:
    code = generate_telegram_code()
    return create_action_token(user=user, action=EmailActionToken.TELEGRAM_LINK, ttl_seconds=10 * 60, token_override=code)


def link_telegram_by_code(code: str, chat_id: int, username: str = '') -> tuple[bool, str, User | None]:
    token = EmailActionToken.objects.filter(token=code, action=EmailActionToken.TELEGRAM_LINK).select_related('user').first()
    if not token:
        return False, 'Код привязки не найден.', None
    if not token.is_valid():
        return False, 'Код привязки истек или уже использован.', None

    with transaction.atomic():
        user = token.user
        user.telegram_chat_id = chat_id
        user.telegram_username = username or ''
        user.save(update_fields=['telegram_chat_id', 'telegram_username'])
        token.mark_used()

    return True, 'Telegram успешно привязан к аккаунту.', user


def set_allowed_inviters(user: User, inviter_ids: Iterable[int]) -> None:
    inviters = User.objects.filter(id__in=list(inviter_ids), is_active=True)
    user.allowed_inviters.set(inviters)
