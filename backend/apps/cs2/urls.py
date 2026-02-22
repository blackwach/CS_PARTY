from django.urls import path

from .views import CS2StatsHealthView, MyCS2StatsView, SyncMyCS2StatsView

urlpatterns = [
    path('me/stats', MyCS2StatsView.as_view(), name='cs2-my-stats-no-slash'),
    path('me/stats/', MyCS2StatsView.as_view(), name='cs2-my-stats'),
    path('me/sync', SyncMyCS2StatsView.as_view(), name='cs2-my-sync-no-slash'),
    path('me/sync/', SyncMyCS2StatsView.as_view(), name='cs2-my-sync'),
    path('health', CS2StatsHealthView.as_view(), name='cs2-health-no-slash'),
    path('health/', CS2StatsHealthView.as_view(), name='cs2-health'),
]
