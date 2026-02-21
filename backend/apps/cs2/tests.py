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

    @override_settings(CS2_STATS_API_URL='https://cs2-stats.example')
    @patch('apps.cs2.services.requests.get')
    def test_sync_resolves_vanity_steam_url(self, mock_get):
        vanity_response = Mock()
        vanity_response.raise_for_status.return_value = None
        vanity_response.text = '<profile><steamID64>76561198099999999</steamID64></profile>'

        stats_response = Mock()
        stats_response.raise_for_status.return_value = None
        stats_response.json.return_value = {
            'rank': 'Master Guardian 1',
            'wins': 4,
            'losses': 2,
            'total_matches': 6,
            'matches': [],
        }

        def _side_effect(url, *args, **kwargs):
            if 'steamcommunity.com/id/' in url:
                return vanity_response
            if 'cs2-stats.example/players/' in url:
                return stats_response
            raise AssertionError(f'Unexpected URL called: {url}')

        mock_get.side_effect = _side_effect

        profile_update = self.client.patch(
            '/api/auth/me/',
            {'steam_profile_url': 'https://steamcommunity.com/id/test-player'},
            format='json',
        )
        self.assertEqual(profile_update.status_code, status.HTTP_200_OK)
        self.assertEqual(profile_update.data['steam_account_id'], '')

        sync_response = self.client.post('/api/cs2/me/sync', {}, format='json')
        self.assertEqual(sync_response.status_code, status.HTTP_200_OK)
        self.assertEqual(sync_response.data['rank'], 'Master Guardian 1')

        self.user.refresh_from_db()
        self.assertEqual(self.user.steam_account_id, '76561198099999999')

    @override_settings(CS2_STATS_API_URL='')
    @patch('apps.cs2.services.requests.get')
    def test_sync_falls_back_to_public_profile_mode_when_provider_not_configured(self, mock_get):
        profile_xml = Mock()
        profile_xml.raise_for_status.return_value = None
        profile_xml.text = (
            '<profile>'
            '<steamID64>76561198012345678</steamID64>'
            '<steamID>Public Player</steamID>'
            '<privacyState>public</privacyState>'
            '</profile>'
        )
        mock_get.return_value = profile_xml

        profile_response = self.client.patch(
            '/api/auth/me/',
            {'steam_profile_url': 'https://steamcommunity.com/profiles/76561198012345678'},
            format='json',
        )
        self.assertEqual(profile_response.status_code, status.HTTP_200_OK)

        sync_response = self.client.post('/api/cs2/me/sync/', {}, format='json')
        self.assertEqual(sync_response.status_code, status.HTTP_200_OK)
        self.assertEqual(sync_response.data['source'], 'public_profile')
        self.assertEqual(sync_response.data['total_matches'], 0)
        self.assertTrue(sync_response.data['note'])
