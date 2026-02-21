from django.contrib import admin

from .models import MatchHistory, PlayerStats


@admin.register(PlayerStats)
class PlayerStatsAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'rank', 'wins', 'losses', 'total_matches', 'last_synced_at')
    search_fields = ('user__email', 'user__nickname', 'rank')


@admin.register(MatchHistory)
class MatchHistoryAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'external_match_id', 'played_at', 'map_name', 'result', 'kills', 'deaths', 'assists')
    search_fields = ('external_match_id', 'user__email', 'user__nickname', 'map_name')
    list_filter = ('result',)
