from django.contrib import admin

from .models import GameRoom, RoomMembership


class RoomMembershipInline(admin.TabularInline):
    model = RoomMembership
    extra = 0


@admin.register(GameRoom)
class GameRoomAdmin(admin.ModelAdmin):
    list_display = ('id', 'code', 'title', 'host', 'scheduled_for', 'status', 'server_host', 'server_port', 'max_players')
    search_fields = ('code', 'title', 'host__email', 'host__nickname')
    list_filter = ('status',)
    inlines = [RoomMembershipInline]


@admin.register(RoomMembership)
class RoomMembershipAdmin(admin.ModelAdmin):
    list_display = ('id', 'room', 'user', 'state', 'joined_via', 'ready_at')
    search_fields = ('room__code', 'user__nickname', 'user__email')
    list_filter = ('state', 'joined_via')
