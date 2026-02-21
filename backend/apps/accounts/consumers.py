from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.contrib.auth.models import AnonymousUser
from rest_framework.exceptions import ValidationError

from apps.notifications.realtime import notification_group_name
from .models import User
from .realtime import chat_group_name
from .services import are_friends, send_direct_message


class NotificationsConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        user = self.scope.get('user')
        if not user or isinstance(user, AnonymousUser) or not user.is_authenticated:
            await self.close(code=4401)
            return
        self.group_name = notification_group_name(user.id)
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def notify_message(self, event):
        await self.send_json({'type': 'notification', 'data': event['payload']})


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

    async def disconnect(self, close_code):
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive_json(self, content, **kwargs):
        event_type = content.get('type')
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
        await self.send_json({'type': 'message.new', 'data': event['payload']})

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
