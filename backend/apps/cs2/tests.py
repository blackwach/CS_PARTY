from datetime import date
from unittest.mock import Mock, patch

from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import User


class Cs2StatsFlowTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email='stats@example.com',
            password='StrongPass123!',
            nickname='stats_user',
            birth_date=date(1999, 3, 15),
            initials='SU',
            is_active=True,
            is_email_verified=True,
        )
        self.client.force_authenticate(user=self.user)

    @override_settings(CS2_STATS_API_URL='https://cs2-stats.example')
    @patch('apps.cs2.services.requests.get')
    def test_stats_can_be_synced_and_loaded_after_setting_steam_profile(self, mock_get):
        mock_response = Mock()
        mock_response.raise_for_status.return_value = None
        mock_response.json.return_value = {
            'rank': 'Gold Nova 1',
            'wins': 12,
            'losses': 5,
            'total_matches': 17,
            'matches': [
                {
                    'id': 'm1',
                    'played_at': '2026-02-21T10:00:00Z',
                    'map': 'de_mirage',
                    'result': 'win',
                    'kills': 21,
                    'deaths': 15,
                    'assists': 8,
                    'rank': 'Gold Nova 1',
                }
            ],
        }
        mock_get.return_value = mock_response

        profile_response = self.client.patch(
            '/api/auth/me/',
            {'steam_profile_url': 'https://steamcommunity.com/profiles/76561198012345678'},
            format='json',
        )
        self.assertEqual(profile_response.status_code, status.HTTP_200_OK)
        self.assertEqual(profile_response.data['steam_account_id'], '76561198012345678')

        sync_response = self.client.post('/api/cs2/me/sync/', {}, format='json')
        self.assertEqual(sync_response.status_code, status.HTTP_200_OK)
        self.assertEqual(sync_response.data['rank'], 'Gold Nova 1')
        self.assertEqual(sync_response.data['wins'], 12)

        stats_response = self.client.get('/api/cs2/me/stats/')
        self.assertEqual(stats_response.status_code, status.HTTP_200_OK)
        self.assertEqual(stats_response.data['total_matches'], 17)
        self.assertEqual(len(stats_response.data['recent_matches']), 1)
