import secrets
import string
from datetime import date

from django.contrib.auth.models import AbstractUser, UserManager as DjangoUserManager
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils import timezone


def generate_action_token() -> str:
    return secrets.token_urlsafe(32)


def generate_telegram_code() -> str:
    alphabet = string.ascii_uppercase + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(10))


class UserManager(DjangoUserManager):
    def _create_user(self, email, password, **extra_fields):
        if not email:
            raise ValueError('The email must be set.')
        email = self.normalize_email(email)
        username = extra_fields.pop('username', None) or email.split('@')[0]
        user = self.model(email=email, username=username, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra_fields):
        extra_fields.setdefault('is_staff', False)
        extra_fields.setdefault('is_superuser', False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)
        extra_fields.setdefault('is_active', True)
        extra_fields.setdefault('is_email_verified', True)
        extra_fields.setdefault('nickname', 'admin')
        extra_fields.setdefault('birth_date', date(1990, 1, 1))
        extra_fields.setdefault('initials', 'ADM')

        if extra_fields.get('is_staff') is not True:
            raise ValueError('Superuser must have is_staff=True.')
        if extra_fields.get('is_superuser') is not True:
            raise ValueError('Superuser must have is_superuser=True.')

        return self._create_user(email, password, **extra_fields)


class User(AbstractUser):
    email = models.EmailField(unique=True)
    nickname = models.CharField(max_length=40, unique=True)
    birth_date = models.DateField()
    initials = models.CharField(max_length=16)
    about = models.TextField(blank=True)
    avatar = models.ImageField(upload_to='avatars/', blank=True, null=True)
    steam_account_id = models.CharField(max_length=64, blank=True)
    steam_profile_url = models.URLField(max_length=512, blank=True)
    cs2_match_token = models.CharField(max_length=1024, blank=True)
    is_email_verified = models.BooleanField(default=False)
    pending_email = models.EmailField(blank=True)
    pending_email_previous = models.EmailField(blank=True)
    pending_email_expires_at = models.DateTimeField(blank=True, null=True)
    last_seen_at = models.DateTimeField(blank=True, null=True)
    ws_connection_count = models.PositiveIntegerField(default=0)
    telegram_chat_id = models.BigIntegerField(unique=True, blank=True, null=True)
    telegram_username = models.CharField(max_length=255, blank=True)
    telegram_notifications_enabled = models.BooleanField(default=True)
    allowed_inviters = models.ManyToManyField('self', symmetrical=False, related_name='allowed_targets', blank=True)

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['username', 'nickname', 'birth_date', 'initials']

    objects = UserManager()

    def __str__(self) -> str:
        return f'{self.nickname} <{self.email}>'

    def clear_pending_email_change(self) -> None:
        self.pending_email = ''
        self.pending_email_previous = ''
        self.pending_email_expires_at = None

    @property
    def is_online(self) -> bool:
        return self.ws_connection_count > 0

    def get_cs2_match_token(self) -> str:
        from .cs2_token_security import decrypt_cs2_match_token

        return decrypt_cs2_match_token(self.cs2_match_token)

    def get_cs2_match_token_masked(self) -> str:
        from .cs2_token_security import mask_cs2_match_token

        return mask_cs2_match_token(self.cs2_match_token)


class EmailActionToken(models.Model):
    VERIFY_EMAIL = 'verify_email'
    RESET_PASSWORD = 'reset_password'
    TELEGRAM_LINK = 'telegram_link'
    DELETE_ACCOUNT = 'delete_account'

    ACTION_CHOICES = [
        (VERIFY_EMAIL, 'Verify email'),
        (RESET_PASSWORD, 'Reset password'),
        (TELEGRAM_LINK, 'Telegram link'),
        (DELETE_ACCOUNT, 'Delete account'),
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='action_tokens')
    action = models.CharField(max_length=32, choices=ACTION_CHOICES)
    token = models.CharField(max_length=128, unique=True, default=generate_action_token)
    payload = models.JSONField(default=dict, blank=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['action', 'token']),
            models.Index(fields=['expires_at']),
        ]

    def is_valid(self) -> bool:
        return self.used_at is None and self.expires_at > timezone.now()

    def mark_used(self) -> None:
        self.used_at = timezone.now()
        self.save(update_fields=['used_at'])


class Friendship(models.Model):
    user_low = models.ForeignKey(User, on_delete=models.CASCADE, related_name='friendships_low')
    user_high = models.ForeignKey(User, on_delete=models.CASCADE, related_name='friendships_high')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(fields=['user_low', 'user_high'], name='unique_friendship_pair'),
            models.CheckConstraint(check=~Q(user_low=models.F('user_high')), name='friendship_users_not_equal'),
        ]

    def save(self, *args, **kwargs):
        if self.user_low_id and self.user_high_id and self.user_low_id > self.user_high_id:
            self.user_low_id, self.user_high_id = self.user_high_id, self.user_low_id
        super().save(*args, **kwargs)

    def clean(self):
        if self.user_low_id and self.user_high_id and self.user_low_id == self.user_high_id:
            raise ValidationError('Friendship users must be different.')

    def __str__(self) -> str:
        return f'{self.user_low_id}<->{self.user_high_id}'


class FriendRequest(models.Model):
    STATUS_PENDING = 'pending'
    STATUS_ACCEPTED = 'accepted'
    STATUS_DECLINED = 'declined'
    STATUS_CANCELLED = 'cancelled'

    STATUS_CHOICES = [
        (STATUS_PENDING, 'Pending'),
        (STATUS_ACCEPTED, 'Accepted'),
        (STATUS_DECLINED, 'Declined'),
        (STATUS_CANCELLED, 'Cancelled'),
    ]

    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name='sent_friend_requests')
    receiver = models.ForeignKey(User, on_delete=models.CASCADE, related_name='received_friend_requests')
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    responded_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['receiver', 'status']),
            models.Index(fields=['sender', 'status']),
        ]
        constraints = [
            models.CheckConstraint(check=~Q(sender=models.F('receiver')), name='friend_request_users_not_equal'),
        ]

    def __str__(self) -> str:
        return f'{self.sender_id}->{self.receiver_id}:{self.status}'


class DirectConversation(models.Model):
    user_low = models.ForeignKey(User, on_delete=models.CASCADE, related_name='direct_conversations_low')
    user_high = models.ForeignKey(User, on_delete=models.CASCADE, related_name='direct_conversations_high')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']
        constraints = [
            models.UniqueConstraint(fields=['user_low', 'user_high'], name='unique_direct_conversation_pair'),
            models.CheckConstraint(check=~Q(user_low=models.F('user_high')), name='direct_conversation_users_not_equal'),
        ]

    def save(self, *args, **kwargs):
        if self.user_low_id and self.user_high_id and self.user_low_id > self.user_high_id:
            self.user_low_id, self.user_high_id = self.user_high_id, self.user_low_id
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f'conversation:{self.user_low_id}-{self.user_high_id}'


class DirectMessage(models.Model):
    conversation = models.ForeignKey(DirectConversation, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name='direct_messages_sent')
    text = models.TextField(max_length=4000)
    created_at = models.DateTimeField(auto_now_add=True)
    read_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['conversation', 'created_at']),
            models.Index(fields=['sender', 'created_at']),
        ]

    def __str__(self) -> str:
        return f'msg:{self.id} conv:{self.conversation_id} sender:{self.sender_id}'
