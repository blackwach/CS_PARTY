import logging

from asgiref.sync import async_to_sync
try:
    from channels.layers import get_channel_layer
except Exception:  # pragma: no cover - fallback for local env without channels
    def get_channel_layer():
        return None

logger = logging.getLogger(__name__)


def chat_group_name(user_a_id: int, user_b_id: int) -> str:
    low_id, high_id = sorted((int(user_a_id), int(user_b_id)))
    return f'chat_{low_id}_{high_id}'


def broadcast_chat_message(message) -> None:
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    group = chat_group_name(message.conversation.user_low_id, message.conversation.user_high_id)
    try:
        async_to_sync(channel_layer.group_send)(
            group,
            {
                'type': 'chat.message',
                'payload': {
                    'id': message.id,
                    'text': message.text,
                    'created_at': message.created_at.isoformat(),
                    'read_at': message.read_at.isoformat() if message.read_at else None,
                    'sender': {
                        'id': message.sender_id,
                        'nickname': message.sender.nickname,
                        'avatar': message.sender.avatar.url if message.sender.avatar else None,
                    },
                },
            },
        )
    except Exception as exc:  # pragma: no cover - best-effort realtime
        logger.warning('Chat realtime broadcast skipped: %s', exc)


def broadcast_chat_presence(
    *,
    user_a_id: int,
    user_b_id: int,
    user_id: int,
    is_online: bool,
    last_seen_at=None,
) -> None:
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    group = chat_group_name(user_a_id, user_b_id)
    try:
        if isinstance(last_seen_at, str):
            last_seen_value = last_seen_at
        else:
            last_seen_value = last_seen_at.isoformat() if last_seen_at else None
        async_to_sync(channel_layer.group_send)(
            group,
            {
                'type': 'chat.presence',
                'payload': {
                    'user_id': int(user_id),
                    'is_online': bool(is_online),
                    'last_seen_at': last_seen_value,
                },
            },
        )
    except Exception as exc:  # pragma: no cover - best-effort realtime
        logger.warning('Chat presence broadcast skipped: %s', exc)


def broadcast_chat_read(*, conversation, reader_id: int, message_ids: list[int], read_at) -> None:
    if not message_ids:
        return
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    group = chat_group_name(conversation.user_low_id, conversation.user_high_id)
    try:
        async_to_sync(channel_layer.group_send)(
            group,
            {
                'type': 'chat.read',
                'payload': {
                    'reader_id': int(reader_id),
                    'message_ids': [int(item) for item in message_ids],
                    'read_at': read_at.isoformat() if read_at else None,
                },
            },
        )
    except Exception as exc:  # pragma: no cover - best-effort realtime
        logger.warning('Chat read-receipt broadcast skipped: %s', exc)
