import logging

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import generics, permissions, response, status, views

logger = logging.getLogger(__name__)
from rest_framework.decorators import api_view, permission_classes
from rest_framework_simplejwt.views import TokenObtainPairView

from .serializers import (
    AllowedInvitersSerializer,
    EmailTokenObtainPairSerializer,
    PasswordChangeSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    ProfileSerializer,
    PublicUserSerializer,
    RegistrationSerializer,
)
from .services import (
    generate_telegram_link_code,
    link_telegram_by_code,
    reset_password_by_token,
    send_password_reset_email,
    set_allowed_inviters,
    verify_email_by_token,
)

User = get_user_model()


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
            except Exception as e:
                logger.exception('Ошибка отправки письма сброса пароля: %s', e)
                return response.Response(
                    {'detail': 'Сервис отправки писем временно недоступен. Попробуйте позже или обратитесь к администратору.'},
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                )
        return response.Response({'detail': 'If email exists, reset link has been sent.'})


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


class PasswordChangeView(views.APIView):
    def post(self, request):
        serializer = PasswordChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = request.user
        if not user.check_password(serializer.validated_data['old_password']):
            return response.Response({'old_password': ['Current password is incorrect.']}, status=status.HTTP_400_BAD_REQUEST)

        try:
            validate_password(serializer.validated_data['new_password'])
        except DjangoValidationError as exc:
            return response.Response({'new_password': exc.messages}, status=status.HTTP_400_BAD_REQUEST)

        user.set_password(serializer.validated_data['new_password'])
        user.save(update_fields=['password'])
        return response.Response({'detail': 'Password changed successfully.'})


class ProfileView(generics.RetrieveUpdateAPIView):
    serializer_class = ProfileSerializer

    def get_object(self):
        return self.request.user


class UserSearchView(generics.ListAPIView):
    serializer_class = PublicUserSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        query = self.request.query_params.get('q', '').strip()
        if not query:
            return User.objects.none()
        return User.objects.filter(nickname__icontains=query, is_active=True).exclude(id=self.request.user.id)[:20]


class AllowedInvitersView(views.APIView):
    def post(self, request):
        serializer = AllowedInvitersSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        set_allowed_inviters(request.user, serializer.validated_data['inviter_ids'])
        return response.Response({'detail': 'Allowed inviters updated.'})


class TelegramLinkCodeView(views.APIView):
    def post(self, request):
        token = generate_telegram_link_code(request.user)
        return response.Response({'code': token.token, 'expires_at': token.expires_at})


class TelegramNotificationsToggleView(views.APIView):
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
        return response.Response({'detail': 'code and chat_id are required.'}, status=status.HTTP_400_BAD_REQUEST)

    success, message, user = link_telegram_by_code(code, int(chat_id), username)
    payload = {'success': success, 'message': message}
    if user:
        payload['user_id'] = user.id
    return response.Response(payload, status=status.HTTP_200_OK if success else status.HTTP_400_BAD_REQUEST)
