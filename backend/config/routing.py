from django.urls import path

from apps.accounts.consumers import ChatConsumer, NotificationsConsumer

websocket_urlpatterns = [
    path('ws/notifications/', NotificationsConsumer.as_asgi()),
    path('ws/chat/<int:user_id>/', ChatConsumer.as_asgi()),
]
