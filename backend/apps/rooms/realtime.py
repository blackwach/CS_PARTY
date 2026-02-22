import logging

from asgiref.sync import async_to_sync

try:
    from channels.layers import get_channel_layer
except Exception:  # pragma: no cover - fallback for local env without channels
    def get_channel_layer():
        return None

from .models import GameRoom

logger = logging.getLogger(__name__)


def room_group_name(room_code: str) -> str:
    return f"room_{str(room_code or '').strip().upper()}"


def get_room_payload(room_code: str) -> dict | None:
    normalized = str(room_code or '').strip().upper()
    if not normalized:
        return None

    room = (
        GameRoom.objects.filter(code=normalized)
        .select_related('host')
        .prefetch_related('memberships__user')
        .first()
    )
    if not room:
        return None

    from .serializers import RoomSerializer

    return RoomSerializer(room).data


def broadcast_room_state(room_id: int) -> None:
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return

    room = (
        GameRoom.objects.filter(id=room_id)
        .select_related('host')
        .prefetch_related('memberships__user')
        .first()
    )
    if not room:
        return

    from .serializers import RoomSerializer

    payload = RoomSerializer(room).data
    try:
        async_to_sync(channel_layer.group_send)(
            room_group_name(room.code),
            {
                'type': 'room.state',
                'payload': payload,
            },
        )
    except Exception as exc:  # pragma: no cover - best-effort realtime
        logger.warning('Room realtime broadcast skipped for %s: %s', room.code, exc)
