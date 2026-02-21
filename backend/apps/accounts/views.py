import logging

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import generics, permissions, response, status, views
from rest_framework.decorators import api_view, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework_simplejwt.views import TokenObtainPairView

from apps.notifications.models import InAppNotification
from .models import DirectConversation, FriendRequest
from .serializers import (
    AllowedInvitersSerializer,
    ChatMessageCreateSerializer,
    ChatMessageSerializer,
    DeleteAccountConfirmSerializer,
    EmailTokenObtainPairSerializer,
    FriendRequestCreateSerializer,
    FriendRequestSerializer,
    FriendshipSerializer,
    NotificationSerializer,
    PasswordChangeSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    ProfileSerializer,
    PublicProfileSerializer,
    PublicUserSerializer,
    RegistrationSerializer,
)
from .services import (
    accept_friend_request,
    are_friends,
    decline_friend_request,
    delete_account_by_token,
    generate_telegram_link_code,
    get_or_create_direct_conversation,
    get_user_friendships,
    link_telegram_by_code,
    mark_direct_messages_as_read,
    reset_password_by_token,
    send_account_deletion_email,
    send_direct_message,
    send_friend_request,
    send_password_reset_email,
    set_allowed_inviters,
    verify_email_by_token,
)

logger = logging.getLogger(__name__)
User = get_user_model()


def _friendship_status(current_user: User, target_user: User) -> str:
    if current_user.id == target_user.id:
        return 'self'
    if are_friends(current_user, target_user):
        return 'friends'

    outgoing = FriendRequest.objects.filter(
        sender=current_user,
        receiver=target_user,
        status=FriendRequest.STATUS_PENDING,
    ).exists()
    if outgoing:
        return 'outgoing'

    incoming = FriendRequest.objects.filter(
        sender=target_user,
        receiver=current_user,
        status=FriendRequest.STATUS_PENDING,
    ).exists()
    if incoming:
        return 'incoming'
    return 'none'


class RegisterView(generics.CreateAPIView):
    serializer_class = RegistrationSerializer
    permission_classes = [permissions.AllowAny]


class LoginView(TokenObtainPairView):
    serializer_class = EmailTokenObtainPairSerializer
    permission_classes = [permissions.AllowAny]


