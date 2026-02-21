from datetime import timedelta

from django.core import mail
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import EmailActionToken, User
from apps.accounts.services import send_email_change_verification_email, send_verification_email
from apps.accounts.tasks import enforce_email_verification_timeouts_task


@override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
class EmailLifecycleTests(APITestCase):
    def _create_user(self, **overrides) -> User:
        data = {
            'email': 'player@example.com',
            'password': 'StrongPass123!',
            'nickname': 'player1',
            'birth_date': timezone.now().date().replace(year=1998),
            'initials': 'PL',
            'is_active': True,
            'is_email_verified': True,
        }
        data.update(overrides)
        return User.objects.create_user(**data)

    def test_registration_verification_token_valid_for_10_minutes(self):
        user = self._create_user(email='new@example.com', nickname='newbie', is_active=False, is_email_verified=False)
        token = send_verification_email(user)

        delta = token.expires_at - token.created_at
        self.assertLessEqual(delta.total_seconds(), 10 * 60 + 2)
        self.assertGreaterEqual(delta.total_seconds(), 10 * 60 - 2)
        self.assertEqual(len(mail.outbox), 1)

    def test_stale_unverified_account_is_deleted_after_10_minutes(self):
        stale_user = self._create_user(
            email='stale@example.com',
            nickname='stale',
            is_active=False,
            is_email_verified=False,
        )
        stale_user.date_joined = timezone.now() - timedelta(minutes=11)
        stale_user.save(update_fields=['date_joined'])

        active_user = self._create_user(email='active@example.com', nickname='active')

        result = enforce_email_verification_timeouts_task()

        self.assertEqual(result['deleted_unverified_users'], 1)
        self.assertFalse(User.objects.filter(id=stale_user.id).exists())
        self.assertTrue(User.objects.filter(id=active_user.id).exists())

    def test_email_change_requires_confirmation_and_applies_on_verify(self):
        user = self._create_user(email='old@example.com', nickname='oldnick')
        self.client.force_authenticate(user=user)

        response = self.client.patch('/api/auth/me/', {'email': 'new@example.com'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        user.refresh_from_db()
        self.assertEqual(user.email, 'old@example.com')
        self.assertEqual(user.pending_email, 'new@example.com')
        self.assertTrue(user.pending_email_expires_at)

        token = EmailActionToken.objects.filter(
            user=user,
            action=EmailActionToken.VERIFY_EMAIL,
            payload__flow='email_change',
            used_at__isnull=True,
        ).latest('created_at')

        verify_response = self.client.get('/api/auth/verify-email/', {'token': token.token})
        self.assertEqual(verify_response.status_code, status.HTTP_200_OK)

        user.refresh_from_db()
        self.assertEqual(user.email, 'new@example.com')
        self.assertEqual(user.pending_email, '')
        self.assertIsNone(user.pending_email_expires_at)

    def test_expired_email_change_is_rolled_back(self):
        user = self._create_user(email='old2@example.com', nickname='oldnick2')
        send_email_change_verification_email(user, 'new2@example.com')
        user.refresh_from_db()
        user.pending_email_expires_at = timezone.now() - timedelta(seconds=1)
        user.save(update_fields=['pending_email_expires_at'])

        result = enforce_email_verification_timeouts_task()

        self.assertEqual(result['rolled_back_pending_email_changes'], 1)
        user.refresh_from_db()
        self.assertEqual(user.email, 'old2@example.com')
        self.assertEqual(user.pending_email, '')
        self.assertIsNone(user.pending_email_expires_at)
