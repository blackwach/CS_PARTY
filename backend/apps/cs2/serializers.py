import re

from rest_framework import serializers

from .models import MatchHistory, PlayerStats


def _extract_headshots(raw_data: dict | None) -> int:
    raw = raw_data or {}
    value = (
        raw.get('headshots')
        or raw.get('headshot_kills')
        or raw.get('hs_kills')
        or raw.get('headshots_count')
        or raw.get('hs')
        or 0
    )
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return 0
    return max(parsed, 0)


def _extract_headshot_percent(raw_data: dict | None, kills: int, headshots: int) -> float:
    raw = raw_data or {}
    raw_percent = (
        raw.get('headshot_percent')
        or raw.get('hs_percent')
        or raw.get('headshots_percentage')
        or raw.get('hs_percentage')
    )
    if raw_percent is not None:
        try:
            value = float(raw_percent)
        except (TypeError, ValueError):
            value = None
        if value is not None:
            return round(max(min(value, 100.0), 0.0), 2)

    if kills <= 0:
        return 0.0
    return round((headshots / kills) * 100, 2)


class CS2FriendInviteSerializer(serializers.Serializer):
    invite_link = serializers.CharField(max_length=1024)

    def validate_invite_link(self, value: str) -> str:
        cleaned = str(value or '').strip()
        if not cleaned:
            raise serializers.ValidationError('Введите ссылку приглашения в друзья.')
        return cleaned


class CS2SteamGuardCodeSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=32)

    def validate_code(self, value: str) -> str:
        cleaned = str(value or '').strip().upper()
        if not re.fullmatch(r'[A-Z0-9]{5}', cleaned):
            raise serializers.ValidationError('Введите код Steam Guard из 5 символов (буквы/цифры).')
        return cleaned


class MatchHistorySerializer(serializers.ModelSerializer):
    headshots = serializers.SerializerMethodField()
    headshot_percent = serializers.SerializerMethodField()
    rank_id = serializers.SerializerMethodField()

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
            'headshots',
            'headshot_percent',
            'rank_id',
            'rank_at_match',
        )

    def get_headshots(self, obj):
        return _extract_headshots(obj.raw_data)

    def get_headshot_percent(self, obj):
        kills = int(obj.kills or 0)
        headshots = self.get_headshots(obj)
        return _extract_headshot_percent(obj.raw_data, kills, headshots)

    def get_rank_id(self, obj):
        value = (obj.raw_data or {}).get('rank_id')
        if value is None:
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None


class PlayerStatsSerializer(serializers.ModelSerializer):
    rank_id = serializers.SerializerMethodField()
    recent_matches = serializers.SerializerMethodField()
    averages = serializers.SerializerMethodField()
    synced = serializers.SerializerMethodField()
    source = serializers.SerializerMethodField()
    note = serializers.SerializerMethodField()

    class Meta:
        model = PlayerStats
        fields = (
            'rank',
            'rank_id',
            'wins',
            'losses',
            'total_matches',
            'last_synced_at',
            'recent_matches',
            'averages',
            'synced',
            'source',
            'note',
        )

    def get_recent_matches(self, obj):
        matches = obj.user.cs2_matches.all()[:10]
        return MatchHistorySerializer(matches, many=True).data

    def get_rank_id(self, obj):
        value = (obj.raw_data or {}).get('rank_id')
        if value is None:
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    def get_averages(self, obj):
        matches = list(obj.user.cs2_matches.all())
        total_matches = len(matches)
        if total_matches == 0:
            return {
                'matches_count': 0,
                'avg_kills': 0.0,
                'avg_deaths': 0.0,
                'avg_assists': 0.0,
                'avg_kd': 0.0,
                'avg_kda': 0.0,
                'avg_hs_percent': 0.0,
            }

        total_kills = 0
        total_deaths = 0
        total_assists = 0
        total_headshots = 0

        for item in matches:
            kills = int(item.kills or 0)
            deaths = int(item.deaths or 0)
            assists = int(item.assists or 0)
            total_kills += kills
            total_deaths += deaths
            total_assists += assists
            total_headshots += _extract_headshots(item.raw_data)

        avg_kills = total_kills / total_matches
        avg_deaths = total_deaths / total_matches
        avg_assists = total_assists / total_matches

        if total_deaths > 0:
            avg_kd = total_kills / total_deaths
            avg_kda = (total_kills + total_assists) / total_deaths
        else:
            avg_kd = float(total_kills)
            avg_kda = float(total_kills + total_assists)

        avg_hs_percent = (total_headshots / total_kills) * 100 if total_kills > 0 else 0.0

        return {
            'matches_count': total_matches,
            'avg_kills': round(avg_kills, 2),
            'avg_deaths': round(avg_deaths, 2),
            'avg_assists': round(avg_assists, 2),
            'avg_kd': round(avg_kd, 2),
            'avg_kda': round(avg_kda, 2),
            'avg_hs_percent': round(avg_hs_percent, 2),
        }

    def get_synced(self, obj):
        return True

    def get_source(self, obj):
        return str((obj.raw_data or {}).get('source') or 'provider')

    def get_note(self, obj):
        return str((obj.raw_data or {}).get('note') or '')
