from urllib.parse import quote

import requests
from django.conf import settings
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import GameRoom


def build_connect_command(host: str, port: int, password: str = '') -> str:
    command = f'+connect {host}:{port}'
    if password:
        command = f'{command} +password {password}'
    return command


def build_steam_launch_url(command: str) -> str:
    encoded = quote(command, safe='')
    return f'steam://run/730//{encoded}/'


def configure_room_server_endpoint(
    room: GameRoom,
    *,
    host: str,
    port: int,
    password: str = '',
    connect_url: str = '',
    launch_command: str = '',
    provider_payload: dict | None = None,
) -> GameRoom:
    host = (host or '').strip()
    password = (password or '').strip()
    if not host or int(port or 0) <= 0:
        raise ValidationError('Нужно указать хост и порт сервера.')

    command = launch_command.strip() if launch_command else build_connect_command(host, port, password)
    url = connect_url.strip() if connect_url else build_steam_launch_url(command)

    room.server_host = host
    room.server_port = int(port)
    room.server_password = password
    room.server_connect_url = url
    room.server_launch_command = command
    room.server_error = ''
    room.server_provider_payload = provider_payload or room.server_provider_payload or {}
    room.server_provisioned_at = room.server_provisioned_at or timezone.now()
    room.save(
        update_fields=[
            'server_host',
            'server_port',
            'server_password',
            'server_connect_url',
            'server_launch_command',
            'server_error',
            'server_provider_payload',
            'server_provisioned_at',
            'updated_at',
        ]
    )
    return room


def ensure_server_connect_metadata(room: GameRoom) -> GameRoom:
    if not room.server_host or not room.server_port:
        raise ValidationError('Адрес сервера комнаты не настроен.')
    return configure_room_server_endpoint(
        room,
        host=room.server_host,
        port=room.server_port,
        password=room.server_password,
        connect_url=room.server_connect_url,
        launch_command=room.server_launch_command,
        provider_payload=room.server_provider_payload or {'source': 'room'},
    )


def _provision_with_external_api(room: GameRoom) -> dict | None:
    base_url = getattr(settings, 'CS2_SERVER_API_URL', '').strip().rstrip('/')
    if not base_url:
        return None

    headers = {}
    token = getattr(settings, 'CS2_SERVER_API_TOKEN', '').strip()
    if token:
        headers['Authorization'] = f'Bearer {token}'

    payload = {
        'room_code': room.code,
        'title': room.title,
        'max_players': room.max_players,
        'scheduled_for': room.scheduled_for.isoformat(),
    }
    try:
        response = requests.post(f'{base_url}/servers', json=payload, headers=headers, timeout=20)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise ValidationError(f'Не удалось подготовить CS2-сервер: {exc}') from exc

    data = response.json() if response.content else {}
    host = str(data.get('host') or data.get('ip') or '').strip()
    port = int(data.get('port') or 0)
    password = str(data.get('password') or '').strip()
    connect_url = str(data.get('steam_connect_url') or '').strip()

    if not host or port <= 0:
        raise ValidationError('Ответ провайдера CS2-сервера должен содержать host и port.')

    provider_payload = {'source': 'allocator'}
    provider_payload.update(data if isinstance(data, dict) else {})

    return {
        'host': host,
        'port': port,
        'password': password,
        'connect_url': connect_url,
        'launch_command': str(data.get('launch_command') or '').strip(),
        'provider_payload': provider_payload,
    }


def _provision_from_static_settings() -> dict | None:
    host = getattr(settings, 'CS2_SERVER_HOST', '').strip()
    port = int(getattr(settings, 'CS2_SERVER_PORT', 0) or 0)
    password = getattr(settings, 'CS2_SERVER_PASSWORD', '').strip()
    if not host or port <= 0:
        return None
    return {
        'host': host,
        'port': port,
        'password': password,
        'connect_url': '',
        'launch_command': '',
        'provider_payload': {'source': 'static-settings'},
    }


def provision_server_for_room(room: GameRoom) -> GameRoom:
    if room.server_host and room.server_port:
        return ensure_server_connect_metadata(room)

    provisioning_data = _provision_with_external_api(room) or _provision_from_static_settings()
    if not provisioning_data:
        raise ValidationError('CS2-сервер не настроен. Укажите CS2_SERVER_* или CS2_SERVER_API_URL.')

    return configure_room_server_endpoint(
        room,
        host=provisioning_data['host'],
        port=provisioning_data['port'],
        password=provisioning_data['password'],
        connect_url=provisioning_data['connect_url'],
        launch_command=provisioning_data.get('launch_command') or '',
        provider_payload=provisioning_data['provider_payload'],
    )


def release_server_for_room(room: GameRoom) -> None:
    source = str((room.server_provider_payload or {}).get('source') or '')
    if source != 'allocator':
        return

    base_url = getattr(settings, 'CS2_SERVER_API_URL', '').strip().rstrip('/')
    if not base_url:
        return

    headers = {}
    token = getattr(settings, 'CS2_SERVER_API_TOKEN', '').strip()
    if token:
        headers['Authorization'] = f'Bearer {token}'

    try:
        requests.delete(f'{base_url}/servers/{room.code}', headers=headers, timeout=20)
    except requests.RequestException:
        # Room should still be closable if external allocator is unavailable.
        return
