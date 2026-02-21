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

    def validate_scheduled_for(self, value):
        if value <= timezone.now():
            raise serializers.ValidationError('Время сбора должно быть в будущем.')
        return value


class RoomMembershipSerializer(serializers.ModelSerializer):
    user = PublicUserSerializer(read_only=True)

    class Meta:
        model = RoomMembership
        fields = ('id', 'user', 'state', 'joined_via', 'ready_at')


class RoomSerializer(serializers.ModelSerializer):
    host = PublicUserSerializer(read_only=True)
    memberships = RoomMembershipSerializer(many=True, read_only=True)

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
            'memberships',
            'created_at',
        )
