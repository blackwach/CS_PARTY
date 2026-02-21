'use strict';

/**
 * CS2 stats bot service.
 * - logs into Steam
 * - keeps Game Coordinator (GC) session alive
 * - serves GET /players/:steamId in backend format
 * - exposes bot status and manual reconnect endpoints
 */

require('dotenv').config();
const express = require('express');
const SteamUser = require('steam-user');
const GlobalOffensive = require('globaloffensive');
const SteamTotp = require('steam-totp');

const PORT = parseInt(process.env.PORT || '3100', 10);
const API_TOKEN = (process.env.CS2_STATS_API_TOKEN || '').trim();
const CACHE_TTL_MS = parseInt(process.env.CS2_STATS_CACHE_TTL_MS || '60000', 10);
const REQUEST_TIMEOUT_MS = parseInt(process.env.CS2_STATS_REQUEST_TIMEOUT_MS || '15000', 10);
const RECONNECT_DELAY_MS = parseInt(process.env.CS2_STATS_RECONNECT_DELAY_MS || '15000', 10);

const STEAM_USERNAME =
  process.env.CS2_STATS_STEAM_USERNAME ||
  process.env.STEAM_USERNAME ||
  process.env.STEAM_USER ||
  '';
const STEAM_PASSWORD =
  process.env.CS2_STATS_STEAM_PASSWORD ||
  process.env.STEAM_PASSWORD ||
  '';
const STEAM_2FA_SECRET =
  process.env.CS2_STATS_STEAM_2FA_SECRET ||
  process.env.STEAM_2FA_SECRET ||
  process.env.STEAM_SHARED_SECRET ||
  '';

const RANK_NAMES = {
  0: 'Без ранга',
  1: '1',
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: '11',
  12: '12',
  13: '13',
  14: '14',
  15: '15',
  16: '16',
  17: '17',
  18: '18',
};

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '128kb' }));

let steamClient = null;
let csgo = null;
let gcReady = false;
let reconnectTimer = null;
let reconnectInProgress = false;

const botState = {
  logged_on: false,
  gc_ready: false,
  last_connected_at: null,
  last_error: null,
  reconnect_attempts: 0,
};

const playerCache = new Map();

function nowIso() {
  return new Date().toISOString();
}

function sanitizeSteamId(steamId) {
  return String(steamId || '').trim();
}

function rankName(rankId) {
  if (rankId === undefined || rankId === null) return RANK_NAMES[0];
  return RANK_NAMES[rankId] || String(rankId);
}

function getBotStatus() {
  return {
    logged_on: botState.logged_on,
    gc_ready: botState.gc_ready,
    have_gc_session: Boolean(csgo && csgo.haveGCSession),
    last_connected_at: botState.last_connected_at,
    last_error: botState.last_error,
    reconnect_attempts: botState.reconnect_attempts,
    reconnect_scheduled: Boolean(reconnectTimer),
    reconnect_in_progress: reconnectInProgress,
  };
}

function requireToken(req, res, next) {
  if (!API_TOKEN) {
    next();
    return;
  }
  const bearer = String(req.headers.authorization || '');
  const fromHeader = String(req.headers['x-api-token'] || '');
  const token = bearer.startsWith('Bearer ') ? bearer.slice(7).trim() : fromHeader.trim();
  if (token !== API_TOKEN) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

function resetClient() {
  try {
    if (steamClient) {
      steamClient.removeAllListeners();
      steamClient.logOff();
    }
  } catch (_) {
    // ignore cleanup errors
  }
  steamClient = null;
  csgo = null;
  gcReady = false;
  botState.logged_on = false;
  botState.gc_ready = false;
}

function scheduleReconnect(reason) {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    await connectBot(`reconnect: ${reason || 'unknown'}`);
  }, RECONNECT_DELAY_MS);
}

function setLastError(message) {
  botState.last_error = `[${nowIso()}] ${message}`;
}

