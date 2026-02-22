from rest_framework import mixins, permissions, response, status, viewsets
from rest_framework.decorators import action

from .models import GameRoom
from .serializers import RoomCreateSerializer, RoomSerializer
from .services import (
    close_room,
    create_room_with_invites,
    decline_room,
    diagnose_host_auto_start,
    join_room,
    set_member_ready,
    set_member_unready,
)


class RoomViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = RoomSerializer
    permission_classes = [permissions.IsAuthenticated]
    lookup_field = 'code'

    def get_queryset(self):
        return (
            GameRoom.objects.filter(memberships__user=self.request.user)
            .select_related('host')
            .prefetch_related('memberships__user')
            .distinct()
            .order_by('scheduled_for')
        )

    def create(self, request, *args, **kwargs):
        serializer = RoomCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        room = create_room_with_invites(
            host=request.user,
            title=serializer.validated_data['title'],
            scheduled_for=serializer.validated_data['scheduled_for'],
            invited_user_ids=serializer.validated_data['invited_user_ids'],
            host_auto_server=serializer.validated_data.get('host_auto_server', False),
            host_server_host=serializer.validated_data.get('host_server_host', ''),
            host_server_port=serializer.validated_data.get('host_server_port'),
            host_server_password=serializer.validated_data.get('host_server_password', ''),
            host_server_map=serializer.validated_data.get('host_server_map', 'de_dust2'),
        )
        output = RoomSerializer(room, context={'request': request})
        return response.Response(output.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def join(self, request, code=None):
        room = self.get_object()
        join_room(room, request.user)
        room.refresh_from_db()
        return response.Response(RoomSerializer(room, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def ready(self, request, code=None):
        room = self.get_object()
        host_public_ip = str(request.data.get('host_public_ip') or '').strip()
        set_member_ready(room, request.user, host_public_ip=host_public_ip)
        room.refresh_from_db()
        return response.Response(RoomSerializer(room, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def unready(self, request, code=None):
        room = self.get_object()
        set_member_unready(room, request.user)
        room.refresh_from_db()
        return response.Response(RoomSerializer(room, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def decline(self, request, code=None):
        room = self.get_object()
        decline_room(room, request.user)
        room.refresh_from_db()
        return response.Response(RoomSerializer(room, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def close(self, request, code=None):
        room = self.get_object()
        close_room(room, request.user)
        room.refresh_from_db()
        return response.Response(RoomSerializer(room, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def diagnostics(self, request, code=None):
        room = self.get_object()
        host_public_ip = str(request.data.get('host_public_ip') or '').strip()
        data = diagnose_host_auto_start(room, request.user, host_public_ip=host_public_ip)
        return response.Response(data)
