import re
import secrets
import string
from datetime import date

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from apps.notifications.models import InAppNotification
from .models import DirectMessage, FriendRequest, Friendship
from .services import send_email_change_verification_email, send_verification_email

User = get_user_model()

STEAM_PROFILES_RE = re.compile(r'steamcommunity\.com/profiles/(\d{17})(?:[/?#]|$)', re.IGNORECASE)
STEAM_ID_RE = re.compile(r'steamcommunity\.com/id/([^/?#]+)(?:[/?#]|$)', re.IGNORECASE)


def steam_id_from_profile_url(url: str) -> str | None:
    if not url or not url.strip():
        return None
    url = url.strip()
    if re.fullmatch(r'\d{17}', url):
        return url
    match = STEAM_PROFILES_RE.search(url)
    return match.group(1) if match else None


def calc_age(born: date) -> int:
    today = timezone.now().date()
    return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


def generate_username(seed: str) -> str:
    safe_seed = ''.join(ch for ch in seed.lower() if ch.isalnum())[:12] or 'player'
    suffix = ''.join(secrets.choice(string.digits) for _ in range(4))
    return f'{safe_seed}_{suffix}'


class BasicUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ('id', 'nickname', 'avatar')


class EmailTokenObtainPairSerializer(TokenObtainPairSerializer):
    username_field = User.EMAIL_FIELD

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields[self.username_field] = serializers.CharField(write_only=True)
        if 'username' in self.fields:
            del self.fields['username']

    def validate(self, attrs):
        email = (attrs.get(self.username_field) or attrs.get('email') or '').strip()
        password = attrs.get('password')
        if email and password:
            user = User.objects.filter(email__iexact=email).first()
            if user and not user.is_active:
                raise serializers.ValidationError(
                    'Аккаунт не активирован. Подтвердите email по ссылке из письма.'
                )
        return super().validate(attrs)

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token['nickname'] = user.nickname
        token['email'] = user.email
        return token


class RegistrationSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)
    password_confirm = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = ('email', 'username', 'nickname', 'birth_date', 'initials', 'password', 'password_confirm')
        extra_kwargs = {
            'username': {'required': False, 'allow_blank': True},
        }

    def validate_birth_date(self, value):
        if calc_age(value) < 18:
            raise serializers.ValidationError('Регистрация доступна только для игроков 18+.')
        return value

    def validate(self, attrs):
        if attrs['password'] != attrs['password_confirm']:
            raise serializers.ValidationError({'password_confirm': 'Пароли не совпадают.'})
        return attrs

    def create(self, validated_data):
        validated_data.pop('password_confirm')
        password = validated_data.pop('password')

        username = validated_data.get('username', '').strip()
        if not username:
            username = generate_username(validated_data.get('nickname', 'player'))
            while User.objects.filter(username=username).exists():
                username = generate_username(validated_data.get('nickname', 'player'))
        validated_data['username'] = username

        user = User.objects.create_user(password=password, is_active=False, **validated_data)
        try:
            send_verification_email(user)
        except Exception:
            pass
        return user


