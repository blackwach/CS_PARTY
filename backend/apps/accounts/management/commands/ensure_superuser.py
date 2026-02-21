import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Create superuser from env vars if it does not exist.'

    def handle(self, *args, **options):
        email = (os.getenv('DJANGO_SUPERUSER_EMAIL') or '').strip().lower()
        password = os.getenv('DJANGO_SUPERUSER_PASSWORD') or ''

        if not email or not password:
            self.stdout.write('Skipped ensure_superuser: DJANGO_SUPERUSER_EMAIL or DJANGO_SUPERUSER_PASSWORD is empty.')
            return

        user_model = get_user_model()
        if user_model.objects.filter(email__iexact=email).exists():
            self.stdout.write(f'Superuser already exists: {email}')
            return

        user_model.objects.create_superuser(email=email, password=password)
        self.stdout.write(f'Superuser created: {email}')
