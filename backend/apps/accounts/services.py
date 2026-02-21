from datetime import timedelta
from typing import Iterable

from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.notifications.models import InAppNotification
from apps.notifications.services import create_notification
from .realtime import broadcast_chat_message
from .models import (
    DirectConversation,
    DirectMessage,
    EmailActionToken,
    FriendRequest,
    Friendship,
    User,
    generate_telegram_code,
)

EMAIL_VERIFICATION_TTL_SECONDS = 10 * 60


def create_action_token(
    user: User,
    action: str,
    ttl_seconds: int,
    payload: dict | None = None,
    token_override: str | None = None,
) -> EmailActionToken:
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
    token = create_action_token(
        user=user,
        action=EmailActionToken.VERIFY_EMAIL,
        ttl_seconds=EMAIL_VERIFICATION_TTL_SECONDS,
        payload={'flow': 'registration'},
    )
    verify_url = f"{settings.FRONTEND_URL.rstrip('/')}/verify-email/{token.token}/"
    subject = 'Подтверждение почты в CS Party'
    message = (
        f'Привет, {user.nickname}!\n\n'
        'Подтвердите почту для активации аккаунта.\n'
        'Ссылка действует 10 минут:\n'
        f'{verify_url}\n\n'
        'Если это были не вы, просто проигнорируйте письмо.'
    )
    send_mail(subject=subject, message=message, from_email=settings.DEFAULT_FROM_EMAIL, recipient_list=[user.email])
    return token


def send_email_change_verification_email(user: User, new_email: str) -> EmailActionToken:
    new_email = User.objects.normalize_email(new_email).strip()
    previous_email = user.email
    expires_at = timezone.now() + timedelta(seconds=EMAIL_VERIFICATION_TTL_SECONDS)

    with transaction.atomic():
        EmailActionToken.objects.filter(
            user=user,
            action=EmailActionToken.VERIFY_EMAIL,
            used_at__isnull=True,
            payload__flow='email_change',
        ).update(used_at=timezone.now())
        user.pending_email = new_email
        user.pending_email_previous = previous_email
        user.pending_email_expires_at = expires_at
        user.save(update_fields=['pending_email', 'pending_email_previous', 'pending_email_expires_at'])
        token = create_action_token(
            user=user,
            action=EmailActionToken.VERIFY_EMAIL,
            ttl_seconds=EMAIL_VERIFICATION_TTL_SECONDS,
            payload={
                'flow': 'email_change',
                'new_email': new_email,
                'previous_email': previous_email,
            },
        )

    verify_url = f"{settings.FRONTEND_URL.rstrip('/')}/verify-email/{token.token}/"
    subject = 'Подтверждение смены почты в CS Party'
    message = (
        f'Привет, {user.nickname}!\n\n'
        'Вы запросили смену почты для аккаунта CS Party.\n'
        'Подтвердите новый email по ссылке (действует 10 минут):\n'
        f'{verify_url}\n\n'
        'Если это были не вы, проигнорируйте письмо.'
    )
    try:
        send_mail(subject=subject, message=message, from_email=settings.DEFAULT_FROM_EMAIL, recipient_list=[new_email])
    except Exception:
        with transaction.atomic():
            token.delete()
            user.clear_pending_email_change()
            user.save(update_fields=['pending_email', 'pending_email_previous', 'pending_email_expires_at'])
        raise
    return token


def send_password_reset_email(user: User) -> EmailActionToken:
    token = create_action_token(user=user, action=EmailActionToken.RESET_PASSWORD, ttl_seconds=5 * 60)
    reset_url = f"{settings.FRONTEND_URL.rstrip('/')}/reset-password?token={token.token}"
    subject = 'Сброс пароля в CS Party'
    message = (
        f'Привет, {user.nickname}!\n\n'
        'Перейдите по ссылке, чтобы сменить пароль (действует 5 минут):\n'
        f'{reset_url}\n\n'
        'Если это были не вы, срочно смените пароль после входа.'
    )
    send_mail(subject=subject, message=message, from_email=settings.DEFAULT_FROM_EMAIL, recipient_list=[user.email])
    return token


def send_account_deletion_email(user: User) -> EmailActionToken:
    token = create_action_token(user=user, action=EmailActionToken.DELETE_ACCOUNT, ttl_seconds=15 * 60)
    confirm_url = f"{settings.FRONTEND_URL.rstrip('/')}/delete-account/{token.token}"
    subject = 'Удаление аккаунта в CS Party'
    message = (
        f'Привет, {user.nickname}!\n\n'
        'Мы получили запрос на удаление вашего аккаунта.\n'
        'Подтвердите удаление по ссылке (действует 15 минут):\n'
        f'{confirm_url}\n\n'
        'Если это были не вы, проигнорируйте письмо.'
    )
    send_mail(subject=subject, message=message, from_email=settings.DEFAULT_FROM_EMAIL, recipient_list=[user.email])
    return token


