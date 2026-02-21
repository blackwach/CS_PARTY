from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import EmailActionToken, User


@admin.register(User)
class CustomUserAdmin(UserAdmin):
    fieldsets = UserAdmin.fieldsets + (
        (
            'CS Party',
            {
                'fields': (
                    'nickname',
                    'birth_date',
                    'initials',
                    'avatar',
                    'steam_account_id',
                    'steam_profile_url',
                    'is_email_verified',
                    'telegram_chat_id',
                    'telegram_username',
                    'telegram_notifications_enabled',
                    'allowed_inviters',
                )
            },
        ),
    )
    list_display = ('id', 'email', 'nickname', 'is_active', 'is_email_verified', 'is_staff')
    search_fields = ('email', 'nickname', 'username')


@admin.register(EmailActionToken)
class EmailActionTokenAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'action', 'expires_at', 'used_at', 'created_at')
    list_filter = ('action',)
    search_fields = ('token', 'user__email', 'user__nickname')
