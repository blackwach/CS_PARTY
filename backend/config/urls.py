from django.contrib import admin
from django.conf import settings
from django.conf.urls.static import static
from django.urls import include, path

from config.views import LandingView, ResetPasswordLandingView, VerifyEmailLandingView

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', LandingView.as_view(), name='landing'),
    path('verify-email/<str:token>/', VerifyEmailLandingView.as_view(), name='verify-email-landing'),
    path('reset-password/', ResetPasswordLandingView.as_view(), name='reset-password-landing'),
    path('api/auth/', include('apps.accounts.urls')),
    path('api/rooms/', include('apps.rooms.urls')),
    path('api/cs2/', include('apps.cs2.urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
