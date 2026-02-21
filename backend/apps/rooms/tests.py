from datetime import date, timedelta
from unittest.mock import patch

from django.test import override_settings
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

    def _create_room(self):
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
        return response.data

    def test_room_invite_creates_in_app_notification(self):
        room = self._create_room()
        notification = InAppNotification.objects.filter(user=self.guest, type=InAppNotification.TYPE_ROOM_INVITE).first()
        self.assertIsNotNone(notification)
        self.assertEqual(notification.payload.get('room_code'), room['code'])

    def test_room_can_use_host_server_endpoint(self):
        response = self.client.post(
            '/api/rooms/',
            {
                'title': 'Host server room',
                'scheduled_for': (timezone.now() + timedelta(hours=1)).isoformat(),
                'invited_user_ids': [self.guest.id],
                'host_server_host': '203.0.113.5',
                'host_server_port': 27015,
                'host_server_password': 'p@ss',
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        room_code = response.data['code']

        self.client.post(f'/api/rooms/{room_code}/ready/', {}, format='json')

        self.client.force_authenticate(user=self.guest)
        self.client.post(f'/api/rooms/{room_code}/join/', {}, format='json')
        ready = self.client.post(f'/api/rooms/{room_code}/ready/', {}, format='json')
        self.assertEqual(ready.status_code, status.HTTP_200_OK)
        self.assertEqual(ready.data['status'], 'started')
        self.assertEqual(ready.data['server_host'], '203.0.113.5')
        self.assertEqual(ready.data['server_port'], 27015)
        self.assertIn('%2Bconnect%20203.0.113.5%3A27015', ready.data['server_connect_url'])

    def test_room_host_auto_mode_uses_host_public_ip_and_starts(self):
        response = self.client.post(
            '/api/rooms/',
            {
                'title': 'Host auto room',
                'scheduled_for': (timezone.now() + timedelta(hours=1)).isoformat(),
                'invited_user_ids': [self.guest.id],
                'host_auto_server': True,
                'host_server_port': 27015,
                'host_server_password': 'roompass',
                'host_server_map': 'de_mirage',
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        room_code = response.data['code']

        host_ready = self.client.post(
            f'/api/rooms/{room_code}/ready/',
            {'host_public_ip': '198.51.100.25'},
            format='json',
        )
        self.assertEqual(host_ready.status_code, status.HTTP_200_OK)
        self.assertEqual(host_ready.data['server_source'], 'host-auto')

        self.client.force_authenticate(user=self.guest)
        join_response = self.client.post(f'/api/rooms/{room_code}/join/', {}, format='json')
        self.assertEqual(join_response.status_code, status.HTTP_200_OK)

        guest_ready = self.client.post(f'/api/rooms/{room_code}/ready/', {}, format='json')
        self.assertEqual(guest_ready.status_code, status.HTTP_200_OK)
        self.assertEqual(guest_ready.data['status'], 'started')
        self.assertEqual(guest_ready.data['server_host'], '198.51.100.25')
        self.assertEqual(guest_ready.data['server_port'], 27015)
        self.assertEqual(guest_ready.data['server_source'], 'host-auto')
        self.assertIn('%2Bconnect%20198.51.100.25%3A27015', guest_ready.data['server_connect_url'])
        self.assertIn('+map de_mirage', guest_ready.data['server_launch_command'])
        self.assertIn('+port 27015', guest_ready.data['server_launch_command'])

    @patch('apps.notifications.realtime.async_to_sync', side_effect=Exception('redis unavailable'))
    def test_room_creation_is_not_broken_when_ws_broadcast_fails(self, _):
        room = self._create_room()
        self.assertTrue(room['code'])

    def test_member_can_cancel_ready_before_room_start(self):
        room = self._create_room()
        room_code = room['code']

        self.client.force_authenticate(user=self.guest)
        join_response = self.client.post(f'/api/rooms/{room_code}/join/', {}, format='json')
        self.assertEqual(join_response.status_code, status.HTTP_200_OK)

        ready_response = self.client.post(f'/api/rooms/{room_code}/ready/', {}, format='json')
        self.assertEqual(ready_response.status_code, status.HTTP_200_OK)

        unready_response = self.client.post(f'/api/rooms/{room_code}/unready/', {}, format='json')
        self.assertEqual(unready_response.status_code, status.HTTP_200_OK)
        my_membership = next(item for item in unready_response.data['memberships'] if item['user']['id'] == self.guest.id)
        self.assertEqual(my_membership['state'], 'joined')

    def test_host_can_close_room(self):
        room = self._create_room()
        response = self.client.post(f"/api/rooms/{room['code']}/close/", {}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], 'cancelled')

    def test_non_host_cannot_close_room(self):
        room = self._create_room()
        self.client.force_authenticate(user=self.guest)
        self.client.post(f"/api/rooms/{room['code']}/join/", {}, format='json')
        response = self.client.post(f"/api/rooms/{room['code']}/close/", {}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    @override_settings(CS2_SERVER_API_URL='https://allocator.test')
    @patch('apps.rooms.server_provisioning.requests.delete')
    def test_close_room_requests_server_release(self, mock_delete):
        room = self._create_room()
        room_obj = self.host.hosted_rooms.get(code=room['code'])
        room_obj.server_provider_payload = {'source': 'allocator'}
        room_obj.save(update_fields=['server_provider_payload', 'updated_at'])
        response = self.client.post(f"/api/rooms/{room['code']}/close/", {}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(mock_delete.called)

    @override_settings(
        CS2_SERVER_HOST='127.0.0.1',
        CS2_SERVER_PORT=27015,
        CS2_SERVER_PASSWORD='roompass',
        CS2_SERVER_API_URL='',
    )
    def test_room_is_started_and_has_steam_connect_url_when_all_members_ready(self):
        room = self._create_room()
        room_code = room['code']

        host_ready = self.client.post(f'/api/rooms/{room_code}/ready/', {}, format='json')
        self.assertEqual(host_ready.status_code, status.HTTP_200_OK)

        self.client.force_authenticate(user=self.guest)
        self.client.post(f'/api/rooms/{room_code}/join/', {}, format='json')
        guest_ready = self.client.post(f'/api/rooms/{room_code}/ready/', {}, format='json')
        self.assertEqual(guest_ready.status_code, status.HTTP_200_OK)
        self.assertEqual(guest_ready.data['status'], 'started')
        self.assertEqual(guest_ready.data['server_host'], '127.0.0.1')
        self.assertEqual(guest_ready.data['server_port'], 27015)
        self.assertTrue(guest_ready.data['server_connect_url'].startswith('steam://'))
