from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework import response, status, views

from .serializers import CS2FriendInviteSerializer, CS2SteamGuardCodeSerializer, PlayerStatsSerializer
from .services import add_friend_by_invite_link, get_cs2_stats_health, submit_steam_guard_code, sync_cs2_stats_for_user

User = get_user_model()


def _is_cs2_bot_admin(user) -> bool:
    allowed_email = str(getattr(settings, 'CS2_BOT_ADMIN_EMAIL', 'backwach1@yandex.ru') or '').strip().lower()
    user_email = str(getattr(user, 'email', '') or '').strip().lower()
    return bool(allowed_email and user_email and user_email == allowed_email)


def _forbidden_bot_admin_response():
    allowed_email = str(getattr(settings, 'CS2_BOT_ADMIN_EMAIL', 'backwach1@yandex.ru') or '').strip()
    return response.Response(
        {'detail': f'Управление CS2-ботом доступно только для {allowed_email}.'},
        status=status.HTTP_403_FORBIDDEN,
    )


def _empty_stats_payload() -> dict:
    return {
        'rank': '',
        'rank_id': None,
        'premier_rating': None,
        'premier_rank_id': None,
        'premier_rank': '',
        'map_ranks': [],
        'wins': 0,
        'losses': 0,
        'total_matches': 0,
        'last_synced_at': None,
        'recent_matches': [],
        'averages': {
            'matches_count': 0,
            'avg_kills': 0.0,
            'avg_deaths': 0.0,
            'avg_assists': 0.0,
            'avg_kd': 0.0,
            'avg_kda': 0.0,
            'avg_hs_percent': 0.0,
        },
        'synced': False,
        'source': '',
        'note': '',
    }


class MyCS2StatsView(views.APIView):
    def get(self, request):
        stats = getattr(request.user, 'cs2_stats', None)
        if not stats:
            return response.Response(_empty_stats_payload())
        return response.Response(PlayerStatsSerializer(stats).data)


class SyncMyCS2StatsView(views.APIView):
    def post(self, request):
        stats = sync_cs2_stats_for_user(request.user)
        return response.Response(PlayerStatsSerializer(stats).data)


class UserCS2StatsView(views.APIView):
    def get(self, request, user_id: int):
        target = User.objects.filter(id=user_id, is_active=True).first()
        if not target:
            return response.Response({'detail': 'Пользователь не найден.'}, status=status.HTTP_404_NOT_FOUND)

        stats = getattr(target, 'cs2_stats', None)
        if not stats:
            return response.Response(_empty_stats_payload())
        return response.Response(PlayerStatsSerializer(stats).data)


class CS2StatsHealthView(views.APIView):
    def get(self, request):
        if not _is_cs2_bot_admin(request.user):
            return _forbidden_bot_admin_response()
        return response.Response(get_cs2_stats_health())


class CS2AddFriendView(views.APIView):
    def post(self, request):
        if not _is_cs2_bot_admin(request.user):
            return _forbidden_bot_admin_response()
        serializer = CS2FriendInviteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            payload = add_friend_by_invite_link(serializer.validated_data['invite_link'])
        except ValueError as exc:
            return response.Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except RuntimeError as exc:
            return response.Response({'detail': str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        return response.Response(payload, status=status.HTTP_200_OK)


class CS2SubmitSteamGuardView(views.APIView):
    def post(self, request):
        if not _is_cs2_bot_admin(request.user):
            return _forbidden_bot_admin_response()
        serializer = CS2SteamGuardCodeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            payload = submit_steam_guard_code(serializer.validated_data['code'])
        except ValueError as exc:
            return response.Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except RuntimeError as exc:
            return response.Response({'detail': str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        return response.Response(payload, status=status.HTTP_200_OK)
