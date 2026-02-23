import base64
import hashlib
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings

TOKEN_PREFIX = 'enc:v1:'


def _as_fernet_key(raw_value: str) -> bytes:
    candidate = str(raw_value or '').strip()
    if candidate:
        try:
            decoded = base64.urlsafe_b64decode(candidate.encode('ascii'))
            if len(decoded) == 32:
                return candidate.encode('ascii')
        except Exception:
            pass
        return base64.urlsafe_b64encode(hashlib.sha256(candidate.encode('utf-8')).digest())
    return base64.urlsafe_b64encode(hashlib.sha256(settings.SECRET_KEY.encode('utf-8')).digest())


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    raw_key = getattr(settings, 'CS2_MATCH_TOKEN_ENCRYPTION_KEY', '')
    return Fernet(_as_fernet_key(raw_key))


def is_encrypted_cs2_match_token(value: str | None) -> bool:
    return str(value or '').strip().startswith(TOKEN_PREFIX)


def encrypt_cs2_match_token(value: str | None) -> str:
    token = str(value or '').strip()
    if not token:
        return ''
    if is_encrypted_cs2_match_token(token):
        return token
    encrypted = _fernet().encrypt(token.encode('utf-8')).decode('ascii')
    return f'{TOKEN_PREFIX}{encrypted}'


def decrypt_cs2_match_token(value: str | None) -> str:
    token = str(value or '').strip()
    if not token:
        return ''
    if not is_encrypted_cs2_match_token(token):
        # Legacy plaintext value (before encryption rollout).
        return token
    payload = token[len(TOKEN_PREFIX) :]
    if not payload:
        return ''
    try:
        return _fernet().decrypt(payload.encode('ascii')).decode('utf-8').strip()
    except (InvalidToken, ValueError, TypeError):
        return ''


def mask_cs2_match_token(value: str | None) -> str:
    token = decrypt_cs2_match_token(value)
    if not token:
        return ''
    visible = token[-4:] if len(token) > 4 else token[-2:]
    return f'{"*" * max(len(token) - len(visible), 6)}{visible}'


def get_user_cs2_match_token(user) -> str:
    if user is None:
        return ''
    return decrypt_cs2_match_token(getattr(user, 'cs2_match_token', ''))
