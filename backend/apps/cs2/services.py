from datetime import datetime
import hashlib
import re
import xml.etree.ElementTree as ET

import requests
from django.conf import settings
from django.utils import timezone

from .models import MatchHistory, PlayerStats

STEAM_PROFILE_ID_RE = re.compile(r'steamcommunity\.com/profiles/(\d{17})(?:[/?#]|$)', re.IGNORECASE)
STEAM_VANITY_RE = re.compile(r'steamcommunity\.com/id/([^/?#]+)(?:[/?#]|$)', re.IGNORECASE)
STEAM_ID64_XML_RE = re.compile(r'<steamID64>(\d{17})</steamID64>', re.IGNORECASE)
STEAM_FRIEND_ADD_RE = re.compile(r'steamcommunity\.com/(?:profiles/\d+/)?friend/add/(\d+)(?:[/?#]|$)', re.IGNORECASE)
STEAM_ACCOUNT_ID_RE = re.compile(r'\[U:1:(\d+)\]', re.IGNORECASE)
STEAM_ID64_BASE = 76561197960265728


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


def _account_id_to_steam64(value: str | int | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or not text.isdigit():
        return None
    if re.fullmatch(r'\d{17}', text):
        return text
    try:
        account_id = int(text)
    except ValueError:
        return None
    if account_id <= 0:
        return None
    if account_id > 4294967295:
        return None
    return str(STEAM_ID64_BASE + account_id)


def _extract_steam_id_from_invite_link(invite_link: str) -> str | None:
    if not invite_link:
        return None

    cleaned = invite_link.strip()
    if not cleaned:
        return None

    # Direct SteamID64 or profile URL.
    direct = _extract_steam_id_from_profile_url(cleaned)
    if direct:
        return direct

    # Steam3 format: [U:1:123456]
    steam3_match = STEAM_ACCOUNT_ID_RE.search(cleaned)
    if steam3_match:
        steam_id = _account_id_to_steam64(steam3_match.group(1))
        if steam_id:
            return steam_id

    # steamcommunity.com/friend/add/<account_id or steamid64>
    friend_add_match = STEAM_FRIEND_ADD_RE.search(cleaned)
    if friend_add_match:
        steam_id = _account_id_to_steam64(friend_add_match.group(1))
        if steam_id:
            return steam_id

    # Vanity profile URL.
    vanity_id = _resolve_vanity_steam_id(cleaned)
    if vanity_id:
        return vanity_id

    # Try final URL after redirects (e.g. short invite URLs).
    normalized = cleaned
    if not re.match(r'^https?://', normalized, re.IGNORECASE) and (
        normalized.lower().startswith('steamcommunity.com/') or normalized.lower().startswith('s.team/')
    ):
        normalized = f'https://{normalized}'

    if re.match(r'^https?://', normalized, re.IGNORECASE):
        try:
            response = requests.get(normalized, timeout=20, allow_redirects=True)
            final_url = (response.url or '').strip()
        except requests.RequestException:
            final_url = ''

        if final_url:
            direct = _extract_steam_id_from_profile_url(final_url)
            if direct:
                return direct

            steam3_match = STEAM_ACCOUNT_ID_RE.search(final_url)
            if steam3_match:
                steam_id = _account_id_to_steam64(steam3_match.group(1))
                if steam_id:
                    return steam_id

            friend_add_match = STEAM_FRIEND_ADD_RE.search(final_url)
            if friend_add_match:
                steam_id = _account_id_to_steam64(friend_add_match.group(1))
                if steam_id:
                    return steam_id

            vanity_id = _resolve_vanity_steam_id(final_url)
            if vanity_id:
                return vanity_id

    return None


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


def _to_int(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return int(default)


def _extract_match_id(item: dict, fallback_index: int) -> str:
    direct = str(item.get('id') or item.get('match_id') or item.get('matchId') or '').strip()
    if direct:
        return direct

    key = '|'.join(
        [
            str(item.get('played_at') or item.get('playedAt') or item.get('time') or item.get('timestamp') or '').strip(),
            str(item.get('map') or item.get('map_name') or '').strip(),
            str(item.get('kills') or 0),
            str(item.get('deaths') or 0),
            str(item.get('assists') or 0),
            str(item.get('result') or '').strip().lower(),
        ]
    )
    if not key.replace('|', '').strip():
        return f'match_{fallback_index}'
    digest = hashlib.sha1(key.encode('utf-8')).hexdigest()[:16]
    return f'match_{digest}'


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
    stats = PlayerStats.objects.filter(user=user).first()
    previous_raw_data = stats.raw_data if stats else {}
    previous_share_code_cursor = str((previous_raw_data or {}).get('share_code_cursor') or '').strip()
    previous_history_token = str((previous_raw_data or {}).get('history_token') or '').strip()
    match_token = str(getattr(user, 'cs2_match_token', '') or '').strip()
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
        if not stats:
            stats = PlayerStats.objects.create(user=user)
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
        params = {}
        if match_token:
            params['match_token'] = match_token
            if previous_share_code_cursor and previous_history_token and previous_history_token == match_token:
                params['share_code_cursor'] = previous_share_code_cursor
        if settings.CS2_STATS_API_TOKEN:
            headers['Authorization'] = f"Bearer {settings.CS2_STATS_API_TOKEN}"

        try:
            response = requests.get(url, headers=headers, params=params, timeout=20)
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

    if isinstance(data, dict):
        data['history_token'] = match_token if match_token else ''

    if not stats:
        stats = PlayerStats.objects.create(user=user)
    stats.rank = data.get('rank', '') or ''
    stats.wins = int(data.get('wins', 0) or 0)
    stats.losses = int(data.get('losses', 0) or 0)
    stats.total_matches = int(data.get('total_matches', stats.wins + stats.losses) or 0)
    stats.last_synced_at = timezone.now()
    stats.raw_data = data
    stats.save()

    history_mode = str(data.get('history_mode') or '').strip().lower()
    if history_mode not in {'snapshot', 'incremental'}:
        history_mode = 'snapshot'

    matches = data.get('matches', [])
    if not matches:
        # In public-profile mode we have no reliable match history.
        if history_mode == 'snapshot':
            MatchHistory.objects.filter(user=user).delete()
    else:
        seen_ids: set[str] = set()
        synced_match_ids: list[str] = []

        for index, item in enumerate(matches):
            if not isinstance(item, dict):
                continue

            match_id = _extract_match_id(item, index)
            if not match_id or match_id in seen_ids:
                continue
            seen_ids.add(match_id)
            synced_match_ids.append(match_id)

            result = _normalize_match_result(str(item.get('result', '')))
            MatchHistory.objects.update_or_create(
                user=user,
                external_match_id=match_id,
                defaults={
                    'played_at': _parse_datetime(item.get('played_at') or item.get('playedAt')),
                    'map_name': str(item.get('map', '') or item.get('map_name', '') or '').strip(),
                    'result': result,
                    'kills': max(_to_int(item.get('kills', 0), 0), 0),
                    'deaths': max(_to_int(item.get('deaths', 0), 0), 0),
                    'assists': max(_to_int(item.get('assists', 0), 0), 0),
                    'rank_at_match': str(item.get('rank', '') or item.get('rank_at_match', '') or '').strip(),
                    'raw_data': item,
                },
            )

        # Keep only current provider snapshot to avoid stale/inflated aggregates.
        if history_mode == 'snapshot':
            if synced_match_ids:
                MatchHistory.objects.filter(user=user).exclude(external_match_id__in=synced_match_ids).delete()
            else:
                MatchHistory.objects.filter(user=user).delete()

    return stats


def get_cs2_stats_health() -> dict:
    api_url = str(settings.CS2_STATS_API_URL or '').strip().rstrip('/')
    health = {
        'configured': bool(api_url),
        'api_url': api_url,
        'api_token_configured': bool(settings.CS2_STATS_API_TOKEN),
        'bot_credentials': {
            'username_set': bool((getattr(settings, 'CS2_STATS_STEAM_USERNAME', None) or '').strip()),
            'password_set': bool((getattr(settings, 'CS2_STATS_STEAM_PASSWORD', None) or '').strip()),
            'two_factor_set': bool((getattr(settings, 'CS2_STATS_STEAM_2FA_SECRET', None) or '').strip()),
        },
        'service_reachable': False,
        'service_status_code': None,
        'service': None,
        'error': '',
        'hint': '',
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
    # Подсказка: бэкенд видит учётные данные, а сервис бота — нет (часто из-за compose environment).
    last_err = (payload.get('bot') or {}).get('last_error') or ''
    creds_ok = health['bot_credentials'].get('username_set') and health['bot_credentials'].get('password_set')
    guard_pending = (payload.get('bot') or {}).get('steam_guard_pending')
    if guard_pending:
        health['hint'] = (
            'Steam Guard ожидает код. Откройте страницу состояния CS2-бота и отправьте код вручную.'
        )
    if creds_ok and 'not set' in last_err.lower():
        health['hint'] = (
            'Логин/пароль заданы в backend/.env, но сервис бота их не видит. '
            'Перезапустите контейнер: docker compose up -d cs2_stats_service --force-recreate'
        )
    return health


def add_friend_by_invite_link(invite_link: str) -> dict:
    api_url = str(settings.CS2_STATS_API_URL or '').strip().rstrip('/')
    if not api_url:
        raise ValueError('CS2_STATS_API_URL не задан.')

    steam_id = _extract_steam_id_from_invite_link(invite_link)
    if not steam_id:
        raise ValueError(
            'Не удалось извлечь SteamID64 из ссылки. Используйте ссылку вида '
            'https://steamcommunity.com/profiles/7656119...'
        )

    headers = {}
    if settings.CS2_STATS_API_TOKEN:
        headers['Authorization'] = f"Bearer {settings.CS2_STATS_API_TOKEN}"

    try:
        response = requests.post(
            f'{api_url}/bot/friends/add',
            headers=headers,
            json={'steam_id': steam_id},
            timeout=15,
        )
    except requests.RequestException as exc:
        raise RuntimeError(f'Не удалось обратиться к CS2 stats service: {exc}') from exc

    try:
        payload = response.json()
    except ValueError:
        payload = {}

    if not response.ok:
        detail = payload.get('detail') or payload.get('error') or response.text or f'HTTP {response.status_code}'
        raise RuntimeError(f'CS2 stats service вернул ошибку: {detail}')

    result = dict(payload) if isinstance(payload, dict) else {}
    result.setdefault('steam_id', steam_id)
    return result


def submit_steam_guard_code(code: str) -> dict:
    api_url = str(settings.CS2_STATS_API_URL or '').strip().rstrip('/')
    if not api_url:
        raise ValueError('CS2_STATS_API_URL не задан.')

    cleaned_code = str(code or '').strip().upper()
    if not re.fullmatch(r'[A-Z0-9]{5}', cleaned_code):
        raise ValueError('Некорректный код Steam Guard. Ожидалось 5 символов (буквы/цифры).')

    headers = {}
    if settings.CS2_STATS_API_TOKEN:
        headers['Authorization'] = f"Bearer {settings.CS2_STATS_API_TOKEN}"

    try:
        response = requests.post(
            f'{api_url}/bot/steam-guard',
            headers=headers,
            json={'code': cleaned_code},
            timeout=15,
        )
    except requests.RequestException as exc:
        raise RuntimeError(f'Не удалось обратиться к CS2 stats service: {exc}') from exc

    try:
        payload = response.json()
    except ValueError:
        payload = {}

    if not response.ok:
        detail = payload.get('detail') or payload.get('error') or response.text or f'HTTP {response.status_code}'
        if response.status_code in {400, 409}:
            raise ValueError(str(detail))
        raise RuntimeError(f'CS2 stats service вернул ошибку: {detail}')

    return dict(payload) if isinstance(payload, dict) else {'ok': True}
