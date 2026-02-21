from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import serializers

from apps.accounts.serializers import PublicUserSerializer
from .models import GameRoom, RoomMembership

User = get_user_model()


class RoomCreateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=120)
    scheduled_for = serializers.DateTimeField()
    invited_user_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), allow_empty=True)
    host_auto_server = serializers.BooleanField(required=False, default=False)
    host_server_host = serializers.CharField(max_length=255, required=False, allow_blank=True)
    host_server_port = serializers.IntegerField(min_value=1, max_value=65535, required=False)
    host_server_password = serializers.CharField(max_length=128, required=False, allow_blank=True)
    host_server_map = serializers.CharField(max_length=64, required=False, allow_blank=True)

    def validate_scheduled_for(self, value):
        if value <= timezone.now():
            raise serializers.ValidationError('Room start time must be in the future.')
        return value

    def validate(self, attrs):
        host_auto_server = bool(attrs.get('host_auto_server', False))
        host = (attrs.get('host_server_host') or '').strip()
        port = attrs.get('host_server_port')
        room_map = (attrs.get('host_server_map') or '').strip() or 'de_dust2'

        if host_auto_server:
            attrs['host_server_host'] = ''
            attrs['host_server_port'] = int(port or 27015)
            attrs['host_server_password'] = (attrs.get('host_server_password') or '').strip()
            attrs['host_server_map'] = room_map
            return attrs

        if host and not port:
            raise serializers.ValidationError({'host_server_port': 'Specify host server port.'})
        if port and not host:
            raise serializers.ValidationError({'host_server_host': 'Specify host server address.'})

        attrs['host_server_host'] = host
        attrs['host_server_password'] = (attrs.get('host_server_password') or '').strip()
        attrs['host_server_map'] = room_map
        return attrs


class RoomMembershipSerializer(serializers.ModelSerializer):
    user = PublicUserSerializer(read_only=True)

    class Meta:
        model = RoomMembership
        fields = ('id', 'user', 'state', 'joined_via', 'ready_at')


class RoomSerializer(serializers.ModelSerializer):
    host = PublicUserSerializer(read_only=True)
    memberships = RoomMembershipSerializer(many=True, read_only=True)
    server_source = serializers.SerializerMethodField()

    def get_server_source(self, obj):
        return str((obj.server_provider_payload or {}).get('source') or '')

    class Meta:
        model = GameRoom
        fields = (
            'id',
            'code',
            'title',
            'host',
            'scheduled_for',
            'max_players',
            'status',
            'reminder_sent',
            'server_host',
            'server_port',
            'server_connect_url',
            'server_launch_command',
            'server_source',
            'server_error',
            'server_provisioned_at',
            'memberships',
            'created_at',
        )
