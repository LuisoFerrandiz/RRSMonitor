#!/usr/bin/env node
/**
 * RRS Monitor — Backend API
 * Servidor HTTP nativo de Node.js en el puerto 3000 dentro del contenedor rrs-scheduler.
 * Sirve auth, config, kanban, schedule, users, backup (archive/reset/restore) y force-cleanup.
 *
 * Los datos estáticos (state.json, history.jsonl, changes.jsonl, cleanup-archive.jsonl)
 * los sirve nginx directamente; este servicio solo gestiona la lógica y los archivos
 * que requieren escritura segura (auth, config, kanban, schedule, users, backups).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const APP_DIR = path.join(__dirname, '..');

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const USERS_ACTIVITY_FILE = path.join(DATA_DIR, 'users-activity.jsonl');
const KANBAN_FILE = path.join(DATA_DIR, 'kanban.json');
const KANBAN_LABELS_FILE = path.join(DATA_DIR, 'kanban-labels.json');
const KANBAN_JUDGES_FILE = path.join(DATA_DIR, 'kanban-judges.json');
const KANBAN_ROLES_FILE = path.join(DATA_DIR, 'kanban-roles.json');
const SCHEDULE_FILE = path.join(DATA_DIR, 'schedule.json');
const MONITOR_CONFIG_FILE = path.join(DATA_DIR, 'monitor-config.json');
const VIEWER_FILE = path.join(DATA_DIR, 'viewer.html');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.jsonl');
const CHANGES_FILE = path.join(DATA_DIR, 'changes.jsonl');
const CLEANUP_ARCHIVE_FILE = path.join(DATA_DIR, 'cleanup-archive.jsonl');
const ENV_FILE = path.join(APP_DIR, '.env');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas
const sessions = new Map(); // token -> { username, expiresAt }

// Flags del .env gestionados desde el modal de Configuration
const CONFIG_FLAGS = [
  { envKey: 'DOCUMENTS', cfgKey: 'documentsEnabled' },
  { envKey: 'DECISIONS', cfgKey: 'decisionsEnabled' },
  { envKey: 'QUESTIONS', cfgKey: 'questionsEnabled' },
  { envKey: 'SCORINGENQUIRIES', cfgKey: 'scoringEnquiriesEnabled' },
  { envKey: 'CREWCHANGES', cfgKey: 'crewSubstitutionsEnabled' },
  { envKey: 'ONWATERPENALTIES', cfgKey: 'penaltiesEnabled' },
  { envKey: 'REPORTPENALTIES', cfgKey: 'penaltyReportsEnabled' },
  { envKey: 'RETIREMENTS', cfgKey: 'retirementsEnabled' },
  { envKey: 'SAILTIRESULTS', cfgKey: 'sailtiResultsEnabled' },
  { envKey: 'EQUIPMENTSUBSTITUTIONS', cfgKey: 'equipmentSubstitutionsEnabled' },
];

/* ------------------------------------------------------------------ */
/* Utilidades de fichero                                                */
/* ------------------------------------------------------------------ */

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function readFileSafe(file) {
  try {
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  } catch {
    return '';
  }
}

function writeFileSafe(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}

function readLines(file) {
  return readFileSafe(file)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l)
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter((l) => l !== null);
}

/* ------------------------------------------------------------------ */
/* Usuarios y sesiones                                                  */
/* ------------------------------------------------------------------ */

function loadUsers() {
  const data = readJson(USERS_FILE, { users: [] });
  return Array.isArray(data.users) ? data : { users: [] };
}

function saveUsers(users) {
  writeJson(USERS_FILE, users);
}

function getConfigured() {
  const users = loadUsers();
  return users.users.length > 0;
}

function findUser(username) {
  const users = loadUsers();
  const uname = String(username || '').toLowerCase();
  return users.users.find((u) => String(u.username || '').toLowerCase() === uname) || null;
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password || '')).digest('hex');
}

function verifyPassword(user, password) {
  // soporta contraseñas en claro o con hash sha256 (migración)
  return String(user.password) === String(password) ||
         String(user.passwordHash) === hashPassword(password);
}

function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function getSession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return s;
}

function destroySession(token) {
  if (token) sessions.delete(token);
}

function requireAuth(req, res) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const session = getSession(token);
  if (!session) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Not authenticated' }));
    return null;
  }
  return session;
}

