from datetime import datetime

from rest_framework import serializers

from .models import MatchHistory, PlayerStats


class CS2FriendInviteSerializer(serializers.Serializer):
    invite_link = serializers.CharField(max_length=1024)

    def validate_invite_link(self, value: str) -> str:
        cleaned = str(value or '').strip()
        if not cleaned:
            raise serializers.ValidationError('Введите ссылку приглашения в друзья.')
        return cleaned


class MatchHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = MatchHistory
        fields = (
            'external_match_id',
            'played_at',
            'map_name',
            'result',
            'kills',
            'deaths',
            'assists',
            'rank_at_match',
        )


class PlayerStatsSerializer(serializers.ModelSerializer):
    recent_matches = serializers.SerializerMethodField()
    synced = serializers.SerializerMethodField()
    source = serializers.SerializerMethodField()
    note = serializers.SerializerMethodField()

    class Meta:
        model = PlayerStats
        fields = ('rank', 'wins', 'losses', 'total_matches', 'last_synced_at', 'recent_matches', 'synced', 'source', 'note')

    def get_recent_matches(self, obj):
        matches = obj.user.cs2_matches.all()[:10]
        return MatchHistorySerializer(matches, many=True).data

    def get_synced(self, obj):
        return True

    def get_source(self, obj):
        return str((obj.raw_data or {}).get('source') or 'provider')

    def get_note(self, obj):
        return str((obj.raw_data or {}).get('note') or '')
