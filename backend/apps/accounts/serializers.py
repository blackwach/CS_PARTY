import re
import secrets
import string
from datetime import date

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .services import send_verification_email

User = get_user_model()

# Извлечение Steam ID 64 из ссылки вида https://steamcommunity.com/profiles/76561198012345678
STEAM_PROFILES_RE = re.compile(r'steamcommunity\.com/profiles/(\d{17})', re.IGNORECASE)


def steam_id_from_profile_url(url: str) -> str | None:
    if not url or not url.strip():
        return None
    url = url.strip()
    m = STEAM_PROFILES_RE.search(url)
    return m.group(1) if m else None


def calc_age(born: date) -> int:
    today = timezone.now().date()
    return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


def generate_username(seed: str) -> str:
    safe_seed = ''.join(ch for ch in seed.lower() if ch.isalnum())[:12] or 'player'
    suffix = ''.join(secrets.choice(string.digits) for _ in range(4))
    return f'{safe_seed}_{suffix}'


class EmailTokenObtainPairSerializer(TokenObtainPairSerializer):
    username_field = User.EMAIL_FIELD

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
            raise serializers.ValidationError('Registration is allowed for 18+ players only.')
        return value

    def validate(self, attrs):
        if attrs['password'] != attrs['password_confirm']:
            raise serializers.ValidationError({'password_confirm': 'Passwords do not match.'})
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
        send_verification_email(user)
        return user


class ProfileSerializer(serializers.ModelSerializer):
    steam_profile_url = serializers.URLField(required=False, allow_blank=True, max_length=512)

    class Meta:
        model = User
        fields = (
            'id',
            'email',
            'username',
            'nickname',
            'birth_date',
            'initials',
            'avatar',
            'steam_account_id',
            'steam_profile_url',
            'telegram_chat_id',
            'telegram_username',
            'telegram_notifications_enabled',
            'is_email_verified',
        )
        read_only_fields = ('id', 'email', 'telegram_chat_id', 'telegram_username', 'is_email_verified')

    def validate_steam_profile_url(self, value):
        if not value or not value.strip():
            return ''
        url = value.strip()
        if 'steamcommunity.com/profiles/' in url.lower():
            steam_id = steam_id_from_profile_url(url)
            if not steam_id:
                raise serializers.ValidationError(
                    'Укажите ссылку в формате https://steamcommunity.com/profiles/ВАШ_STEAM_ID (17 цифр).'
                )
        elif 'steamcommunity.com/id/' in url.lower():
            raise serializers.ValidationError(
                'Поддерживается только формат с числовым ID: https://steamcommunity.com/profiles/76561198... '
                'Скопируйте ссылку из профиля Steam (профиль → правый клик → Копировать ссылку на профиль).'
            )
        else:
            raise serializers.ValidationError('Неверная ссылка на профиль Steam.')
        return url

    def update(self, instance, validated_data):
        steam_url = validated_data.get('steam_profile_url')
        if steam_url is not None:
            if not steam_url.strip():
                validated_data['steam_account_id'] = ''
                validated_data['steam_profile_url'] = ''
            else:
                validated_data['steam_account_id'] = steam_id_from_profile_url(steam_url) or instance.steam_account_id
        return super().update(instance, validated_data)


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


class TelegramLinkCodeSerializer(serializers.Serializer):
    code = serializers.CharField(read_only=True)


class AllowedInvitersSerializer(serializers.Serializer):
    inviter_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), allow_empty=True)
