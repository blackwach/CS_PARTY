import secrets
import string

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


def generate_room_code() -> str:
    alphabet = string.ascii_uppercase + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(8))


class GameRoom(models.Model):
    STATUS_OPEN = 'open'
    STATUS_READY = 'ready'
    STATUS_STARTED = 'started'
    STATUS_FINISHED = 'finished'
    STATUS_CANCELLED = 'cancelled'

    STATUS_CHOICES = [
        (STATUS_OPEN, 'Open'),
        (STATUS_READY, 'Ready'),
        (STATUS_STARTED, 'Started'),
        (STATUS_FINISHED, 'Finished'),
        (STATUS_CANCELLED, 'Cancelled'),
    ]

    code = models.CharField(max_length=8, unique=True, default=generate_room_code)
    host = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='hosted_rooms')
    title = models.CharField(max_length=120)
    scheduled_for = models.DateTimeField()
    max_players = models.PositiveSmallIntegerField(default=5, validators=[MinValueValidator(1), MaxValueValidator(5)])
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_OPEN)
    reminder_sent = models.BooleanField(default=False)
    server_host = models.CharField(max_length=255, blank=True)
    server_port = models.PositiveIntegerField(blank=True, null=True)
    server_password = models.CharField(max_length=128, blank=True)
    server_connect_url = models.CharField(max_length=1024, blank=True)
    server_launch_command = models.CharField(max_length=1024, blank=True)
    server_error = models.CharField(max_length=512, blank=True)
    server_provider_payload = models.JSONField(default=dict, blank=True)
    server_provisioned_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['scheduled_for', '-created_at']

    def __str__(self) -> str:
        return f'{self.code} ({self.title})'

    @property
    def server_endpoint(self) -> str:
        if not self.server_host or not self.server_port:
            return ''
        return f'{self.server_host}:{self.server_port}'


class RoomMembership(models.Model):
    STATE_INVITED = 'invited'
    STATE_JOINED = 'joined'
    STATE_READY = 'ready'
    STATE_DECLINED = 'declined'

    STATE_CHOICES = [
        (STATE_INVITED, 'Invited'),
        (STATE_JOINED, 'Joined'),
        (STATE_READY, 'Ready'),
        (STATE_DECLINED, 'Declined'),
    ]

    VIA_WEB = 'web'
    VIA_TELEGRAM = 'telegram'
    VIA_SYSTEM = 'system'

    VIA_CHOICES = [
        (VIA_WEB, 'Web'),
        (VIA_TELEGRAM, 'Telegram'),
        (VIA_SYSTEM, 'System'),
    ]

    room = models.ForeignKey(GameRoom, on_delete=models.CASCADE, related_name='memberships')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='room_memberships')
    state = models.CharField(max_length=16, choices=STATE_CHOICES, default=STATE_INVITED)
    joined_via = models.CharField(max_length=16, choices=VIA_CHOICES, default=VIA_WEB)
    ready_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('room', 'user')
        ordering = ['created_at']

    def __str__(self) -> str:
        return f'{self.user_id}:{self.room_id}:{self.state}'
