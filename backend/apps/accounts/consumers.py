from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.contrib.auth.models import AnonymousUser
from rest_framework.exceptions import ValidationError

from apps.notifications.realtime import notification_group_name
from .models import User
from .realtime import broadcast_chat_presence, chat_group_name
from .services import (
    are_friends,
    get_user_presence,
    mark_direct_messages_as_read,
    mark_user_connected,
    mark_user_disconnected,
    send_direct_message,
)


class NotificationsConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        user = self.scope.get('user')
        if not user or isinstance(user, AnonymousUser) or not user.is_authenticated:
            await self.close(code=4401)
            return
        self.user = user
        await self._mark_connected(self.user.id)
        self.group_name = notification_group_name(user.id)
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, 'user'):
            await self._mark_disconnected(self.user.id)
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def notify_message(self, event):
        await self.send_json({'type': 'notification', 'data': event['payload']})

    @database_sync_to_async
    def _mark_connected(self, user_id: int):
        return mark_user_connected(user_id)

    @database_sync_to_async
    def _mark_disconnected(self, user_id: int):
        return mark_user_disconnected(user_id)


class ChatConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        user = self.scope.get('user')
        if not user or isinstance(user, AnonymousUser) or not user.is_authenticated:
            await self.close(code=4401)
            return

        self.user = user
        self.peer_id = int(self.scope['url_route']['kwargs']['user_id'])
        allowed = await self._can_chat(self.user.id, self.peer_id)
        if not allowed:
            await self.close(code=4403)
            return

        self.group_name = chat_group_name(self.user.id, self.peer_id)
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        presence = await self._mark_connected(self.user.id)
        await self._mark_read_messages(self.user.id, self.peer_id)
        peer_presence = await self._get_presence(self.peer_id)
        await self.send_json({'type': 'presence.update', 'data': peer_presence})
        await self._broadcast_presence(
            user_a_id=self.user.id,
            user_b_id=self.peer_id,
            user_id=self.user.id,
            is_online=bool(presence.get('is_online')),
            last_seen_at=presence.get('last_seen_at'),
        )

    async def disconnect(self, close_code):
        presence = None
        if hasattr(self, 'user'):
            presence = await self._mark_disconnected(self.user.id)
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)
        if hasattr(self, 'user') and hasattr(self, 'peer_id') and presence is not None:
            await self._broadcast_presence(
                user_a_id=self.user.id,
                user_b_id=self.peer_id,
                user_id=self.user.id,
                is_online=bool(presence.get('is_online')),
                last_seen_at=presence.get('last_seen_at'),
            )

    async def receive_json(self, content, **kwargs):
        event_type = content.get('type')
        if event_type == 'messages.read':
            await self._mark_read_messages(self.user.id, self.peer_id)
            return
        if event_type != 'message.send':
            return
        text = (content.get('text') or '').strip()
        if not text:
            return
        try:
            await self._send_message(self.user.id, self.peer_id, text)
        except ValidationError as exc:
            await self.send_json({'type': 'error', 'detail': str(exc.detail)})

    async def chat_message(self, event):
        payload = event['payload']
        await self.send_json({'type': 'message.new', 'data': payload})
        sender_id = (payload.get('sender') or {}).get('id')
        if sender_id == self.peer_id:
            await self._mark_read_messages(self.user.id, self.peer_id)

    async def chat_presence(self, event):
        await self.send_json({'type': 'presence.update', 'data': event['payload']})

    async def chat_read(self, event):
        await self.send_json({'type': 'message.read', 'data': event['payload']})

    @database_sync_to_async
    def _can_chat(self, user_id: int, peer_id: int) -> bool:
        user = User.objects.filter(id=user_id, is_active=True).first()
        peer = User.objects.filter(id=peer_id, is_active=True).first()
        if not user or not peer:
            return False
        return are_friends(user, peer)

    @database_sync_to_async
    def _send_message(self, sender_id: int, recipient_id: int, text: str):
        sender = User.objects.get(id=sender_id)
        recipient = User.objects.get(id=recipient_id)
        return send_direct_message(sender, recipient, text)

    @database_sync_to_async
    def _mark_read_messages(self, user_id: int, peer_id: int):
        user = User.objects.filter(id=user_id, is_active=True).first()
        peer = User.objects.filter(id=peer_id, is_active=True).first()
        if not user or not peer:
            return []
        return mark_direct_messages_as_read(user, peer)

    @database_sync_to_async
    def _mark_connected(self, user_id: int):
        return mark_user_connected(user_id)

    @database_sync_to_async
    def _mark_disconnected(self, user_id: int):
        return mark_user_disconnected(user_id)

    @database_sync_to_async
    def _get_presence(self, user_id: int):
        return get_user_presence(user_id)

    @database_sync_to_async
    def _broadcast_presence(self, user_a_id: int, user_b_id: int, user_id: int, is_online: bool, last_seen_at: str | None):
        broadcast_chat_presence(
            user_a_id=user_a_id,
            user_b_id=user_b_id,
            user_id=user_id,
            is_online=is_online,
            last_seen_at=last_seen_at,
        )