def verify_email_by_token(token_value: str) -> tuple[bool, str]:
    token = EmailActionToken.objects.filter(token=token_value, action=EmailActionToken.VERIFY_EMAIL).select_related('user').first()
    if not token:
        return False, 'Токен подтверждения не найден.'
    if not token.is_valid():
        return False, 'Ссылка подтверждения истекла или уже использована.'

    flow = (token.payload or {}).get('flow')
    with transaction.atomic():
        user = token.user
        if flow == 'email_change':
            new_email = ((token.payload or {}).get('new_email') or user.pending_email or '').strip()
            if not new_email:
                return False, 'Запрос на смену почты не активен.'
            if user.pending_email.lower() != new_email.lower():
                return False, 'Запрос на смену почты больше не активен.'
            if user.pending_email_expires_at and user.pending_email_expires_at <= timezone.now():
                user.email = user.pending_email_previous or user.email
                user.clear_pending_email_change()
                user.save(update_fields=['email', 'pending_email', 'pending_email_previous', 'pending_email_expires_at'])
                return False, 'Время подтверждения смены почты истекло. Предыдущий email восстановлен.'
            if User.objects.filter(email__iexact=new_email).exclude(id=user.id).exists():
                user.email = user.pending_email_previous or user.email
                user.clear_pending_email_change()
                user.save(update_fields=['email', 'pending_email', 'pending_email_previous', 'pending_email_expires_at'])
                return False, 'Этот email уже используется другим аккаунтом.'

            user.email = new_email
            user.is_email_verified = True
            user.clear_pending_email_change()
            user.save(
                update_fields=[
                    'email',
                    'is_email_verified',
                    'pending_email',
                    'pending_email_previous',
                    'pending_email_expires_at',
                ]
            )
            EmailActionToken.objects.filter(
                user=user,
                action=EmailActionToken.VERIFY_EMAIL,
                used_at__isnull=True,
                payload__flow='email_change',
            ).exclude(id=token.id).update(used_at=timezone.now())
            token.mark_used()
            return True, 'Email успешно изменен и подтвержден.'

        user.is_email_verified = True
        user.is_active = True
        user.save(update_fields=['is_email_verified', 'is_active'])
        token.mark_used()
    return True, 'Почта успешно подтверждена.'


def reset_password_by_token(token_value: str, new_password: str) -> tuple[bool, str]:
    token = EmailActionToken.objects.filter(token=token_value, action=EmailActionToken.RESET_PASSWORD).select_related('user').first()
    if not token:
        return False, 'Токен сброса пароля не найден.'
    if not token.is_valid():
        return False, 'Ссылка для сброса пароля истекла или уже использована.'

    with transaction.atomic():
        user = token.user
        user.set_password(new_password)
        user.save(update_fields=['password'])
        token.mark_used()
    return True, 'Пароль успешно обновлен.'


def delete_account_by_token(token_value: str) -> tuple[bool, str]:
    token = EmailActionToken.objects.filter(token=token_value, action=EmailActionToken.DELETE_ACCOUNT).select_related('user').first()
    if not token:
        return False, 'Токен удаления аккаунта не найден.'
    if not token.is_valid():
        return False, 'Ссылка удаления аккаунта истекла или уже использована.'
    if token.user.is_superuser:
        return False, 'Аккаунт суперпользователя нельзя удалить по токену.'

    with transaction.atomic():
        user = token.user
        token.mark_used()
        user.delete()

    return True, 'Аккаунт успешно удален.'


def generate_telegram_link_code(user: User) -> EmailActionToken:
    code = generate_telegram_code()
    return create_action_token(user=user, action=EmailActionToken.TELEGRAM_LINK, ttl_seconds=10 * 60, token_override=code)


def link_telegram_by_code(code: str, chat_id: int, username: str = '') -> tuple[bool, str, User | None]:
    token = EmailActionToken.objects.filter(token=code, action=EmailActionToken.TELEGRAM_LINK).select_related('user').first()
    if not token:
        return False, 'Код привязки Telegram не найден.', None
    if not token.is_valid():
        return False, 'Код привязки Telegram истек или уже использован.', None

    with transaction.atomic():
        user = token.user
        user.telegram_chat_id = chat_id
        user.telegram_username = username or ''
        user.save(update_fields=['telegram_chat_id', 'telegram_username'])
        token.mark_used()

    return True, 'Telegram успешно привязан.', user


