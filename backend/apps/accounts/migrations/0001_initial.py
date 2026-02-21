# Generated manually for project bootstrap.

import django.contrib.auth.models
import django.contrib.auth.validators
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models

import apps.accounts.models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ('auth', '0012_alter_user_first_name_max_length'),
    ]

    operations = [
        migrations.CreateModel(
            name='User',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('password', models.CharField(max_length=128, verbose_name='password')),
                ('last_login', models.DateTimeField(blank=True, null=True, verbose_name='last login')),
                ('is_superuser', models.BooleanField(default=False, help_text='Designates that this user has all permissions without explicitly assigning them.', verbose_name='superuser status')),
                ('username', models.CharField(error_messages={'unique': 'A user with that username already exists.'}, help_text='Required. 150 characters or fewer. Letters, digits and @/./+/-/_ only.', max_length=150, unique=True, validators=[django.contrib.auth.validators.UnicodeUsernameValidator()], verbose_name='username')),
                ('first_name', models.CharField(blank=True, max_length=150, verbose_name='first name')),
                ('last_name', models.CharField(blank=True, max_length=150, verbose_name='last name')),
                ('is_staff', models.BooleanField(default=False, help_text='Designates whether the user can log into this admin site.', verbose_name='staff status')),
                ('is_active', models.BooleanField(default=True, help_text='Designates whether this user should be treated as active. Unselect this instead of deleting accounts.', verbose_name='active')),
                ('date_joined', models.DateTimeField(default=django.utils.timezone.now, verbose_name='date joined')),
                ('email', models.EmailField(max_length=254, unique=True)),
                ('nickname', models.CharField(max_length=40, unique=True)),
                ('birth_date', models.DateField()),
                ('initials', models.CharField(max_length=16)),
                ('avatar', models.ImageField(blank=True, null=True, upload_to='avatars/')),
                ('steam_account_id', models.CharField(blank=True, max_length=64)),
                ('is_email_verified', models.BooleanField(default=False)),
                ('telegram_chat_id', models.BigIntegerField(blank=True, null=True, unique=True)),
                ('telegram_username', models.CharField(blank=True, max_length=255)),
                ('telegram_notifications_enabled', models.BooleanField(default=True)),
                ('allowed_inviters', models.ManyToManyField(blank=True, related_name='allowed_targets', symmetrical=False, to='accounts.user')),
                ('groups', models.ManyToManyField(blank=True, help_text='The groups this user belongs to. A user will get all permissions granted to each of their groups.', related_name='user_set', related_query_name='user', to='auth.group', verbose_name='groups')),
                ('user_permissions', models.ManyToManyField(blank=True, help_text='Specific permissions for this user.', related_name='user_set', related_query_name='user', to='auth.permission', verbose_name='user permissions')),
            ],
            options={
                'verbose_name': 'user',
                'verbose_name_plural': 'users',
                'abstract': False,
            },
            managers=[
                ('objects', apps.accounts.models.UserManager()),
            ],
        ),
        migrations.CreateModel(
            name='EmailActionToken',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('action', models.CharField(choices=[('verify_email', 'Verify email'), ('reset_password', 'Reset password'), ('telegram_link', 'Telegram link')], max_length=32)),
                ('token', models.CharField(default=apps.accounts.models.generate_action_token, max_length=128, unique=True)),
                ('payload', models.JSONField(blank=True, default=dict)),
                ('expires_at', models.DateTimeField()),
                ('used_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('user', models.ForeignKey(on_delete=models.deletion.CASCADE, related_name='action_tokens', to='accounts.user')),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='emailactiontoken',
            index=models.Index(fields=['action', 'token'], name='accounts_em_action_22bdd9_idx'),
        ),
        migrations.AddIndex(
            model_name='emailactiontoken',
            index=models.Index(fields=['expires_at'], name='accounts_em_expires_3f83cb_idx'),
        ),
    ]
