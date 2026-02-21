from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    AllowedInvitersView,
    LoginView,
    PasswordChangeView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    ProfileView,
    RegisterView,
    TelegramLinkCodeView,
    TelegramNotificationsToggleView,
    UserSearchView,
    VerifyEmailAPIView,
    telegram_link_callback,
)

urlpatterns = [
    path('register/', RegisterView.as_view(), name='register'),
    path('login/', LoginView.as_view(), name='login'),
    path('token/refresh/', TokenRefreshView.as_view(), name='token-refresh'),
    path('verify-email/', VerifyEmailAPIView.as_view(), name='verify-email'),
    path('password-reset/request/', PasswordResetRequestView.as_view(), name='password-reset-request'),
    path('password-reset/confirm/', PasswordResetConfirmView.as_view(), name='password-reset-confirm'),
    path('password-change/', PasswordChangeView.as_view(), name='password-change'),
    path('me/', ProfileView.as_view(), name='profile'),
    path('users/search/', UserSearchView.as_view(), name='users-search'),
    path('permissions/inviters/', AllowedInvitersView.as_view(), name='allowed-inviters'),
    path('telegram/link-code/', TelegramLinkCodeView.as_view(), name='telegram-link-code'),
    path('telegram/toggle/', TelegramNotificationsToggleView.as_view(), name='telegram-toggle'),
    path('telegram/link-callback/', telegram_link_callback, name='telegram-link-callback'),
]
