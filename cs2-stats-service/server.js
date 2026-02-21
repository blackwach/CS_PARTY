/**
 * CS2 Stats Service — получает статистику через Game Coordinator (node-globaloffensive).
 * Отдаёт HTTP API в формате, ожидаемом бэкендом CS Party: GET /players/:steamId
 *
 * Требования: Steam-аккаунт для входа в GC (см. .env.example).
 * Ограничение: requestPlayersProfile работает для игроков в друзьях у этого аккаунта.
 */

require('dotenv').config();
const express = require('express');
const SteamUser = require('steam-user');
const GlobalOffensive = require('globaloffensive');

const PORT = parseInt(process.env.PORT || '3100', 10);
const STEAM_USER = process.env.STEAM_USERNAME || process.env.STEAM_USER;
const STEAM_PASS = process.env.STEAM_PASSWORD;
const STEAM_2FA = process.env.STEAM_2FA_SECRET; // shared secret для mobile authenticator

// rank_id 0–18 (0 = unranked) → отображаемое имя (Premier / упрощённо)
const RANK_NAMES = {
  0: 'Unranked',
  1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8',
  9: '9', 10: '10', 11: '11', 12: '12', 13: '13', 14: '14', 15: '15',
  16: '16', 17: '17', 18: '18',
};

const app = express();
app.disable('x-powered-by');

let steamClient = null;
let csgo = null;
let gcReady = false;

function getRankName(rankId) {
  if (rankId == null || rankId === undefined) return 'Unranked';
  return RANK_NAMES[rankId] || `Rank ${rankId}`;
}

function ensureSteamId64(steamId) {
  const s = String(steamId).trim();
  if (/^\d{17}$/.test(s)) return s;
  return s;
}

function connectToSteam() {
  return new Promise((resolve, reject) => {
    if (!STEAM_USER || !STEAM_PASS) {
      reject(new Error('STEAM_USERNAME and STEAM_PASSWORD are required in .env'));
      return;
    }

    steamClient = new SteamUser();
    csgo = new GlobalOffensive(steamClient);

    const logOnOptions = { accountName: STEAM_USER, password: STEAM_PASS };
    if (STEAM_2FA) {
      try {
        logOnOptions.twoFactorCode = require('steam-totp').getAuthCode(STEAM_2FA);
      } catch (e) {
        reject(new Error('STEAM_2FA_SECRET invalid or steam-totp not installed'));
        return;
      }
    }
    steamClient.logOn(logOnOptions);

    steamClient.on('loggedOn', () => {
      steamClient.setPersona(SteamUser.EPersonaState.Offline);
      steamClient.gamesPlayed([730]); // CS2 app id
    });

    steamClient.on('error', (err) => {
      if (err.message && err.message.includes('SteamGuard')) {
        reject(new Error('Steam Guard: нужен STEAM_2FA_SECRET (shared secret) в .env для 2FA'));
      } else {
        reject(err);
      }
    });

    csgo.on('connectedToGC', () => {
      gcReady = true;
      console.log('[CS2] Connected to Game Coordinator');
      resolve();
    });

    csgo.on('disconnectedFromGC', (reason) => {
      gcReady = false;
      console.log('[CS2] Disconnected from GC:', reason);
    });

    csgo.on('error', (err) => {
      console.error('[CS2] GC error:', err.message);
    });
  });
}

function fetchPlayerProfile(steamId64) {
  return new Promise((resolve, reject) => {
    if (!gcReady || !csgo.haveGCSession) {
      reject(new Error('Game Coordinator not ready'));
      return;
    }

    const timeout = setTimeout(() => {
      reject(new Error('Timeout waiting for profile'));
    }, 15000);

    csgo.once('playersProfile', (profile) => {
      clearTimeout(timeout);
      resolve(profile);
    });

    try {
      csgo.requestPlayersProfile(steamId64);
    } catch (e) {
      clearTimeout(timeout);
      reject(e);
    }
  });
}

function fetchRecentGames(steamId64) {
  return new Promise((resolve, reject) => {
    if (!gcReady || !csgo.haveGCSession) {
      reject(new Error('Game Coordinator not ready'));
      return;
    }

    const timeout = setTimeout(() => {
      reject(new Error('Timeout waiting for recent games'));
    }, 15000);

    csgo.once('matchList', (matches, data) => {
      clearTimeout(timeout);
      resolve(matches || []);
    });

    try {
      csgo.requestRecentGames(steamId64);
    } catch (e) {
      clearTimeout(timeout);
      reject(e);
    }
  });
}

/**
 * Преобразуем ответ GC в формат, ожидаемый бэкендом CS Party.
 */
function toBackendFormat(profile, recentMatches) {
  const mainRank = profile && (profile.ranking || profile.rankings && profile.rankings[0]);
  const rankId = mainRank && (mainRank.rank_id != null ? mainRank.rank_id : profile.rank_id);
  const wins = mainRank && (mainRank.wins != null ? mainRank.wins : profile.wins) || profile?.wins || 0;

  const matches = (recentMatches || []).map((m, i) => {
    const matchId = m.matchid || m.match_id || m.matchId || `match_${i}_${Date.now()}`;
    let playedAt = m.played_at || m.time || m.timestamp;
    if (playedAt && typeof playedAt === 'number') playedAt = new Date(playedAt * 1000).toISOString();
    if (playedAt && playedAt.toISOString) playedAt = playedAt.toISOString();

    return {
      id: String(matchId),
      played_at: playedAt || null,
      map: m.map_name || m.map || m.map_name || '',
      result: (m.win === true || m.result === 'win') ? 'win' : (m.win === false || m.result === 'lose') ? 'lose' : 'draw',
      kills: parseInt(m.kills || m.kills_count || 0, 10) || 0,
      deaths: parseInt(m.deaths || m.deaths_count || 0, 10) || 0,
      assists: parseInt(m.assists || m.assists_count || 0, 10) || 0,
      rank: getRankName(m.rank_id != null ? m.rank_id : rankId),
    };
  });

  const losses = typeof profile?.losses === 'number' ? profile.losses : 0;
  const totalMatches = matches.length > 0 ? (wins + losses) || matches.length : wins + losses;

  return {
    rank: getRankName(rankId),
    wins,
    losses,
    total_matches: totalMatches || wins + losses,
    matches,
  };
}

app.get('/players/:steamId', async (req, res) => {
  const steamId = ensureSteamId64(req.params.steamId);
  if (!/^\d{17}$/.test(steamId)) {
    return res.status(400).json({ error: 'Invalid Steam ID (expected 17-digit SteamID64)' });
  }

  try {
    const profile = await fetchPlayerProfile(steamId).catch(() => null);
    const recentMatches = await fetchRecentGames(steamId).catch(() => []);

    const payload = toBackendFormat(profile, recentMatches);
    res.json(payload);
  } catch (err) {
    console.error('[CS2] Error for', steamId, err.message);
    const code = err.message && (err.message.includes('Timeout') || err.message.includes('not ready')) ? 503 : 500;
    res.status(code).json({
      error: err.message || 'Failed to fetch stats',
      detail: 'Убедитесь, что игрок в друзьях у Steam-аккаунта сервиса и что GC подключён.',
    });
  }
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    gc: gcReady && csgo && csgo.haveGCSession,
  });
});

async function main() {
  try {
    await connectToSteam();
  } catch (err) {
    console.error('[Steam] Login failed:', err.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`[HTTP] CS2 Stats API listening on http://0.0.0.0:${PORT}`);
    console.log(`[HTTP] Example: GET /players/76561198000000000`);
  });
}

main();