function setupSteamHandlers() {
  steamClient.on('loggedOn', () => {
    botState.logged_on = true;
    botState.last_error = null;
    steamClient.setPersona(SteamUser.EPersonaState.Offline);
    steamClient.gamesPlayed([730]);
    console.log('[steam] logged on');
  });

  steamClient.on('error', (err) => {
    botState.logged_on = false;
    gcReady = false;
    botState.gc_ready = false;
    const message = err?.message || 'Steam error';
    setLastError(message);
    console.error('[steam] error:', message);
    scheduleReconnect('steam-error');
  });

  steamClient.on('disconnected', (eresult, msg) => {
    botState.logged_on = false;
    gcReady = false;
    botState.gc_ready = false;
    const reason = msg || `eresult=${eresult}`;
    setLastError(`Steam disconnected: ${reason}`);
    console.warn('[steam] disconnected:', reason);
    scheduleReconnect('steam-disconnected');
  });

  csgo.on('connectedToGC', () => {
    gcReady = true;
    botState.gc_ready = true;
    botState.last_connected_at = nowIso();
    botState.last_error = null;
    console.log('[cs2] connected to GC');
  });

  csgo.on('disconnectedFromGC', (reason) => {
    gcReady = false;
    botState.gc_ready = false;
    setLastError(`GC disconnected: ${reason || 'unknown'}`);
    console.warn('[cs2] disconnected from GC:', reason || 'unknown');
    scheduleReconnect('gc-disconnected');
  });

  csgo.on('error', (err) => {
    const message = err?.message || 'GC error';
    setLastError(message);
    console.error('[cs2] GC error:', message);
  });
}

async function connectBot(source = 'startup') {
  if (reconnectInProgress) return;
  reconnectInProgress = true;

  try {
    if (!STEAM_USERNAME || !STEAM_PASSWORD) {
      throw new Error('STEAM_USERNAME/STEAM_PASSWORD are not set');
    }

    botState.reconnect_attempts += 1;
    resetClient();

    steamClient = new SteamUser();
    csgo = new GlobalOffensive(steamClient);
    setupSteamHandlers();

    const logOnOptions = {
      accountName: STEAM_USERNAME,
      password: STEAM_PASSWORD,
    };

    if (STEAM_2FA_SECRET) {
      try {
        logOnOptions.twoFactorCode = SteamTotp.getAuthCode(STEAM_2FA_SECRET);
      } catch (err) {
        throw new Error(`Invalid STEAM_2FA_SECRET: ${err.message}`);
      }
    }

    steamClient.logOn(logOnOptions);
    console.log(`[bot] connect initiated (${source})`);
  } catch (err) {
    const message = err?.message || 'Unknown connect error';
    setLastError(message);
    console.error('[bot] connect failed:', message);
    scheduleReconnect('connect-failed');
  } finally {
    reconnectInProgress = false;
  }
}

function withTimeout(promiseFactory, timeoutMs, timeoutMessage) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    promiseFactory()
      .then((data) => {
        clearTimeout(timeout);
        resolve(data);
      })
      .catch((err) => {
        clearTimeout(timeout);
        reject(err);
      });
  });
}

function fetchPlayerProfile(steamId64) {
  if (!gcReady || !csgo || !csgo.haveGCSession) {
    return Promise.reject(new Error('Game Coordinator is not ready'));
  }

  return withTimeout(
    () =>
      new Promise((resolve, reject) => {
        csgo.once('playersProfile', (profile) => resolve(profile));
        try {
          csgo.requestPlayersProfile(steamId64);
        } catch (err) {
          reject(err);
        }
      }),
    REQUEST_TIMEOUT_MS,
    'Timeout while waiting playersProfile'
  );
}

function fetchRecentGames(steamId64) {
  if (!gcReady || !csgo || !csgo.haveGCSession) {
    return Promise.reject(new Error('Game Coordinator is not ready'));
  }

  return withTimeout(
    () =>
      new Promise((resolve, reject) => {
        csgo.once('matchList', (matches) => resolve(matches || []));
        try {
          csgo.requestRecentGames(steamId64);
        } catch (err) {
          reject(err);
        }
      }),
    REQUEST_TIMEOUT_MS,
    'Timeout while waiting matchList'
  );
}

