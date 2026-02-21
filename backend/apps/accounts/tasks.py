from datetime import timedelta

from celery import shared_task
from django.db import transaction
from django.utils import timezone

from .models import EmailActionToken, User


@shared_task
def enforce_email_verification_timeouts_task() -> dict[str, int]:
    now = timezone.now()
    register_cutoff = now - timedelta(minutes=10)

    stale_users = User.objects.filter(
        is_active=False,
        is_email_verified=False,
        is_superuser=False,
        date_joined__lte=register_cutoff,
    )
    stale_user_count = stale_users.count()
    stale_users.delete()

    expired_pending_users = list(
        User.objects.filter(
            pending_email__gt='',
            pending_email_expires_at__isnull=False,
            pending_email_expires_at__lte=now,
        ).only('id', 'email', 'pending_email_previous')
    )

    with transaction.atomic():
        for user in expired_pending_users:
            user.email = user.pending_email_previous or user.email
            user.pending_email = ''
            user.pending_email_previous = ''
            user.pending_email_expires_at = None
            user.save(update_fields=['email', 'pending_email', 'pending_email_previous', 'pending_email_expires_at'])

        if expired_pending_users:
            EmailActionToken.objects.filter(
                user_id__in=[u.id for u in expired_pending_users],
                action=EmailActionToken.VERIFY_EMAIL,
                used_at__isnull=True,
                payload__flow='email_change',
            ).update(used_at=now)

    return {
        'deleted_unverified_users': stale_user_count,
        'rolled_back_pending_email_changes': len(expired_pending_users),
    }
