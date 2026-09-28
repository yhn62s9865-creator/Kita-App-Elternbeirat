'use strict';

// Kita-App für Eltern und Elternbeirat, ohne externe Abhängigkeiten.
// - Notbetreuung: Eltern melden ihr Kind an Engpass-Tagen an (braucht Betreuung)
//   oder ab (bleibt freiwillig zuhause).
// - Listen: Anmeldungen für Elternabende, Feste usw. und Helferlisten
//   (z. B. „Kuchen backen“, „Aufbau 14–15 Uhr“).
// Kita-Leitung / Elternbeirat legt beides an und lädt die Listen als Excel herunter.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildXlsx } = require('./xlsx');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

// ---------- Speicher ----------

function createStore(file) {
  let data = {};
  if (file && fs.existsSync(file)) {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  // Ältere Datendateien kennen noch nicht alle Bereiche
  for (const key of ['days', 'entries', 'lists', 'signups']) data[key] ||= [];
  return {
    data,
    save() {
      if (!file) return;
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, file);
    },
  };
}

// ---------- Fachlogik ----------

const id = () => crypto.randomBytes(8).toString('hex');
const token = () => crypto.randomBytes(18).toString('base64url');

function isoDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

function cleanText(s, max) {
  return typeof s === 'string' ? s.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

// Wer Betreuung braucht, bekommt in Reihenfolge der Anmeldung einen Platz;
// alle weiteren landen auf der Warteliste und rücken bei Absagen automatisch nach.
function entriesWithStatus(data, day) {
  const list = data.entries
    .filter((e) => e.dayId === day.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let used = 0;
  return list.map((e) => {
    let status = 'home';
    if (e.type === 'need') {
      status = used < day.slots ? 'confirmed' : 'waitlist';
      used++;
    }
    return { ...e, status };
  });
}

function daySummary(data, day, now = new Date()) {
  const entries = entriesWithStatus(data, day);
  const count = (s) => entries.filter((e) => e.status === s).length;
  return {
    id: day.id,
    date: day.date,
    slots: day.slots,
    note: day.note,
    deadline: day.deadline,
    closed: day.closed || isPastDeadline(day, now),
    confirmed: count('confirmed'),
    waitlist: count('waitlist'),
    home: count('home'),
  };
}

// Anmeldeschluss prüfen: leer = keiner; in der Vergangenheit ist fast immer ein Versehen
// (z. B. hat der Kalender-Knopf die aktuelle Uhrzeit eingetragen).
function parseDeadline(value, now) {
  if (value === undefined || value === null || value === '') return null;
  if (isNaN(Date.parse(value))) throw new HttpError(400, 'Ungültiger Anmeldeschluss');
  const d = new Date(value);
  if (d <= now) {
    throw new HttpError(400, 'Der Anmeldeschluss liegt in der Vergangenheit. Bitte eine spätere Zeit wählen oder das Feld leer lassen.');
  }
  return d.toISOString();
}

// Öffnen/Schließen und Anmeldeschluss ändern (für Engpass-Tage und Listen gleich).
// Wer „Wieder öffnen“ drückt, will, dass Eltern sich eintragen können – ein bereits
// abgelaufener Anmeldeschluss wird dabei entfernt.
function applyOpenClose(target, body, now) {
  if (body.deadline !== undefined) target.deadline = parseDeadline(body.deadline, now);
  if (body.closed !== undefined) {
    target.closed = Boolean(body.closed);
    if (!target.closed && isPastDeadline(target, now)) target.deadline = null;
  }
}

function isPastDeadline(day, now = new Date()) {
  return Boolean(day.deadline) && new Date(day.deadline) < now;
}

function publicEntry(e) {
  return { id: e.id, dayId: e.dayId, child: e.child, group: e.group, type: e.type, status: e.status };
}

// Kalendertag in Deutschland (sonst wäre zwischen 0 und 2 Uhr noch „gestern“)
function berlinDate(now) {
  return now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
}

function upcomingDays(data, now = new Date()) {
  const today = berlinDate(now);
  return data.days.filter((d) => d.date >= today).sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- Listen (Elternabend, Feste, Helfer) ----------

const LIST_KINDS = { event: 'Anmeldung', helper: 'Helferliste' };

function listSummary(data, list, now = new Date(), { admin = false } = {}) {
  const signups = data.signups
    .filter((s) => s.listId === list.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const items = list.items.map((item) => {
    const mine = signups.filter((s) => s.itemId === item.id);
    const taken = mine.reduce((n, s) => n + s.persons, 0);
    const out = { id: item.id, label: item.label, capacity: item.capacity, taken };
    if (admin) out.signups = mine.map(publicSignup);
    else if (list.showNames) out.names = mine.map((s) => s.name);
    return out;
  });
  return {
    id: list.id,
    kind: list.kind,
    title: list.title,
    date: list.date,
    time: list.time,
    location: list.location,
    description: list.description,
    deadline: list.deadline,
    showNames: list.showNames,
    closed: list.closed || isPastDeadline(list, now),
    ...(admin && { manuallyClosed: Boolean(list.closed) }),
    items,
  };
}

function publicSignup(s) {
  return { id: s.id, listId: s.listId, itemId: s.itemId, name: s.name, persons: s.persons, comment: s.comment, createdAt: s.createdAt };
}

function sortLists(lists) {
  // Listen mit Datum chronologisch, Listen ohne Datum ans Ende
  return [...lists].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.createdAt.localeCompare(b.createdAt));
}

// Zeilen wie „Kuchen backen | 8“ → { label: 'Kuchen backen', capacity: 8 }
function parseItems(raw) {
  const lines = Array.isArray(raw) ? raw : String(raw || '').split('\n');
  return lines
    .map((l) => (typeof l === 'string' ? l : `${l.label ?? ''}|${l.capacity ?? ''}`))
    .map((l) => {
      const [label, cap] = l.split('|');
      const capacity = cap && cap.trim() ? Number(cap.trim()) : null;
      return { label: cleanText(label, 100), capacity };
    })
    .filter((i) => i.label);
}

function validCapacity(c) {
  return c === null || (Number.isInteger(c) && c > 0 && c <= 1000);
}

// ---------- Excel-Export ----------

function deDate(iso) {
  if (!iso) return '';
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

function deDateTime(iso) {
  return iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Berlin' }) : '';
}

const STATUS_DE = { confirmed: 'Platz bestätigt', waitlist: 'Warteliste', home: 'bleibt zuhause' };

function dayWorkbook(data, day) {
  const entries = entriesWithStatus(data, day);
  const s = daySummary(data, day);
  const rows = [
    [`Notbetreuung ${deDate(day.date)}`],
    [`${s.confirmed} von ${s.slots} Plätzen belegt · ${s.waitlist} auf der Warteliste · ${s.home} bleiben zuhause`],
    [],
    ['Nr.', 'Kind', 'Gruppe', 'Status', 'Eingetragen am'],
    ...entries.map((e, i) => [i + 1, e.child, e.group, STATUS_DE[e.status], deDateTime(e.createdAt)]),
  ];
  return buildXlsx([{ name: `Notbetreuung ${day.date}`, rows, titleRows: 1, headerRow: 3 }]);
}

function listWorkbook(data, list) {
  const summary = listSummary(data, list, new Date(), { admin: true });
  const info = [list.date && deDate(list.date), list.time, list.location].filter(Boolean).join(' · ');
  const intro = [[list.title], ...(info ? [[info]] : []), []];
  const headerRow = intro.length;
  let rows;
  if (list.kind === 'event') {
    const item = summary.items[0];
    rows = [
      ...intro,
      ['Nr.', 'Name', 'Personen', 'Bemerkung', 'Eingetragen am'],
      ...item.signups.map((s, i) => [i + 1, s.name, s.persons, s.comment, deDateTime(s.createdAt)]),
      [],
      ['', 'Summe', item.taken, item.capacity ? `von ${item.capacity} Plätzen` : ''],
    ];
  } else {
    rows = [...intro, ['Aufgabe', 'Name', 'Bemerkung', 'Eingetragen am']];
    for (const item of summary.items) {
      const status = item.capacity ? `${item.taken}/${item.capacity}` : `${item.taken}`;
      if (!item.signups.length) rows.push([`${item.label} (${status})`, '– noch offen –']);
      item.signups.forEach((s) => rows.push([`${item.label} (${status})`, s.name, s.comment, deDateTime(s.createdAt)]));
    }
  }
  return buildXlsx([{ name: list.title, rows, titleRows: 1, headerRow }]);
}

function fileName(s) {
  return s.replace(/[^\wäöüÄÖÜß -]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'liste';
}

// ---------- HTTP ----------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

class FileResponse {
  constructor(name, buffer) {
    this.name = name;
    this.buffer = buffer;
  }
}

function sendXlsx(res, file) {
  res.writeHead(200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${file.name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    'Cache-Control': 'no-store',
  });
  res.end(file.buffer);
}

// Schutz gegen Einbetten in fremde Seiten, nachgeladene fremde Skripte usw.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) throw new HttpError(413, 'Anfrage zu groß');
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Ungültiges JSON');
  }
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function serveStatic(req, res) {
  let p;
  try {
    p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Ungültige Adresse');
  }
  if (p === '/') p = '/index.html';
  if (p === '/admin') p = '/admin.html';
  const file = path.join(PUBLIC_DIR, path.normalize(p));
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Nicht gefunden');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

// Absender-Adresse. Hinter einem Reverse Proxy (z. B. auf der NAS) kommen alle Anfragen
// vom Proxy; die echte Adresse hängt dieser hinten an X-Forwarded-For an.
// trustProxy: true = jedem Absender glauben (App nur lokal erreichbar, z. B. Docker),
// oder die IP-Adresse des Proxys = nur Anfragen von dort glauben (z. B. NAS → Raspberry Pi).
function clientIp(req, trustProxy) {
  const remote = String(req.socket.remoteAddress || 'unbekannt').replace(/^::ffff:/, '');
  if (trustProxy === true || (typeof trustProxy === 'string' && trustProxy === remote)) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (xff.length) return xff[xff.length - 1];
  }
  return remote;
}

// Nach zu vielen falschen Codes wird eine Adresse eine Weile gesperrt,
// damit niemand die Codes einfach durchprobieren kann.
function createLoginGuard({ maxFails = 10, windowMs = 15 * 60 * 1000, now }) {
  const fails = new Map(); // ip -> { count, since }
  return {
    check(ip) {
      const f = fails.get(ip);
      if (f && now() - f.since > windowMs) fails.delete(ip);
      else if (f && f.count >= maxFails) {
        throw new HttpError(429, 'Zu viele falsche Versuche. Bitte in 15 Minuten erneut probieren.');
      }
    },
    fail(ip) {
      const f = fails.get(ip);
      if (!f || now() - f.since > windowMs) fails.set(ip, { count: 1, since: now() });
      else if (++f.count === maxFails) {
        console.warn(`${new Date().toISOString()} Zu viele falsche Codes von ${ip} – für 15 Minuten gesperrt.`);
      }
      if (fails.size > 10000) fails.clear(); // Speicher begrenzen
    },
  };
}

function createApp({ parentCode, adminCode, dataFile, trustProxy = false, now = () => new Date() }) {
  if (!parentCode || !adminCode) throw new Error('parentCode und adminCode müssen gesetzt sein');
  const store = createStore(dataFile);
  const { data } = store;
  const guard = createLoginGuard({ now: () => now().getTime() });

  const checkCode = (req, header, allowed, message) => {
    const ip = clientIp(req, trustProxy);
    guard.check(ip);
    const code = req.headers[header] || '';
    if (!allowed.some((c) => safeEqual(code, c))) {
      guard.fail(ip);
      throw new HttpError(401, message);
    }
  };
  const requireParent = (req) => checkCode(req, 'x-kita-code', [parentCode, adminCode], 'Falscher Kita-Code');
  const requireAdmin = (req) => checkCode(req, 'x-admin-code', [adminCode], 'Falscher Admin-Code');
  const findList = (listId) => {
    const list = data.lists.find((l) => l.id === listId);
    if (!list) throw new HttpError(404, 'Liste nicht gefunden');
    return list;
  };
  const findDay = (dayId) => {
    const day = data.days.find((d) => d.id === dayId);
    if (!day) throw new HttpError(404, 'Tag nicht gefunden');
    return day;
  };

  const routes = [
    // --- Eltern ---
    ['POST', /^\/api\/login$/, (req) => {
      requireParent(req);
      return { ok: true };
    }],
    ['GET', /^\/api\/days$/, (req) => {
      requireParent(req);
      return upcomingDays(data, now()).map((d) => daySummary(data, d, now()));
    }],
    ['POST', /^\/api\/days\/([\w-]+)\/entries$/, async (req, [dayId]) => {
      requireParent(req);
      const day = findDay(dayId);
      if (day.closed || isPastDeadline(day, now())) throw new HttpError(409, 'Die Anmeldung für diesen Tag ist geschlossen');
      const body = await readJson(req);
      const child = cleanText(body.child, 60);
      const group = cleanText(body.group, 40);
      if (!child) throw new HttpError(400, 'Bitte den Namen des Kindes angeben');
      if (body.type !== 'need' && body.type !== 'home') throw new HttpError(400, 'Ungültige Auswahl');
      const dup = data.entries.find(
        (e) => e.dayId === day.id && e.child.toLowerCase() === child.toLowerCase() && e.group.toLowerCase() === group.toLowerCase(),
      );
      if (dup) throw new HttpError(409, `${child} ist für diesen Tag bereits eingetragen`);
      const entry = { id: id(), dayId: day.id, child, group, type: body.type, editToken: token(), createdAt: now().toISOString() };
      data.entries.push(entry);
      store.save();
      const withStatus = entriesWithStatus(data, day).find((e) => e.id === entry.id);
      return { entry: publicEntry(withStatus), editToken: entry.editToken };
    }],
    // Eltern sehen nur ihre eigenen Einträge (über die geheimen Bearbeitungs-Tokens).
    ['POST', /^\/api\/my-entries$/, async (req) => {
      requireParent(req);
      const body = await readJson(req);
      const tokens = new Set(Array.isArray(body.tokens) ? body.tokens.slice(0, 200) : []);
      const result = [];
      for (const day of data.days) {
        for (const e of entriesWithStatus(data, day)) {
          if (tokens.has(e.editToken)) result.push({ ...publicEntry(e), editToken: e.editToken });
        }
      }
      return result;
    }],
    ['DELETE', /^\/api\/entries\/([\w-]+)$/, (req, [entryId]) => {
      requireParent(req);
      const idx = data.entries.findIndex((e) => e.id === entryId);
      if (idx === -1) throw new HttpError(404, 'Eintrag nicht gefunden');
      if (!safeEqual(req.headers['x-edit-token'] || '', data.entries[idx].editToken)) {
        throw new HttpError(403, 'Keine Berechtigung für diesen Eintrag');
      }
      const day = findDay(data.entries[idx].dayId);
      if (day.closed || isPastDeadline(day, now())) throw new HttpError(409, 'Die Anmeldung für diesen Tag ist geschlossen');
      data.entries.splice(idx, 1);
      store.save();
      return { ok: true };
    }],

    ['GET', /^\/api\/lists$/, (req) => {
      requireParent(req);
      const today = berlinDate(now());
      return sortLists(data.lists.filter((l) => !l.date || l.date >= today)).map((l) => listSummary(data, l, now()));
    }],
    ['POST', /^\/api\/lists\/([\w-]+)\/signups$/, async (req, [listId]) => {
      requireParent(req);
      const list = findList(listId);
      if (list.closed || isPastDeadline(list, now())) throw new HttpError(409, 'Die Anmeldung für diese Liste ist geschlossen');
      const body = await readJson(req);
      const item = list.items.find((i) => i.id === body.itemId);
      if (!item) throw new HttpError(400, 'Bitte eine Aufgabe auswählen');
      const name = cleanText(body.name, 80);
      if (!name) throw new HttpError(400, 'Bitte deinen Namen angeben');
      const persons = list.kind === 'event' ? Number(body.persons ?? 1) : 1;
      if (!Number.isInteger(persons) || persons < 1 || persons > 20) throw new HttpError(400, 'Anzahl Personen muss zwischen 1 und 20 liegen');
      const existing = data.signups.filter((s) => s.itemId === item.id);
      if (existing.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
        throw new HttpError(409, `${name} ist hier bereits eingetragen`);
      }
      const taken = existing.reduce((n, s) => n + s.persons, 0);
      if (item.capacity && taken + persons > item.capacity) {
        const left = item.capacity - taken;
        throw new HttpError(409, left > 0 ? `Es sind nur noch ${left} Plätze frei` : 'Leider schon voll');
      }
      const signup = {
        id: id(), listId: list.id, itemId: item.id, name, persons,
        comment: cleanText(body.comment, 200), editToken: token(), createdAt: now().toISOString(),
      };
      data.signups.push(signup);
      store.save();
      return { signup: publicSignup(signup), editToken: signup.editToken };
    }],
    ['POST', /^\/api\/my-signups$/, async (req) => {
      requireParent(req);
      const body = await readJson(req);
      const tokens = new Set(Array.isArray(body.tokens) ? body.tokens.slice(0, 200) : []);
      return data.signups.filter((s) => tokens.has(s.editToken)).map((s) => ({ ...publicSignup(s), editToken: s.editToken }));
    }],
    ['DELETE', /^\/api\/signups\/([\w-]+)$/, (req, [signupId]) => {
      requireParent(req);
      const idx = data.signups.findIndex((s) => s.id === signupId);
      if (idx === -1) throw new HttpError(404, 'Eintrag nicht gefunden');
      if (!safeEqual(req.headers['x-edit-token'] || '', data.signups[idx].editToken)) {
        throw new HttpError(403, 'Keine Berechtigung für diesen Eintrag');
      }
      const list = findList(data.signups[idx].listId);
      if (list.closed || isPastDeadline(list, now())) throw new HttpError(409, 'Die Anmeldung für diese Liste ist geschlossen');
      data.signups.splice(idx, 1);
      store.save();
      return { ok: true };
    }],

    // --- Kita-Leitung / Elternbeirat ---
    ['POST', /^\/api\/admin\/login$/, (req) => {
      requireAdmin(req);
      return { ok: true };
    }],
    ['GET', /^\/api\/admin\/days$/, (req) => {
      requireAdmin(req);
      return [...data.days]
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((d) => ({ ...daySummary(data, d, now()), manuallyClosed: Boolean(d.closed) }));
    }],
    ['POST', /^\/api\/admin\/days$/, async (req) => {
      requireAdmin(req);
      const body = await readJson(req);
      if (!isoDate(body.date)) throw new HttpError(400, 'Bitte ein gültiges Datum angeben');
      const slots = Number(body.slots);
      if (!Number.isInteger(slots) || slots < 0 || slots > 500) throw new HttpError(400, 'Plätze müssen eine Zahl zwischen 0 und 500 sein');
      if (data.days.some((d) => d.date === body.date)) throw new HttpError(409, 'Für dieses Datum gibt es schon einen Eintrag');
      const deadline = parseDeadline(body.deadline, now());
      const day = {
        id: id(),
        date: body.date,
        slots,
        note: cleanText(body.note, 500),
        deadline,
        closed: false,
        createdAt: now().toISOString(),
      };
      data.days.push(day);
      store.save();
      return daySummary(data, day, now());
    }],
    ['PATCH', /^\/api\/admin\/days\/([\w-]+)$/, async (req, [dayId]) => {
      requireAdmin(req);
      const day = findDay(dayId);
      const body = await readJson(req);
      if (body.slots !== undefined) {
        const slots = Number(body.slots);
        if (!Number.isInteger(slots) || slots < 0 || slots > 500) throw new HttpError(400, 'Plätze müssen eine Zahl zwischen 0 und 500 sein');
        day.slots = slots;
      }
      applyOpenClose(day, body, now());
      if (body.note !== undefined) day.note = cleanText(body.note, 500);
      store.save();
      return daySummary(data, day, now());
    }],
    ['DELETE', /^\/api\/admin\/days\/([\w-]+)$/, (req, [dayId]) => {
      requireAdmin(req);
      findDay(dayId);
      data.days = data.days.filter((d) => d.id !== dayId);
      data.entries = data.entries.filter((e) => e.dayId !== dayId);
      store.save();
      return { ok: true };
    }],
    ['GET', /^\/api\/admin\/days\/([\w-]+)\/entries$/, (req, [dayId]) => {
      requireAdmin(req);
      return entriesWithStatus(data, findDay(dayId)).map(publicEntry);
    }],
    ['GET', /^\/api\/admin\/days\/([\w-]+)\/excel$/, (req, [dayId]) => {
      requireAdmin(req);
      const day = findDay(dayId);
      return new FileResponse(`Notbetreuung-${day.date}.xlsx`, dayWorkbook(data, day));
    }],
    ['GET', /^\/api\/admin\/lists$/, (req) => {
      requireAdmin(req);
      return sortLists(data.lists).reverse().map((l) => listSummary(data, l, now(), { admin: true }));
    }],
    ['POST', /^\/api\/admin\/lists$/, async (req) => {
      requireAdmin(req);
      const body = await readJson(req);
      if (!LIST_KINDS[body.kind]) throw new HttpError(400, 'Ungültige Listenart');
      const title = cleanText(body.title, 100);
      if (!title) throw new HttpError(400, 'Bitte einen Titel angeben');
      if (body.date && !isoDate(body.date)) throw new HttpError(400, 'Ungültiges Datum');
      const deadline = parseDeadline(body.deadline, now());
      let items;
      if (body.kind === 'event') {
        const capacity = body.capacity === undefined || body.capacity === null || body.capacity === '' ? null : Number(body.capacity);
        items = [{ label: 'Teilnahme', capacity }];
      } else {
        items = parseItems(body.items);
        if (!items.length) throw new HttpError(400, 'Bitte mindestens eine Aufgabe eintragen (eine pro Zeile)');
        if (items.length > 100) throw new HttpError(400, 'Höchstens 100 Aufgaben pro Liste');
      }
      if (!items.every((i) => validCapacity(i.capacity))) throw new HttpError(400, 'Plätze müssen eine Zahl zwischen 1 und 1000 sein');
      const list = {
        id: id(),
        kind: body.kind,
        title,
        date: body.date || null,
        time: cleanText(body.time, 40),
        location: cleanText(body.location, 100),
        description: cleanText(body.description, 1000),
        deadline,
        showNames: Boolean(body.showNames),
        closed: false,
        items: items.map((i) => ({ id: id(), ...i })),
        createdAt: now().toISOString(),
      };
      data.lists.push(list);
      store.save();
      return listSummary(data, list, now(), { admin: true });
    }],
    ['PATCH', /^\/api\/admin\/lists\/([\w-]+)$/, async (req, [listId]) => {
      requireAdmin(req);
      const list = findList(listId);
      const body = await readJson(req);
      applyOpenClose(list, body, now());
      if (body.showNames !== undefined) list.showNames = Boolean(body.showNames);
      store.save();
      return listSummary(data, list, now(), { admin: true });
    }],
    ['DELETE', /^\/api\/admin\/lists\/([\w-]+)$/, (req, [listId]) => {
      requireAdmin(req);
      findList(listId);
      data.lists = data.lists.filter((l) => l.id !== listId);
      data.signups = data.signups.filter((s) => s.listId !== listId);
      store.save();
      return { ok: true };
    }],
    ['DELETE', /^\/api\/admin\/signups\/([\w-]+)$/, (req, [signupId]) => {
      requireAdmin(req);
      const before = data.signups.length;
      data.signups = data.signups.filter((s) => s.id !== signupId);
      if (data.signups.length === before) throw new HttpError(404, 'Eintrag nicht gefunden');
      store.save();
      return { ok: true };
    }],
    ['GET', /^\/api\/admin\/lists\/([\w-]+)\/excel$/, (req, [listId]) => {
      requireAdmin(req);
      const list = findList(listId);
      return new FileResponse(`${fileName(list.title)}.xlsx`, listWorkbook(data, list));
    }],
  ];

  return async function handler(req, res) {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    let pathname;
    try {
      ({ pathname } = new URL(req.url, 'http://x'));
    } catch {
      return send(res, 400, { error: 'Ungültige Adresse' });
    }
    if (!pathname.startsWith('/api/')) return serveStatic(req, res);
    try {
      for (const [method, re, fn] of routes) {
        const m = pathname.match(re);
        if (m && req.method === method) {
          const result = await fn(req, m.slice(1));
          return result instanceof FileResponse ? sendXlsx(res, result) : send(res, 200, result);
        }
      }
      throw new HttpError(404, 'Unbekannte Adresse');
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error(err);
      return send(res, 500, { error: 'Interner Fehler' });
    }
  };
}

module.exports = { createApp, entriesWithStatus, parseItems, codeProblems };

// Gibt eine Liste von Problemen mit den Codes zurück (leer = alles gut).
function codeProblems(parentCode, adminCode) {
  const problems = [];
  const weak = ['kita', 'leitung', 'hier-kita-code-eintragen', 'hier-langen-admin-code-eintragen'];
  if (!parentCode || weak.includes(parentCode)) problems.push('KITA_CODE ist nicht gesetzt oder noch der Beispielwert.');
  else if (parentCode.length < 6) problems.push('KITA_CODE sollte mindestens 6 Zeichen lang sein.');
  if (!adminCode || weak.includes(adminCode)) problems.push('ADMIN_CODE ist nicht gesetzt oder noch der Beispielwert.');
  else if (adminCode.length < 12) problems.push('ADMIN_CODE sollte mindestens 12 Zeichen lang sein.');
  if (parentCode && parentCode === adminCode) problems.push('KITA_CODE und ADMIN_CODE müssen verschieden sein.');
  return problems;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const production = process.env.NODE_ENV === 'production';
  const problems = codeProblems(process.env.KITA_CODE, process.env.ADMIN_CODE);
  if (production && problems.length) {
    // Im Echtbetrieb (z. B. Docker auf der NAS) lieber gar nicht starten als ungeschützt
    console.error('Die App startet nicht, weil die Zugangscodes unsicher sind:\n- ' + problems.join('\n- '));
    console.error('Bitte in docker-compose.yml eigene Codes eintragen und neu starten.');
    process.exit(1);
  }
  const handler = createApp({
    parentCode: process.env.KITA_CODE || 'kita',
    adminCode: process.env.ADMIN_CODE || 'leitung',
    dataFile: process.env.DATA_FILE || path.join(__dirname, 'data.json'),
    // "1" = allen glauben (Docker, nur lokal erreichbar); sonst die IP-Adresse des Proxys
    trustProxy: process.env.TRUST_PROXY === '1' ? true : process.env.TRUST_PROXY || false,
  });
  if (problems.length) {
    console.warn('Achtung (nur zum Testen in Ordnung):\n- ' + problems.join('\n- '));
  }
  // HOST=127.0.0.1: nur für den Reverse Proxy auf demselben Rechner erreichbar (Server-Betrieb)
  http.createServer(handler).listen(port, process.env.HOST || undefined, () => {
    console.log(`Kita-App läuft auf http://localhost:${port}  (Verwaltung: /admin)`);
  });
}
