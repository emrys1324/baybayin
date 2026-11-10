'use strict';
/* Serverless mode: two app instances share one (fake) Upstash Redis, like two Vercel functions. */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const BAY = require('../public/js/shared');

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

// Minimal Upstash REST emulator: POST / with a JSON command array.
function fakeUpstash() {
  const kv = new Map(), hashes = new Map();
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.headers.authorization !== 'Bearer test-token') { res.writeHead(401); return res.end('{"error":"unauthorized"}'); }
      const [cmd, ...a] = JSON.parse(body);
      let result = null;
      switch (cmd.toUpperCase()) {
        case 'GET': result = kv.has(a[0]) ? kv.get(a[0]) : null; break;
        case 'SET': {
          const nx = a.includes('NX');
          if (nx && kv.has(a[0])) result = null; else { kv.set(a[0], a[1]); result = 'OK'; }
          break;
        }
        case 'HSET': { const h = hashes.get(a[0]) || new Map(); for (let i = 1; i < a.length; i += 2) h.set(a[i], a[i + 1]); hashes.set(a[0], h); result = 1; break; }
        case 'HGETALL': result = [...(hashes.get(a[0]) || new Map())].flat(); break;
        case 'INCR': { const n = (+kv.get(a[0]) || 0) + 1; kv.set(a[0], String(n)); result = n; break; }
        case 'EXPIRE': result = 1; break;
        case 'EVAL': { const key = a[2], id = a[3]; result = kv.get(key) === id ? (kv.delete(key), 1) : 0; break; }
        default: res.writeHead(400); return res.end(JSON.stringify({ error: 'unknown ' + cmd }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result }));
    });
  });
}

let redis, appA, appB, baseA, baseB;
before(async () => {
  redis = fakeUpstash();
  await new Promise((r) => redis.listen(0, r));
  process.env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:' + redis.address().port;
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
  const { createApp } = require('../server');
  appA = createApp(); appB = createApp();
  assert.strictEqual(appA.store.kind, 'redis');
  await new Promise((r) => appA.server.listen(0, r));
  await new Promise((r) => appB.server.listen(0, r));
  baseA = 'http://127.0.0.1:' + appA.server.address().port;
  baseB = 'http://127.0.0.1:' + appB.server.address().port;
});
after(() => {
  appA.server.close(); appB.server.close(); redis.close();
  delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

const post = (base, url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: JSON.stringify(body) });
const day = (n) => BAY.addDays(BAY.today(), n);
const booking = (name) => ({
  pickup: day(20) + 'T09:00', return: day(21) + 'T09:00', model: 'Yamaha NMAX V3', addons: {},
  customer: { name, mobile: '09171234567', fb: name, stayingAt: 'Port', riders: 1 },
  license: JPEG, agreeTerms: true, payment: { method: 'cash' }
});

test('seeds once and both instances see the same data', async () => {
  const [a, b] = await Promise.all([fetch(baseA + '/api/config').then((r) => r.json()), fetch(baseB + '/api/config').then((r) => r.json())]);
  assert.strictEqual(a.units.length, 5);
  assert.deepStrictEqual(a.units.map((u) => u.id), b.units.map((u) => u.id));
});

test('simultaneous bookings for the last unit on two instances: exactly one wins', async () => {
  const [r1, r2] = await Promise.all([post(baseA, '/api/bookings', booking('Rider One')), post(baseB, '/api/bookings', booking('Rider Two'))]);
  const codes = [r1.status, r2.status].sort();
  assert.deepStrictEqual(codes, [200, 409]);
  const winner = await (r1.status === 200 ? r1 : r2).json();
  assert.strictEqual(winner.booking.ref, 'BAY-0007', 'counter continues from sample data');
  const next = await post(baseB, '/api/bookings', Object.assign(booking('Rider Three'), { model: 'Honda Click 125' }));
  assert.strictEqual((await next.json()).booking.ref, 'BAY-0008');
});

test('admin login on one instance works on the other; images stored in Redis', async () => {
  const login = await post(baseA, '/api/admin/login', { password: 'baybayin2026' });
  assert.strictEqual(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const d = await fetch(baseB + '/api/admin/data', { headers: { Cookie: cookie } }).then((r) => r.json());
  assert.strictEqual(d.storage, 'redis');
  const b = d.bookings.find((x) => x.customer.name.startsWith('Rider') && x.licensePhoto);
  const img = await fetch(baseA + '/api/admin/files/' + b.licensePhoto, { headers: { Cookie: cookie } });
  assert.strictEqual(img.status, 200);
  assert.strictEqual((await fetch(baseA + '/api/admin/files/' + b.licensePhoto)).status, 401);

  const up = await post(baseA, '/api/admin/upload', { dataUrl: JPEG }, { Cookie: cookie }).then((r) => r.json());
  assert.strictEqual((await fetch(baseB + '/api/media/' + up.file)).status, 200, 'public media served from Redis');

  const s = await fetch(baseB + '/api/admin/settings', { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ deposit: 1200 }) });
  assert.strictEqual(s.status, 200);
  assert.strictEqual((await fetch(baseA + '/api/config').then((r) => r.json())).settings.deposit, 1200);

  assert.strictEqual((await fetch(baseA + '/api/admin/data', { headers: { Cookie: 'bay_admin=9999999999999.deadbeef' } })).status, 401, 'forged token rejected');
});

test('Vercel-style pre-parsed body is accepted', async () => {
  const res = await new Promise((resolve) => {
    const req = { method: 'POST', url: '/api/admin/login', headers: {}, socket: {}, body: { password: 'wrong' } };
    const out = { writeHead(status) { this.status = status; }, end() { resolve(this); } };
    appA.handle(req, out);
  });
  assert.strictEqual(res.status, 401);
});
