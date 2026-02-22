from django.urls import path

from apps.accounts.consumers import ChatConsumer, DialogsConsumer, NotificationsConsumer
from apps.rooms.consumers import RoomConsumer

websocket_urlpatterns = [
    path('ws/notifications/', NotificationsConsumer.as_asgi()),
    path('ws/chats/', DialogsConsumer.as_asgi()),
    path('ws/chat/<int:user_id>/', ChatConsumer.as_asgi()),
    path('ws/rooms/<str:code>/', RoomConsumer.as_asgi()),
]
