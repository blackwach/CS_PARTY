from django.conf import settings
from django.core import validators
from django.db import migrations, models

import apps.rooms.models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='GameRoom',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('code', models.CharField(default=apps.rooms.models.generate_room_code, max_length=8, unique=True)),
                ('title', models.CharField(max_length=120)),
                ('scheduled_for', models.DateTimeField()),
                ('max_players', models.PositiveSmallIntegerField(default=5, validators=[validators.MinValueValidator(1), validators.MaxValueValidator(5)])),
                ('status', models.CharField(choices=[('open', 'Open'), ('ready', 'Ready'), ('started', 'Started'), ('finished', 'Finished'), ('cancelled', 'Cancelled')], default='open', max_length=16)),
                ('reminder_sent', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('host', models.ForeignKey(on_delete=models.deletion.CASCADE, related_name='hosted_rooms', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['scheduled_for', '-created_at'],
            },
        ),
        migrations.CreateModel(
            name='RoomMembership',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('state', models.CharField(choices=[('invited', 'Invited'), ('joined', 'Joined'), ('ready', 'Ready'), ('declined', 'Declined')], default='invited', max_length=16)),
                ('joined_via', models.CharField(choices=[('web', 'Web'), ('telegram', 'Telegram'), ('system', 'System')], default='web', max_length=16)),
                ('ready_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('room', models.ForeignKey(on_delete=models.deletion.CASCADE, related_name='memberships', to='rooms.gameroom')),
                ('user', models.ForeignKey(on_delete=models.deletion.CASCADE, related_name='room_memberships', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['created_at'],
                'unique_together': {('room', 'user')},
            },
        ),
    ]

