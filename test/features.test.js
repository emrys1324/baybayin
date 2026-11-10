'use strict';
/* Walk-in bookings, SMS via (fake) Semaphore, Tagalog bookings, go-live checklist, sample cleanup. */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const BAY = require('../public/js/shared');
const CORE = require('../public/js/core');

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
let server, base, dir, cookie, gateway, sent = [];

async function call(method, url, body) {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie || '' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
const day = (n) => BAY.addDays(BAY.today(), n);

before(async () => {
  // Fake Semaphore: records form posts, answers like the real API.
  gateway = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const f = Object.fromEntries(new URLSearchParams(b));
      sent.push(f);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(f.apikey === 'sem-key' ? [{ message_id: 100 + sent.length, status: 'Queued' }] : { apikey: ['invalid'] }));
    });
  });
  await new Promise((r) => gateway.listen(0, r));
  process.env.SEMAPHORE_API_KEY = 'sem-key';
  process.env.SEMAPHORE_SENDER_NAME = 'BAYBAYIN';
  process.env.SEMAPHORE_API_URL = 'http://127.0.0.1:' + gateway.address().port + '/api/v4/messages';

  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bay-feat-'));
  const { createApp } = require('../server');
  ({ server } = createApp({ dataDir: dir }));
  await new Promise((r) => server.listen(0, r));
  base = 'http://127.0.0.1:' + server.address().port;
  const login = await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'baybayin2026' }) });
  cookie = login.headers.get('set-cookie').split(';')[0];
});
after(() => {
  server.close(); gateway.close(); fs.rmSync(dir, { recursive: true, force: true });
  ['SEMAPHORE_API_KEY', 'SEMAPHORE_SENDER_NAME', 'SEMAPHORE_API_URL'].forEach((k) => delete process.env[k]);
});

test('SMS texts are plain GSM and fit one credit', () => {
  const d = CORE.buildSeedData();
  for (const lang of ['en', 'tl']) {
    for (const kind of ['received', 'confirm']) {
      const txt = CORE.smsText(Object.assign({}, d.bookings[2], { lang }), d.settings, kind);
      assert.ok(txt.length <= 160, `${lang}/${kind} is ${txt.length} chars: ${txt}`);
      assert.doesNotMatch(txt, /[₱\u{1F300}-\u{1FAFF}]/u, 'no peso sign or emoji (would force expensive Unicode SMS)');
    }
  }
});

test('Tagalog booking: language stored, SMS on confirm in Tagalog, logged on booking', async () => {
  const r = await call('POST', '/api/bookings', {
    pickup: day(6) + 'T10:00', return: day(7) + 'T10:00', model: 'Honda PCX 160', addons: {}, lang: 'tl',
    customer: { name: 'Juan Dela Cruz', mobile: '09171234567', fb: 'Juan', stayingAt: 'Port', riders: 1 },
    license: JPEG, agreeTerms: true, payment: { method: 'cash' }
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.strictEqual(sent.length, 0, '"received" SMS is off by default');
  const d = (await call('GET', '/api/admin/data')).data;
  const b = d.bookings.find((x) => x.ref === r.data.booking.ref);
  assert.strictEqual(b.lang, 'tl');
  assert.strictEqual(b.source, 'online');

  const msgs = (await call('GET', `/api/admin/bookings/${b.id}/messages`)).data;
  assert.match(msgs.customer, /CONFIRMED na ang scooter booking/);

  const p = await call('PATCH', '/api/admin/bookings/' + b.id, { status: 'confirmed' });
  assert.strictEqual(p.data.sms.ok, true);
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].number, '09171234567');
  assert.strictEqual(sent[0].sendername, 'BAYBAYIN');
  assert.match(sent[0].message, /CONFIRMED na ang booking .* Dalhin ang lisensya at P1,000 deposit/);
  assert.strictEqual(p.data.booking.sms.length, 1);

  // Re-saving notes on a confirmed booking must not text again
  await call('PATCH', '/api/admin/bookings/' + b.id, { notes: 'helmet #3' });
  assert.strictEqual(sent.length, 1);

  // Manual resend
  const again = await call('POST', `/api/admin/bookings/${b.id}/sms`, { kind: 'confirm' });
  assert.strictEqual(again.status, 200);
  assert.strictEqual(sent.length, 2);
});

