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


def _to_int_or_none(value) -> int | None:
    if value is None:
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed


def _to_int(value, default: int = 0) -> int:
    parsed = _to_int_or_none(value)
    if parsed is None:
        return int(default)
    return int(parsed)


def _extract_premier_rating(raw_data: dict | None) -> int | None:
    raw = raw_data or {}
    candidates = [
        raw.get('premier_rating'),
        raw.get('premierRating'),
    ]
    premier_obj = raw.get('premier')
    if isinstance(premier_obj, dict):
        candidates.extend(
            [
                premier_obj.get('rating'),
                premier_obj.get('premier_rating'),
                premier_obj.get('premierRating'),
            ]
        )

    for candidate in candidates:
        parsed = _to_int_or_none(candidate)
        if parsed is not None and parsed > 0:
            return parsed
    return None


def _extract_premier_rank_id(raw_data: dict | None) -> int | None:
    raw = raw_data or {}
    candidates = [
        raw.get('premier_rank_id'),
        raw.get('premierRankId'),
        raw.get('premier_rank'),
    ]
    premier_obj = raw.get('premier')
    if isinstance(premier_obj, dict):
        candidates.extend(
            [
                premier_obj.get('rank_id'),
                premier_obj.get('premier_rank_id'),
                premier_obj.get('premierRankId'),
            ]
        )

    for candidate in candidates:
        parsed = _to_int_or_none(candidate)
        if parsed is not None:
            return parsed
    return None


def _extract_premier_rank_name(raw_data: dict | None) -> str:
    raw = raw_data or {}
    candidates = [
        raw.get('premier_rank'),
        raw.get('premierRank'),
    ]
    premier_obj = raw.get('premier')
    if isinstance(premier_obj, dict):
        candidates.extend(
            [
                premier_obj.get('rank'),
                premier_obj.get('name'),
                premier_obj.get('premier_rank'),
            ]
        )

    for candidate in candidates:
        text = str(candidate or '').strip()
        if text:
            return text
    return ''


def _collect_map_stats_from_matches(obj: PlayerStats | None) -> dict[str, dict]:
    if obj is None:
        return {}

    aggregate: dict[str, dict] = {}
    for item in _unique_matches(obj):
        map_name = str(item.map_name or '').strip()
        if not map_name:
            continue

        key = map_name.lower()
        if key not in aggregate:
            aggregate[key] = {
                'map': map_name,
                'rank_id': None,
                'rank': '',
                'wins': 0,
                'losses': 0,
                'matches': 0,
                'win_rate': 0.0,
            }

        row = aggregate[key]
        row['matches'] += 1
        if item.result == MatchHistory.RESULT_WIN:
            row['wins'] += 1
        elif item.result == MatchHistory.RESULT_LOSE:
            row['losses'] += 1

        match_rank_id = _to_int_or_none((item.raw_data or {}).get('rank_id'))
        if row['rank_id'] is None and match_rank_id is not None:
            row['rank_id'] = match_rank_id

        rank_at_match = str(item.rank_at_match or '').strip()
        if not row['rank'] and rank_at_match:
            row['rank'] = rank_at_match

    for row in aggregate.values():
        matches = int(row['matches'] or 0)
        wins = int(row['wins'] or 0)
        row['win_rate'] = round((wins / matches) * 100, 2) if matches > 0 else 0.0
    return aggregate


