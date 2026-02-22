'use strict';

/**
 * CS2 stats bot service.
 * - logs into Steam
 * - keeps Game Coordinator (GC) session alive
 * - serves GET /players/:steamId in backend format
 * - exposes bot status and manual reconnect endpoints
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const express = require('express');
const SteamUser = require('steam-user');
const GlobalOffensive = require('globaloffensive');
const SteamTotp = require('steam-totp');

const PORT = parseInt(process.env.PORT || '3100', 10);
const API_TOKEN = (process.env.CS2_STATS_API_TOKEN || '').trim();
const CACHE_TTL_MS = parseInt(process.env.CS2_STATS_CACHE_TTL_MS || '60000', 10);
const REQUEST_TIMEOUT_MS = parseInt(process.env.CS2_STATS_REQUEST_TIMEOUT_MS || '15000', 10);
const RECONNECT_DELAY_MS = parseInt(process.env.CS2_STATS_RECONNECT_DELAY_MS || '15000', 10);
const STEAM_DATA_DIR = (process.env.CS2_STATS_STEAM_DATA_DIR || path.join(__dirname, '.steam-data')).trim();

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

const STEAM_EMAIL_IMAP_USER =
  process.env.CS2_STATS_STEAM_EMAIL_IMAP_USER ||
  process.env.CS2_STATS_STEAM_EMAIL_LOGIN ||
  process.env.EMAIL_HOST_USER ||
  '';
const STEAM_EMAIL_IMAP_PASSWORD =
  process.env.CS2_STATS_STEAM_EMAIL_IMAP_PASSWORD ||
  process.env.CS2_STATS_STEAM_EMAIL_PASSWORD ||
  process.env.EMAIL_HOST_PASSWORD ||
  '';
const STEAM_EMAIL_IMAP_HOST =
  process.env.CS2_STATS_STEAM_EMAIL_IMAP_HOST ||
  inferImapHost(STEAM_EMAIL_IMAP_USER) ||
  '';
const STEAM_EMAIL_IMAP_PORT = parseInt(process.env.CS2_STATS_STEAM_EMAIL_IMAP_PORT || '993', 10);
const STEAM_EMAIL_IMAP_INBOX = (process.env.CS2_STATS_STEAM_EMAIL_IMAP_INBOX || 'INBOX').trim();
const STEAM_EMAIL_IMAP_TIMEOUT_MS = parseInt(
  process.env.CS2_STATS_STEAM_EMAIL_IMAP_TIMEOUT_MS || '90000',
  10
);
const STEAM_EMAIL_IMAP_POLL_INTERVAL_MS = parseInt(
  process.env.CS2_STATS_STEAM_EMAIL_IMAP_POLL_INTERVAL_MS || '5000',
  10
);
const STEAM_EMAIL_IMAP_MAX_MESSAGES = parseInt(
  process.env.CS2_STATS_STEAM_EMAIL_IMAP_MAX_MESSAGES || '8',
  10
);
const STEAM_EMAIL_FROM_FILTER = (process.env.CS2_STATS_STEAM_EMAIL_FROM_FILTER || 'noreply@steampowered.com').trim();
const STEAM_EMAIL_SUBJECT_FILTER = (process.env.CS2_STATS_STEAM_EMAIL_SUBJECT_FILTER || 'Steam Guard').trim();
const STEAM_EMAIL_GUARD_ENABLED = parseBool(
  process.env.CS2_STATS_STEAM_EMAIL_GUARD_ENABLED,
  false
);

const STEAM_EMAIL_GUARD_READY = Boolean(
  STEAM_EMAIL_GUARD_ENABLED &&
    STEAM_EMAIL_IMAP_HOST &&
    STEAM_EMAIL_IMAP_USER &&
    STEAM_EMAIL_IMAP_PASSWORD &&
    Number.isFinite(STEAM_EMAIL_IMAP_PORT) &&
    STEAM_EMAIL_IMAP_PORT > 0
);

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
let lastSubmittedSteamGuardCode = '';
let lastSubmittedSteamGuardAt = 0;

const botState = {
  logged_on: false,
  gc_ready: false,
  last_connected_at: null,
  last_error: null,
  reconnect_attempts: 0,
};

const playerCache = new Map();

const COMMON_NON_CODE_TOKENS = new Set([
  'STEAM',
  'GUARD',
  'LOGIN',
  'EMAIL',
  'FROM',
  'HTTPS',
  'HTTP',
  'SUPPORT',
  'VALVE',
]);

function nowIso() {
  return new Date().toISOString();
}

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inferImapHost(email) {
  const domain = String(email || '')
    .trim()
    .toLowerCase()
    .split('@')[1];
  if (!domain) return '';
  if (domain === 'yandex.ru' || domain === 'ya.ru' || domain.endsWith('.yandex.ru')) {
    return 'imap.yandex.ru';
  }
  if (domain === 'gmail.com') {
    return 'imap.gmail.com';
  }
  if (
    domain === 'outlook.com' ||
    domain === 'hotmail.com' ||
    domain === 'live.com' ||
    domain === 'office365.com'
  ) {
    return 'outlook.office365.com';
  }
  return '';
}

function imapQuote(value) {
  return `"${String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')}"`;
}

class SimpleImapSession {
  constructor(socket) {
    this.socket = socket;
    this.tagIndex = 1;
    this.buffer = '';
    this.closed = false;
    this.closeError = null;
    this.waiters = new Set();

    this.socket.on('data', (chunk) => {
      this.buffer += chunk.toString('utf8');
      this.notifyWaiters();
    });

    this.socket.on('close', () => {
      this.closed = true;
      this.notifyWaiters();
    });

    this.socket.on('error', (err) => {
      this.closeError = err;
      this.notifyWaiters();
    });
  }

  notifyWaiters() {
    for (const waiter of [...this.waiters]) {
      waiter.check();
    }
  }

  waitForRegex(regex, timeoutMs = STEAM_EMAIL_IMAP_TIMEOUT_MS, offset = 0) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.waiters.delete(entry);
        reject(new Error(`IMAP timeout while waiting for pattern: ${regex}`));
      }, timeoutMs);

      const entry = {
        check: () => {
          if (this.closeError) {
            clearTimeout(timeout);
            this.waiters.delete(entry);
            reject(this.closeError);
            return;
          }
          if (this.closed) {
            clearTimeout(timeout);
            this.waiters.delete(entry);
            reject(new Error('IMAP socket closed'));
            return;
          }

          const text = this.buffer.slice(offset);
          const match = text.match(regex);
          if (!match) return;

          clearTimeout(timeout);
          this.waiters.delete(entry);
          resolve({
            match,
            absoluteIndex: offset + (match.index || 0),
          });
        },
      };

      this.waiters.add(entry);
      entry.check();
    });
  }

  async sendCommand(command, timeoutMs = STEAM_EMAIL_IMAP_TIMEOUT_MS) {
    const tag = `A${String(this.tagIndex).padStart(4, '0')}`;
    this.tagIndex += 1;
    const commandStart = this.buffer.length;
    this.socket.write(`${tag} ${command}\r\n`);

    const taggedPattern = new RegExp(`(?:^|\\r\\n)${tag} (OK|NO|BAD)\\b`, 'm');
    const { match, absoluteIndex } = await this.waitForRegex(taggedPattern, timeoutMs, commandStart);
    let lineEnd = this.buffer.indexOf('\r\n', absoluteIndex);
    if (lineEnd === -1) {
      await this.waitForRegex(new RegExp(`\\r\\n`, 'm'), timeoutMs, absoluteIndex);
      lineEnd = this.buffer.indexOf('\r\n', absoluteIndex);
    }

    const responseBlock = this.buffer.slice(commandStart, lineEnd + 2);
    const status = (match[1] || '').toUpperCase();
    if (status !== 'OK') {
      throw new Error(`IMAP ${status}: ${command}`);
    }
    return responseBlock;
  }

  async close() {
    if (this.closed) return;
    try {
      await this.sendCommand('LOGOUT', Math.min(5000, STEAM_EMAIL_IMAP_TIMEOUT_MS));
    } catch (_) {
      // ignore logout errors
    }
    this.socket.end();
  }
}

async function openImapSession() {
  return new Promise((resolve, reject) => {
    if (!STEAM_EMAIL_IMAP_HOST) {
      reject(new Error('IMAP host is not configured'));
      return;
    }

    const socket = tls.connect({
      host: STEAM_EMAIL_IMAP_HOST,
      port: STEAM_EMAIL_IMAP_PORT,
      servername: STEAM_EMAIL_IMAP_HOST,
      rejectUnauthorized: true,
    });
    socket.setTimeout(STEAM_EMAIL_IMAP_TIMEOUT_MS);
    socket.once('timeout', () => socket.destroy(new Error('IMAP socket timeout')));
    socket.once('error', (err) => reject(err));

    socket.once('secureConnect', async () => {
      try {
        const session = new SimpleImapSession(socket);
        await session.waitForRegex(/(?:^|\r\n)\* OK\b/m, STEAM_EMAIL_IMAP_TIMEOUT_MS, 0);
        resolve(session);
      } catch (err) {
        socket.destroy();
        reject(err);
      }
    });
  });
}

function parseSearchUids(searchResponse) {
  const match = searchResponse.match(/^\* SEARCH\s*(.*)$/m);
  if (!match) return [];
  const tail = String(match[1] || '').trim();
  if (!tail) return [];
  return tail
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => /^\d+$/.test(item));
}

function extractSteamGuardCode(messageText) {
  const text = String(messageText || '').replace(/\r/g, '\n');

  const contextualPatterns = [
    /steam\s*guard[^A-Z0-9]{0,60}([A-Z0-9]{5})/i,
    /(?:guard|код|code)[^A-Z0-9]{0,30}([A-Z0-9]{5})/i,
  ];
  for (const pattern of contextualPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const candidate = match[1].toUpperCase();
      if (!COMMON_NON_CODE_TOKENS.has(candidate)) return candidate;
    }
  }

  const steamLines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /steam|guard|код|code/i.test(line));
  for (const line of steamLines) {
    const match = line.match(/\b([A-Z0-9]{5})\b/i);
    if (!match || !match[1]) continue;
    const candidate = match[1].toUpperCase();
    if (!COMMON_NON_CODE_TOKENS.has(candidate)) return candidate;
  }

  return '';
}

function extractMessageDate(messageText) {
  const match = String(messageText || '').match(/^Date:\s*(.+)$/im);
  if (!match || !match[1]) return null;
  const parsed = new Date(match[1].trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function wasCodeSubmittedRecently(code) {
  if (!code || !lastSubmittedSteamGuardCode) return false;
  if (String(code).toUpperCase() !== lastSubmittedSteamGuardCode) return false;
  return Date.now() - lastSubmittedSteamGuardAt < 20 * 60 * 1000;
}

function buildSearchCommand() {
  const parts = ['UID SEARCH', 'ALL'];
  if (STEAM_EMAIL_FROM_FILTER) {
    parts.push('FROM', imapQuote(STEAM_EMAIL_FROM_FILTER));
  }
  if (STEAM_EMAIL_SUBJECT_FILTER) {
    parts.push('SUBJECT', imapQuote(STEAM_EMAIL_SUBJECT_FILTER));
  }
  return parts.join(' ');
}

async function fetchSteamGuardCodeFromEmail() {
  const session = await openImapSession();
  const checkedUids = new Set();

  try {
    await session.sendCommand(
      `LOGIN ${imapQuote(STEAM_EMAIL_IMAP_USER)} ${imapQuote(STEAM_EMAIL_IMAP_PASSWORD)}`
    );
    await session.sendCommand(`SELECT ${imapQuote(STEAM_EMAIL_IMAP_INBOX)}`);

    const deadline = Date.now() + STEAM_EMAIL_IMAP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const strictSearch = await session.sendCommand(buildSearchCommand());
      let uids = parseSearchUids(strictSearch);
      if (uids.length === 0) {
        const broadSearch = await session.sendCommand('UID SEARCH ALL');
        uids = parseSearchUids(broadSearch);
      }

      const candidates = uids.slice(-STEAM_EMAIL_IMAP_MAX_MESSAGES).reverse();
      for (const uid of candidates) {
        if (checkedUids.has(uid)) continue;
        checkedUids.add(uid);

        const fetchResponse = await session.sendCommand(
          `UID FETCH ${uid} (BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)] BODY.PEEK[TEXT]<0.4096>)`
        );
        const messageDate = extractMessageDate(fetchResponse);
        if (messageDate && Date.now() - messageDate.getTime() > 30 * 60 * 1000) {
          continue;
        }

        const code = extractSteamGuardCode(fetchResponse);
        if (!code || wasCodeSubmittedRecently(code)) continue;
        return code;
      }

      await sleep(STEAM_EMAIL_IMAP_POLL_INTERVAL_MS);
    }
  } finally {
    await session.close();
  }

  throw new Error('Steam Guard code was not found in mailbox before timeout');
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
    email_guard_auto_enabled: STEAM_EMAIL_GUARD_ENABLED,
    email_guard_auto_ready: STEAM_EMAIL_GUARD_READY,
    steam_data_dir: STEAM_DATA_DIR,
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
  steamClient.on('steamGuard', (domain, callback, lastCodeWrong) => {
    const isEmailGuard = Boolean(domain);
    const guardSource = isEmailGuard ? `email (${domain})` : '2FA';
    console.warn(`[steam] steamGuard challenge detected: ${guardSource}`);

    if (lastCodeWrong) {
      console.warn('[steam] previous Steam Guard code was rejected');
    }

    (async () => {
      try {
        let code = '';

        if (!isEmailGuard) {
          if (!STEAM_2FA_SECRET) {
            throw new Error('Steam Guard 2FA requested, but STEAM_2FA_SECRET is not configured');
          }
          code = SteamTotp.getAuthCode(STEAM_2FA_SECRET);
        } else {
          if (!STEAM_EMAIL_GUARD_READY) {
            throw new Error(
              'Steam email guard requested, but IMAP auto-fetch is not configured. Set CS2_STATS_STEAM_EMAIL_GUARD_ENABLED=true and IMAP env vars.'
            );
          }
          code = await fetchSteamGuardCodeFromEmail();
        }

        const normalizedCode = String(code || '').trim().toUpperCase();
        callback(normalizedCode);
        lastSubmittedSteamGuardCode = normalizedCode;
        lastSubmittedSteamGuardAt = Date.now();
        console.log('[steam] steamGuard code submitted');
      } catch (err) {
        const message = err?.message || 'Failed to resolve Steam Guard code';
        setLastError(message);
        console.error('[steam] steamGuard error:', message);
        try {
          callback('');
        } catch (_) {
          // ignore callback errors
        }
      }
    })();
  });

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

    if (STEAM_DATA_DIR) {
      fs.mkdirSync(STEAM_DATA_DIR, { recursive: true });
    }
    steamClient = new SteamUser({
      dataDirectory: STEAM_DATA_DIR || null,
    });
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

function addFriendBySteamId(steamId64) {
  if (!steamClient || !botState.logged_on) {
    return Promise.reject(new Error('Steam bot is not logged on'));
  }

  return new Promise((resolve, reject) => {
    steamClient.addFriend(steamId64, (err, personaName) => {
      if (!err) {
        resolve({
          status: 'request_sent',
          persona_name: personaName || '',
          detail: 'Friend request sent.',
        });
        return;
      }

      const eresult = Number(err?.eresult || 0);
      if (eresult === 14) {
        resolve({
          status: 'already_or_pending',
          persona_name: personaName || '',
          detail: 'Already friends or request is already pending.',
        });
        return;
      }

      reject(err);
    });
  });
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

app.post('/bot/friends/add', requireToken, async (req, res) => {
  const steamId = sanitizeSteamId(req.body?.steam_id);
  if (!/^\d{17}$/.test(steamId)) {
    return res.status(400).json({ error: 'Invalid steam_id. Expected SteamID64 with 17 digits.' });
  }

  if (!steamClient || !botState.logged_on) {
    return res.status(503).json({
      error: 'Steam bot is not logged on',
      bot: getBotStatus(),
    });
  }

  try {
    const result = await addFriendBySteamId(steamId);
    return res.json({
      ok: true,
      steam_id: steamId,
      ...result,
    });
  } catch (err) {
    const message = err?.message || 'Failed to add friend';
    const eresult = Number(err?.eresult || 0) || null;
    return res.status(eresult === 40 ? 403 : 500).json({
      error: message,
      eresult,
      bot: getBotStatus(),
    });
  }
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
