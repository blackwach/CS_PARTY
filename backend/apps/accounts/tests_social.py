from datetime import date

from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import DirectMessage, Friendship, User
from apps.notifications.models import InAppNotification


class SocialApiTests(APITestCase):
    def setUp(self):
        self.alice = User.objects.create_user(
            email='alice@example.com',
            password='StrongPass123!',
            nickname='alice',
            birth_date=date(1998, 1, 1),
            initials='AL',
            is_active=True,
            is_email_verified=True,
        )
        self.bob = User.objects.create_user(
            email='bob@example.com',
            password='StrongPass123!',
            nickname='bob',
            birth_date=date(1998, 2, 2),
            initials='BO',
            is_active=True,
            is_email_verified=True,
        )

    def test_friend_request_accept_and_chat(self):
        self.client.force_authenticate(user=self.alice)
        create_response = self.client.post('/api/auth/friends/request/', {'user_id': self.bob.id}, format='json')
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        request_id = create_response.data['id']

        self.assertTrue(
            InAppNotification.objects.filter(
                user=self.bob,
                type=InAppNotification.TYPE_FRIEND_REQUEST,
            ).exists()
        )

        self.client.force_authenticate(user=self.bob)
        accept_response = self.client.post(f'/api/auth/friends/requests/{request_id}/accept/', {}, format='json')
        self.assertEqual(accept_response.status_code, status.HTTP_200_OK)
        self.assertEqual(accept_response.data['status'], 'accepted')
        self.assertEqual(Friendship.objects.count(), 1)

        send_message = self.client.post(
            f'/api/auth/chats/{self.alice.id}/messages/',
            {'text': 'hello'},
            format='json',
        )
        self.assertEqual(send_message.status_code, status.HTTP_201_CREATED)
        self.assertEqual(send_message.data['text'], 'hello')
        chat_notification = InAppNotification.objects.filter(
            user=self.alice,
            type=InAppNotification.TYPE_SYSTEM,
            payload__kind='chat_message',
            payload__message_id=send_message.data['id'],
        ).first()
        self.assertIsNotNone(chat_notification)
        self.assertFalse(chat_notification.is_read)

        self.client.force_authenticate(user=self.alice)
        list_messages = self.client.get(f'/api/auth/chats/{self.bob.id}/messages/')
        self.assertEqual(list_messages.status_code, status.HTTP_200_OK)
        self.assertEqual(len(list_messages.data), 1)
        self.assertIsNotNone(list_messages.data[0]['read_at'])
        self.assertIsNotNone(DirectMessage.objects.get(id=send_message.data['id']).read_at)
        chat_notification.refresh_from_db()
        self.assertTrue(chat_notification.is_read)

    def test_public_profile_contains_friendship_status(self):
        self.client.force_authenticate(user=self.alice)
        response = self.client.get(f'/api/auth/users/{self.bob.id}/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['friendship_status'], 'none')
        self.assertNotIn('email', response.data)
        self.assertNotIn('about', response.data)
        self.assertNotIn('initials', response.data)
        self.assertIn('nickname', response.data)
        self.assertIn('steam_profile_url', response.data)
        self.assertIn('is_online', response.data)
        self.assertIn('last_seen_at', response.data)

    def test_profile_can_store_cs2_match_token(self):
        self.client.force_authenticate(user=self.alice)
        response = self.client.patch(
            '/api/auth/me/',
            {'cs2_match_token': 'TOKEN_12345678'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['cs2_match_token'], 'TOKEN_12345678')
        self.alice.refresh_from_db()
        self.assertEqual(self.alice.cs2_match_token, 'TOKEN_12345678')

    def test_profile_can_store_cs2_share_code(self):
        self.client.force_authenticate(user=self.alice)
        mixed_case_code = 'CSGO-r9KKC-RHx6r-5Z3UA-X6cf5-mqbNE'
        response = self.client.patch(
            '/api/auth/me/',
            {'cs2_match_token': f'steam://rungame/730/+csgo_download_match {mixed_case_code}'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['cs2_match_token'], mixed_case_code)
        self.alice.refresh_from_db()
        self.assertEqual(self.alice.cs2_match_token, mixed_case_code)

    def test_profile_can_extract_steamidkey_from_url(self):
        self.client.force_authenticate(user=self.alice)
        response = self.client.patch(
            '/api/auth/me/',
            {'cs2_match_token': 'https://example.com/cs2?steamidkey=TOKEN_ABCDEFG12345&steamid=76561198000000000'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['cs2_match_token'], 'TOKEN_ABCDEFG12345')
        self.alice.refresh_from_db()
        self.assertEqual(self.alice.cs2_match_token, 'TOKEN_ABCDEFG12345')

    def test_profile_rejects_invalid_cs2_match_token(self):
        self.client.force_authenticate(user=self.alice)
        response = self.client.patch(
            '/api/auth/me/',
            {'cs2_match_token': 'invalid token with spaces'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('cs2_match_token', response.data)
