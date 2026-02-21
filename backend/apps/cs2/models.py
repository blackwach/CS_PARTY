from django.conf import settings
from django.db import models


class PlayerStats(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='cs2_stats')
    rank = models.CharField(max_length=128, blank=True)
    wins = models.PositiveIntegerField(default=0)
    losses = models.PositiveIntegerField(default=0)
    total_matches = models.PositiveIntegerField(default=0)
    last_synced_at = models.DateTimeField(blank=True, null=True)
    raw_data = models.JSONField(default=dict, blank=True)

    def __str__(self) -> str:
        return f'Stats for {self.user_id}'


class MatchHistory(models.Model):
    RESULT_WIN = 'win'
    RESULT_LOSE = 'lose'
    RESULT_DRAW = 'draw'

    RESULT_CHOICES = [
        (RESULT_WIN, 'Win'),
        (RESULT_LOSE, 'Lose'),
        (RESULT_DRAW, 'Draw'),
    ]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='cs2_matches')
    external_match_id = models.CharField(max_length=64)
    played_at = models.DateTimeField(blank=True, null=True)
    map_name = models.CharField(max_length=128, blank=True)
    result = models.CharField(max_length=16, choices=RESULT_CHOICES, default=RESULT_DRAW)
    kills = models.IntegerField(default=0)
    deaths = models.IntegerField(default=0)
    assists = models.IntegerField(default=0)
    rank_at_match = models.CharField(max_length=128, blank=True)
    raw_data = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('user', 'external_match_id')
        ordering = ['-played_at', '-created_at']

    def __str__(self) -> str:
        return f'{self.user_id}:{self.external_match_id}'