class ProfileSerializer(serializers.ModelSerializer):
    steam_profile_url = serializers.URLField(required=False, allow_blank=True, max_length=512)
    avatar = serializers.ImageField(required=False, allow_null=True)
    pending_email = serializers.EmailField(read_only=True)
    pending_email_expires_at = serializers.DateTimeField(read_only=True)

    class Meta:
        model = User
        fields = (
            'id',
            'email',
            'pending_email',
            'pending_email_expires_at',
            'username',
            'nickname',
            'birth_date',
            'initials',
            'about',
            'avatar',
            'steam_account_id',
            'steam_profile_url',
            'telegram_chat_id',
            'telegram_username',
            'telegram_notifications_enabled',
            'is_email_verified',
        )
        read_only_fields = (
            'id',
            'steam_account_id',
            'telegram_chat_id',
            'telegram_username',
            'is_email_verified',
            'pending_email',
            'pending_email_expires_at',
        )

    def validate_email(self, value: str):
        email = User.objects.normalize_email(value).strip()
        instance = self.instance
        instance_id = instance.id if instance else None
        if instance and email.lower() == instance.email.lower():
            return email
        if User.objects.filter(email__iexact=email).exclude(id=instance_id).exists():
            raise serializers.ValidationError('Этот email уже используется.')
        if User.objects.filter(pending_email__iexact=email).exclude(id=instance_id).exists():
            raise serializers.ValidationError('Этот email уже ожидает подтверждения в другом аккаунте.')
        return email

    def validate_steam_profile_url(self, value):
        if not value or not value.strip():
            return ''
        url = value.strip()
        if 'steamcommunity.com/profiles/' in url.lower():
            steam_id = steam_id_from_profile_url(url)
            if not steam_id:
                raise serializers.ValidationError('Use URL in format https://steamcommunity.com/profiles/STEAM_ID64.')
        elif STEAM_ID_RE.search(url):
            # Vanity URL is allowed. SteamID64 will be resolved during CS2 sync.
            pass
        else:
            raise serializers.ValidationError('Invalid Steam profile URL.')
        return url

    def update(self, instance, validated_data):
        requested_email = validated_data.pop('email', None)
        if requested_email and requested_email.lower() != instance.email.lower():
            send_email_change_verification_email(instance, requested_email)

        steam_url = validated_data.get('steam_profile_url')
        if steam_url is not None:
            if not steam_url.strip():
                validated_data['steam_account_id'] = ''
                validated_data['steam_profile_url'] = ''
            else:
                validated_data['steam_account_id'] = steam_id_from_profile_url(steam_url) or ''

        updated = super().update(instance, validated_data)
        if requested_email and requested_email.lower() != instance.email.lower():
            updated.refresh_from_db(fields=['email', 'pending_email', 'pending_email_expires_at'])
        return updated


class PublicProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = (
            'id',
            'nickname',
            'avatar',
            'steam_profile_url',
        )


class PublicUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ('id', 'nickname', 'avatar')


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=128)
    new_password = serializers.CharField(min_length=8)


class PasswordChangeSerializer(serializers.Serializer):
    old_password = serializers.CharField(min_length=8)
    new_password = serializers.CharField(min_length=8)


class DeleteAccountConfirmSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=128)


class TelegramLinkCodeSerializer(serializers.Serializer):
    code = serializers.CharField(read_only=True)


class AllowedInvitersSerializer(serializers.Serializer):
    inviter_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), allow_empty=True)


class FriendRequestCreateSerializer(serializers.Serializer):
    user_id = serializers.IntegerField(min_value=1)


class FriendRequestSerializer(serializers.ModelSerializer):
    sender = BasicUserSerializer(read_only=True)
    receiver = BasicUserSerializer(read_only=True)

    class Meta:
        model = FriendRequest
        fields = ('id', 'sender', 'receiver', 'status', 'created_at', 'responded_at')


class FriendshipSerializer(serializers.ModelSerializer):
    friend = serializers.SerializerMethodField()

    class Meta:
        model = Friendship
        fields = ('id', 'friend', 'created_at')

    def get_friend(self, obj):
        request = self.context['request']
        current_user_id = request.user.id
        friend = obj.user_high if obj.user_low_id == current_user_id else obj.user_low
        return BasicUserSerializer(friend).data


class NotificationSerializer(serializers.ModelSerializer):
    actor = BasicUserSerializer(read_only=True)

    class Meta:
        model = InAppNotification
        fields = (
            'id',
            'type',
            'title',
            'message',
            'payload',
            'is_read',
            'created_at',
            'read_at',
            'actor',
        )


class ChatMessageCreateSerializer(serializers.Serializer):
    text = serializers.CharField(min_length=1, max_length=4000, trim_whitespace=True)


class ChatMessageSerializer(serializers.ModelSerializer):
    sender = BasicUserSerializer(read_only=True)

    class Meta:
        model = DirectMessage
        fields = ('id', 'sender', 'text', 'created_at', 'read_at')
