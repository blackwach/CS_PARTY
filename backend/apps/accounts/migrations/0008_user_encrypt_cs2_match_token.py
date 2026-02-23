import base64
import hashlib

from cryptography.fernet import Fernet
from django.conf import settings
from django.db import migrations, models

TOKEN_PREFIX = 'enc:v1:'


def _build_fernet() -> Fernet:
    raw_key = str(getattr(settings, 'CS2_MATCH_TOKEN_ENCRYPTION_KEY', '') or '').strip()
    if raw_key:
        try:
            decoded = base64.urlsafe_b64decode(raw_key.encode('ascii'))
            if len(decoded) == 32:
                return Fernet(raw_key.encode('ascii'))
        except Exception:
            pass
        digest = hashlib.sha256(raw_key.encode('utf-8')).digest()
        return Fernet(base64.urlsafe_b64encode(digest))
    digest = hashlib.sha256(settings.SECRET_KEY.encode('utf-8')).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_existing_match_tokens(apps, schema_editor):
    User = apps.get_model('accounts', 'User')
    fernet = _build_fernet()
    queryset = User.objects.exclude(cs2_match_token='')
    for user in queryset.iterator(chunk_size=500):
        token = str(user.cs2_match_token or '').strip()
        if not token or token.startswith(TOKEN_PREFIX):
            continue
        encrypted = fernet.encrypt(token.encode('utf-8')).decode('ascii')
        User.objects.filter(pk=user.pk).update(cs2_match_token=f'{TOKEN_PREFIX}{encrypted}')


class Migration(migrations.Migration):
    dependencies = [
        ('accounts', '0007_user_cs2_match_token'),
    ]

    operations = [
        migrations.AlterField(
            model_name='user',
            name='cs2_match_token',
            field=models.CharField(blank=True, max_length=1024),
        ),
        migrations.RunPython(encrypt_existing_match_tokens, migrations.RunPython.noop),
    ]
