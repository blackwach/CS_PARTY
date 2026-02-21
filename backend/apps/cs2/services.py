from datetime import datetime

import requests
from django.conf import settings
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import MatchHistory, PlayerStats


def _parse_datetime(value: str | None):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None


def sync_cs2_stats_for_user(user):
    if not user.steam_account_id:
        raise ValidationError(
            'Укажите ссылку на профиль Steam в профиле (формат: steamcommunity.com/profiles/ваш_ID).'
        )

    if not settings.CS2_STATS_API_URL:
        raise ValidationError('Не задан CS2_STATS_API_URL в окружении.')

    url = f"{settings.CS2_STATS_API_URL}/players/{user.steam_account_id}"
    headers = {}
    if settings.CS2_STATS_API_TOKEN:
        headers['Authorization'] = f"Bearer {settings.CS2_STATS_API_TOKEN}"

    try:
        response = requests.get(url, headers=headers, timeout=20)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise ValidationError(f'Ошибка обращения к API статистики: {exc}') from exc

    data = response.json()

    stats, _ = PlayerStats.objects.get_or_create(user=user)
    stats.rank = data.get('rank', '') or ''
    stats.wins = int(data.get('wins', 0) or 0)
    stats.losses = int(data.get('losses', 0) or 0)
    stats.total_matches = int(data.get('total_matches', stats.wins + stats.losses) or 0)
    stats.last_synced_at = timezone.now()
    stats.raw_data = data
    stats.save()

    valid_results = {MatchHistory.RESULT_WIN, MatchHistory.RESULT_LOSE, MatchHistory.RESULT_DRAW}
    matches = data.get('matches', [])
    for item in matches:
        match_id = str(item.get('id', '')).strip()
        if not match_id:
            continue
        raw_result = item.get('result', MatchHistory.RESULT_DRAW)
        result = raw_result if raw_result in valid_results else MatchHistory.RESULT_DRAW
        MatchHistory.objects.update_or_create(
            user=user,
            external_match_id=match_id,
            defaults={
                'played_at': _parse_datetime(item.get('played_at')),
                'map_name': item.get('map', '') or '',
                'result': result,
                'kills': int(item.get('kills', 0) or 0),
                'deaths': int(item.get('deaths', 0) or 0),
                'assists': int(item.get('assists', 0) or 0),
                'rank_at_match': item.get('rank', '') or '',
                'raw_data': item,
            },
        )

    return stats
