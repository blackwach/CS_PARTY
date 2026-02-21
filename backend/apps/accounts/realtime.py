from asgiref.sync import async_to_sync
try:
    from channels.layers import get_channel_layer
except Exception:  # pragma: no cover - fallback for local env without channels
    def get_channel_layer():
        return None


def chat_group_name(user_a_id: int, user_b_id: int) -> str:
    low_id, high_id = sorted((int(user_a_id), int(user_b_id)))
    return f'chat_{low_id}_{high_id}'


def broadcast_chat_message(message) -> None:
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    group = chat_group_name(message.conversation.user_low_id, message.conversation.user_high_id)
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
