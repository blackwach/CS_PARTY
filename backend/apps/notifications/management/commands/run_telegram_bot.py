from asgiref.sync import sync_to_async
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from telegram import Update
from telegram.ext import ApplicationBuilder, CommandHandler, ContextTypes

from apps.accounts.services import link_telegram_by_code
from apps.rooms.services import mark_member_ready_by_telegram


async def start_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = (
        'CS Party bot активирован.\n\n'
        '1) Привязка аккаунта: /link CODE\n'
        '2) Подтвердить готовность: /ready ROOMCODE\n'
    )
    await update.message.reply_text(text)


async def link_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text('Использование: /link CODE')
        return

    code = context.args[0].strip().upper()
    success, message, _ = await sync_to_async(link_telegram_by_code)(
        code,
        int(update.effective_chat.id),
        update.effective_user.username or '',
    )
    await update.message.reply_text(message if success else f'Ошибка: {message}')


async def ready_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text('Использование: /ready ROOMCODE')
        return

    room_code = context.args[0].strip().upper()
    success, message = await sync_to_async(mark_member_ready_by_telegram)(
        int(update.effective_chat.id),
        room_code,
    )
    await update.message.reply_text(message if success else f'Ошибка: {message}')


class Command(BaseCommand):
    help = 'Run Telegram bot polling loop for CS Party.'

    def handle(self, *args, **options):
        token = settings.TELEGRAM_BOT_TOKEN
        if not token:
            raise CommandError('TELEGRAM_BOT_TOKEN is empty.')

        app = ApplicationBuilder().token(token).build()
        app.add_handler(CommandHandler('start', start_handler))
        app.add_handler(CommandHandler('link', link_handler))
        app.add_handler(CommandHandler('ready', ready_handler))

        self.stdout.write(self.style.SUCCESS('Telegram bot polling started.'))
        app.run_polling(close_loop=False)
