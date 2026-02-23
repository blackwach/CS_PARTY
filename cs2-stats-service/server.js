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
const https = require('https');
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
const MATCH_HISTORY_REQUEST_TIMEOUT_MS = parseInt(
  process.env.CS2_STATS_MATCH_HISTORY_REQUEST_TIMEOUT_MS || '12000',
  10
);
const MATCH_HISTORY_MAX_SHARE_CODES_PER_SYNC = parseInt(
  process.env.CS2_STATS_MATCH_HISTORY_MAX_SHARE_CODES_PER_SYNC || '40',
  10
);
const RECONNECT_DELAY_MS = parseInt(process.env.CS2_STATS_RECONNECT_DELAY_MS || '15000', 10);
const RECONNECT_DELAY_THROTTLE_MS = parseInt(
  process.env.CS2_STATS_RECONNECT_DELAY_THROTTLE_MS || '300000',
  10
);
const STEAM_GUARD_MANUAL_TIMEOUT_MS = parseInt(
  process.env.CS2_STATS_STEAM_GUARD_MANUAL_TIMEOUT_MS || '180000',
  10
);
const STEAM_DATA_DIR = (process.env.CS2_STATS_STEAM_DATA_DIR || path.join(__dirname, '.steam-data')).trim();

const STEAM_USERNAME =
  process.env.CS2_STATS_STEAM_USERNAME ||
  process.env.STEAM_USERNAME ||
  process.env.STEAM_USER ||
  '';
const STEAM_PASSWORD =
  process.env.CS2_STATS_STEAM_PASSWORD ||
  process.env.STEAM_PASSWORD ||
  process.env.STEAM_PASS ||
  '';
const STEAM_2FA_SECRET =
  process.env.CS2_STATS_STEAM_2FA_SECRET ||
  process.env.STEAM_2FA_SECRET ||
  process.env.STEAM_SHARED_SECRET ||
  '';
const STEAM_WEB_API_KEY = (
  process.env.CS2_STATS_STEAM_WEB_API_KEY ||
  process.env.CS2_STATS_STEAM_API_KEY ||
  process.env.CS2_STEAM_WEB_API_KEY ||
  process.env.STEAM_WEB_API_KEY ||
  process.env.STEAM_API_KEY ||
  ''
).trim();
const STEAM_ID64_BASE = 76561197960265728n;

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
const STEAM_EMAIL_IMAP_FETCH_BODY_MAX = parseInt(
  process.env.CS2_STATS_STEAM_EMAIL_IMAP_FETCH_BODY_MAX || '16384',
  10
);
// Пауза перед первым опросом почты (письмо с кодом приходит с задержкой 5–30 с)
const STEAM_EMAIL_INITIAL_WAIT_MS = parseInt(
  process.env.CS2_STATS_STEAM_EMAIL_INITIAL_WAIT_MS || '18000',
  10
);
// Берём код только из писем не старше N мс (одно письмо на попытку входа — не использовать старый код)
const STEAM_EMAIL_MAX_AGE_MS = parseInt(
  process.env.CS2_STATS_STEAM_EMAIL_MAX_AGE_MS || '300000',
  10
);
const STEAM_EMAIL_FROM_FILTER = (process.env.CS2_STATS_STEAM_EMAIL_FROM_FILTER || 'noreply@steampowered.com').trim();
// "Steam" находит и "Steam Guard", и "Ваш аккаунт Steam: доступ с нового компьютера"
const STEAM_EMAIL_SUBJECT_FILTER = (process.env.CS2_STATS_STEAM_EMAIL_SUBJECT_FILTER || 'Steam').trim();
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
  1: 'Silver I',
  2: 'Silver II',
  3: 'Silver III',
  4: 'Silver IV',
  5: 'Silver Elite',
  6: 'Silver Elite Master',
  7: 'Gold Nova I',
  8: 'Gold Nova II',
  9: 'Gold Nova III',
  10: 'Gold Nova Master',
  11: 'Master Guardian I',
  12: 'Master Guardian II',
  13: 'Master Guardian Elite',
  14: 'Distinguished Master Guardian',
  15: 'Legendary Eagle',
  16: 'Legendary Eagle Master',
  17: 'Supreme Master First Class',
  18: 'Global Elite',
};

const KNOWN_CS2_MAP_CODES = [
  'de_ancient',
  'de_anubis',
  'de_dust2',
  'de_inferno',
  'de_mirage',
  'de_nuke',
  'de_train',
  'de_overpass',
  'de_vertigo',
  'de_office',
  'de_italy',
  'de_cache',
];
const KNOWN_CS2_MAP_CODE_SET = new Set(KNOWN_CS2_MAP_CODES);
const CS2_MAP_ALIASES = {
  ancient: 'de_ancient',
  anubis: 'de_anubis',
  dust2: 'de_dust2',
  dust_2: 'de_dust2',
  dust_ii: 'de_dust2',
  de_dust_2: 'de_dust2',
  inferno: 'de_inferno',
  mirage: 'de_mirage',
  nuke: 'de_nuke',
  train: 'de_train',
  overpass: 'de_overpass',
  vertigo: 'de_vertigo',
  office: 'de_office',
  italy: 'de_italy',
  cache: 'de_cache',
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
let pendingSteamGuard = null;

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

/** Убирает HTML-теги (Steam шлёт письма в HTML). */
function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&#(\d+);/g, (_, dec) => {
      const value = parseInt(dec, 10);
      if (!Number.isFinite(value)) return '';
      try {
        return String.fromCodePoint(value);
      } catch (_) {
        return '';
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const value = parseInt(hex, 16);
      if (!Number.isFinite(value)) return '';
      try {
        return String.fromCodePoint(value);
      } catch (_) {
        return '';
      }
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function decodeQuotedPrintable(text) {
  const source = String(text || '');
  if (!/=([0-9A-F]{2}|\r?\n)/i.test(source)) {
    return source;
  }

  const bytes = [];
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '=') {
      const next = source[i + 1];
      const next2 = source[i + 2];

      // Soft line break in quoted-printable.
      if (next === '\r' && next2 === '\n') {
        i += 2;
        continue;
      }
      if (next === '\n') {
        i += 1;
        continue;
      }

      const hex = source.slice(i + 1, i + 3);
      if (/^[0-9A-F]{2}$/i.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }

    const code = source.charCodeAt(i);
    bytes.push(code <= 0xff ? code : 0x20);
  }

  return Buffer.from(bytes).toString('utf8');
}

function stripHtml(html) {
  return decodeHtmlEntities(
    String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  );
}

function normalizeSteamGuardCode(rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) return '';
  if (!/[A-Z]/.test(code)) return '';
  return COMMON_NON_CODE_TOKENS.has(code) ? '' : code;
}

