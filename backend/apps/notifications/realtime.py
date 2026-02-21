from asgiref.sync import async_to_sync
try:
    from channels.layers import get_channel_layer
except Exception:  # pragma: no cover - fallback for local env without channels
    def get_channel_layer():
        return None


def notification_group_name(user_id: int) -> str:
    return f'user_{int(user_id)}'


def notification_payload(notification) -> dict:
    return {
        'id': notification.id,
        'type': notification.type,
        'title': notification.title,
        'message': notification.message,
        'payload': notification.payload,
        'is_read': notification.is_read,
        'created_at': notification.created_at.isoformat(),
        'read_at': notification.read_at.isoformat() if notification.read_at else None,
        'actor': {
            'id': notification.actor_id,
            'nickname': notification.actor.nickname,
            'avatar': notification.actor.avatar.url if notification.actor and notification.actor.avatar else None,
        } if notification.actor else None,
    }


def broadcast_notification(notification) -> None:
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    async_to_sync(channel_layer.group_send)(
        notification_group_name(notification.user_id),
        {
            'type': 'notify.message',
            'payload': notification_payload(notification),
        },
    )
