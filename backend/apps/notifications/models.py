from django.conf import settings
from django.db import models
from django.utils import timezone


class InAppNotification(models.Model):
    TYPE_FRIEND_REQUEST = 'friend_request'
    TYPE_ROOM_INVITE = 'room_invite'
    TYPE_SYSTEM = 'system'

    TYPE_CHOICES = [
        (TYPE_FRIEND_REQUEST, 'Friend request'),
        (TYPE_ROOM_INVITE, 'Room invite'),
        (TYPE_SYSTEM, 'System'),
    ]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='in_app_notifications')
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, blank=True, null=True, related_name='notifications_created')
    type = models.CharField(max_length=32, choices=TYPE_CHOICES, default=TYPE_SYSTEM)
    title = models.CharField(max_length=255)
    message = models.TextField(blank=True)
    payload = models.JSONField(default=dict, blank=True)
    is_read = models.BooleanField(default=False)
    read_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'is_read', 'created_at']),
            models.Index(fields=['type', 'created_at']),
        ]

    def mark_read(self) -> None:
        if self.is_read:
            return
        self.is_read = True
        self.read_at = timezone.now()
        self.save(update_fields=['is_read', 'read_at'])
        from .realtime import broadcast_notification

        broadcast_notification(self)

    def __str__(self) -> str:
        return f'notification:{self.id} user:{self.user_id} type:{self.type}'
