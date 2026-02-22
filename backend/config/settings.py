import os
import importlib.util
from pathlib import Path
from datetime import timedelta

import dj_database_url
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.getenv('DJANGO_SECRET_KEY', '')
DEBUG = os.getenv('DJANGO_DEBUG', 'False').lower() == 'true'

ALLOWED_HOSTS = [host.strip() for host in os.getenv('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1,192.168.31.28,cs2party.duckdns.org').split(',') if host.strip()]
FRONTEND_URL = os.getenv('FRONTEND_URL', 'http://localhost')

HAS_DAPHNE = importlib.util.find_spec('daphne') is not None
HAS_CHANNELS = importlib.util.find_spec('channels') is not None
HAS_CHANNELS_REDIS = importlib.util.find_spec('channels_redis') is not None

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'corsheaders',
    'rest_framework',
    'rest_framework_simplejwt.token_blacklist',
    'apps.accounts',
    'apps.rooms',
    'apps.cs2',
    'apps.notifications',
]

if HAS_DAPHNE:
    INSTALLED_APPS.insert(0, 'daphne')
if HAS_CHANNELS:
    INSTALLED_APPS.insert(1 if HAS_DAPHNE else 0, 'channels')

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'
ASGI_APPLICATION = 'config.asgi.application'

DATABASES = {
    'default': dj_database_url.parse(
        os.getenv('DATABASE_URL', f"sqlite:///{BASE_DIR / 'db.sqlite3'}"),
        conn_max_age=600,
    )
}

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'ru-ru'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
AUTH_USER_MODEL = 'accounts.User'

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
}

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(hours=1),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=1),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
}

EMAIL_BACKEND = os.getenv('EMAIL_BACKEND', 'django.core.mail.backends.smtp.EmailBackend')
EMAIL_HOST = os.getenv('EMAIL_HOST', 'smtp.yandex.ru')
EMAIL_PORT = int(os.getenv('EMAIL_PORT', '587'))
EMAIL_HOST_USER = os.getenv('EMAIL_HOST_USER', '')
EMAIL_HOST_PASSWORD = os.getenv('EMAIL_HOST_PASSWORD', '')
EMAIL_USE_TLS = os.getenv('EMAIL_USE_TLS', 'True').lower() == 'true'
EMAIL_USE_SSL = os.getenv('EMAIL_USE_SSL', 'False').lower() == 'true'
EMAIL_TIMEOUT = int(os.getenv('EMAIL_TIMEOUT', '10'))
DEFAULT_FROM_EMAIL = os.getenv('DEFAULT_FROM_EMAIL', EMAIL_HOST_USER)

CSRF_TRUSTED_ORIGINS = [origin.strip() for origin in os.getenv('CSRF_TRUSTED_ORIGINS', 'http://localhost,http://127.0.0.1,https://localhost,https://127.0.0.1').split(',') if origin.strip()]
CORS_ALLOWED_ORIGINS = [origin.strip() for origin in os.getenv('CORS_ALLOWED_ORIGINS', 'http://localhost,http://127.0.0.1,https://localhost,https://127.0.0.1').split(',') if origin.strip()]

REDIS_URL = os.getenv('REDIS_URL', 'redis://localhost:6379/0')
CHANNEL_REDIS_URL = os.getenv('CHANNEL_REDIS_URL', REDIS_URL)
if HAS_CHANNELS_REDIS:
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels_redis.core.RedisChannelLayer',
            'CONFIG': {
                'hosts': [CHANNEL_REDIS_URL],
            },
        },
    }
elif HAS_CHANNELS:
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels.layers.InMemoryChannelLayer',
        },
    }
CELERY_BROKER_URL = REDIS_URL
CELERY_RESULT_BACKEND = REDIS_URL
CELERY_TIMEZONE = TIME_ZONE

CELERY_BEAT_SCHEDULE = {
    'send-room-reminders-every-minute': {
        'task': 'apps.rooms.tasks.send_room_reminders_task',
        'schedule': 60.0,
    },
    'sync-cs2-stats-every-30-minutes': {
        'task': 'apps.cs2.tasks.sync_all_cs2_stats_task',
        'schedule': 30 * 60.0,
    },
    'enforce-email-verification-timeouts-every-minute': {
        'task': 'apps.accounts.tasks.enforce_email_verification_timeouts_task',
        'schedule': 60.0,
    },
    'notify-unread-direct-messages-every-5-minutes': {
        'task': 'apps.accounts.tasks.notify_unread_direct_messages_task',
        'schedule': 5 * 60.0,
    },
}

TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '')
CS2_BOT_ADMIN_EMAIL = os.getenv('CS2_BOT_ADMIN_EMAIL', 'backwach1@yandex.ru').strip().lower()
CS2_STATS_API_URL = os.getenv('CS2_STATS_API_URL', '').rstrip('/')
CS2_STATS_API_TOKEN = os.getenv('CS2_STATS_API_TOKEN', '')
CS2_STATS_STEAM_USERNAME = os.getenv('CS2_STATS_STEAM_USERNAME', os.getenv('STEAM_USERNAME', ''))
CS2_STATS_STEAM_PASSWORD = os.getenv('CS2_STATS_STEAM_PASSWORD', os.getenv('STEAM_PASSWORD', ''))
CS2_STATS_STEAM_2FA_SECRET = os.getenv('CS2_STATS_STEAM_2FA_SECRET', os.getenv('STEAM_2FA_SECRET', ''))
CS2_SERVER_API_URL = os.getenv('CS2_SERVER_API_URL', '').rstrip('/')
CS2_SERVER_API_TOKEN = os.getenv('CS2_SERVER_API_TOKEN', '')
CS2_SERVER_HOST = os.getenv('CS2_SERVER_HOST', '')
CS2_SERVER_PORT = int(os.getenv('CS2_SERVER_PORT', '0') or '0')
CS2_SERVER_PASSWORD = os.getenv('CS2_SERVER_PASSWORD', '')
