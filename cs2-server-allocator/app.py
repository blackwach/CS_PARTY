import datetime as dt
import os
import socket
import threading
from typing import Any

import docker
from docker.errors import APIError, DockerException, ImageNotFound, NotFound
from flask import Flask, jsonify, request

app = Flask(__name__)

LOCK = threading.Lock()

PORT = int(os.getenv('PORT', '8090'))
PUBLIC_HOST = os.getenv('CS2_PUBLIC_HOST', '127.0.0.1').strip()
CS2_IMAGE = os.getenv('CS2_IMAGE', 'joedwards32/cs2:latest').strip()
CONTAINER_PREFIX = os.getenv('CS2_CONTAINER_PREFIX', 'cs2-room').strip()
PORT_RANGE_START = int(os.getenv('CS2_PORT_RANGE_START', '27100'))
PORT_RANGE_END = int(os.getenv('CS2_PORT_RANGE_END', '27200'))
REQUIRE_X86 = os.getenv('CS2_REQUIRE_X86', 'true').lower() == 'true'
HOST_BIND_IP = os.getenv('CS2_HOST_BIND_IP', '0.0.0.0').strip()
DEFAULT_MAP = os.getenv('CS2_DEFAULT_MAP', 'de_dust2').strip()
DEFAULT_GAME_TYPE = os.getenv('CS2_DEFAULT_GAME_TYPE', '0').strip()
DEFAULT_GAME_MODE = os.getenv('CS2_DEFAULT_GAME_MODE', '1').strip()
SERVER_PASSWORD = os.getenv('CS2_SERVER_PASSWORD', '').strip()

LABEL_MANAGED = 'cs_party.managed'
LABEL_ROOM_CODE = 'cs_party.room_code'
LABEL_CREATED_AT = 'cs_party.created_at'


class ProvisioningError(RuntimeError):
    pass


def _docker_client() -> docker.DockerClient:
    try:
        return docker.from_env()
    except DockerException as exc:
        raise ProvisioningError(f'Docker connection failed: {exc}') from exc


def _is_arch_supported(client: docker.DockerClient) -> bool:
    try:
        info = client.info()
    except DockerException:
        return False

    arch = str(info.get('Architecture', '')).lower()
    if not REQUIRE_X86:
        return True
    return arch in {'x86_64', 'amd64'}


def _steam_connect_url(host: str, port: int, password: str) -> tuple[str, str]:
    command = f'+connect {host}:{port}'
    if password:
        command = f'{command} +password {password}'
    encoded = command.replace(' ', '%20').replace('+', '%2B').replace(':', '%3A')
    return command, f'steam://run/730//{encoded}/'


def _managed_containers(client: docker.DockerClient):
    return client.containers.list(all=True, filters={'label': f'{LABEL_MANAGED}=true'})


def _port_mappings(container) -> tuple[int | None, int | None]:
    ports = container.attrs.get('NetworkSettings', {}).get('Ports', {})
    game_entries = ports.get('27015/udp') or []
    tv_entries = ports.get('27020/udp') or []
    game_port = int(game_entries[0].get('HostPort')) if game_entries else None
    tv_port = int(tv_entries[0].get('HostPort')) if tv_entries else None
    return game_port, tv_port


def _find_room_container(client: docker.DockerClient, room_code: str):
    containers = _managed_containers(client)
    normalized = room_code.upper()
    for container in containers:
        labels = container.labels or {}
        if labels.get(LABEL_ROOM_CODE, '').upper() == normalized:
            return container
    return None


def _used_ports(client: docker.DockerClient) -> set[int]:
    used: set[int] = set()
    for container in _managed_containers(client):
        game_port, tv_port = _port_mappings(container)
        if game_port:
            used.add(game_port)
        if tv_port:
            used.add(tv_port)
    return used


def _pick_port_pair(client: docker.DockerClient) -> tuple[int, int]:
    used = _used_ports(client)
    for base in range(PORT_RANGE_START, PORT_RANGE_END + 1):
        tv = base + 1000
        if tv > 65535:
            continue
        if base in used or tv in used:
            continue
        return base, tv
    raise ProvisioningError('No free ports available in configured range.')


def _container_name(room_code: str) -> str:
    safe = ''.join(ch for ch in room_code.lower() if ch.isalnum())[:24] or 'room'
    stamp = dt.datetime.utcnow().strftime('%H%M%S')
    return f'{CONTAINER_PREFIX}-{safe}-{stamp}'


