from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.contrib.auth.models import AnonymousUser

from .models import GameRoom, RoomMembership
from .realtime import get_room_payload, room_group_name


class RoomConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        user = self.scope.get('user')
        if not user or isinstance(user, AnonymousUser) or not user.is_authenticated:
            await self.close(code=4401)
            return

        self.user = user
        self.room_code = str(self.scope['url_route']['kwargs']['code']).strip().upper()
        allowed = await self._can_view_room(self.room_code, self.user.id)
        if not allowed:
            await self.close(code=4403)
            return

        self.group_name = room_group_name(self.room_code)
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        payload = await self._get_room_payload(self.room_code)
        if payload:
            await self.send_json({'type': 'room.state', 'data': payload})

    async def disconnect(self, close_code):
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive_json(self, content, **kwargs):
        event_type = str(content.get('type') or '').strip()
        if event_type != 'room.sync':
            return
        payload = await self._get_room_payload(self.room_code)
        if payload:
            await self.send_json({'type': 'room.state', 'data': payload})

    async def room_state(self, event):
        await self.send_json({'type': 'room.state', 'data': event['payload']})

    @database_sync_to_async
    def _can_view_room(self, room_code: str, user_id: int) -> bool:
        room = GameRoom.objects.filter(code=room_code).first()
        if not room:
            return False
        return RoomMembership.objects.filter(room=room, user_id=user_id).exists()

    @database_sync_to_async
    def _get_room_payload(self, room_code: str):
        return get_room_payload(room_code)
