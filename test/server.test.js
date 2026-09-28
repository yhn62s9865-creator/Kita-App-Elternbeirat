'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { createApp } = require('../server');

async function startServer(opts = {}) {
  const handler = createApp({ parentCode: 'eltern', adminCode: 'chef', dataFile: null, ...opts });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const call = async (method, url, { body, headers = {} } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  return { server, call };
}

const P = { 'X-Kita-Code': 'eltern' };
const A = { 'X-Admin-Code': 'chef' };

test('Warteliste und Nachrücken', async (t) => {
  const { server, call } = await startServer();
  t.after(() => server.close());

  const day = await call('POST', '/api/admin/days', { headers: A, body: { date: '2099-01-10', slots: 2 } });
  assert.strictEqual(day.status, 200);
  const dayId = day.body.id;

  const add = (child, type = 'need') => call('POST', `/api/days/${dayId}/entries`, { headers: P, body: { child, group: 'Bären', type } });
  const a = await add('Anna');
  const b = await add('Ben');
  const c = await add('Carl');
  const d = await add('Dora', 'home');
  assert.deepStrictEqual([a, b, c, d].map((r) => r.body.entry.status), ['confirmed', 'confirmed', 'waitlist', 'home']);

  const summary = (await call('GET', '/api/days', { headers: P })).body[0];
  assert.deepStrictEqual([summary.confirmed, summary.waitlist, summary.home], [2, 1, 1]);

  // Eltern sehen keine fremden Namen, nur Zahlen
  assert.strictEqual(JSON.stringify(summary).includes('Anna'), false);

  // Fremder Token darf nicht löschen
  const forbidden = await call('DELETE', `/api/entries/${a.body.entry.id}`, { headers: { ...P, 'X-Edit-Token': b.body.editToken } });
  assert.strictEqual(forbidden.status, 403);

  // Anna sagt ab -> Carl rückt nach
  const del = await call('DELETE', `/api/entries/${a.body.entry.id}`, { headers: { ...P, 'X-Edit-Token': a.body.editToken } });
  assert.strictEqual(del.status, 200);
  const mine = await call('POST', '/api/my-entries', { headers: P, body: { tokens: [c.body.editToken] } });
  assert.strictEqual(mine.body[0].status, 'confirmed');
});

test('Zugangscodes und Validierung', async (t) => {
  const { server, call } = await startServer();
  t.after(() => server.close());

  assert.strictEqual((await call('GET', '/api/days')).status, 401);
  assert.strictEqual((await call('GET', '/api/days', { headers: { 'X-Kita-Code': 'falsch' } })).status, 401);
  assert.strictEqual((await call('POST', '/api/admin/days', { headers: P, body: { date: '2099-01-01', slots: 1 } })).status, 401);
  assert.strictEqual((await call('POST', '/api/admin/days', { headers: A, body: { date: 'morgen', slots: 1 } })).status, 400);

  const day = await call('POST', '/api/admin/days', { headers: A, body: { date: '2099-02-01', slots: 5 } });
  assert.strictEqual((await call('POST', '/api/admin/days', { headers: A, body: { date: '2099-02-01', slots: 5 } })).status, 409);

  const url = `/api/days/${day.body.id}/entries`;
  assert.strictEqual((await call('POST', url, { headers: P, body: { child: '', type: 'need' } })).status, 400);
  assert.strictEqual((await call('POST', url, { headers: P, body: { child: 'Mia', group: 'Igel', type: 'need' } })).status, 200);
  assert.strictEqual((await call('POST', url, { headers: P, body: { child: 'mia', group: 'igel', type: 'home' } })).status, 409);
});

test('Geschlossene Tage und Anmeldeschluss', async (t) => {
  let now = new Date('2099-03-01T08:00:00Z');
  const { server, call } = await startServer({ now: () => now });
  t.after(() => server.close());

  const day = await call('POST', '/api/admin/days', {
    headers: A,
    body: { date: '2099-03-02', slots: 3, deadline: '2099-03-01T18:00:00Z' },
  });
  const url = `/api/days/${day.body.id}/entries`;
  assert.strictEqual((await call('POST', url, { headers: P, body: { child: 'Tom', type: 'need' } })).status, 200);

  now = new Date('2099-03-01T19:00:00Z');
  assert.strictEqual((await call('POST', url, { headers: P, body: { child: 'Lea', type: 'need' } })).status, 409);

  now = new Date('2099-03-01T08:00:00Z');
  await call('PATCH', `/api/admin/days/${day.body.id}`, { headers: A, body: { closed: true } });
  assert.strictEqual((await call('POST', url, { headers: P, body: { child: 'Lea', type: 'need' } })).status, 409);

  // Admin sieht die vollständige Liste mit Namen
  const list = await call('GET', `/api/admin/days/${day.body.id}/entries`, { headers: A });
  assert.deepStrictEqual(list.body.map((e) => e.child), ['Tom']);
});


test('Anmeldeliste (Elternabend) mit Personenzahl und Kapazität', async (t) => {
  const { server, call } = await startServer();
  t.after(() => server.close());

  const list = await call('POST', '/api/admin/lists', {
    headers: A,
    body: { kind: 'event', title: 'Elternabend Herbst', date: '2099-10-15', time: '19:30 Uhr', capacity: 5 },
  });
  assert.strictEqual(list.status, 200);
  const itemId = list.body.items[0].id;
  const url = `/api/lists/${list.body.id}/signups`;

  const a = await call('POST', url, { headers: P, body: { itemId, name: 'Familie Müller', persons: 2 } });
  assert.strictEqual(a.status, 200);
  assert.strictEqual((await call('POST', url, { headers: P, body: { itemId, name: 'familie müller', persons: 1 } })).status, 409);
  const full = await call('POST', url, { headers: P, body: { itemId, name: 'Familie Kaya', persons: 4 } });
  assert.strictEqual(full.status, 409);
  assert.match(full.body.error, /nur noch 3/);
  assert.strictEqual((await call('POST', url, { headers: P, body: { itemId, name: 'Familie Kaya', persons: 3 } })).status, 200);

  const lists = (await call('GET', '/api/lists', { headers: P })).body;
  assert.strictEqual(lists[0].items[0].taken, 5);
  assert.strictEqual(lists[0].items[0].names, undefined); // Namen standardmäßig verborgen

  const mine = await call('POST', '/api/my-signups', { headers: P, body: { tokens: [a.body.editToken] } });
  assert.deepStrictEqual(mine.body.map((s) => s.name), ['Familie Müller']);
  const del = await call('DELETE', `/api/signups/${a.body.signup.id}`, { headers: { ...P, 'X-Edit-Token': a.body.editToken } });
  assert.strictEqual(del.status, 200);
});

test('Helferliste mit Aufgaben und sichtbaren Namen', async (t) => {
  const { server, call } = await startServer();
  t.after(() => server.close());

  const list = await call('POST', '/api/admin/lists', {
    headers: A,
    body: { kind: 'helper', title: 'Sommerfest', showNames: true, items: 'Kuchen backen | 2\nAufbau 14–15 Uhr | 3\nGrillen' },
  });
  assert.deepStrictEqual(list.body.items.map((i) => [i.label, i.capacity]), [['Kuchen backen', 2], ['Aufbau 14–15 Uhr', 3], ['Grillen', null]]);
  const [kuchen, , grillen] = list.body.items;
  const url = `/api/lists/${list.body.id}/signups`;

  await call('POST', url, { headers: P, body: { itemId: kuchen.id, name: 'Anna', comment: 'Marmorkuchen' } });
  await call('POST', url, { headers: P, body: { itemId: kuchen.id, name: 'Ben', persons: 5 } }); // Personen zählen bei Helfern nicht
  assert.strictEqual((await call('POST', url, { headers: P, body: { itemId: kuchen.id, name: 'Carl' } })).status, 409);
  assert.strictEqual((await call('POST', url, { headers: P, body: { itemId: grillen.id, name: 'Carl' } })).status, 200);

  const pub = (await call('GET', '/api/lists', { headers: P })).body[0];
  assert.deepStrictEqual(pub.items[0].names, ['Anna', 'Ben']);
  assert.strictEqual(pub.items[0].taken, 2);

  assert.strictEqual((await call('POST', '/api/admin/lists', { headers: A, body: { kind: 'helper', title: 'Leer', items: '' } })).status, 400);
  assert.strictEqual((await call('POST', '/api/admin/lists', { headers: P, body: { kind: 'event', title: 'X' } })).status, 401);
});

test('Excel-Download ist eine gültige .xlsx-Datei', async (t) => {
  const { server } = await startServer();
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}`;
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { ...A, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

  const list = await post('/api/admin/lists', { kind: 'helper', title: 'Laternenfest <Helfer>', items: 'Punsch | 2' });
  await fetch(`${base}/api/lists/${list.id}/signups`, {
    method: 'POST', headers: { ...P, 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId: list.items[0].id, name: 'Jörg & Söhne' }),
  });

  assert.strictEqual((await fetch(`${base}/api/admin/lists/${list.id}/excel`, { headers: P })).status, 401);
  const res = await fetch(`${base}/api/admin/lists/${list.id}/excel`, { headers: A });
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /spreadsheetml/);
  assert.match(res.headers.get('content-disposition'), /Laternenfest-Helfer\.xlsx/);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.strictEqual(buf.subarray(0, 2).toString(), 'PK'); // ZIP-Signatur
  const text = buf.toString('utf8');
  assert.ok(text.includes('Jörg &amp; Söhne'));
  assert.ok(text.includes('Laternenfest &lt;Helfer&gt;'));

  const day = await post('/api/admin/days', { date: '2099-05-05', slots: 3 });
  const dayRes = await fetch(`${base}/api/admin/days/${day.id}/excel`, { headers: A });
  assert.strictEqual(dayRes.status, 200);
});

test('Anmeldeschluss in der Vergangenheit wird abgelehnt, Wieder öffnen hebt abgelaufenen Schluss auf', async (t) => {
  let now = new Date('2099-04-01T09:30:00Z');
  const { server, call } = await startServer({ now: () => now });
  t.after(() => server.close());

  // Versehentlich die aktuelle Uhrzeit als Anmeldeschluss → verständliche Fehlermeldung
  const past = await call('POST', '/api/admin/days', { headers: A, body: { date: '2099-04-02', slots: 10, deadline: '2099-04-01T09:11:00Z' } });
  assert.strictEqual(past.status, 400);
  assert.match(past.body.error, /Vergangenheit/);
  const pastList = await call('POST', '/api/admin/lists', { headers: A, body: { kind: 'event', title: 'X', deadline: '2099-03-01T00:00:00Z' } });
  assert.strictEqual(pastList.status, 400);

  const day = await call('POST', '/api/admin/days', { headers: A, body: { date: '2099-04-02', slots: 10, deadline: '2099-04-01T12:00:00Z' } });
  now = new Date('2099-04-01T13:00:00Z'); // Schluss ist vorbei
  const url = `/api/days/${day.body.id}/entries`;
  assert.strictEqual((await call('POST', url, { headers: P, body: { child: 'Paula', type: 'need' } })).status, 409);

  const reopened = await call('PATCH', `/api/admin/days/${day.body.id}`, { headers: A, body: { closed: false } });
  assert.strictEqual(reopened.body.closed, false);
  assert.strictEqual(reopened.body.deadline, null);
  assert.strictEqual((await call('POST', url, { headers: P, body: { child: 'Paula', type: 'need' } })).status, 200);

  // Anmeldeschluss nachträglich setzen und wieder entfernen
  const later = await call('PATCH', `/api/admin/days/${day.body.id}`, { headers: A, body: { deadline: '2099-04-01T20:00:00Z' } });
  assert.strictEqual(later.body.deadline, '2099-04-01T20:00:00.000Z');
  const removed = await call('PATCH', `/api/admin/days/${day.body.id}`, { headers: A, body: { deadline: null } });
  assert.strictEqual(removed.body.deadline, null);
});

test('Sperre nach zu vielen falschen Codes, pro Absender', async (t) => {
  const { server, call } = await startServer({ trustProxy: true });
  t.after(() => server.close());
  const from = (ip, code = 'falsch') => ({ 'X-Kita-Code': code, 'X-Forwarded-For': `1.2.3.4, ${ip}` });

  for (let i = 0; i < 10; i++) {
    assert.strictEqual((await call('POST', '/api/login', { headers: from('9.9.9.9') })).status, 401);
  }
  // Jetzt gesperrt – auch mit richtigem Code
  const blocked = await call('POST', '/api/login', { headers: from('9.9.9.9', 'eltern') });
  assert.strictEqual(blocked.status, 429);
  assert.match(blocked.body.error, /Zu viele/);
  // Andere Eltern sind nicht betroffen (die vorderste, fälschbare Adresse zählt nicht)
  assert.strictEqual((await call('POST', '/api/login', { headers: from('8.8.8.8', 'eltern') })).status, 200);
  // Admin-Versuche zählen ebenfalls
  for (let i = 0; i < 10; i++) {
    await call('GET', '/api/admin/days', { headers: { 'X-Admin-Code': 'rate', 'X-Forwarded-For': '7.7.7.7' } });
  }
  assert.strictEqual((await call('GET', '/api/admin/days', { headers: { ...A, 'X-Forwarded-For': '7.7.7.7' } })).status, 429);
});

test('Sicherheits-Header und kaputte Adressen', async (t) => {
  const { server } = await startServer();
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}`;

  const page = await fetch(base + '/');
  assert.strictEqual(page.status, 200);
  assert.strictEqual(page.headers.get('x-frame-options'), 'DENY');
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);

  // Darf den Server nicht abstürzen lassen
  assert.strictEqual((await fetch(base + '/%E0%A4%A')).status, 400);
  assert.strictEqual((await fetch(base + '/../server.js')).status, 404);
  assert.strictEqual((await fetch(base + '/')).status, 200);
});