def _create_room_server(client: docker.DockerClient, room_code: str) -> dict[str, Any]:
    if not _is_arch_supported(client):
        raise ProvisioningError('CS2 dedicated server requires x86_64 host. Current Docker host architecture is not supported.')

    game_port, tv_port = _pick_port_pair(client)

    labels = {
        LABEL_MANAGED: 'true',
        LABEL_ROOM_CODE: room_code.upper(),
        LABEL_CREATED_AT: dt.datetime.utcnow().isoformat(),
    }

    env = {
        'SERVER_PASSWORD': SERVER_PASSWORD,
        'CS2_MAP': DEFAULT_MAP,
        'CS2_GAME_TYPE': DEFAULT_GAME_TYPE,
        'CS2_GAME_MODE': DEFAULT_GAME_MODE,
    }

    try:
        container = client.containers.run(
            CS2_IMAGE,
            name=_container_name(room_code),
            detach=True,
            labels=labels,
            restart_policy={'Name': 'unless-stopped'},
            ports={
                '27015/udp': (HOST_BIND_IP, game_port),
                '27015/tcp': (HOST_BIND_IP, game_port),
                '27020/udp': (HOST_BIND_IP, tv_port),
                '27020/tcp': (HOST_BIND_IP, tv_port),
            },
            environment=env,
        )
    except ImageNotFound as exc:
        raise ProvisioningError(f'CS2 image not found: {CS2_IMAGE}') from exc
    except APIError as exc:
        raise ProvisioningError(f'Failed to run CS2 container: {exc.explanation or exc}') from exc
    except DockerException as exc:
        raise ProvisioningError(f'Failed to run CS2 container: {exc}') from exc

    launch_command, connect_url = _steam_connect_url(PUBLIC_HOST, game_port, SERVER_PASSWORD)

    return {
        'container_id': container.id,
        'container_name': container.name,
        'host': PUBLIC_HOST,
        'port': game_port,
        'tv_port': tv_port,
        'password': SERVER_PASSWORD,
        'launch_command': launch_command,
        'steam_connect_url': connect_url,
    }


def _serialize_existing(container) -> dict[str, Any]:
    container.reload()
    game_port, tv_port = _port_mappings(container)
    if not game_port:
        raise ProvisioningError('Existing room container has no published game port.')
    launch_command, connect_url = _steam_connect_url(PUBLIC_HOST, game_port, SERVER_PASSWORD)
    return {
        'container_id': container.id,
        'container_name': container.name,
        'host': PUBLIC_HOST,
        'port': game_port,
        'tv_port': tv_port,
        'password': SERVER_PASSWORD,
        'launch_command': launch_command,
        'steam_connect_url': connect_url,
    }


@app.get('/health')
def health():
    try:
        client = _docker_client()
        docker_ok = client.ping()
        arch_ok = _is_arch_supported(client)
        return jsonify({'ok': True, 'docker': bool(docker_ok), 'arch_supported': arch_ok})
    except ProvisioningError as exc:
        return jsonify({'ok': False, 'error': str(exc)}), 503


@app.post('/servers')
def provision_server():
    payload = request.get_json(silent=True) or {}
    room_code = str(payload.get('room_code', '')).strip().upper()
    if not room_code:
        return jsonify({'detail': 'room_code is required'}), 400

    try:
        client = _docker_client()
    except ProvisioningError as exc:
        return jsonify({'detail': str(exc)}), 503

    with LOCK:
        existing = _find_room_container(client, room_code)
        try:
            if existing:
                data = _serialize_existing(existing)
            else:
                data = _create_room_server(client, room_code)
        except ProvisioningError as exc:
            return jsonify({'detail': str(exc)}), 503

    return jsonify(data), 201


@app.delete('/servers/<room_code>')
def release_server(room_code: str):
    normalized = (room_code or '').strip().upper()
    if not normalized:
        return '', 204

    try:
        client = _docker_client()
    except ProvisioningError as exc:
        return jsonify({'detail': str(exc)}), 503

    with LOCK:
        container = _find_room_container(client, normalized)
        if not container:
            return '', 204
        try:
            container.remove(force=True)
        except NotFound:
            pass
        except APIError as exc:
            return jsonify({'detail': f'Failed to remove container: {exc.explanation or exc}'}), 503

    return '', 204


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=PORT)
