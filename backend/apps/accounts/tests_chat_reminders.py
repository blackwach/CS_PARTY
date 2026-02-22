from datetime import date, timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from apps.accounts.models import DirectMessage, Friendship, User
from apps.accounts.services import get_or_create_direct_conversation
from apps.accounts.tasks import notify_unread_direct_messages_task
from apps.notifications.models import InAppNotification


class ChatReminderTaskTests(TestCase):
    def setUp(self):
        self.alice = User.objects.create_user(
            email='alice-reminder@example.com',
            password='StrongPass123!',
            nickname='alice_reminder',
            birth_date=date(1998, 1, 1),
            initials='AR',
            is_active=True,
            is_email_verified=True,
            telegram_chat_id=123456789,
            telegram_notifications_enabled=True,
        )
        self.bob = User.objects.create_user(
            email='bob-reminder@example.com',
            password='StrongPass123!',
            nickname='bob_reminder',
            birth_date=date(1998, 2, 2),
            initials='BR',
            is_active=True,
            is_email_verified=True,
        )
        Friendship.objects.create(
            user_low=self.alice if self.alice.id < self.bob.id else self.bob,
            user_high=self.bob if self.alice.id < self.bob.id else self.alice,
        )

    def _create_old_unread_message(self, text: str = 'old unread message') -> DirectMessage:
        conversation = get_or_create_direct_conversation(self.alice, self.bob)
        message = DirectMessage.objects.create(conversation=conversation, sender=self.bob, text=text)
        old_time = timezone.now() - timedelta(hours=1, minutes=5)
        DirectMessage.objects.filter(id=message.id).update(created_at=old_time)
        message.refresh_from_db()
        return message

    @patch('apps.accounts.tasks.send_telegram_message', return_value=True)
    def test_task_creates_single_reminder_and_telegram_message(self, mock_send_telegram):
        message = self._create_old_unread_message()
        self._create_old_unread_message(text='second unread message in same chat')

        first_result = notify_unread_direct_messages_task()
        self.assertEqual(first_result['reminder_notifications_created'], 1)
        self.assertEqual(first_result['telegram_messages_sent'], 1)
        self.assertEqual(mock_send_telegram.call_count, 1)

        reminder = InAppNotification.objects.filter(
            user=self.alice,
            type=InAppNotification.TYPE_SYSTEM,
            payload__kind='chat_unread_hour_alert',
            payload__message_id=message.id,
        ).first()
        self.assertIsNotNone(reminder)

        second_result = notify_unread_direct_messages_task()
        self.assertEqual(second_result['reminder_notifications_created'], 0)
        self.assertEqual(second_result['telegram_messages_sent'], 0)
        self.assertEqual(mock_send_telegram.call_count, 1)
