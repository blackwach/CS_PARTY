from rest_framework import response, views

from .serializers import PlayerStatsSerializer
from .services import sync_cs2_stats_for_user


class MyCS2StatsView(views.APIView):
    def get(self, request):
        stats = getattr(request.user, 'cs2_stats', None)
        if not stats:
            return response.Response({'detail': 'Статистика еще не синхронизирована.'}, status=404)
        return response.Response(PlayerStatsSerializer(stats).data)


class SyncMyCS2StatsView(views.APIView):
    def post(self, request):
        stats = sync_cs2_stats_for_user(request.user)
        return response.Response(PlayerStatsSerializer(stats).data)
