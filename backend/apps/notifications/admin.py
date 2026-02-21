from django.contrib import admin

from .models import InAppNotification


@admin.register(InAppNotification)
class InAppNotificationAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'type', 'title', 'is_read', 'created_at', 'read_at')
    list_filter = ('type', 'is_read')
    search_fields = ('title', 'message', 'user__email', 'user__nickname', 'actor__email', 'actor__nickname')