function canManageUsers(session) {
  const user = findUser(session.username);
  return Boolean(user && user.role === 'admin');
}

function logUserActivity(username, action) {
  try {
    const line = JSON.stringify({
      username,
      action,
      ts: new Date().toISOString(),
    });
    fs.appendFileSync(USERS_ACTIVITY_FILE, line + '\n');
  } catch {
    /* noop */
  }
}

/* ------------------------------------------------------------------ */
/* Config                                                               */
/* ------------------------------------------------------------------ */

function loadMonitorConfig() {
  const cfg = readJson(MONITOR_CONFIG_FILE, {});
  if (cfg && Object.keys(cfg).length) return cfg;
  return null;
}

function loadEnv() {
  let txt = readFileSafe(ENV_FILE);
  // Strip BOM si existe (UTF-8 con BOM comienza con ﻿)
  if (txt.charCodeAt(0) === 0xFEFF) txt = txt.slice(1);
  const env = {};
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

function normalizeConfig(cfg) {
  const env = loadEnv();
  // El .env es la fuente única de verdad para eventId y flags/URLs.
  const eventId = String(env.RRS_EVENT_ID || cfg.eventId || '');
  const resolve = (tplKey, fallbackUrl) => {
    const tpl = env[tplKey];
    return tpl ? tpl.replace('{id_evento}', eventId) : (fallbackUrl || '').replace('{id_evento}', eventId);
  };
  const bool = (envKey, fallback) => (env[envKey] !== undefined ? env[envKey] === 'true' : !!fallback);
  return {
    eventId,
    targetUrl: resolve('RRS_URL', cfg.targetUrl),
    rrsOrigin: 'https://www.racingrulesofsailing.org',
    bannerImageUrl: cfg.bannerImageUrl || '/rrs-logo.png',
    eventTitle: env.RRS_EVENT_TITLE || cfg.eventTitle || '',
    eventLogoUrl: env.RRS_EVENT_LOGO_URL || cfg.eventLogoUrl || '',
    documentsEnabled: bool('DOCUMENTS', cfg.documentsEnabled),
    documentsUrl: resolve('RRS_DOCUMENTS_URL', cfg.documentsUrl),
    documentsSource: cfg.documentsSource || 'rrs',
    sailtiResultsEnabled: bool('SAILTIRESULTS', cfg.sailtiResultsEnabled),
    sailtiResultsUrl: cfg.sailtiResultsUrl || '',
    trackingEnabled: !!cfg.trackingEnabled,
    trackingUrl: cfg.trackingUrl || '',
    decisionsEnabled: bool('DECISIONS', cfg.decisionsEnabled !== false),
    decisionsUrl: resolve('RRS_DECISIONS_URL', cfg.decisionsUrl),
    questionsEnabled: bool('QUESTIONS', cfg.questionsEnabled),
    questionsUrl: resolve('RRS_QUESTIONS_URL', cfg.questionsUrl),
    scoringEnquiriesEnabled: bool('SCORINGENQUIRIES', cfg.scoringEnquiriesEnabled),
    scoringEnquiriesUrl: resolve('RRS_SCORINGENQUIRIES_URL', cfg.scoringEnquiriesUrl),
    crewSubstitutionsEnabled: bool('CREWCHANGES', cfg.crewSubstitutionsEnabled),
    crewChangesUrl: resolve('RRS_CREWCHANGES_URL', cfg.crewChangesUrl),
    equipmentSubstitutionsEnabled: bool('EQUIPMENTSUBSTITUTIONS', cfg.equipmentSubstitutionsEnabled),
    equipmentSubstitutionsUrl: resolve('RRS_EQUIPMENTSUBSTITUTIONS_URL', cfg.equipmentSubstitutionsUrl),
    penaltiesEnabled: bool('ONWATERPENALTIES', cfg.penaltiesEnabled),
    onWaterPenaltiesUrl: resolve('RRS_ONWATERPENALTIES_URL', cfg.onWaterPenaltiesUrl),
    penaltyReportsEnabled: bool('REPORTPENALTIES', cfg.penaltyReportsEnabled),
    penaltyReportsUrl: resolve('RRS_REPORTPENALTIES_URL', cfg.penaltyReportsUrl),
    retirementsEnabled: bool('RETIREMENTS', cfg.retirementsEnabled),
    retirementsUrl: resolve('RRS_RETIREMENTS_URL', cfg.retirementsUrl),
    reportTimeZone: cfg.reportTimeZone || 'Europe/Madrid',
    links: cfg.links || [
      {
        id: 'schedule', label: 'Event / Schedule', icon: 'fa-calendar-days',
        url: resolve('RRS_URL', ''), enabled: true,
      },
    ],
  };
}

function writeMonitorConfig(cfg) {
  writeJson(MONITOR_CONFIG_FILE, normalizeConfig(cfg));
}

function writeEnv(env) {
  let txt = readFileSafe(ENV_FILE);
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || value === null) continue;
    const re = new RegExp(`^${key}=.*$`, 'm');
    const line = `${key}=${value}`;
    if (re.test(txt)) txt = txt.replace(re, line);
    else txt += (txt.endsWith('\n') ? '' : '\n') + line;
  }
  writeFileSafe(ENV_FILE, txt);
}