function toBackendFormat(profile, recentMatches) {
  const mainRank = profile && (profile.ranking || (profile.rankings && profile.rankings[0]));
  const rankId = mainRank && (mainRank.rank_id != null ? mainRank.rank_id : profile.rank_id);
  const wins =
    ((mainRank && (mainRank.wins != null ? mainRank.wins : profile.wins)) || profile?.wins || 0);

  const matches = (recentMatches || []).map((item, index) => {
    const matchId = item.matchid || item.match_id || item.matchId || `match_${index}_${Date.now()}`;
    let playedAt = item.played_at || item.time || item.timestamp || null;
    if (typeof playedAt === 'number') playedAt = new Date(playedAt * 1000).toISOString();
    if (playedAt && typeof playedAt.toISOString === 'function') playedAt = playedAt.toISOString();

    return {
      id: String(matchId),
      played_at: playedAt || null,
      map: item.map_name || item.map || '',
      result:
        item.win === true || item.result === 'win'
          ? 'win'
          : item.win === false || item.result === 'lose'
            ? 'lose'
            : 'draw',
      kills: parseInt(item.kills || item.kills_count || 0, 10) || 0,
      deaths: parseInt(item.deaths || item.deaths_count || 0, 10) || 0,
      assists: parseInt(item.assists || item.assists_count || 0, 10) || 0,
      rank: rankName(item.rank_id != null ? item.rank_id : rankId),
    };
  });

  const losses = typeof profile?.losses === 'number' ? profile.losses : 0;
  const totalMatches = matches.length > 0 ? (wins + losses) || matches.length : wins + losses;

  return {
    rank: rankName(rankId),
    wins,
    losses,
    total_matches: totalMatches || wins + losses,
    matches,
  };
}

function getCached(steamId) {
  const cached = playerCache.get(steamId);
  if (!cached) return null;
  if (Date.now() > cached.expires_at) {
    playerCache.delete(steamId);
    return null;
  }
  return cached.payload;
}

function setCached(steamId, payload) {
  playerCache.set(steamId, {
    payload,
    expires_at: Date.now() + CACHE_TTL_MS,
  });
}

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    bot: getBotStatus(),
    cache_size: playerCache.size,
  });
});

app.get('/bot/status', (req, res) => {
  res.json({ ok: true, bot: getBotStatus() });
});

app.post('/bot/reconnect', requireToken, async (req, res) => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  await connectBot('manual-reconnect');
  res.status(202).json({ ok: true, bot: getBotStatus() });
});

app.get('/players/:steamId', requireToken, async (req, res) => {
  const steamId = sanitizeSteamId(req.params.steamId);
  if (!/^\d{17}$/.test(steamId)) {
    return res.status(400).json({ error: 'Некорректный SteamID64 (ожидаются 17 цифр)' });
  }

  const cached = getCached(steamId);
  if (cached) {
    return res.json({ ...cached, source: 'gc_cache' });
  }

  if (!gcReady || !csgo || !csgo.haveGCSession) {
    return res.status(503).json({
      error: 'GC недоступен',
      detail: 'Steam-бот еще не подключен к Game Coordinator.',
      bot: getBotStatus(),
    });
  }

  try {
    const profile = await fetchPlayerProfile(steamId);
    const recentMatches = await fetchRecentGames(steamId).catch(() => []);
    const payload = toBackendFormat(profile, recentMatches);
    setCached(steamId, payload);
    return res.json({ ...payload, source: 'gc_live' });
  } catch (err) {
    const message = err?.message || 'Failed to fetch stats';
    setLastError(message);
    const statusCode = message.includes('Timeout') || message.includes('not ready') ? 503 : 500;
    return res.status(statusCode).json({
      error: message,
      detail: 'Проверьте статус бота через /bot/status и дружбу в Steam с сервисным аккаунтом.',
      bot: getBotStatus(),
    });
  }
});

async function main() {
  app.listen(PORT, () => {
    console.log(`[http] CS2 stats bot on 0.0.0.0:${PORT}`);
  });

  await connectBot('startup');
}

main().catch((err) => {
  console.error('[fatal]', err?.message || err);
  process.exit(1);
});