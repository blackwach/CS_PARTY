from datetime import date, timedelta

from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import User
from apps.notifications.models import InAppNotification


class RoomInviteNotificationTests(APITestCase):
    def setUp(self):
        self.host = User.objects.create_user(
            email='host@example.com',
            password='StrongPass123!',
            nickname='host',
            birth_date=date(1995, 1, 1),
            initials='HO',
            is_active=True,
            is_email_verified=True,
        )
        self.guest = User.objects.create_user(
            email='guest@example.com',
            password='StrongPass123!',
            nickname='guest',
            birth_date=date(1995, 1, 1),
            initials='GU',
            is_active=True,
            is_email_verified=True,
        )
        self.client.force_authenticate(user=self.host)

    def test_room_invite_creates_in_app_notification(self):
        response = self.client.post(
            '/api/rooms/',
            {
                'title': 'Evening match',
                'scheduled_for': (timezone.now() + timedelta(hours=1)).isoformat(),
                'invited_user_ids': [self.guest.id],
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        notification = InAppNotification.objects.filter(user=self.guest, type=InAppNotification.TYPE_ROOM_INVITE).first()
        self.assertIsNotNone(notification)
        self.assertEqual(notification.payload.get('room_code'), response.data['code'])
