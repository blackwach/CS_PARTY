from datetime import date

from django.core import mail
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import EmailActionToken, User
from apps.accounts.services import create_action_token


class AccountDeletionApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email='player@example.com',
            password='StrongPass123!',
            nickname='player1',
            birth_date=date(1998, 1, 1),
            initials='PL',
            is_active=True,
            is_email_verified=True,
        )

    @override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
    def test_delete_account_request_sends_email_and_creates_token(self):
        self.client.force_authenticate(user=self.user)

        response = self.client.post('/api/auth/delete-account/request/', {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(EmailActionToken.objects.filter(user=self.user, action=EmailActionToken.DELETE_ACCOUNT).count(), 1)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn('delete-account', mail.outbox[0].body)

    def test_delete_account_confirm_deletes_user(self):
        token = create_action_token(user=self.user, action=EmailActionToken.DELETE_ACCOUNT, ttl_seconds=300)

        response = self.client.post('/api/auth/delete-account/confirm/', {'token': token.token}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(User.objects.filter(id=self.user.id).exists())

    def test_delete_account_confirm_with_invalid_token_returns_400(self):
        response = self.client.post('/api/auth/delete-account/confirm/', {'token': 'bad-token'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
