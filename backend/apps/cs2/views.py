from rest_framework import response, views

from .serializers import PlayerStatsSerializer
from .services import get_cs2_stats_health, sync_cs2_stats_for_user


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
