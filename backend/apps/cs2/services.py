from datetime import datetime
import re
import xml.etree.ElementTree as ET

import requests
from django.conf import settings
from django.utils import timezone

from .models import MatchHistory, PlayerStats

STEAM_PROFILE_ID_RE = re.compile(r'steamcommunity\.com/profiles/(\d{17})(?:[/?#]|$)', re.IGNORECASE)
STEAM_VANITY_RE = re.compile(r'steamcommunity\.com/id/([^/?#]+)(?:[/?#]|$)', re.IGNORECASE)
STEAM_ID64_XML_RE = re.compile(r'<steamID64>(\d{17})</steamID64>', re.IGNORECASE)


def _parse_datetime(value: str | None):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None


def _extract_steam_id_from_profile_url(url: str) -> str | None:
    if not url:
        return None
    cleaned = url.strip()
    if re.fullmatch(r'\d{17}', cleaned):
        return cleaned
    match = STEAM_PROFILE_ID_RE.search(cleaned)
    return match.group(1) if match else None


def _resolve_vanity_steam_id(profile_url: str) -> str | None:
    if not profile_url:
        return None
    match = STEAM_VANITY_RE.search(profile_url.strip())
    if not match:
        return None

    vanity = match.group(1)
    xml_url = f'https://steamcommunity.com/id/{vanity}/?xml=1'
    try:
        response = requests.get(xml_url, timeout=20)
        response.raise_for_status()
    except requests.RequestException:
        return None

    xml_text = response.text or ''
    xml_match = STEAM_ID64_XML_RE.search(xml_text)
    return xml_match.group(1) if xml_match else None


def _get_or_resolve_steam_account_id(user) -> str:
    steam_id = str(user.steam_account_id or '').strip()
    if steam_id and re.fullmatch(r'\d{17}', steam_id):
        return steam_id

    profile_url = str(user.steam_profile_url or '').strip()
    if not profile_url:
        return ''

    steam_id = _extract_steam_id_from_profile_url(profile_url) or _resolve_vanity_steam_id(profile_url)
    if not steam_id:
        return ''

    if user.steam_account_id != steam_id:
        user.steam_account_id = steam_id
        user.save(update_fields=['steam_account_id'])

    return steam_id


def _normalize_match_result(raw_result: str) -> str:
    value = (raw_result or '').strip().lower()
    if value in {'win', 'won', 'victory'}:
        return MatchHistory.RESULT_WIN
    if value in {'lose', 'loss', 'lost', 'defeat'}:
        return MatchHistory.RESULT_LOSE
    return MatchHistory.RESULT_DRAW


def _sync_from_public_profile(steam_id: str) -> dict:
    xml_url = f'https://steamcommunity.com/profiles/{steam_id}/?xml=1'
    try:
        response = requests.get(xml_url, timeout=20)
        response.raise_for_status()
    except requests.RequestException as exc:
        return {
            'rank': '',
            'wins': 0,
            'losses': 0,
            'total_matches': 0,
            'matches': [],
            'source': 'public_profile',
            'note': f'Ограниченный режим: не удалось загрузить публичный Steam-профиль ({exc}).',
            'profile_name': '',
        }

    try:
        root = ET.fromstring(response.text or '')
    except ET.ParseError as exc:
        return {
            'rank': '',
            'wins': 0,
            'losses': 0,
            'total_matches': 0,
            'matches': [],
            'source': 'public_profile',
            'note': f'Ограниченный режим: не удалось разобрать ответ Steam-профиля ({exc}).',
            'profile_name': '',
        }

    privacy_state = (root.findtext('privacyState') or '').strip().lower()
    if privacy_state and privacy_state != 'public':
        return {
            'rank': '',
            'wins': 0,
            'losses': 0,
            'total_matches': 0,
            'matches': [],
            'source': 'public_profile',
            'note': 'Ограниченный режим: профиль Steam закрыт. Откройте профиль для синхронизации без авторизации в Steam.',
            'profile_name': '',
        }

    display_name = (root.findtext('steamID') or '').strip()
    return {
        'rank': '',
        'wins': 0,
        'losses': 0,
        'total_matches': 0,
        'matches': [],
        'source': 'public_profile',
        'note': (
            'Ограниченный режим: данные получены только из публичного Steam-профиля. '
            'Ранг и история матчей CS2 недоступны без Steam GC/API-провайдера.'
        ),
        'profile_name': display_name,
    }


