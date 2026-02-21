from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='PlayerStats',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('rank', models.CharField(blank=True, max_length=128)),
                ('wins', models.PositiveIntegerField(default=0)),
                ('losses', models.PositiveIntegerField(default=0)),
                ('total_matches', models.PositiveIntegerField(default=0)),
                ('last_synced_at', models.DateTimeField(blank=True, null=True)),
                ('raw_data', models.JSONField(blank=True, default=dict)),
                ('user', models.OneToOneField(on_delete=models.deletion.CASCADE, related_name='cs2_stats', to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.CreateModel(
            name='MatchHistory',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('external_match_id', models.CharField(max_length=64)),
                ('played_at', models.DateTimeField(blank=True, null=True)),
                ('map_name', models.CharField(blank=True, max_length=128)),
                ('result', models.CharField(choices=[('win', 'Win'), ('lose', 'Lose'), ('draw', 'Draw')], default='draw', max_length=16)),
                ('kills', models.IntegerField(default=0)),
                ('deaths', models.IntegerField(default=0)),
                ('assists', models.IntegerField(default=0)),
                ('rank_at_match', models.CharField(blank=True, max_length=128)),
                ('raw_data', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('user', models.ForeignKey(on_delete=models.deletion.CASCADE, related_name='cs2_matches', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-played_at', '-created_at'],
                'unique_together': {('user', 'external_match_id')},
            },
        ),
    ]