class VerifyEmailAPIView(views.APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        token = request.query_params.get('token', '')
        success, message = verify_email_by_token(token)
        code = status.HTTP_200_OK if success else status.HTTP_400_BAD_REQUEST
        return response.Response({'success': success, 'message': message}, status=code)


class PasswordResetRequestView(views.APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = User.objects.filter(email__iexact=serializer.validated_data['email']).first()
        if user:
            try:
                send_password_reset_email(user)
            except Exception as exc:
                logger.exception('Failed to send password reset email: %s', exc)
                return response.Response(
                    {'detail': 'Почтовый сервис временно недоступен. Попробуйте позже.'},
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                )
        return response.Response({'detail': 'Если email существует, ссылка для сброса отправлена.'})


class PasswordResetConfirmView(views.APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            validate_password(serializer.validated_data['new_password'])
        except DjangoValidationError as exc:
            return response.Response({'new_password': exc.messages}, status=status.HTTP_400_BAD_REQUEST)

        success, message = reset_password_by_token(
            serializer.validated_data['token'],
            serializer.validated_data['new_password'],
        )
        code = status.HTTP_200_OK if success else status.HTTP_400_BAD_REQUEST
        return response.Response({'success': success, 'message': message}, status=code)


class DeleteAccountRequestView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        try:
            send_account_deletion_email(request.user)
        except Exception as exc:
            logger.exception('Failed to send account deletion email: %s', exc)
            return response.Response(
                {'detail': 'Почтовый сервис временно недоступен. Попробуйте позже.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        return response.Response({'detail': 'Ссылка подтверждения отправлена на вашу почту.'})


class DeleteAccountConfirmView(views.APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = DeleteAccountConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        success, message = delete_account_by_token(serializer.validated_data['token'])
        code = status.HTTP_200_OK if success else status.HTTP_400_BAD_REQUEST
        return response.Response({'success': success, 'message': message}, status=code)


class PasswordChangeView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = PasswordChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = request.user
        if not user.check_password(serializer.validated_data['old_password']):
            return response.Response({'old_password': ['Текущий пароль указан неверно.']}, status=status.HTTP_400_BAD_REQUEST)

        try:
            validate_password(serializer.validated_data['new_password'])
        except DjangoValidationError as exc:
            return response.Response({'new_password': exc.messages}, status=status.HTTP_400_BAD_REQUEST)

        user.set_password(serializer.validated_data['new_password'])
        user.save(update_fields=['password'])
        return response.Response({'detail': 'Пароль успешно изменен.'})


class ProfileView(generics.RetrieveUpdateAPIView):
    serializer_class = ProfileSerializer
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_object(self):
        return self.request.user


class PublicProfileView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, user_id: int):
        target = User.objects.filter(id=user_id, is_active=True).first()
        if not target:
            return response.Response({'detail': 'Пользователь не найден.'}, status=status.HTTP_404_NOT_FOUND)

        is_self = request.user.id == target.id
        data = ProfileSerializer(target).data if is_self else PublicProfileSerializer(target).data
        data['is_self'] = is_self
        data['friendship_status'] = _friendship_status(request.user, target)
        data['can_chat'] = data['friendship_status'] in {'friends', 'self'}
        return response.Response(data)


class UserSearchView(generics.ListAPIView):
    serializer_class = PublicUserSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        query = self.request.query_params.get('q', '').strip()
        if not query:
            return User.objects.none()
        return User.objects.filter(nickname__icontains=query, is_active=True).exclude(id=self.request.user.id)[:20]


class FriendRequestCreateView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = FriendRequestCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target = User.objects.filter(id=serializer.validated_data['user_id'], is_active=True).first()
        if not target:
            return response.Response({'detail': 'Пользователь не найден.'}, status=status.HTTP_404_NOT_FOUND)
        friend_request = send_friend_request(request.user, target)
        return response.Response(FriendRequestSerializer(friend_request).data, status=status.HTTP_201_CREATED)


class FriendRequestsIncomingView(generics.ListAPIView):
    serializer_class = FriendRequestSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return FriendRequest.objects.filter(
            receiver=self.request.user,
            status=FriendRequest.STATUS_PENDING,
        ).select_related('sender', 'receiver')


class FriendRequestAcceptView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, request_id: int):
        friend_request = FriendRequest.objects.filter(id=request_id).select_related('sender', 'receiver').first()
        if not friend_request:
            return response.Response({'detail': 'Заявка в друзья не найдена.'}, status=status.HTTP_404_NOT_FOUND)
        friend_request = accept_friend_request(friend_request, request.user)
        return response.Response(FriendRequestSerializer(friend_request).data)


class FriendRequestDeclineView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, request_id: int):
        friend_request = FriendRequest.objects.filter(id=request_id).select_related('sender', 'receiver').first()
        if not friend_request:
            return response.Response({'detail': 'Заявка в друзья не найдена.'}, status=status.HTTP_404_NOT_FOUND)
        friend_request = decline_friend_request(friend_request, request.user)
        return response.Response(FriendRequestSerializer(friend_request).data)


class FriendsListView(generics.ListAPIView):
    serializer_class = FriendshipSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return get_user_friendships(self.request.user)


class NotificationsListView(generics.ListAPIView):
    serializer_class = NotificationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return InAppNotification.objects.filter(user=self.request.user).select_related('actor')[:100]


class NotificationMarkReadView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, notification_id: int):
        notification = InAppNotification.objects.filter(id=notification_id, user=request.user).first()
        if not notification:
            return response.Response({'detail': 'Уведомление не найдено.'}, status=status.HTTP_404_NOT_FOUND)
        notification.mark_read()
        return response.Response(NotificationSerializer(notification).data)


class NotificationMarkAllReadView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        notifications = InAppNotification.objects.filter(user=request.user, is_read=False)
        for item in notifications:
            item.mark_read()
        return response.Response({'detail': 'Уведомления отмечены как прочитанные.'})


class ChatDialogsView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        dialogs = []
        for friendship in get_user_friendships(request.user):
            peer = friendship.user_high if friendship.user_low_id == request.user.id else friendship.user_low
            conversation = get_or_create_direct_conversation(request.user, peer)
            last_message = conversation.messages.order_by('-created_at').select_related('sender').first()
            unread_count = conversation.messages.filter(sender_id=peer.id, read_at__isnull=True).count()
            dialogs.append(
                {
                    'friend': PublicUserSerializer(peer).data,
                    'conversation_id': conversation.id,
                    'unread_count': unread_count,
                    'last_message': ChatMessageSerializer(last_message).data if last_message else None,
                }
            )
        return response.Response(dialogs)


class ChatMessagesView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, user_id: int):
        peer = User.objects.filter(id=user_id, is_active=True).first()
        if not peer:
            return response.Response({'detail': 'Пользователь не найден.'}, status=status.HTTP_404_NOT_FOUND)
        if not are_friends(request.user, peer):
            return response.Response({'detail': 'Чат доступен только между друзьями.'}, status=status.HTTP_403_FORBIDDEN)
        conversation = get_or_create_direct_conversation(request.user, peer)
        mark_direct_messages_as_read(request.user, peer)
        messages = conversation.messages.select_related('sender').all()[:200]
        return response.Response(ChatMessageSerializer(messages, many=True).data)

    def post(self, request, user_id: int):
        peer = User.objects.filter(id=user_id, is_active=True).first()
        if not peer:
            return response.Response({'detail': 'Пользователь не найден.'}, status=status.HTTP_404_NOT_FOUND)
        serializer = ChatMessageCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        message = send_direct_message(request.user, peer, serializer.validated_data['text'])
        return response.Response(ChatMessageSerializer(message).data, status=status.HTTP_201_CREATED)


class AllowedInvitersView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = AllowedInvitersSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        set_allowed_inviters(request.user, serializer.validated_data['inviter_ids'])
        return response.Response({'detail': 'Список разрешенных приглашающих обновлен.'})


class TelegramLinkCodeView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        token = generate_telegram_link_code(request.user)
        return response.Response({'code': token.token, 'expires_at': token.expires_at})


class TelegramNotificationsToggleView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        enabled = bool(request.data.get('enabled', True))
        request.user.telegram_notifications_enabled = enabled
        request.user.save(update_fields=['telegram_notifications_enabled'])
        return response.Response({'telegram_notifications_enabled': enabled})


@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def telegram_link_callback(request):
    code = request.data.get('code', '').strip().upper()
    chat_id = request.data.get('chat_id')
    username = request.data.get('username', '')
    if not code or not chat_id:
        return response.Response({'detail': 'Поля code и chat_id обязательны.'}, status=status.HTTP_400_BAD_REQUEST)

    success, message, user = link_telegram_by_code(code, int(chat_id), username)
    payload = {'success': success, 'message': message}
    if user:
        payload['user_id'] = user.id
    return response.Response(payload, status=status.HTTP_200_OK if success else status.HTTP_400_BAD_REQUEST)