def set_allowed_inviters(user: User, inviter_ids: Iterable[int]) -> None:
    inviters = User.objects.filter(id__in=list(inviter_ids), is_active=True)
    user.allowed_inviters.set(inviters)


def _pair_ids(user_a_id: int, user_b_id: int) -> tuple[int, int]:
    if user_a_id < user_b_id:
        return user_a_id, user_b_id
    return user_b_id, user_a_id


def are_friends(user_a: User, user_b: User) -> bool:
    low_id, high_id = _pair_ids(user_a.id, user_b.id)
    return Friendship.objects.filter(user_low_id=low_id, user_high_id=high_id).exists()


@transaction.atomic
def send_friend_request(sender: User, receiver: User) -> FriendRequest:
    if sender.id == receiver.id:
        raise ValidationError('Нельзя добавить себя в друзья.')
    if not receiver.is_active:
        raise ValidationError('Пользователь не найден.')
    if are_friends(sender, receiver):
        raise ValidationError('Вы уже друзья.')

    reverse_pending = FriendRequest.objects.filter(
        sender=receiver,
        receiver=sender,
        status=FriendRequest.STATUS_PENDING,
    ).first()
    if reverse_pending:
        return accept_friend_request(reverse_pending, sender)

    existing_pending = FriendRequest.objects.filter(
        sender=sender,
        receiver=receiver,
        status=FriendRequest.STATUS_PENDING,
    ).first()
    if existing_pending:
        return existing_pending

    friend_request = FriendRequest.objects.create(sender=sender, receiver=receiver, status=FriendRequest.STATUS_PENDING)
    create_notification(
        user=receiver,
        actor=sender,
        notification_type=InAppNotification.TYPE_FRIEND_REQUEST,
        title='Заявка в друзья',
        message=f'{sender.nickname} отправил вам заявку в друзья.',
        payload={'friend_request_id': friend_request.id},
    )
    return friend_request


@transaction.atomic
def accept_friend_request(friend_request: FriendRequest, by_user: User) -> FriendRequest:
    if friend_request.receiver_id != by_user.id:
        raise ValidationError('Вы не можете принять эту заявку.')
    if friend_request.status != FriendRequest.STATUS_PENDING:
        raise ValidationError('Заявка уже не в статусе ожидания.')

    low_id, high_id = _pair_ids(friend_request.sender_id, friend_request.receiver_id)
    Friendship.objects.get_or_create(user_low_id=low_id, user_high_id=high_id)
    friend_request.status = FriendRequest.STATUS_ACCEPTED
    friend_request.responded_at = timezone.now()
    friend_request.save(update_fields=['status', 'responded_at'])

    create_notification(
        user=friend_request.sender,
        actor=by_user,
        notification_type=InAppNotification.TYPE_SYSTEM,
        title='Заявка в друзья принята',
        message=f'{by_user.nickname} принял вашу заявку в друзья.',
        payload={'friend_user_id': by_user.id},
    )
    return friend_request


@transaction.atomic
def decline_friend_request(friend_request: FriendRequest, by_user: User) -> FriendRequest:
    if friend_request.receiver_id != by_user.id:
        raise ValidationError('Вы не можете отклонить эту заявку.')
    if friend_request.status != FriendRequest.STATUS_PENDING:
        raise ValidationError('Заявка уже не в статусе ожидания.')
    friend_request.status = FriendRequest.STATUS_DECLINED
    friend_request.responded_at = timezone.now()
    friend_request.save(update_fields=['status', 'responded_at'])
    return friend_request


def get_or_create_direct_conversation(user_a: User, user_b: User) -> DirectConversation:
    low_id, high_id = _pair_ids(user_a.id, user_b.id)
    conversation, _ = DirectConversation.objects.get_or_create(user_low_id=low_id, user_high_id=high_id)
    return conversation


@transaction.atomic
def send_direct_message(sender: User, recipient: User, text: str) -> DirectMessage:
    if sender.id == recipient.id:
        raise ValidationError('Нельзя отправить сообщение самому себе.')
    if not are_friends(sender, recipient):
        raise ValidationError('Чат доступен только между друзьями.')
    conversation = get_or_create_direct_conversation(sender, recipient)
    message = DirectMessage.objects.create(conversation=conversation, sender=sender, text=text.strip())
    conversation.save(update_fields=['updated_at'])
    broadcast_chat_message(message)
    return message


def get_user_friendships(user: User):
    return Friendship.objects.filter(Q(user_low=user) | Q(user_high=user)).select_related('user_low', 'user_high')
