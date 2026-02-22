from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('accounts', '0006_user_last_seen_at_user_ws_connection_count'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='cs2_match_token',
            field=models.CharField(blank=True, max_length=128),
        ),
    ]

