from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import DirectConversation, DirectMessage, EmailActionToken, FriendRequest, Friendship, User


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
                    'about',
                    'avatar',
                    'steam_account_id',
                    'steam_profile_url',
                    'cs2_share_code_seed',
                    'is_email_verified',
                    'pending_email',
                    'pending_email_previous',
                    'pending_email_expires_at',
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


@admin.register(FriendRequest)
class FriendRequestAdmin(admin.ModelAdmin):
    list_display = ('id', 'sender', 'receiver', 'status', 'created_at', 'responded_at')
    list_filter = ('status',)
    search_fields = ('sender__email', 'sender__nickname', 'receiver__email', 'receiver__nickname')


@admin.register(Friendship)
class FriendshipAdmin(admin.ModelAdmin):
    list_display = ('id', 'user_low', 'user_high', 'created_at')
    search_fields = ('user_low__email', 'user_low__nickname', 'user_high__email', 'user_high__nickname')


@admin.register(DirectConversation)
class DirectConversationAdmin(admin.ModelAdmin):
    list_display = ('id', 'user_low', 'user_high', 'updated_at', 'created_at')
    search_fields = ('user_low__email', 'user_low__nickname', 'user_high__email', 'user_high__nickname')


@admin.register(DirectMessage)
class DirectMessageAdmin(admin.ModelAdmin):
    list_display = ('id', 'conversation', 'sender', 'created_at', 'read_at')
    search_fields = ('sender__email', 'sender__nickname', 'text')
