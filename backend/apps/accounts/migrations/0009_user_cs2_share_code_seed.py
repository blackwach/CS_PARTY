from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('accounts', '0008_user_encrypt_cs2_match_token'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='cs2_share_code_seed',
            field=models.CharField(blank=True, max_length=64),
        ),
    ]
