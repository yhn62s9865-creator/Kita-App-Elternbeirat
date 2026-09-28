'use strict';

// Kita-Notbetreuung: kleine Web-App ohne externe Abhängigkeiten.
// Eltern melden ihr Kind an Engpass-Tagen an (braucht Betreuung) oder ab
// (bleibt freiwillig zuhause). Kita-Leitung / Elternbeirat legt die Tage an.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

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
  let data = { days: [], entries: [] };
  if (file && fs.existsSync(file)) {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
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

function isPastDeadline(day, now = new Date()) {
  return Boolean(day.deadline) && new Date(day.deadline) < now;
}

function publicEntry(e) {
  return { id: e.id, dayId: e.dayId, child: e.child, group: e.group, type: e.type, status: e.status };
}

function upcomingDays(data, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  return data.days.filter((d) => d.date >= today).sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- HTTP ----------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

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
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
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

function createApp({ parentCode, adminCode, dataFile, now = () => new Date() }) {
  if (!parentCode || !adminCode) throw new Error('parentCode und adminCode müssen gesetzt sein');
  const store = createStore(dataFile);
  const { data } = store;

  const requireParent = (req) => {
    const code = req.headers['x-kita-code'] || '';
    if (!safeEqual(code, parentCode) && !safeEqual(code, adminCode)) {
      throw new HttpError(401, 'Falscher Kita-Code');
    }
  };
  const requireAdmin = (req) => {
    if (!safeEqual(req.headers['x-admin-code'] || '', adminCode)) {
      throw new HttpError(401, 'Falscher Admin-Code');
    }
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
      if (body.deadline && isNaN(Date.parse(body.deadline))) throw new HttpError(400, 'Ungültiger Anmeldeschluss');
      const day = {
        id: id(),
        date: body.date,
        slots,
        note: cleanText(body.note, 500),
        deadline: body.deadline ? new Date(body.deadline).toISOString() : null,
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
      if (body.closed !== undefined) day.closed = Boolean(body.closed);
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
  ];

  return async function handler(req, res) {
    const { pathname } = new URL(req.url, 'http://x');
    if (!pathname.startsWith('/api/')) return serveStatic(req, res);
    try {
      for (const [method, re, fn] of routes) {
        const m = pathname.match(re);
        if (m && req.method === method) return send(res, 200, await fn(req, m.slice(1)));
      }
      throw new HttpError(404, 'Unbekannte Adresse');
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error(err);
      return send(res, 500, { error: 'Interner Fehler' });
    }
  };
}

module.exports = { createApp, entriesWithStatus };

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const handler = createApp({
    parentCode: process.env.KITA_CODE || 'kita',
    adminCode: process.env.ADMIN_CODE || 'leitung',
    dataFile: process.env.DATA_FILE || path.join(__dirname, 'data.json'),
  });
  if (!process.env.KITA_CODE || !process.env.ADMIN_CODE) {
    console.warn('Achtung: Standard-Codes aktiv. Für den echten Einsatz KITA_CODE und ADMIN_CODE setzen!');
  }
  http.createServer(handler).listen(port, () => {
    console.log(`Kita-Notbetreuung läuft auf http://localhost:${port}  (Admin: /admin)`);
  });
}