def sync_cs2_stats_for_user(user):
    steam_id = _get_or_resolve_steam_account_id(user)
    if not steam_id:
        data = {
            'rank': '',
            'wins': 0,
            'losses': 0,
            'total_matches': 0,
            'matches': [],
            'source': 'public_profile',
            'note': 'Ограниченный режим: укажите ссылку на Steam-профиль в настройках профиля.',
            'profile_name': '',
        }
        stats, _ = PlayerStats.objects.get_or_create(user=user)
        stats.rank = ''
        stats.wins = 0
        stats.losses = 0
        stats.total_matches = 0
        stats.last_synced_at = timezone.now()
        stats.raw_data = data
        stats.save()
        MatchHistory.objects.filter(user=user).delete()
        return stats

    if settings.CS2_STATS_API_URL:
        url = f"{settings.CS2_STATS_API_URL}/players/{steam_id}"
        headers = {}
        if settings.CS2_STATS_API_TOKEN:
            headers['Authorization'] = f"Bearer {settings.CS2_STATS_API_TOKEN}"

        try:
            response = requests.get(url, headers=headers, timeout=20)
            response.raise_for_status()
        except requests.RequestException as exc:
            data = _sync_from_public_profile(steam_id)
            data['source'] = data.get('source') or 'public_profile'
            data['note'] = (
                f'Провайдер статистики недоступен ({exc}). '
                f"{data.get('note') or 'Ограниченный режим: данные получены только из публичного Steam-профиля.'}"
            )
        else:
            try:
                data = response.json()
            except ValueError as exc:
                data = _sync_from_public_profile(steam_id)
                data['source'] = data.get('source') or 'public_profile'
                data['note'] = (
                    f'Провайдер вернул некорректный JSON ({exc}). '
                    f"{data.get('note') or 'Ограниченный режим: данные получены только из публичного Steam-профиля.'}"
                )

    else:
        data = _sync_from_public_profile(steam_id)

    stats, _ = PlayerStats.objects.get_or_create(user=user)
    stats.rank = data.get('rank', '') or ''
    stats.wins = int(data.get('wins', 0) or 0)
    stats.losses = int(data.get('losses', 0) or 0)
    stats.total_matches = int(data.get('total_matches', stats.wins + stats.losses) or 0)
    stats.last_synced_at = timezone.now()
    stats.raw_data = data
    stats.save()

    matches = data.get('matches', [])
    if not matches:
        # In public-profile mode we have no reliable match history.
        MatchHistory.objects.filter(user=user).delete()

    for item in matches:
        if not isinstance(item, dict):
            continue
        match_id = str(item.get('id') or item.get('match_id') or item.get('matchId') or '').strip()
        if not match_id:
            continue

        result = _normalize_match_result(str(item.get('result', '')))
        MatchHistory.objects.update_or_create(
            user=user,
            external_match_id=match_id,
            defaults={
                'played_at': _parse_datetime(item.get('played_at') or item.get('playedAt')),
                'map_name': item.get('map', '') or item.get('map_name', '') or '',
                'result': result,
                'kills': int(item.get('kills', 0) or 0),
                'deaths': int(item.get('deaths', 0) or 0),
                'assists': int(item.get('assists', 0) or 0),
                'rank_at_match': item.get('rank', '') or item.get('rank_at_match', '') or '',
                'raw_data': item,
            },
        )

    return stats


def get_cs2_stats_health() -> dict:
    api_url = str(settings.CS2_STATS_API_URL or '').strip().rstrip('/')
    health = {
        'configured': bool(api_url),
        'api_url': api_url,
        'api_token_configured': bool(settings.CS2_STATS_API_TOKEN),
        'bot_credentials': {
            'username_set': bool(getattr(settings, 'CS2_STATS_STEAM_USERNAME', '')),
            'password_set': bool(getattr(settings, 'CS2_STATS_STEAM_PASSWORD', '')),
            'two_factor_set': bool(getattr(settings, 'CS2_STATS_STEAM_2FA_SECRET', '')),
        },
        'service_reachable': False,
        'service_status_code': None,
        'service': None,
        'error': '',
    }

    if not api_url:
        health['error'] = 'CS2_STATS_API_URL не задан.'
        return health

    headers = {}
    if settings.CS2_STATS_API_TOKEN:
        headers['Authorization'] = f"Bearer {settings.CS2_STATS_API_TOKEN}"

    try:
        response = requests.get(f'{api_url}/health', headers=headers, timeout=10)
    except requests.RequestException as exc:
        health['error'] = f'Не удалось обратиться к CS2 stats service: {exc}'
        return health

    health['service_status_code'] = response.status_code
    if not response.ok:
        health['error'] = f'CS2 stats service вернул HTTP {response.status_code}.'
        return health

    try:
        payload = response.json()
    except ValueError:
        health['error'] = 'CS2 stats service вернул некорректный JSON на /health.'
        return health

    health['service_reachable'] = True
    health['service'] = payload
    return health