test('Unsichere Codes werden erkannt', () => {
  const { codeProblems } = require('../server');
  assert.ok(codeProblems(undefined, undefined).length >= 2);
  assert.ok(codeProblems('kita', 'leitung').length >= 2);
  assert.ok(codeProblems('hier-kita-code-eintragen', 'hier-langen-admin-code-eintragen').length >= 2);
  assert.ok(codeProblems('abc', 'kurz').length >= 2);
  assert.ok(codeProblems('gleicher-code-123', 'gleicher-code-123').some((p) => /verschieden/.test(p)));
  assert.deepStrictEqual(codeProblems('sonnenschein', 'Elternbeirat-2026-geheim'), []);
});

test('X-Forwarded-For zählt nur, wenn die Anfrage vom eingetragenen Proxy kommt', async (t) => {
  // Anfragen im Test kommen von 127.0.0.1 – als Proxy ist aber eine andere Adresse eingetragen
  const { server, call } = await startServer({ trustProxy: '192.168.178.20' });
  t.after(() => server.close());
  // Wer die Kopfzeile fälscht, umgeht die Sperre nicht: alle Versuche zählen für 127.0.0.1
  for (let i = 0; i < 10; i++) {
    await call('POST', '/api/login', { headers: { 'X-Kita-Code': 'falsch', 'X-Forwarded-For': `10.0.0.${i}` } });
  }
  assert.strictEqual((await call('POST', '/api/login', { headers: { ...P, 'X-Forwarded-For': '10.0.0.99' } })).status, 429);

  const viaProxy = await startServer({ trustProxy: '127.0.0.1' });
  t.after(() => viaProxy.server.close());
  for (let i = 0; i < 10; i++) {
    await viaProxy.call('POST', '/api/login', { headers: { 'X-Kita-Code': 'falsch', 'X-Forwarded-For': '5.5.5.5' } });
  }
  assert.strictEqual((await viaProxy.call('POST', '/api/login', { headers: { ...P, 'X-Forwarded-For': '6.6.6.6' } })).status, 200);
});