def _extract_map_ranks(raw_data: dict | None, obj: PlayerStats | None = None) -> list[dict]:
    raw = raw_data or {}
    rows = raw.get('map_ranks') or raw.get('mapRanks') or []
    row_items = rows if isinstance(rows, list) else []
    match_stats = _collect_map_stats_from_matches(obj)

    seen_maps: set[str] = set()
    normalized: list[dict] = []
    for index, row in enumerate(row_items):
        if not isinstance(row, dict):
            continue

        map_name = str(row.get('map') or row.get('map_name') or f'map_{index + 1}').strip()
        if not map_name:
            continue
        map_key = map_name.lower()
        if map_key in seen_maps:
            continue

        fallback = match_stats.get(map_key) or {}
        rank_id = _to_int_or_none(row.get('rank_id'))
        if rank_id is None:
            rank_id = fallback.get('rank_id')

        rank_name = str(row.get('rank') or row.get('rank_name') or '').strip() or str(fallback.get('rank') or '').strip()
        wins = max(
            _to_int(
                row.get('wins')
                or row.get('wins_count')
                or row.get('win_count')
                or row.get('winCount')
                or fallback.get('wins')
                or 0,
                0,
            ),
            0,
        )
        losses = max(
            _to_int(
                row.get('losses')
                or row.get('losses_count')
                or row.get('loss_count')
                or row.get('lossCount')
                or fallback.get('losses')
                or 0,
                0,
            ),
            0,
        )
        matches = max(
            _to_int(
                row.get('matches')
                or row.get('total_matches')
                or row.get('totalMatches')
                or row.get('games')
                or fallback.get('matches')
                or 0,
                0,
            ),
            wins + losses,
        )
        raw_win_rate = row.get('win_rate') or row.get('winRate') or row.get('win_percent') or row.get('winPercent')
        if raw_win_rate is None:
            raw_win_rate = fallback.get('win_rate')
        try:
            parsed_win_rate = float(raw_win_rate) if raw_win_rate is not None else None
        except (TypeError, ValueError):
            parsed_win_rate = None
        win_rate = round(max(min(parsed_win_rate, 100.0), 0.0), 2) if parsed_win_rate is not None else (
            round((wins / matches) * 100, 2) if matches > 0 else 0.0
        )

        normalized.append(
            {
                'map': map_name,
                'rank_id': rank_id,
                'rank': rank_name,
                'wins': wins,
                'losses': losses,
                'matches': matches,
                'win_rate': win_rate,
            }
        )
        seen_maps.add(map_key)

    for map_key, fallback in match_stats.items():
        if map_key in seen_maps:
            continue
        normalized.append(
            {
                'map': fallback.get('map') or map_key,
                'rank_id': fallback.get('rank_id'),
                'rank': fallback.get('rank') or '',
                'wins': int(fallback.get('wins') or 0),
                'losses': int(fallback.get('losses') or 0),
                'matches': int(fallback.get('matches') or 0),
                'win_rate': round(float(fallback.get('win_rate') or 0.0), 2),
            }
        )

    normalized.sort(key=lambda item: str(item.get('map') or ''))
    return normalized


def _unique_matches(obj: PlayerStats) -> list[MatchHistory]:
    unique: list[MatchHistory] = []
    seen_ids: set[str] = set()
    for item in obj.user.cs2_matches.all():
        key = str(item.external_match_id or '').strip()
        if not key:
            continue
        if key in seen_ids:
            continue
        seen_ids.add(key)
        unique.append(item)
    return unique


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
    premier_rating = serializers.SerializerMethodField()
    premier_rank_id = serializers.SerializerMethodField()
    premier_rank = serializers.SerializerMethodField()
    map_ranks = serializers.SerializerMethodField()
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
            'premier_rating',
            'premier_rank_id',
            'premier_rank',
            'map_ranks',
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
        matches = _unique_matches(obj)[:10]
        return MatchHistorySerializer(matches, many=True).data

    def get_rank_id(self, obj):
        value = (obj.raw_data or {}).get('rank_id')
        if value is None:
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    def get_premier_rating(self, obj):
        return _extract_premier_rating(obj.raw_data)

    def get_premier_rank_id(self, obj):
        return _extract_premier_rank_id(obj.raw_data)

    def get_premier_rank(self, obj):
        return _extract_premier_rank_name(obj.raw_data)

    def get_map_ranks(self, obj):
        return _extract_map_ranks(obj.raw_data, obj=obj)

    def get_averages(self, obj):
        matches = _unique_matches(obj)
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
