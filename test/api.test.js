'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const BAY = require('../public/js/shared');
const { createApp } = require('../server');

// 1x1 white JPEG
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
let server, base, dir, cookie = '';

async function call(method, url, body, headers = {}) {
  const r = await fetch(base + url, {
    method, headers: Object.assign({ 'Content-Type': 'application/json', Cookie: cookie }, headers),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data, headers: r.headers };
}

const day = (n) => BAY.addDays(BAY.today(), n);
function bookingBody(over = {}) {
  return Object.assign({
    pickup: day(10) + 'T09:00', return: day(11) + 'T09:00', model: 'Honda Click 125', addons: { helmet: 1 },
    customer: { name: 'Test Rider', mobile: '09171234567', fb: 'Test', stayingAt: 'Port', riders: 2 },
    license: JPEG, agreeTerms: true, payment: { method: 'cash' }
  }, over);
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bay-test-'));
  ({ server } = createApp({ dataDir: dir }));
  await new Promise((r) => server.listen(0, r));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('pricing: half-day, daily, multi-day and add-ons', () => {
  const s = { halfDayHours: 6, graceMinutes: 60, multiDayMinDays: 3, deposit: 1000,
    addons: [{ id: 'helmet', name: 'Helmet', price: 50, maxQty: 2, active: true }, { id: 'x', name: 'X', price: 20, perDay: true, maxQty: 1, active: true }] };
  const u = { dailyRate: 500, halfDayRate: 350, multiDayRate: 450 };
  assert.strictEqual(BAY.quote(u, '2026-12-01T09:00', '2026-12-01T15:00', {}, s).rental, 350);
  assert.strictEqual(BAY.quote(u, '2026-12-01T09:00', '2026-12-02T09:00', {}, s).rental, 500);
  assert.strictEqual(BAY.quote(u, '2026-12-01T09:00', '2026-12-02T10:00', {}, s).rental, 500, 'within grace');
  assert.strictEqual(BAY.quote(u, '2026-12-01T09:00', '2026-12-02T11:00', {}, s).rental, 1000, 'past grace = 2 days');
  const q = BAY.quote(u, '2026-12-01T09:00', '2026-12-04T09:00', { helmet: 5, x: 1 }, s);
  assert.strictEqual(q.rental, 1350, '3 days at multi-day rate');
  assert.strictEqual(q.addonsTotal, 100 + 60, 'helmet capped at 2, per-day add-on × 3');
  assert.strictEqual(q.dueAtPickup, q.total + 1000);
});

test('time helpers are Asia/Manila regardless of server TZ', () => {
  assert.strictEqual(BAY.fromEpoch(Date.parse('2026-11-10T16:30:00Z')), '2026-11-11T00:30');
  assert.strictEqual(BAY.addDays('2026-12-31', 1), '2027-01-01');
});

test('config hides plate numbers', async () => {
  const r = await call('GET', '/api/config');
  assert.strictEqual(r.status, 200);
  assert.ok(r.data.units.length >= 3);
  assert.ok(r.data.units.every((u) => !('plate' in u)));
});

test('availability rejects out-of-hours windows', async () => {
  const r = await call('GET', `/api/availability?pickup=${day(10)}T07:00&return=${day(11)}T09:00`);
  assert.strictEqual(r.status, 400);
  const late = await call('GET', `/api/availability?pickup=${day(10)}T09:00&return=${day(10)}T19:00`);
  assert.strictEqual(late.status, 400, 'return after 6 PM rejected');
  const edge = await call('GET', `/api/availability?pickup=${day(10)}T09:00&return=${day(10)}T18:00`);
  assert.strictEqual(edge.status, 200, '6:00 PM return allowed');
});

test('booking flow prevents double-booking', async () => {
  let a = await call('GET', `/api/availability?pickup=${day(10)}T09:00&return=${day(11)}T09:00`);
  const click = a.data.models.find((m) => m.model === 'Honda Click 125');
  assert.strictEqual(click.available, 2);
  assert.ok(a.data.models.every((m) => m.model !== 'Honda BeAT'), 'maintenance-only model hidden');

  const r1 = await call('POST', '/api/bookings', bookingBody());
  assert.strictEqual(r1.status, 200, JSON.stringify(r1.data));
  assert.match(r1.data.booking.ref, /^BAY-\d{4}$/);
  assert.strictEqual(r1.data.booking.quote.total, 550);
  const r2 = await call('POST', '/api/bookings', bookingBody());
  assert.strictEqual(r2.status, 200);
  const r3 = await call('POST', '/api/bookings', bookingBody({ pickup: day(10) + 'T13:00', return: day(10) + 'T18:00' }));
  assert.strictEqual(r3.status, 409, 'both Click units taken');

  a = await call('GET', `/api/availability?pickup=${day(10)}T09:00&return=${day(11)}T09:00`);
  assert.strictEqual(a.data.models.find((m) => m.model === 'Honda Click 125').available, 0);
  // turnaround buffer: return 09:00, next pickup 09:30 < 60 min buffer -> still busy
  a = await call('GET', `/api/availability?pickup=${day(11)}T09:30&return=${day(12)}T09:30`);
  assert.strictEqual(a.data.models.find((m) => m.model === 'Honda Click 125').available, 0);
  a = await call('GET', `/api/availability?pickup=${day(11)}T10:00&return=${day(12)}T10:00`);
  assert.strictEqual(a.data.models.find((m) => m.model === 'Honda Click 125').available, 2);

  const look = await call('GET', `/api/bookings/lookup?ref=${r1.data.booking.ref}&mobile=0917-123-4567`);
  assert.strictEqual(look.status, 200);
});

test('booking validation', async () => {
  assert.strictEqual((await call('POST', '/api/bookings', bookingBody({ license: null }))).status, 400);
  assert.strictEqual((await call('POST', '/api/bookings', bookingBody({ agreeTerms: false }))).status, 400);
  assert.strictEqual((await call('POST', '/api/bookings', bookingBody({ customer: { name: 'A B', mobile: '123' } }))).status, 400);
  assert.strictEqual((await call('POST', '/api/bookings', bookingBody({ payment: { method: 'gcash', gcashRef: '' } }))).status, 400);
  assert.strictEqual((await call('POST', '/api/bookings', bookingBody({ license: 'data:image/jpeg;base64,aGVsbG8=' }))).status, 400, 'non-image rejected');
  const past = await call('POST', '/api/bookings', bookingBody({ pickup: day(-1) + 'T09:00', return: day(0) + 'T09:00' }));
  assert.strictEqual(past.status, 400);
});

test('admin requires login; can manage bookings and export CSV', async () => {
  assert.strictEqual((await call('GET', '/api/admin/data')).status, 401);
  assert.strictEqual((await call('POST', '/api/admin/login', { password: 'nope' })).status, 401);
  const login = await call('POST', '/api/admin/login', { password: 'baybayin2026' });
  assert.strictEqual(login.status, 200);
  cookie = login.headers.get('set-cookie').split(';')[0];

  const d = await call('GET', '/api/admin/data');
  assert.strictEqual(d.status, 200);
  const b = d.data.bookings.find((x) => x.status === 'pending' && !x.sample);
  assert.ok(b.licensePhoto);
  const img = await fetch(base + '/api/admin/files/' + b.licensePhoto, { headers: { Cookie: cookie } });
  assert.strictEqual(img.status, 200);
  assert.strictEqual((await fetch(base + '/api/admin/files/' + b.licensePhoto)).status, 401, 'license photo is private');

  let r = await call('PATCH', '/api/admin/bookings/' + b.id, { status: 'picked_up', deposit: 'collected' });
  assert.strictEqual(r.data.booking.status, 'picked_up');
  let units = (await call('GET', '/api/admin/data')).data.units;
  assert.strictEqual(units.find((u) => u.id === b.scooterId).status, 'rented');
  r = await call('PATCH', '/api/admin/bookings/' + b.id, { status: 'returned', deposit: 'refunded' });
  units = (await call('GET', '/api/admin/data')).data.units;
  assert.strictEqual(units.find((u) => u.id === b.scooterId).status, 'available');

  const msgs = await call('GET', '/api/admin/bookings/' + b.id + '/messages');
  assert.match(msgs.data.customer, /Salamat/);
  assert.match(msgs.data.admin, /NEW BOOKING/);

  const csv = await call('GET', '/api/admin/export.csv');
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.data, /BAY-0001/);

  r = await call('PUT', '/api/admin/settings', { deposit: 1500, openTime: '08:00' });
  assert.strictEqual(r.data.settings.deposit, 1500);
  r = await call('POST', '/api/admin/units', { name: 'Suzuki Burgman', plate: 'SZK 1', dailyRate: 600 });
  assert.strictEqual(r.status, 200);
  const cfg = await call('GET', '/api/config');
  assert.ok(cfg.data.units.some((u) => u.name === 'Suzuki Burgman'));
});

test('static files and path traversal', async () => {
  const r = await fetch(base + '/');
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await fetch(base + '/admin')).status, 200);
  assert.notStrictEqual((await fetch(base + '/..%2fserver.js')).status, 200);
});

test('standalone demo builds into one self-contained file', () => {
  const { execFileSync } = require('child_process');
  execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'build-demo.js')]);
  const html = fs.readFileSync(path.join(__dirname, '..', 'dist', 'baybayin-demo.html'), 'utf8');
  assert.match(html, /function RUN_CUSTOMER/);
  assert.match(html, /function RUN_ADMIN/);
  assert.doesNotMatch(html, /<script src=|<link rel="stylesheet"/, 'no external files');
});

test('older databases get new settings filled in without losing edits', () => {
  const CORE = require('../public/js/core');
  const old = CORE.buildSeedData();
  delete old.settings.termsTl; delete old.settings.smsOnConfirm;
  old.settings.deposit = 1500;
  CORE.upgrade(old);
  assert.ok(old.settings.termsTl.length > 0);
  assert.strictEqual(old.settings.smsOnConfirm, true);
  assert.strictEqual(old.settings.deposit, 1500);
});
