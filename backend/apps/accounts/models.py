import secrets
import string
from datetime import date

from django.contrib.auth.models import AbstractUser, UserManager as DjangoUserManager
from django.db import models
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
    avatar = models.ImageField(upload_to='avatars/', blank=True, null=True)
    steam_account_id = models.CharField(max_length=64, blank=True)
    steam_profile_url = models.URLField(max_length=512, blank=True)
    is_email_verified = models.BooleanField(default=False)
    telegram_chat_id = models.BigIntegerField(unique=True, blank=True, null=True)
    telegram_username = models.CharField(max_length=255, blank=True)
    telegram_notifications_enabled = models.BooleanField(default=True)
    allowed_inviters = models.ManyToManyField('self', symmetrical=False, related_name='allowed_targets', blank=True)

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['username', 'nickname', 'birth_date', 'initials']

    objects = UserManager()

    def __str__(self) -> str:
        return f'{self.nickname} <{self.email}>'


class EmailActionToken(models.Model):
    VERIFY_EMAIL = 'verify_email'
    RESET_PASSWORD = 'reset_password'
    TELEGRAM_LINK = 'telegram_link'

    ACTION_CHOICES = [
        (VERIFY_EMAIL, 'Verify email'),
        (RESET_PASSWORD, 'Reset password'),
        (TELEGRAM_LINK, 'Telegram link'),
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