function extractSteamGuardCode(messageText) {
  const raw = String(messageText || '').replace(/\r/g, '\n');
  const splitIndex = raw.indexOf('\n\n');
  const body = splitIndex >= 0 ? raw.slice(splitIndex + 2) : raw;
  const decodedBody = decodeQuotedPrintable(body);
  const flattenedBody = stripHtml(decodedBody);
  const textVariants = [decodedBody, flattenedBody, stripHtml(raw), raw]
    .filter(Boolean)
    .join('\n');

  const take = (match) => {
    if (!match || !match[1]) return null;
    const c = normalizeSteamGuardCode(match[1]);
    return c || null;
  };

  const patterns = [
    /(?:\u043f\u043e\u043d\u0430\u0434\u043e\u0431\u0438\u0442\u0441\u044f\s+)?\u043a\u043e\u0434\s+Steam\s+Guard[^A-Z0-9]{0,280}([A-Z0-9]{5})\b/i,
    /\u0440\u043e\u0441\u0441\u0438\u044f[^A-Z0-9]{0,120}([A-Z0-9]{5})\b/i,
    /\u0441\u0442\u0440\u0430\u043d\u044b:\s*[^A-Z0-9]{0,80}([A-Z0-9]{5})\b/i,
    /steam\s*guard[^A-Z0-9]{0,120}([A-Z0-9]{5})\b/i,
    /(?:guard|\u043a\u043e\u0434|code|security\s+code)[^A-Z0-9]{0,120}([A-Z0-9]{5})\b/i,
    /you\s+need\s+(?:the\s+)?(?:steam\s+guard\s+)?code[^A-Z0-9]{0,120}([A-Z0-9]{5})\b/i,
    /\b([A-Z0-9]{5})\b[^A-Z0-9]{0,90}(?:steam\s*guard|security\s+code|code|\u043a\u043e\u0434)\b/i,
  ];
  for (const re of patterns) {
    const candidate = take(textVariants.match(re));
    if (candidate) return candidate;
  }

  const lines = textVariants.split(/\n+/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/(steam|guard|code|\u043a\u043e\u0434|\u0432\u0445\u043e\u0434|\u0434\u043e\u0441\u0442\u0443\u043f)/i.test(line)) {
      continue;
    }

    for (let offset = 0; offset <= 2; offset++) {
      const candidateLine = `${line} ${lines[i + offset] || ''}`;
      const m = candidateLine.match(/\b([A-Z0-9]{5})\b/i);
      const candidate = take(m);
      if (candidate) return candidate;
    }
  }

  // Last-resort fallback: choose a candidate with the strongest Steam-related context.
  let bestCandidate = '';
  let bestScore = 0;
  const allCandidatesRegex = /\b([A-Z0-9]{5})\b/gi;
  let match;
  while ((match = allCandidatesRegex.exec(textVariants)) !== null) {
    const candidate = normalizeSteamGuardCode(match[1]);
    if (!candidate) continue;

    const start = Math.max(0, match.index - 200);
    const end = Math.min(textVariants.length, match.index + 200);
    const window = textVariants.slice(start, end);

    let score = 0;
    if (/steam/i.test(window)) score += 2;
    if (/guard/i.test(window)) score += 2;
    if (/(?:\bcode\b|\u043a\u043e\u0434)/i.test(window)) score += 2;
    if (/(?:login|account|\u0432\u0445\u043e\u0434|\u0434\u043e\u0441\u0442\u0443\u043f)/i.test(window)) score += 1;
    if (match.index > textVariants.length * 0.35) score += 1;

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  return bestScore > 0 ? bestCandidate : '';
}

