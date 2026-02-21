from urllib.parse import parse_qs

from asgiref.sync import sync_to_async
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.tokens import AccessToken

from .models import User


@sync_to_async
def _get_user_from_token(token_value: str):
    try:
        token = AccessToken(token_value)
        user_id = token.get('user_id')
        if not user_id:
            return AnonymousUser()
        return User.objects.filter(id=user_id, is_active=True).first() or AnonymousUser()
    except Exception:
        return AnonymousUser()


class JwtQueryAuthMiddleware:
    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        query_string = scope.get('query_string', b'').decode()
        query = parse_qs(query_string)
        token_value = (query.get('token') or [None])[0]
        if token_value:
            scope['user'] = await _get_user_from_token(token_value)
        return await self.inner(scope, receive, send)
