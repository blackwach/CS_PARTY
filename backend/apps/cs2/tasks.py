from celery import shared_task
from django.contrib.auth import get_user_model
from rest_framework.exceptions import ValidationError

from .services import sync_cs2_stats_for_user

User = get_user_model()


@shared_task
def sync_all_cs2_stats_task() -> dict:
    """
    Синхронизирует статистику CS2 для всех пользователей с указанным Steam profile.
    Запускается по расписанию (например, каждые 30 минут).
    """
    users = User.objects.filter(steam_account_id__isnull=False).exclude(steam_account_id='')
    synced = 0
    failed = 0
    for user in users:
        try:
            sync_cs2_stats_for_user(user)
            synced += 1
        except ValidationError:
            failed += 1
        except Exception:
            failed += 1
    return {'synced': synced, 'failed': failed}