function extractMessageDate(messageText) {
  const match = String(messageText || '').match(/^Date:\s*(.+)$/im);
  if (!match || !match[1]) return null;
  const parsed = new Date(match[1].trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function extractMessageFrom(messageText) {
  const match = String(messageText || '').match(/^From:\s*(.+)$/im);
  return (match && match[1] ? match[1].trim() : '').toLowerCase();
}

function extractMessageSubject(messageText) {
  const match = String(messageText || '').match(/^Subject:\s*(.+)$/im);
  return (match && match[1] ? match[1].trim() : '').toLowerCase();
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

function buildSearchCommands() {
  const commands = [];
  const strict = buildSearchCommand();
  if (strict) commands.push(strict);

  // Some IMAP providers reject complex SEARCH criteria; keep a broad fallback.
  commands.push('UID SEARCH ALL');

  if (STEAM_EMAIL_FROM_FILTER) {
    commands.push(`UID SEARCH ALL FROM ${imapQuote(STEAM_EMAIL_FROM_FILTER)}`);
  }
  if (STEAM_EMAIL_SUBJECT_FILTER) {
    commands.push(`UID SEARCH ALL SUBJECT ${imapQuote(STEAM_EMAIL_SUBJECT_FILTER)}`);
  }

  return [...new Set(commands)];
}

async function fetchSteamGuardCodeFromEmail() {
  if (STEAM_EMAIL_INITIAL_WAIT_MS > 0) {
    console.warn(`[steam] ожидание ${Math.round(STEAM_EMAIL_INITIAL_WAIT_MS / 1000)} с перед опросом почты (письмо приходит с задержкой)`);
    await sleep(STEAM_EMAIL_INITIAL_WAIT_MS);
  }

  const session = await openImapSession();
  const checkedUids = new Set();

  try {
    await session.sendCommand(
      `LOGIN ${imapQuote(STEAM_EMAIL_IMAP_USER)} ${imapQuote(STEAM_EMAIL_IMAP_PASSWORD)}`
    );
    await session.sendCommand(`SELECT ${imapQuote(STEAM_EMAIL_IMAP_INBOX)}`);

    const deadline = Date.now() + STEAM_EMAIL_IMAP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      let uids = [];
      for (const command of buildSearchCommands()) {
        try {
          const searchResponse = await session.sendCommand(command);
          const parsed = parseSearchUids(searchResponse);
          if (parsed.length > 0) {
            uids = parsed;
            break;
          }
        } catch (err) {
          // Ignore unsupported SEARCH variants and continue with broader criteria.
          const message = err?.message || String(err);
          if (!/\bIMAP (NO|BAD)\b/i.test(message)) {
            throw err;
          }
          continue;
        }
      }

      const candidates = uids.slice(-STEAM_EMAIL_IMAP_MAX_MESSAGES).reverse();
      for (const uid of candidates) {
        if (checkedUids.has(uid)) continue;
        checkedUids.add(uid);

        const maxBody = Math.min(Math.max(STEAM_EMAIL_IMAP_FETCH_BODY_MAX, 4096), 65536);
        let fetchResponse;
        try {
          fetchResponse = await session.sendCommand(
            `UID FETCH ${uid} (BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)] BODY.PEEK[TEXT]<0.${maxBody}> BODY.PEEK[1.2]<0.${maxBody}>)`
          );
        } catch (_) {
          fetchResponse = await session.sendCommand(
            `UID FETCH ${uid} (BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)] BODY.PEEK[TEXT]<0.${maxBody}>)`
          );
        }
        const messageDate = extractMessageDate(fetchResponse);
        if (messageDate && Date.now() - messageDate.getTime() > STEAM_EMAIL_MAX_AGE_MS) {
          continue;
        }
        const from = extractMessageFrom(fetchResponse);
        const fromFilter = String(STEAM_EMAIL_FROM_FILTER || '').trim().toLowerCase();
        if (from && fromFilter && !from.includes(fromFilter)) continue;
        if (from && !fromFilter && !from.includes('steampowered.com')) continue;

        const subject = extractMessageSubject(fetchResponse);
        const subjectFilter = String(STEAM_EMAIL_SUBJECT_FILTER || '').trim().toLowerCase();
        if (subjectFilter && subject && !subject.includes(subjectFilter)) continue;

        const code = extractSteamGuardCode(fetchResponse);
        if (!code || wasCodeSubmittedRecently(code)) continue;

        try {
          await session.sendCommand(`UID STORE ${uid} +FLAGS (\\Seen)`);
        } catch (_) {
          // помечаем прочитанным; при ошибке (например, только чтение) — не критично
        }
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

function detectRankId(rawRankId) {
  if (rawRankId === null || rawRankId === undefined) return null;
  const parsed = parseInt(rawRankId, 10);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function parseIntSafe(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFloatSafe(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeModeName(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[_-]+/g, ' ');
}

function normalizeMapToken(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function normalizeMapCode(rawMap) {
  const token = normalizeMapToken(rawMap);
  if (!token) return '';
  if (KNOWN_CS2_MAP_CODE_SET.has(token)) return token;
  if (CS2_MAP_ALIASES[token]) return CS2_MAP_ALIASES[token];

  const withoutPrefix = token.replace(/^(de_|cs_|ar_)/, '');
  if (CS2_MAP_ALIASES[withoutPrefix]) return CS2_MAP_ALIASES[withoutPrefix];
  if (KNOWN_CS2_MAP_CODE_SET.has(`de_${withoutPrefix}`)) return `de_${withoutPrefix}`;
  return token.startsWith('de_') ? token : '';
}

function extractMapCodeFromText(value) {
  const token = normalizeMapToken(value);
  if (!token) return '';
  const direct = normalizeMapCode(token);
  if (direct) return direct;

  const searchable = `_${token}_`;
  for (const [alias, mapCode] of Object.entries(CS2_MAP_ALIASES)) {
    if (searchable.includes(`_${alias}_`)) {
      return mapCode;
    }
  }
  return '';
}

function resolveMapFromRankingEntry(entry) {
  if (!entry || typeof entry !== 'object') return '';

  const candidates = [
    entry.map_name,
    entry.mapName,
    entry.map,
    entry.group,
    entry.group_name,
    entry.groupName,
    entry.leaderboard_name,
    entry.leaderboardName,
    entry.leaderboard,
    entry.rank_type_name,
    entry.rankTypeName,
    entry.mode_name,
    entry.modeName,
    entry.rank_type,
    entry.rankType,
    entry.mode,
    entry.name,
  ];

  for (let index = 0; index < candidates.length; index += 1) {
    const mapCode = extractMapCodeFromText(candidates[index]);
    if (mapCode) return mapCode;
  }

  return '';
}

function hashString(value) {
  const source = String(value || '');
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function normalizePlayedAt(value) {
  if (value === null || value === undefined || value === '') return '';

  if (typeof value === 'number') {
    const timeMs = value > 1e12 ? value : value * 1000;
    return new Date(timeMs).toISOString();
  }

  if (value && typeof value.toISOString === 'function') {
    try {
      return value.toISOString();
    } catch (_) {
      return '';
    }
  }

  const asText = normalizeText(value);
  if (!asText) return '';

  const parsedTime = Date.parse(asText);
  if (Number.isNaN(parsedTime)) return asText;
  return new Date(parsedTime).toISOString();
}

function buildStableMatchId(item) {
  const direct =
    normalizeText(item?.matchid) ||
    normalizeText(item?.match_id) ||
    normalizeText(item?.matchId) ||
    normalizeText(item?.id);
  if (direct) return direct;

  const keyParts = [
    normalizePlayedAt(item?.played_at ?? item?.time ?? item?.timestamp ?? null),
    normalizeText(item?.map_name || item?.map || ''),
    String(parseIntSafe(item?.kills ?? item?.kills_count ?? 0, 0)),
    String(parseIntSafe(item?.deaths ?? item?.deaths_count ?? 0, 0)),
    String(parseIntSafe(item?.assists ?? item?.assists_count ?? 0, 0)),
    normalizeText(item?.result ?? item?.win ?? ''),
  ];
  return `match_${hashString(keyParts.join('|'))}`;
}

function normalizeResult(item) {
  const rawResult = normalizeText(item?.result ?? item?.match_result ?? item?.outcome).toLowerCase();
  if (
    item?.win === true ||
    item?.won === true ||
    item?.is_won === true ||
    rawResult === 'win' ||
    rawResult === 'won' ||
    rawResult === 'victory'
  ) {
    return 'win';
  }
  const numericResult = parseIntSafe(item?.result ?? item?.match_result ?? item?.outcome, NaN);
  if (Number.isFinite(numericResult)) {
    if (numericResult === 1) return 'win';
    if (numericResult === 2) return 'lose';
    if (numericResult === 0) return 'draw';
  }
  if (
    item?.win === false ||
    item?.won === false ||
    item?.is_won === false ||
    rawResult === 'lose' ||
    rawResult === 'loss' ||
    rawResult === 'lost' ||
    rawResult === 'defeat'
  ) {
    return 'lose';
  }
  return 'draw';
}

function extractRecentMatchRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  const candidates = [
    payload.matches,
    payload.match_list,
    payload.matchList,
    payload.recent_matches,
    payload.recentMatches,
    payload.games,
    payload.items,
    payload?.result?.matches,
    payload?.data?.matches,
  ];
  for (let index = 0; index < candidates.length; index += 1) {
    if (Array.isArray(candidates[index])) {
      return candidates[index];
    }
  }

  return [];
}

function normalizeLongLikeToString(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(Math.trunc(value)) : '';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object') {
    if (typeof value.toString === 'function') {
      const rendered = String(value.toString());
      if (rendered && rendered !== '[object Object]') return rendered;
    }
    if (typeof value.low === 'number' && typeof value.high === 'number') {
      try {
        const low = BigInt(value.low >>> 0);
        const high = BigInt(value.high >>> 0);
        return ((high << 32n) + low).toString();
      } catch (_) {
        return '';
      }
    }
  }
  return '';
}

function parseLongLikeInt(value, fallback = NaN) {
  const rendered = normalizeLongLikeToString(value);
  if (!rendered) return fallback;
  const parsed = Number(rendered);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function steamId64ToAccountId(steamId64) {
  const rendered = normalizeText(steamId64);
  if (!/^\d{17}$/.test(rendered)) return null;
  try {
    const value = BigInt(rendered) - STEAM_ID64_BASE;
    if (value < 0n || value > 4294967295n) return null;
    return Number(value);
  } catch (_) {
    return null;
  }
}

function sanitizeMatchToken(value) {
  const token = normalizeText(value);
  if (!token) return '';
  return /^[A-Za-z0-9_-]{8,128}$/.test(token) ? token : '';
}

function sanitizeShareCode(value) {
  const code = normalizeText(value).toUpperCase();
  if (!code || code.toLowerCase() === 'n/a') return '';
  if (!/^CSGO(?:-[A-Z0-9]{5}){5}$/.test(code)) return '';
  return code;
}

function readPlayerStatFromArray(source, index, fallback = 0) {
  if (!Array.isArray(source) || index < 0 || index >= source.length) return fallback;
  return Math.max(parseLongLikeInt(source[index], fallback), 0);
}

function resolveGcRoundStatsForPlayer(matchEntry, steamId64) {
  if (!matchEntry || typeof matchEntry !== 'object') return null;

  const rounds = Array.isArray(matchEntry.roundstatsall)
    ? matchEntry.roundstatsall.filter((item) => item && typeof item === 'object')
    : [];
  const fallbackRound =
    matchEntry.roundstats_legacy && typeof matchEntry.roundstats_legacy === 'object' ? matchEntry.roundstats_legacy : null;
  const finalRound = rounds.length > 0 ? rounds[rounds.length - 1] : fallbackRound;
  if (!finalRound || typeof finalRound !== 'object') return null;

  const reservation = finalRound.reservation && typeof finalRound.reservation === 'object' ? finalRound.reservation : {};
  const accountIds = Array.isArray(reservation.account_ids)
    ? reservation.account_ids
    : Array.isArray(finalRound.account_ids)
      ? finalRound.account_ids
      : [];
  const targetAccountId = steamId64ToAccountId(steamId64);

  let playerIndex = -1;
  if (targetAccountId !== null) {
    for (let index = 0; index < accountIds.length; index += 1) {
      if (parseLongLikeInt(accountIds[index], NaN) === targetAccountId) {
        playerIndex = index;
        break;
      }
    }
  }

  const kills = readPlayerStatFromArray(finalRound.kills, playerIndex, 0);
  const deaths = readPlayerStatFromArray(finalRound.deaths, playerIndex, 0);
  const assists = readPlayerStatFromArray(finalRound.assists, playerIndex, 0);
  const headshots = readPlayerStatFromArray(finalRound.enemy_headshots, playerIndex, 0);
  const teamScores = Array.isArray(finalRound.team_scores) ? finalRound.team_scores : [];

  let result = normalizeResult({
    result: matchEntry.result ?? finalRound.match_result,
    match_result: finalRound.match_result,
    win: matchEntry.win,
  });

  if (result === 'draw' && playerIndex >= 0 && teamScores.length >= 2 && accountIds.length >= 2) {
    const teamSize = Math.max(Math.floor(accountIds.length / 2), 1);
    const teamIndex = playerIndex < teamSize ? 0 : 1;
    const ownScore = parseLongLikeInt(teamScores[teamIndex], NaN);
    const enemyScore = parseLongLikeInt(teamScores[teamIndex === 0 ? 1 : 0], NaN);
    if (Number.isFinite(ownScore) && Number.isFinite(enemyScore)) {
      if (ownScore > enemyScore) result = 'win';
      if (ownScore < enemyScore) result = 'lose';
    }
  }

  let rankId = detectRankId(matchEntry.rank_id ?? matchEntry.rankId ?? null);
  let rank = normalizeText(matchEntry.rank || matchEntry.rank_name || matchEntry.rankName || '');
  if (rankId === null && Array.isArray(reservation.rankings)) {
    let playerRanking = null;
    if (playerIndex >= 0 && reservation.rankings[playerIndex]) {
      playerRanking = reservation.rankings[playerIndex];
    } else if (targetAccountId !== null) {
      playerRanking = reservation.rankings.find((item) => parseLongLikeInt(item?.account_id, NaN) === targetAccountId) || null;
    }
    if (playerRanking && typeof playerRanking === 'object') {
      rankId = detectRankId(playerRanking.rank_id ?? playerRanking.rankId ?? null);
      if (!rank) {
        rank = normalizeText(playerRanking.rank || playerRanking.rank_name || playerRanking.rankName || '');
      }
    }
  }

  return {
    map:
      normalizeMapCode(matchEntry.map || matchEntry.map_name || matchEntry.mapName || '') ||
      normalizeMapCode(finalRound.map || matchEntry?.watchablematchinfo?.game_map || '') ||
      normalizeText(matchEntry.map || matchEntry.map_name || matchEntry.mapName || '') ||
      normalizeText(finalRound.map || matchEntry?.watchablematchinfo?.game_map || ''),
    result,
    kills,
    deaths,
    assists,
    headshots,
    rank_id: rankId,
    rank,
  };
}

function normalizeGcMatchEntryForPlayer(matchEntry, steamId64, fallbackIndex = 0) {
  if (!matchEntry || typeof matchEntry !== 'object') return null;

  const resolvedFromRounds = resolveGcRoundStatsForPlayer(matchEntry, steamId64);
  const map =
    normalizeMapCode(
      matchEntry.map ||
        matchEntry.map_name ||
        matchEntry.mapName ||
        matchEntry?.watchablematchinfo?.game_map ||
        resolvedFromRounds?.map ||
        ''
    ) ||
    normalizeText(
      matchEntry.map ||
        matchEntry.map_name ||
        matchEntry.mapName ||
        matchEntry?.watchablematchinfo?.game_map ||
        resolvedFromRounds?.map ||
        ''
    );
  const playedAt =
    normalizePlayedAt(
      matchEntry.played_at ?? matchEntry.playedAt ?? matchEntry.matchtime ?? matchEntry.time ?? matchEntry.timestamp ?? null
    ) || null;

  const kills = Math.max(
    parseLongLikeInt(matchEntry.kills ?? matchEntry.kills_count ?? resolvedFromRounds?.kills ?? 0, 0),
    0
  );
  const deaths = Math.max(
    parseLongLikeInt(matchEntry.deaths ?? matchEntry.deaths_count ?? resolvedFromRounds?.deaths ?? 0, 0),
    0
  );
  const assists = Math.max(
    parseLongLikeInt(matchEntry.assists ?? matchEntry.assists_count ?? resolvedFromRounds?.assists ?? 0, 0),
    0
  );
  const headshots = Math.max(
    parseLongLikeInt(
      matchEntry.headshots ??
        matchEntry.headshot_kills ??
        matchEntry.hs_kills ??
        matchEntry.headshots_count ??
        resolvedFromRounds?.headshots ??
        0,
      0
    ),
    0
  );

  let rankId = detectRankId(matchEntry.rank_id ?? matchEntry.rankId ?? resolvedFromRounds?.rank_id ?? null);
  let rank = normalizeText(matchEntry.rank || matchEntry.rank_name || matchEntry.rankName || resolvedFromRounds?.rank || '');
  if (rankId !== null && !rank) {
    rank = rankName(rankId);
  }

  if (!map && !playedAt && kills === 0 && deaths === 0 && assists === 0) {
    return null;
  }

  const directId =
    normalizeText(normalizeLongLikeToString(matchEntry.matchid)) ||
    normalizeText(matchEntry.match_id || matchEntry.matchId || matchEntry.id || '');
  const matchId = directId || `gc_${fallbackIndex}_${hashString(`${map}|${playedAt}|${kills}|${deaths}|${assists}`)}`;

  return {
    id: matchId,
    played_at: playedAt,
    map,
    result:
      normalizeResult({
        result: matchEntry.result ?? matchEntry.match_result ?? resolvedFromRounds?.result,
        match_result: matchEntry.match_result,
        win: matchEntry.win,
      }) || 'draw',
    kills,
    deaths,
    assists,
    headshots,
    rank_id: rankId,
    rank,
  };
}

function normalizeGcMatchesForPlayer(payload, steamId64) {
  const rows = extractRecentMatchRows(payload);
  const normalized = [];
  const seenMatchIds = new Set();

  for (let index = 0; index < rows.length; index += 1) {
    const item = normalizeGcMatchEntryForPlayer(rows[index], steamId64, index);
    if (!item) continue;
    const stableId = buildStableMatchId(item);
    if (seenMatchIds.has(stableId)) continue;
    seenMatchIds.add(stableId);
    normalized.push({
      ...item,
      id: stableId,
    });
  }

  return normalized;
}

function requestGameByShareCode(shareCode) {
  if (!gcReady || !csgo || !csgo.haveGCSession) {
    return Promise.reject(new Error('Game Coordinator is not ready'));
  }

  return withTimeout(
    () =>
      new Promise((resolve, reject) => {
        csgo.once('matchList', (matches) => resolve(matches || []));
        try {
          csgo.requestGame(shareCode);
        } catch (err) {
          reject(err);
        }
      }),
    REQUEST_TIMEOUT_MS,
    'Timeout while waiting matchList (requestGame)'
  );
}

function httpsGetJson(url, timeoutMs = MATCH_HISTORY_REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const req = https.get(url, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if (settled) return;
        settled = true;

        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 240)}`));
          return;
        }

        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error(`Invalid JSON from ${url}: ${err?.message || err}`));
        }
      });
    });

    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`HTTPS timeout after ${timeoutMs}ms`));
    });
  });
}

async function fetchNextMatchSharingCode(steamId64, matchToken, knownCode) {
  const nextKnownCode = sanitizeShareCode(knownCode) || 'n/a';
  const url = new URL('https://api.steampowered.com/ICSGOPlayers_730/GetNextMatchSharingCode/v1/');
  url.searchParams.set('key', STEAM_WEB_API_KEY);
  url.searchParams.set('steamid', steamId64);
  url.searchParams.set('steamidkey', matchToken);
  url.searchParams.set('knowncode', nextKnownCode);

  const payload = await httpsGetJson(url.toString());
  const rawCode = normalizeText(payload?.result?.nextcode || payload?.nextcode || '');
  return sanitizeShareCode(rawCode);
}

async function fetchHistoricalMatchesByShareCodes(
  steamId64,
  matchToken,
  shareCodeCursor = '',
  seedShareCode = ''
) {
  const response = {
    enabled: false,
    fetched_share_codes: 0,
    matches: [],
    next_cursor: sanitizeShareCode(shareCodeCursor) || '',
    error: '',
  };

  const cleanedMatchToken = sanitizeMatchToken(matchToken);
  const cleanedSeedShareCode = sanitizeShareCode(seedShareCode);
  if (!cleanedMatchToken && !cleanedSeedShareCode) {
    return response;
  }
  response.enabled = true;

  if (cleanedSeedShareCode) {
    try {
      const seededGameMatches = await requestGameByShareCode(cleanedSeedShareCode);
      const seededNormalized = normalizeGcMatchesForPlayer(seededGameMatches, steamId64);
      for (let itemIndex = 0; itemIndex < seededNormalized.length; itemIndex += 1) {
        response.matches.push(seededNormalized[itemIndex]);
      }
      response.next_cursor = cleanedSeedShareCode;
      response.fetched_share_codes += 1;
    } catch (err) {
      response.error = err?.message || `Failed to load match by share code ${cleanedSeedShareCode}`;
      return response;
    }
  }

  if (!cleanedMatchToken) {
    return response;
  }

  if (!STEAM_WEB_API_KEY) {
    return response;
  }

  let knownCode = response.next_cursor || 'n/a';
  const seenShareCodes = new Set();
  const combinedMatches = [];

  const maxShareCodes = Math.max(parseIntSafe(MATCH_HISTORY_MAX_SHARE_CODES_PER_SYNC, 0), 0);
  for (let index = 0; index < maxShareCodes; index += 1) {
    let nextCode = '';
    try {
      nextCode = await fetchNextMatchSharingCode(steamId64, cleanedMatchToken, knownCode);
    } catch (err) {
      const rawError = String(err?.message || '').trim();
      if (/HTTP\s*403/i.test(rawError)) {
        response.error =
          'Steam API вернул 403 при запросе следующего match code. Проверьте CS2_STATS_STEAM_WEB_API_KEY и что указан корректный steamidkey (match token) для этого SteamID64.';
      } else {
        response.error = rawError || 'Failed to request next match sharing code';
      }
      break;
    }

    if (!nextCode) {
      if (index === 0 && knownCode === 'n/a') {
        response.error =
          'Steam API did not return next share code for this match token. Verify that you provided a valid steamidkey (match token) for this exact SteamID64.';
      }
      break;
    }
    if (nextCode === knownCode || seenShareCodes.has(nextCode)) {
      break;
    }
    seenShareCodes.add(nextCode);

    try {
      const fullGameMatches = await requestGameByShareCode(nextCode);
      const normalized = normalizeGcMatchesForPlayer(fullGameMatches, steamId64);
      for (let itemIndex = 0; itemIndex < normalized.length; itemIndex += 1) {
        combinedMatches.push(normalized[itemIndex]);
      }
    } catch (err) {
      response.error = err?.message || `Failed to load match by share code ${nextCode}`;
      break;
    }

    knownCode = nextCode;
    response.next_cursor = nextCode;
    response.fetched_share_codes += 1;
  }

  response.matches = combinedMatches;
  return response;
}

function extractPremierRating(value) {
  const parsed = parseIntSafe(value, NaN);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function extractPremierRatingFromObject(source) {
  if (!source || typeof source !== 'object') return null;
  return (
    extractPremierRating(source.premier_rating) ??
    extractPremierRating(source.premierRating) ??
    extractPremierRating(source.rating) ??
    extractPremierRating(source.elo) ??
    extractPremierRating(source.mmr) ??
    null
  );
}

function isPremierRanking(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const modeText = normalizeModeName(
    entry.mode ||
      entry.mode_name ||
      entry.modeName ||
      entry.rank_type ||
      entry.rank_type_name ||
      entry.rankType ||
      entry.rankTypeName ||
      entry.name ||
      ''
  );
  if (modeText.includes('premier')) return true;
  if (entry.is_premier === true || entry.premier === true) return true;
  return false;
}

function normalizeMapRankEntry(entry) {
  const rankId = detectRankId(entry?.rank_id ?? entry?.rankId ?? null);
  if (rankId === null) return null;

  const mapName = resolveMapFromRankingEntry(entry);
  if (!mapName) return null;
  const rankText = normalizeText(entry?.rank || entry?.rank_name || entry?.rankName || '');
  const wins = Math.max(
    parseIntSafe(entry?.wins ?? entry?.wins_count ?? entry?.win_count ?? entry?.winCount ?? 0, 0),
    0
  );
  const losses = Math.max(
    parseIntSafe(entry?.losses ?? entry?.losses_count ?? entry?.loss_count ?? entry?.lossCount ?? 0, 0),
    0
  );
  const explicitMatches = Math.max(
    parseIntSafe(entry?.matches ?? entry?.total_matches ?? entry?.totalMatches ?? entry?.games ?? 0, 0),
    0
  );
  const matches = Math.max(explicitMatches, wins + losses);
  const rawWinRate = entry?.win_rate ?? entry?.winRate ?? entry?.win_percent ?? entry?.winPercent ?? null;
  const computedWinRate =
    rawWinRate != null
      ? clamp(parseFloatSafe(rawWinRate, 0), 0, 100)
      : matches > 0
        ? clamp((wins / matches) * 100, 0, 100)
        : 0;
  return {
    map: mapName,
    rank_id: rankId,
    rank: rankText || rankName(rankId),
    wins,
    losses,
    matches,
    win_rate: Number(computedWinRate.toFixed(2)),
  };
}

function normalizePerMapRankEntries(entry) {
  const rows = Array.isArray(entry?.per_map_rank)
    ? entry.per_map_rank
    : Array.isArray(entry?.perMapRank)
      ? entry.perMapRank
      : [];
  if (!rows.length) return [];

  const normalized = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row || typeof row !== 'object') continue;

    const rankId = detectRankId(row.rank_id ?? row.rankId ?? null);
    if (rankId === null) continue;

    const mapName = resolveMapFromRankingEntry({
      ...entry,
      ...row,
      map_id: row.map_id ?? row.mapId ?? entry?.map_id ?? entry?.mapId ?? null,
    });
    if (!mapName) continue;

    const wins = Math.max(parseIntSafe(row.wins ?? row.wins_count ?? row.win_count ?? row.winCount ?? 0, 0), 0);
    normalized.push({
      map: mapName,
      rank_id: rankId,
      rank: rankName(rankId),
      wins,
      losses: 0,
      matches: wins,
      win_rate: wins > 0 ? 100 : 0,
    });
  }

  return normalized;
}

function extractRankings(profile) {
  if (!profile || typeof profile !== 'object') return [];
  if (Array.isArray(profile.rankings)) return profile.rankings;
  if (Array.isArray(profile.ranking)) return profile.ranking;
  if (profile.ranking && typeof profile.ranking === 'object') return [profile.ranking];
  return [];
}

function getSteamGuardPendingStatus() {
  if (!pendingSteamGuard) return null;
  return {
    source: pendingSteamGuard.source,
    domain: pendingSteamGuard.domain,
    requested_at: pendingSteamGuard.requested_at,
    expires_at: pendingSteamGuard.expires_at,
    last_code_wrong: pendingSteamGuard.last_code_wrong,
  };
}

function clearPendingSteamGuard(opts = {}) {
  const cancel = Boolean(opts.cancel);
  if (!pendingSteamGuard) return;

  const current = pendingSteamGuard;
  pendingSteamGuard = null;

  if (current.timer) {
    clearTimeout(current.timer);
  }

  if (cancel && typeof current.callback === 'function') {
    try {
      current.callback('');
    } catch (_) {
      // ignore callback errors
    }
  }
}

function registerSteamGuardRequest({ domain, callback, lastCodeWrong, isEmailGuard }) {
  clearPendingSteamGuard({ cancel: true });

  const timeoutMs = Math.max(STEAM_GUARD_MANUAL_TIMEOUT_MS, 30000);
  const requestedAtMs = Date.now();
  const state = {
    callback,
    source: isEmailGuard ? 'email' : '2fa',
    domain: isEmailGuard ? String(domain || '') : '',
    requested_at: new Date(requestedAtMs).toISOString(),
    expires_at: new Date(requestedAtMs + timeoutMs).toISOString(),
    last_code_wrong: Boolean(lastCodeWrong),
    timer: null,
  };

  state.timer = setTimeout(() => {
    if (pendingSteamGuard !== state) return;
    setLastError('Steam Guard code timed out before it was submitted');
    clearPendingSteamGuard({ cancel: true });
  }, timeoutMs);

  pendingSteamGuard = state;
}

function submitSteamGuardCode(code, source = 'manual') {
  if (!pendingSteamGuard) {
    throw new Error('Steam Guard code is not requested right now');
  }

  const normalizedCode = normalizeSteamGuardCode(code);
  if (!normalizedCode) {
    throw new Error('Steam Guard code must contain 5 letters/digits');
  }

  const current = pendingSteamGuard;
  if (current.timer) {
    clearTimeout(current.timer);
  }
  pendingSteamGuard = null;

  try {
    current.callback(normalizedCode);
  } catch (err) {
    throw new Error(`Failed to submit Steam Guard code: ${err?.message || err}`);
  }

  lastSubmittedSteamGuardCode = normalizedCode;
  lastSubmittedSteamGuardAt = Date.now();
  botState.last_error = null;
  console.log(`[steam] steamGuard code submitted (${source})`);
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
    steam_credentials_set: Boolean(STEAM_USERNAME && STEAM_PASSWORD),
    steam_2fa_secret_set: Boolean(STEAM_2FA_SECRET),
    steam_web_api_key_set: Boolean(STEAM_WEB_API_KEY),
    steam_guard_pending: getSteamGuardPendingStatus(),
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
  clearPendingSteamGuard({ cancel: true });

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

function isThrottleError(message, eresult) {
  const msg = String(message || '').toLowerCase();
  return (
    msg.includes('throttle') ||
    msg.includes('accountlogindeniedthrottle') ||
    msg.includes('too many') ||
    msg.includes('rate limit') ||
    Number(eresult) === 87
  );
}

function scheduleReconnect(reason, opts = {}) {
  if (reconnectTimer) return;
  const delay = opts.throttle ? RECONNECT_DELAY_THROTTLE_MS : RECONNECT_DELAY_MS;
  if (opts.throttle) {
    console.warn(`[steam] throttle/denied — следующая попытка входа через ${Math.round(delay / 60000)} мин`);
  }
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    await connectBot(`reconnect: ${reason || 'unknown'}`);
  }, delay);
}

function setLastError(message) {
  let text = message;
  if (isThrottleError(message)) {
    text += ' Подождите 5+ минут. Письмо с кодом приходит одно на попытку входа — не нажимайте переподключение.';
  }
  botState.last_error = `[${nowIso()}] ${text}`;
}

function setupSteamHandlers() {
  steamClient.on('steamGuard', (domain, callback, lastCodeWrong) => {
    const isEmailGuard = Boolean(domain);
    const guardSource = isEmailGuard ? `email (${domain})` : '2FA';
    console.warn(`[steam] steamGuard challenge detected: ${guardSource}`);

    if (lastCodeWrong) {
      console.warn('[steam] previous Steam Guard code was rejected');
      lastSubmittedSteamGuardCode = '';
      lastSubmittedSteamGuardAt = 0;
    }

    registerSteamGuardRequest({
      domain,
      callback,
      lastCodeWrong,
      isEmailGuard,
    });

    (async () => {
      try {
        let code = '';

        if (!isEmailGuard) {
          if (!STEAM_2FA_SECRET) {
            throw new Error('Steam Guard 2FA requested, but CS2_STATS_STEAM_2FA_SECRET is not configured');
          }
          code = SteamTotp.getAuthCode(STEAM_2FA_SECRET);
          submitSteamGuardCode(code, 'totp-auto');
          return;
        }

        if (!STEAM_EMAIL_GUARD_READY) {
          throw new Error(
            'Steam email guard requested, but IMAP auto-fetch is not configured. You can submit the code manually via POST /bot/steam-guard'
          );
        }

        code = await fetchSteamGuardCodeFromEmail();
        submitSteamGuardCode(code, 'email-auto');
      } catch (err) {
        const message = err?.message || 'Failed to resolve Steam Guard code automatically';
        setLastError(message);
        console.error('[steam] steamGuard auto-resolve error:', message);
      }
    })();
  });

  steamClient.on('loggedOn', () => {
    clearPendingSteamGuard();
    botState.logged_on = true;
    botState.last_error = null;
    steamClient.setPersona(SteamUser.EPersonaState.Offline);
    steamClient.gamesPlayed([730]);
    console.log('[steam] logged on');
  });

  steamClient.on('error', (err) => {
    clearPendingSteamGuard({ cancel: true });
    botState.logged_on = false;
    gcReady = false;
    botState.gc_ready = false;
    const message = err?.message || 'Steam error';
    setLastError(message);
    console.error('[steam] error:', message);
    const throttle = isThrottleError(message);
    scheduleReconnect('steam-error', { throttle });
  });

  steamClient.on('disconnected', (eresult, msg) => {
    clearPendingSteamGuard({ cancel: true });
    botState.logged_on = false;
    gcReady = false;
    botState.gc_ready = false;
    const reason = msg || `eresult=${eresult}`;
    setLastError(`Steam disconnected: ${reason}`);
    console.warn('[steam] disconnected:', reason);
    const throttle = isThrottleError(reason, eresult);
    scheduleReconnect('steam-disconnected', { throttle });
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
      throw new Error('Steam credentials are not set (CS2_STATS_STEAM_USERNAME / CS2_STATS_STEAM_PASSWORD)');
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
    const throttle = isThrottleError(message);
    scheduleReconnect('connect-failed', { throttle });
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
  const rankings = extractRankings(profile);
  const rawProfileRankId = detectRankId(profile?.rank_id ?? profile?.rankId ?? null);
  const mapRanksByName = new Map();
  const recentRows = extractRecentMatchRows(recentMatches);

  let premierRating =
    extractPremierRatingFromObject(profile?.premier) ??
    extractPremierRatingFromObject(profile?.cs_rating) ??
    extractPremierRatingFromObject(profile);
  let premierRankId = detectRankId(
    profile?.premier_rank_id ?? profile?.premierRankId ?? profile?.premier_rank ?? null
  );
  let premierRankText = normalizeText(profile?.premier_rank_name || profile?.premierRankName || '');

  for (let index = 0; index < rankings.length; index += 1) {
    const entry = rankings[index];
    const isPremier = isPremierRanking(entry);
    const entryRankId = detectRankId(entry?.rank_id ?? entry?.rankId ?? null);
    const entryRankText = normalizeText(entry?.rank || entry?.rank_name || entry?.rankName || '');
    const entryRating = extractPremierRatingFromObject(entry);

    if (isPremier) {
      if (premierRating === null && entryRating !== null) {
        premierRating = entryRating;
      }
      if (premierRankId === null && entryRankId !== null) {
        premierRankId = entryRankId;
      }
      if (!premierRankText && entryRankText) {
        premierRankText = entryRankText;
      }
      continue;
    }

    const perMapRanks = normalizePerMapRankEntries(entry);
    for (let mapIndex = 0; mapIndex < perMapRanks.length; mapIndex += 1) {
      const perMap = perMapRanks[mapIndex];
      const mapKey = normalizeText(perMap?.map || '').toLowerCase();
      if (!mapKey || mapRanksByName.has(mapKey)) continue;
      mapRanksByName.set(mapKey, perMap);
    }

    const normalizedMapRank = normalizeMapRankEntry(entry);
    if (!normalizedMapRank) {
      if (premierRating === null && entryRating !== null && !normalizeText(entry?.map || entry?.map_name)) {
        premierRating = entryRating;
      }
      continue;
    }

    const mapKey = normalizedMapRank.map.toLowerCase();
    if (!mapRanksByName.has(mapKey)) {
      mapRanksByName.set(mapKey, normalizedMapRank);
    }
  }

  if (premierRankId !== null && !premierRankText) {
    premierRankText = rankName(premierRankId);
  }
  const fallbackMapRank = [...mapRanksByName.values()].find((item) => item && item.rank_id != null) || null;
  const fallbackRankId = fallbackMapRank?.rank_id ?? premierRankId ?? rawProfileRankId ?? null;

  const mappedMatches = recentRows.map((item) => {
    const matchId = buildStableMatchId(item);
    const playedAt = normalizePlayedAt(item.played_at ?? item.time ?? item.timestamp ?? null) || null;

    const kills = parseIntSafe(item.kills ?? item.kills_count ?? item?.stats?.kills ?? 0, 0);
    const deaths = parseIntSafe(item.deaths ?? item.deaths_count ?? item?.stats?.deaths ?? 0, 0);
    const assists = parseIntSafe(item.assists ?? item.assists_count ?? item?.stats?.assists ?? 0, 0);

    const rawHeadshots =
      item.headshots ??
      item.headshot_kills ??
      item.hs_kills ??
      item.headshots_count ??
      item?.stats?.headshots ??
      item.hs ??
      0;
    const headshots = Math.max(0, parseIntSafe(rawHeadshots, 0));
    const safeHeadshots = kills > 0 ? Math.min(headshots, kills) : headshots;

    const rawHeadshotPercent =
      item.headshot_percent ??
      item.hs_percent ??
      item.headshots_percentage ??
      item.hs_percentage ??
      null;
    const computedHeadshotPercent =
      rawHeadshotPercent != null
        ? clamp(parseFloatSafe(rawHeadshotPercent, 0), 0, 100)
        : kills > 0
          ? clamp((safeHeadshots / kills) * 100, 0, 100)
          : 0;

    const matchRankId = detectRankId(item.rank_id ?? item.rankId ?? fallbackRankId);
    const matchRankText = normalizeText(item.rank || item.rank_name || item.rankName || '') || rankName(matchRankId);

    return {
      id: String(matchId),
      played_at: playedAt,
      map:
        normalizeMapCode(item.map_name || item.map || item.mapName || '') ||
        normalizeText(item.map_name || item.map || item.mapName || ''),
      result: normalizeResult(item),
      kills,
      deaths,
      assists,
      headshots: safeHeadshots,
      headshot_percent: Number(computedHeadshotPercent.toFixed(2)),
      rank_id: matchRankId,
      rank: matchRankText,
    };
  });

  const seenMatchIds = new Set();
  const matches = mappedMatches.filter((item) => {
    if (!item?.id) return false;
    if (seenMatchIds.has(item.id)) return false;
    seenMatchIds.add(item.id);
    return true;
  });

  const winsFromMatches = matches.reduce((acc, item) => acc + (item.result === 'win' ? 1 : 0), 0);
  const lossesFromMatches = matches.reduce((acc, item) => acc + (item.result === 'lose' ? 1 : 0), 0);
  const profileWins = parseIntSafe(profile?.wins, NaN);
  const profileLosses = parseIntSafe(profile?.losses, NaN);
  const profileTotalMatches = parseIntSafe(profile?.total_matches ?? profile?.totalMatches, NaN);
  const hasReliableProfileTotals =
    Number.isFinite(profileWins) &&
    Number.isFinite(profileLosses) &&
    Number.isFinite(profileTotalMatches) &&
    profileWins >= 0 &&
    profileLosses >= 0 &&
    profileTotalMatches > 0 &&
    profileWins + profileLosses <= profileTotalMatches + 2;

  const wins = hasReliableProfileTotals
    ? profileWins
    : matches.length > 0
      ? winsFromMatches
      : Math.max(Number.isFinite(profileWins) ? profileWins : 0, 0);
  const losses = hasReliableProfileTotals
    ? profileLosses
    : matches.length > 0
      ? lossesFromMatches
      : Math.max(Number.isFinite(profileLosses) ? profileLosses : 0, 0);

  const mapStatsByName = new Map();
  for (let index = 0; index < matches.length; index += 1) {
    const item = matches[index];
    const mapName = normalizeText(item?.map || '');
    if (!mapName) continue;

    const mapKey = mapName.toLowerCase();
    if (!mapStatsByName.has(mapKey)) {
      mapStatsByName.set(mapKey, { map: mapName, wins: 0, losses: 0, matches: 0 });
    }
    const agg = mapStatsByName.get(mapKey);
    agg.matches += 1;
    if (item.result === 'win') agg.wins += 1;
    if (item.result === 'lose') agg.losses += 1;
  }

  for (const [mapKey, agg] of mapStatsByName.entries()) {
    const existing = mapRanksByName.get(mapKey);
    if (!existing) {
      const winRate = agg.matches > 0 ? Number(((agg.wins / agg.matches) * 100).toFixed(2)) : 0;
      mapRanksByName.set(mapKey, {
        map: agg.map,
        rank_id: null,
        rank: '',
        wins: agg.wins,
        losses: agg.losses,
        matches: agg.matches,
        win_rate: winRate,
      });
      continue;
    }

    const mergedWins = Number(existing.wins || 0) > 0 ? Number(existing.wins || 0) : agg.wins;
    const mergedLosses = Number(existing.losses || 0) > 0 ? Number(existing.losses || 0) : agg.losses;
    const mergedMatches = Math.max(Number(existing.matches || 0), mergedWins + mergedLosses, agg.matches);
    const mergedWinRate =
      existing.win_rate != null
        ? Number(existing.win_rate)
        : mergedMatches > 0
          ? Number(((mergedWins / mergedMatches) * 100).toFixed(2))
          : 0;

    mapRanksByName.set(mapKey, {
      ...existing,
      wins: mergedWins,
      losses: mergedLosses,
      matches: mergedMatches,
      win_rate: Number(mergedWinRate.toFixed(2)),
    });
  }

  const totalMatches =
    hasReliableProfileTotals && Number.isFinite(profileTotalMatches)
      ? Math.max(profileTotalMatches, wins + losses)
      : matches.length > 0
        ? Math.max(matches.length, wins + losses)
        : Math.max(wins + losses, 0);

  const mapRanks = [...mapRanksByName.values()].sort((left, right) => left.map.localeCompare(right.map));
  const mainRank = mapRanks.find((item) => item && item.rank_id != null) || mapRanks[0] || null;
  const resolvedRankId = mainRank?.rank_id ?? premierRankId ?? rawProfileRankId ?? null;
  const resolvedRankName = normalizeText(mainRank?.rank || '') || rankName(resolvedRankId);

  return {
    rank_id: resolvedRankId,
    rank: resolvedRankName,
    premier_rating: premierRating,
    premier_rank_id: premierRankId,
    premier_rank: premierRankText || null,
    map_ranks: mapRanks,
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

app.post('/bot/steam-guard', requireToken, async (req, res) => {
  if (!pendingSteamGuard) {
    return res.status(409).json({
      error: 'Steam Guard code is not requested right now',
      bot: getBotStatus(),
    });
  }

  try {
    submitSteamGuardCode(req.body?.code || '', 'manual-api');
    return res.status(202).json({
      ok: true,
      detail: 'Steam Guard code submitted',
      bot: getBotStatus(),
    });
  } catch (err) {
    return res.status(400).json({
      error: err?.message || 'Failed to submit Steam Guard code',
      bot: getBotStatus(),
    });
  }
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
  const rawMatchToken = normalizeText(req.query?.match_token || req.headers['x-cs2-match-token'] || '');
  const seedShareCode = sanitizeShareCode(rawMatchToken);
  const matchToken = seedShareCode ? '' : sanitizeMatchToken(rawMatchToken);
  const shareCodeCursor = sanitizeShareCode(req.query?.share_code_cursor || '');
  const useHistorySync = Boolean(matchToken || seedShareCode);
  if (!/^\d{17}$/.test(steamId)) {
    return res.status(400).json({ error: 'Некорректный SteamID64 (ожидаются 17 цифр)' });
  }

  if (!useHistorySync) {
    const cached = getCached(steamId);
    if (cached) {
      return res.json({ ...cached, source: 'gc_cache' });
    }
  }

  if (!gcReady || !csgo || !csgo.haveGCSession) {
    return res.status(503).json({
      error: 'GC недоступен',
      detail: 'Steam-бот еще не подключен к Game Coordinator.',
      bot: getBotStatus(),
    });
  }

  try {
    let profile = {};
    let profileError = '';
    try {
      profile = await fetchPlayerProfile(steamId);
    } catch (err) {
      profileError = String(err?.message || '').trim();
    }

    const recentRawMatches = await fetchRecentGames(steamId).catch(() => []);
    const recentMatches = normalizeGcMatchesForPlayer(recentRawMatches, steamId);

    let historySync = {
      enabled: false,
      fetched_share_codes: 0,
      matches: [],
      next_cursor: shareCodeCursor,
      error: '',
    };
    if (useHistorySync) {
      historySync = await fetchHistoricalMatchesByShareCodes(steamId, matchToken, shareCodeCursor, seedShareCode);
    }

    const payload = toBackendFormat(profile, [...recentMatches, ...(historySync.matches || [])]);
    if (profileError) {
      const profileHint = `playersProfile is unavailable (${profileError}).`;
      payload.note = payload.note ? `${payload.note} ${profileHint}` : profileHint;
    }
    if (useHistorySync) {
      payload.history_mode = 'incremental';
      payload.history_enabled = true;
      payload.share_code_cursor = historySync.next_cursor || shareCodeCursor || '';
      payload.history_synced_share_codes = historySync.fetched_share_codes || 0;
      if (!historySync.error && (historySync.fetched_share_codes || 0) === 0 && recentMatches.length === 0) {
        const noDataHint =
          'No GC history entries were resolved for this player. Check that the SteamID64 is correct, the match token belongs to this account, and the bot account has access to player data.';
        payload.note = payload.note ? `${payload.note} ${noDataHint}` : noDataHint;
      }
      if (historySync.error) {
        const historyError = String(historySync.error).trim();
        payload.note = payload.note ? `${payload.note} ${historyError}` : historyError;
      }
    } else {
      payload.history_mode = 'snapshot';
      payload.history_enabled = false;
      payload.share_code_cursor = '';
      const historyHint =
        'Для истории CS2 укажите в профиле match token (steamidkey) или вставьте share code матча формата CSGO-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX.';
      payload.note = payload.note ? `${payload.note} ${historyHint}` : historyHint;
    }

    if (!useHistorySync) {
      setCached(steamId, payload);
    }
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