/* ------------------------------------------------------------------ */
/* Archive (HTML autocontenido)                                         */
/* ------------------------------------------------------------------ */

function buildArchiveHtml() {
  const viewer = readFileSafe(VIEWER_FILE);
  if (!viewer) return null;

  const state = readJson(STATE_FILE, {});
  const schedule = readJson(SCHEDULE_FILE, { plans: [] });
  const kanban = readJson(KANBAN_FILE, { cards: {} });
  const monitorConfig = loadMonitorConfig() || {};
  const userCatalog = loadUsers();

  const archive = {
    version: 1,
    exportedAt: new Date().toISOString(),
    state: state.state || state,
    historyRaw: readFileSafe(HISTORY_FILE),
    changesRaw: readFileSafe(CHANGES_FILE),
    cleanupArchiveRaw: readFileSafe(CLEANUP_ARCHIVE_FILE),
    schedule,
    kanban: { cards: kanban.cards || {}, labelCatalog: readJson(KANBAN_LABELS_FILE, { labels: [] }), judgeCatalog: readJson(KANBAN_JUDGES_FILE, { judges: [] }), roleCatalog: readJson(KANBAN_ROLES_FILE, { roles: [] }) },
    monitorConfig,
    userCatalog,
  };

  const payload = JSON.stringify(archive).replace(/<\/script>/gi, '<\\/script>');
  const snippet = `<script>window.__RRS_ARCHIVE__ = ${payload};</script>`;

  // También marcamos el modo archivo para que el dashboard no llame a la API
  const injected = viewer.replace(/(<\/head>)/i, `${snippet}\n$1`);

  // Sustituir título si disponible
  const title = monitorConfig.eventTitle;
  const withTitle = title
    ? injected.replace(/(<title>)[^<]*(<\/title>)/i, `$1${title} — RRS Monitor$2`)
    : injected;

  return withTitle;
}

/* ------------------------------------------------------------------ */
/* Reset / Restore                                                      */
/* ------------------------------------------------------------------ */

function resetEventData() {
  const empty = '{}';
  writeFileSafe(stateBackupTarget(), currentSnapshot());
  writeFileSafe(HISTORY_FILE, '');
  writeFileSafe(CHANGES_FILE, '');
  writeFileSafe(STATE_FILE, empty);
  return true;
}

function currentSnapshot() {
  return JSON.stringify({
    state: readJson(STATE_FILE, {}),
    history: readLines(HISTORY_FILE),
    changes: readLines(CHANGES_FILE),
    schedule: readJson(SCHEDULE_FILE, null),
    kanban: readJson(KANBAN_FILE, null),
  }, null, 2);
}

function stateBackupTarget() {
  return path.join(DATA_DIR, `backup_${Date.now()}`, 'snapshot.json');
}

/* ------------------------------------------------------------------ */
/* JSON body helper                                                     */
/* ------------------------------------------------------------------ */

function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > limit) {
        tooBig = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooBig) return reject(new Error('Payload too large'));
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/* ------------------------------------------------------------------ */
/* Router                                                               */
/* ------------------------------------------------------------------ */

