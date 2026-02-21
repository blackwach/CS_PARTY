from django.urls import path

from .views import MyCS2StatsView, SyncMyCS2StatsView

urlpatterns = [
    path('me/stats', MyCS2StatsView.as_view(), name='cs2-my-stats-no-slash'),
    path('me/stats/', MyCS2StatsView.as_view(), name='cs2-my-stats'),
    path('me/sync', SyncMyCS2StatsView.as_view(), name='cs2-my-sync-no-slash'),
    path('me/sync/', SyncMyCS2StatsView.as_view(), name='cs2-my-sync'),
]
