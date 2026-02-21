from django.shortcuts import render
from django.utils import timezone
from django.views.generic import TemplateView

from apps.accounts.services import verify_email_by_token


class LandingView(TemplateView):
    template_name = 'pages/landing.html'


class VerifyEmailLandingView(TemplateView):
    template_name = 'pages/verify_email_result.html'

    def get(self, request, *args, **kwargs):
        token = kwargs.get('token', '')
        success, message = verify_email_by_token(token)
        context = {
            'success': success,
            'message': message,
            'now': timezone.now(),
        }
        return render(request, self.template_name, context)


class ResetPasswordLandingView(TemplateView):
    template_name = 'pages/reset_password.html'
