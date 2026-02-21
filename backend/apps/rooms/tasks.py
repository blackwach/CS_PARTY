from celery import shared_task

from .services import send_five_minute_reminders


@shared_task
def send_room_reminders_task() -> int:
    return send_five_minute_reminders()