const router = {
  'POST /api/login': async (req, res) => {
    const body = await readBody(req, 1 * 1024 * 1024);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!username || !password) {
      return sendJson(res, 400, { ok: false, error: 'Username and password are required' });
    }
    const user = findUser(username);
    if (!user || !verifyPassword(user, password)) {
      return sendJson(res, 401, { ok: false, error: 'Incorrect username or password' });
    }
    const token = createSession(user.username);
    logUserActivity(user.username, 'login');
    sendJson(res, 200, {
      ok: true,
      token,
      username: user.username,
      canManageUsers: user.role === 'admin',
    });
  },

  'POST /api/logout': (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    destroySession(req.headers.authorization.slice(7));
    if (session.username) logUserActivity(session.username, 'logout');
    sendJson(res, 200, { ok: true });
  },

  'GET /api/auth/status': (req, res) => {
    const configured = getConfigured();
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const session = getSession(token);
    if (!configured) {
      return sendJson(res, 200, { configured: false, authenticated: false });
    }
    if (!session) {
      return sendJson(res, 200, { configured: true, authenticated: false });
    }
    const user = findUser(session.username);
    sendJson(res, 200, {
      configured: true,
      authenticated: true,
      username: session.username,
      canManageUsers: Boolean(user && user.role === 'admin'),
    });
  },

  'GET /api/config': (req, res) => {
    const cfg = normalizeConfig(loadMonitorConfig() || {});
    sendJson(res, 200, cfg);
  },

  'POST /api/config': async (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const body = await readBody(req);
    const prior = loadMonitorConfig() || {};

    // 1) Persistir eventId y flags XML en el .env (fuente única de verdad)
    const nextEnv = { RRS_EVENT_ID: body.eventId };
    CONFIG_FLAGS.forEach(({ envKey, cfgKey }) => {
      if (body[cfgKey] !== undefined) nextEnv[envKey] = body[cfgKey] ? 'true' : 'false';
    });
    writeEnv(nextEnv);

    // 2) Reconstruir el monitor-config desde el .env actualizado (URLs con el nuevo eventId)
    const merged = normalizeConfig(prior);
    writeMonitorConfig(merged);
    if (session.username) logUserActivity(session.username, 'config.update');
    sendJson(res, 200, { ok: true, config: merged });
  },

  'GET /api/kanban': (req, res) => {
    const kanban = readJson(KANBAN_FILE, { cards: {} });
    sendJson(res, 200, {
      kanban: { cards: kanban.cards || {} },
      labelCatalog: readJson(KANBAN_LABELS_FILE, { labels: [] }),
      judgeCatalog: readJson(KANBAN_JUDGES_FILE, { judges: [] }),
      roleCatalog: readJson(KANBAN_ROLES_FILE, { roles: [] }),
      userCatalog: loadUsers(),
    });
  },

  'PUT /api/kanban': async (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const body = await readBody(req);
    const cards = (body && body.cards) || (body && body.kanban && body.kanban.cards) || {};
    const prev = readJson(KANBAN_FILE, { cards: {} }).cards || {};

    // Validar transiciones de columna entre las 3 columnas principales del kanban interno.
    const MAIN_COLS = ['hearing_request', 'schedule', 'decided'];
    const VALID_TRANSITIONS = {
      hearing_request: ['schedule', 'decided'],
      schedule: ['decided'],
      decided: [],
    };
    for (const key of Object.keys(cards)) {
      const card = cards[key] || {};
      const newCol = card.column;
      const prevCard = prev[key] || {};
      const oldCol = prevCard.column || null;
      if (!oldCol || !newCol || oldCol === newCol) continue;
      if (!MAIN_COLS.includes(oldCol) || !MAIN_COLS.includes(newCol)) continue;
      if (!(VALID_TRANSITIONS[oldCol] || []).includes(newCol)) {
        return sendJson(res, 400, {
          ok: false,
          error: `Transición de columna inválida: "${oldCol}" -> "${newCol}" para el caso ${key}.`,
        });
      }
    }

    writeJson(KANBAN_FILE, { cards });
    if (session.username) logUserActivity(session.username, 'kanban.update');
    sendJson(res, 200, { ok: true });
  },

  'GET /api/kanban-labels': (req, res) => {
    sendJson(res, 200, readJson(KANBAN_LABELS_FILE, { labels: [] }));
  },

  'POST /api/kanban-labels': async (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const body = await readBody(req);
    const store = readJson(KANBAN_LABELS_FILE, { labels: [] });
    const label = {
      id: body.id || `lbl_${Date.now()}`,
      name: body.name || '',
      color: body.color || '#64748b',
    };
    store.labels = store.labels || [];
    store.labels.push(label);
    writeJson(KANBAN_LABELS_FILE, store);
    sendJson(res, 200, { ok: true, label });
  },

  'DELETE /api/kanban-labels': (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const id = decodeURIComponent(String(req.url.split('id=')[1] || '').split('&')[0] || '');
    const store = readJson(KANBAN_LABELS_FILE, { labels: [] });
    store.labels = (store.labels || []).filter((l) => String(l.id) !== id);
    writeJson(KANBAN_LABELS_FILE, store);
    sendJson(res, 200, { ok: true });
  },

  'GET /api/kanban-judges': (req, res) => {
    sendJson(res, 200, readJson(KANBAN_JUDGES_FILE, { judges: [] }));
  },

  'POST /api/kanban-judges': async (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const body = await readBody(req);
    const store = readJson(KANBAN_JUDGES_FILE, { judges: [] });
    const judge = { id: body.id || `judge_${Date.now()}`, name: body.name || '' };
    store.judges = store.judges || [];
    store.judges.push(judge);
    writeJson(KANBAN_JUDGES_FILE, store);
    sendJson(res, 200, { ok: true, judge });
  },

  'DELETE /api/kanban-judges': (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const id = decodeURIComponent(String(req.url.split('id=')[1] || '').split('&')[0] || '');
    const store = readJson(KANBAN_JUDGES_FILE, { judges: [] });
    store.judges = (store.judges || []).filter((j) => String(j.id) !== id);
    writeJson(KANBAN_JUDGES_FILE, store);
    sendJson(res, 200, { ok: true });
  },

  'GET /api/kanban-roles': (req, res) => {
    sendJson(res, 200, readJson(KANBAN_ROLES_FILE, { roles: [] }));
  },

  'POST /api/kanban-roles': async (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const body = await readBody(req);
    const store = readJson(KANBAN_ROLES_FILE, { roles: [] });
    const role = { id: body.id || `role_${Date.now()}`, name: body.name || '' };
    store.roles = store.roles || [];
    store.roles.push(role);
    writeJson(KANBAN_ROLES_FILE, store);
    sendJson(res, 200, { ok: true, role });
  },

  'DELETE /api/kanban-roles': (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const id = decodeURIComponent(String(req.url.split('id=')[1] || '').split('&')[0] || '');
    const store = readJson(KANBAN_ROLES_FILE, { roles: [] });
    store.roles = (store.roles || []).filter((r) => String(r.id) !== id);
    writeJson(KANBAN_ROLES_FILE, store);
    sendJson(res, 200, { ok: true });
  },

  'GET /api/schedule': (req, res) => {
    const schedule = readJson(SCHEDULE_FILE, { plans: [] });
    sendJson(res, 200, { ok: true, schedule });
  },

  'POST /api/schedule': async (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const body = await readBody(req);
    if (!body || !Array.isArray(body.plans)) {
      return sendJson(res, 400, { ok: false, error: 'Invalid schedule payload' });
    }
    writeJson(SCHEDULE_FILE, body);
    if (session.username) logUserActivity(session.username, 'schedule.update');
    sendJson(res, 200, { ok: true, schedule: body });
  },

  'GET /api/users': (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const users = loadUsers();
    // Nunca exponer contraseñas
    const safe = users.users.map(({ password, passwordHash, ...rest }) => rest);
    sendJson(res, 200, { users: safe });
  },

  'POST /api/users': async (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    if (!canManageUsers(session)) {
      return sendJson(res, 403, { ok: false, error: 'No permission to manage users' });
    }
    const body = await readBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const role = body.role === 'admin' ? 'admin' : 'user';
    if (!username || !password) {
      return sendJson(res, 400, { ok: false, error: 'Username and password are required' });
    }
    const users = loadUsers();
    if (findUser(username)) {
      return sendJson(res, 409, { ok: false, error: 'Username already exists' });
    }
    const user = { username, role, createdAt: new Date().toISOString() };
    // Contraseña en claro (configuración indicada por el usuario)
    user.password = password;
    users.users.push(user);
    saveUsers(users);
    logUserActivity(session.username, `user.create:${username}`);
    sendJson(res, 200, { ok: true, user: { username, role } });
  },

  'DELETE /api/users': (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    if (!canManageUsers(session)) {
      return sendJson(res, 403, { ok: false, error: 'No permission to manage users' });
    }
    const username = decodeURIComponent(String(req.url.split('username=')[1] || '').split('&')[0] || '');
    if (!username) return sendJson(res, 400, { ok: false, error: 'username required' });
    const users = loadUsers();
    const target = findUser(username);
    if (!target) return sendJson(res, 404, { ok: false, error: 'User not found' });
    if (username === session.username) {
      return sendJson(res, 400, { ok: false, error: 'Cannot delete the current user' });
    }
    users.users = users.users.filter((u) => String(u.username).toLowerCase() !== username.toLowerCase());
    saveUsers(users);
    logUserActivity(session.username, `user.delete:${username}`);
    sendJson(res, 200, { ok: true });
  },

  'GET /api/users/activity': (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const url = new URL(req.url, 'http://x');
    const username = (url.searchParams.get('username') || '').toLowerCase();
    const lines = readLines(USERS_ACTIVITY_FILE);
    const filtered = username ? lines.filter((l) => String(l.username || '').toLowerCase() === username) : lines;
    sendJson(res, 200, { ok: true, activity: filtered.reverse() });
  },

  'GET /api/archive': (req, res) => {
    const html = buildArchiveHtml();
    if (!html) {
      return sendJson(res, 500, { ok: false, error: 'viewer.html not found' });
    }
    const filename = `RRSMonitor_${Date.now()}.html`;
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.end(html);
  },

  'POST /api/reset': (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    resetEventData();
    if (session.username) logUserActivity(session.username, 'reset');
    sendJson(res, 200, { ok: true });
  },

  'POST /api/restore': async (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    const body = await readBody(req);
    if (!body || (body.state === undefined && body.history === undefined && body.events === undefined)) {
      return sendJson(res, 400, { ok: false, error: 'Invalid restore bundle' });
    }
    if (body.state !== undefined) writeJson(STATE_FILE, typeof body.state === 'string' ? JSON.parse(body.state) : body.state);
    if (body.history !== undefined) {
      const history = Array.isArray(body.history)
        ? body.history.map((l) => JSON.stringify(l)).join('\n') + '\n'
        : String(body.history || '');
      writeFileSafe(HISTORY_FILE, history);
    }
    if (body.changes !== undefined) {
      const changes = Array.isArray(body.changes)
        ? body.changes.map((l) => JSON.stringify(l)).join('\n') + '\n'
        : String(body.changes || '');
      writeFileSafe(CHANGES_FILE, changes);
    }
    if (body.schedule !== undefined && body.schedule.plans) writeJson(SCHEDULE_FILE, body.schedule);
    if (body.kanban !== undefined) writeJson(KANBAN_FILE, body.kanban);
    if (session.username) logUserActivity(session.username, 'restore');
    sendJson(res, 200, { ok: true });
  },

  'POST /api/force-cleanup': (req, res) => {
    const session = requireAuth(req, res);
    if (!session) return;
    try {
      const cleanupPath = path.join(APP_DIR, 'cleanup.js');
      if (fs.existsSync(cleanupPath)) {
        const { execFileSync } = require('child_process');
        execFileSync('node', [cleanupPath], { cwd: APP_DIR, timeout: 60000 });
      }
    } catch {
      /* noop */
    }
    sendJson(res, 200, { ok: true });
  },

  'GET /api/sailti-results-embed': (req, res) => {
    sendJson(res, 200, {
      ok: true,
      embedUrl: loadMonitorConfig()?.sailtiResultsUrl || '',
    });
  },
};

/* ------------------------------------------------------------------ */
/* Servidor                                                            */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  const method = (req.method || 'GET').toUpperCase();
  const url = new URL(req.url, 'http://x');
  const cleanPath = url.pathname.replace(/\/+$/, '') || '/';
  const key = `${method} ${cleanPath}`;

  // CORS para peticiones del mismo origen (nginx proxy)
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const handler = router[key];
  if (!handler) {
    return sendJson(res, 404, { ok: false, error: 'Not found' });
  }

  try {
    await handler(req, res, url);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message || 'Internal error' });
  }
});

server.listen(PORT, () => {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log(`[rrs-api] listening on :${PORT}`);
});
