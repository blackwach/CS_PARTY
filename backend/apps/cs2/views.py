from rest_framework import response, status, views

from .serializers import CS2FriendInviteSerializer, PlayerStatsSerializer
from .services import add_friend_by_invite_link, get_cs2_stats_health, sync_cs2_stats_for_user


class MyCS2StatsView(views.APIView):
    def get(self, request):
        stats = getattr(request.user, 'cs2_stats', None)
        if not stats:
            return response.Response(
                {
                    'rank': '',
                    'wins': 0,
                    'losses': 0,
                    'total_matches': 0,
                    'last_synced_at': None,
                    'recent_matches': [],
                    'synced': False,
                    'source': '',
                    'note': '',
                }
            )
        return response.Response(PlayerStatsSerializer(stats).data)


class SyncMyCS2StatsView(views.APIView):
    def post(self, request):
        stats = sync_cs2_stats_for_user(request.user)
        return response.Response(PlayerStatsSerializer(stats).data)


class CS2StatsHealthView(views.APIView):
    def get(self, request):
        return response.Response(get_cs2_stats_health())


class CS2AddFriendView(views.APIView):
    def post(self, request):
        serializer = CS2FriendInviteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            payload = add_friend_by_invite_link(serializer.validated_data['invite_link'])
        except ValueError as exc:
            return response.Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except RuntimeError as exc:
            return response.Response({'detail': str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        return response.Response(payload, status=status.HTTP_200_OK)