test('"received" SMS when switched on; foreign numbers are skipped, not errors', async () => {
  await call('PUT', '/api/admin/settings', { smsOnReceived: true });
  const mk = (mobile, model) => call('POST', '/api/bookings', {
    pickup: day(9) + 'T10:00', return: day(10) + 'T10:00', model, addons: {},
    customer: { name: 'Anna Schmidt', mobile, fb: 'Anna', stayingAt: 'Resort', riders: 1 },
    license: JPEG, agreeTerms: true, payment: { method: 'cash' }
  });
  const before = sent.length;
  assert.strictEqual((await mk('+639181112222', 'Honda Click 125')).status, 200);
  assert.strictEqual(sent.length, before + 1);
  assert.strictEqual(sent.at(-1).number, '09181112222', '+63 normalised to 09');
  assert.match(sent.at(-1).message, /We got your booking/);
  const foreign = await mk('+4915112345678', 'Yamaha NMAX V3');
  assert.strictEqual(foreign.status, 200, 'booking still succeeds');
  assert.strictEqual(sent.length, before + 1, 'no SMS to a German number');
  const d = (await call('GET', '/api/admin/data')).data;
  const fb = d.bookings.find((x) => x.ref === foreign.data.booking.ref);
  assert.strictEqual(fb.sms[0].ok, false);
  assert.match(fb.sms[0].error, /Messenger/);
  await call('PUT', '/api/admin/settings', { smsOnReceived: false });
});

test('walk-in: renting now marks the scooter rented, blocks double-booking, allows past pickup', async () => {
  const d = (await call('GET', '/api/admin/data')).data;
  const free = d.units.find((u) => u.id === 'u4');                 // PCX
  const now = BAY.nowLocal();
  const ret = BAY.addHours(now, 5);
  const r = await call('POST', '/api/admin/walkins', {
    scooterId: free.id, pickup: BAY.addHours(now, -0.25), return: ret, status: 'picked_up', addons: { helmet: 1 },
    customer: { name: 'Walk In Guest', riders: 2 }, method: 'cash', paid: true, depositCollected: true, notes: 'Fuel full'
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const b = r.data.booking;
  assert.strictEqual(b.source, 'walk-in');
  assert.strictEqual(b.status, 'picked_up');
  assert.strictEqual(b.payment.status, 'paid');
  assert.strictEqual(b.deposit, 'collected');
  assert.strictEqual(b.quote.rental, 550, '5 hrs = half-day rate');
  const after = (await call('GET', '/api/admin/data')).data;
  assert.strictEqual(after.units.find((u) => u.id === free.id).status, 'rented');

  const clash = await call('POST', '/api/admin/walkins', {
    scooterId: free.id, pickup: BAY.addHours(now, 1), return: BAY.addHours(now, 3), status: 'confirmed', customer: { name: 'Second Guest' }
  });
  assert.strictEqual(clash.status, 409);
  const maint = await call('POST', '/api/admin/walkins', { scooterId: 'u5', pickup: now, return: ret, customer: { name: 'X Y' } });
  assert.strictEqual(maint.status, 400, 'maintenance unit refused');
  const noName = await call('POST', '/api/admin/walkins', { scooterId: 'u2', pickup: day(30) + 'T09:00', return: day(31) + 'T09:00', customer: {} });
  assert.strictEqual(noName.status, 400);

  const csv = await call('GET', '/api/admin/export.csv');
  assert.match(csv.data, /walk-in/);
});

test('go-live checklist and sample cleanup', async () => {
  let d = (await call('GET', '/api/admin/data')).data;
  const item = (id) => d.setup.find((x) => x.id === id);
  assert.strictEqual(d.defaultPassword, true);
  assert.strictEqual(item('password').done, false);
  assert.strictEqual(item('samples').done, false);
  assert.strictEqual(item('gcash').done, false);
  assert.strictEqual(item('sms').done, true, 'SMS configured in this test');
  const realBefore = d.bookings.filter((b) => !b.sample).length;

  const r = await call('DELETE', '/api/admin/sample-bookings');
  assert.strictEqual(r.data.removed, 6);
  await call('PUT', '/api/admin/settings', { gcashNumber: '0918 555 1234', gcashName: 'J. DELA CRUZ', pricesReviewed: true });
  const pw = await fetch(base + '/api/admin/password', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ password: 'a-much-better-password' }) });
  cookie = pw.headers.get('set-cookie').split(';')[0];   // password change issues a fresh session

  d = (await call('GET', '/api/admin/data')).data;
  assert.strictEqual(d.bookings.filter((b) => b.sample).length, 0);
  assert.strictEqual(d.bookings.length, realBefore, 'real bookings kept');
  assert.strictEqual(d.units.find((u) => u.id === 'u3').status, 'available', 'NMAX freed once its sample rental is gone');
  for (const id of ['password', 'samples', 'gcash', 'prices']) assert.strictEqual(item(id).done, true, id);
});
