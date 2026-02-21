import os
import logging

from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
logger = logging.getLogger(__name__)

django_asgi_app = get_asgi_application()
application = django_asgi_app

try:
    from channels.auth import AuthMiddlewareStack
    from channels.routing import ProtocolTypeRouter, URLRouter

    from apps.accounts.websocket_auth import JwtQueryAuthMiddleware
    from config.routing import websocket_urlpatterns

    application = ProtocolTypeRouter(
        {
            'http': django_asgi_app,
            'websocket': JwtQueryAuthMiddleware(
                AuthMiddlewareStack(
                    URLRouter(websocket_urlpatterns)
                )
            ),
        }
    )
except ModuleNotFoundError:
    logger.warning('Channels dependencies are missing. Running in HTTP-only mode.')
    application = django_asgi_app
except Exception:
    logger.exception('WebSocket router initialization failed. Running in HTTP-only mode.')
    application = django_asgi_app
