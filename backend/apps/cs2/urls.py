from django.urls import path

from .views import (
    CS2AddFriendView,
    CS2StatsHealthView,
    CS2SubmitSteamGuardView,
    MyCS2StatsView,
    SyncMyCS2StatsView,
    UserCS2StatsView,
)

urlpatterns = [
    path('me/stats', MyCS2StatsView.as_view(), name='cs2-my-stats-no-slash'),
    path('me/stats/', MyCS2StatsView.as_view(), name='cs2-my-stats'),
    path('users/<int:user_id>/stats', UserCS2StatsView.as_view(), name='cs2-user-stats-no-slash'),
    path('users/<int:user_id>/stats/', UserCS2StatsView.as_view(), name='cs2-user-stats'),
    path('me/sync', SyncMyCS2StatsView.as_view(), name='cs2-my-sync-no-slash'),
    path('me/sync/', SyncMyCS2StatsView.as_view(), name='cs2-my-sync'),
    path('health', CS2StatsHealthView.as_view(), name='cs2-health-no-slash'),
    path('health/', CS2StatsHealthView.as_view(), name='cs2-health'),
    path('friends/add', CS2AddFriendView.as_view(), name='cs2-friend-add-no-slash'),
    path('friends/add/', CS2AddFriendView.as_view(), name='cs2-friend-add'),
    path('guard/submit', CS2SubmitSteamGuardView.as_view(), name='cs2-guard-submit-no-slash'),
    path('guard/submit/', CS2SubmitSteamGuardView.as_view(), name='cs2-guard-submit'),
]
