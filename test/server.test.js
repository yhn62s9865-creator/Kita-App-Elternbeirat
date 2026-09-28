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
