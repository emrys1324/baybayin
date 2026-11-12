'use strict';
/* Baybayin Scooter Rental — zero-dependency Node server.
   Serves the static SPA (public/), a JSON API (/api/*), and uploaded images.
   Business rules live in public/js/core.js (shared with the standalone demo). */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const BAY = require('./public/js/shared');
const CORE = require('./public/js/core');
const { createStore, redisConfig, storageEnvNames } = require('./lib/store');
const { hashPassword } = require('./lib/seed');
const { notifyNewBooking } = require('./lib/messages');
const sms = require('./lib/sms');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 8 * 1024 * 1024;       // 8 MB (images are compressed in the browser first)
const MAX_IMAGE = 3 * 1024 * 1024;
const SESSION_TTL = 7 * 24 * 3600e3;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain'
};
const genId = () => crypto.randomBytes(6).toString('hex');

function createApp(opts = {}) {
  const store = createStore(opts);

  /** Setup diagnostics: which storage is in use and whether it answers. Shows env var NAMES only. */
  async function health() {
    const out = { ok: false, storage: store ? store.kind : 'none', vercel: !!process.env.VERCEL };
    if (!store) {
      out.envSeen = storageEnvNames();
      out.hint = out.envSeen.length
        ? 'Storage variables found, but none are Upstash REST credentials. In Vercel: Storage → Upstash for Redis (Upstash, not another Redis), connect it to this project, then redeploy.'
        : 'No database variables in this deployment. In Vercel: Storage → Create Database → Upstash for Redis → connect to this project (tick Production), then Deployments → Redeploy.';
      return out;
    }
    if (store.kind === 'redis') {
      out.source = (redisConfig() || {}).source;
      try { out.ok = (await store.cmd('PING')) === 'PONG'; } catch (e) { out.error = String(e.message).slice(0, 200); }
      if (!out.ok) out.hint = 'Database variables found but the database did not answer. Check the Upstash database still exists and the token is current.';
      return out;
    }
    out.ok = true;
    return out;
  }

  // ---------- helpers ----------
  function send(req, res, status, body, headers = {}) {
    let buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const h = Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }, headers);
    if (buf.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '') && /json|text|javascript|svg|csv/.test(h['Content-Type'])) {
      buf = zlib.gzipSync(buf); h['Content-Encoding'] = 'gzip'; h['Vary'] = 'Accept-Encoding';
    }
    h['Content-Length'] = buf.length;
    res.writeHead(status, h);
    res.end(req.method === 'HEAD' ? undefined : buf);
  }
  const ok = (req, res, payload) => send(req, res, 200, payload);
  const fail = (req, res, status, error) => send(req, res, status, { error });

  function readBody(req) {
    if (req.body !== undefined) {           // already parsed by the platform (e.g. Vercel)
      if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
        try { return Promise.resolve(JSON.parse(String(req.body) || '{}')); }
        catch { return Promise.reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
      }
      return Promise.resolve(req.body || {});
    }
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(Object.assign(new Error('Upload too large'), { status: 413 })); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
      });
      req.on('error', reject);
    });
  }

  function cookies(req) {
    const out = {};
    (req.headers.cookie || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
    return out;
  }
  // Stateless signed session token "<expiry>.<hmac>", so any server instance can verify it.
  // The key derives from the password hash: changing the password logs everyone out.
  const sign = (data, exp) => crypto.createHmac('sha256', (process.env.SESSION_SECRET || '') + data.auth.hash).update(String(exp)).digest('hex');
  function makeToken(data) { const exp = Date.now() + SESSION_TTL; return exp + '.' + sign(data, exp); }
  function isAdmin(req, data) {
    const [exp, mac] = String(cookies(req).bay_admin || '').split('.');
    if (!exp || !mac || +exp < Date.now()) return false;
    const want = Buffer.from(sign(data, exp), 'hex'), got = Buffer.from(mac, 'hex');
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  }

  /** Decode a data: URL and verify it's really an image. Returns { buf, ext }. */
  function parseImage(dataUrl) {
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl || '');
    if (!m) throw Object.assign(new Error('Please upload a JPG or PNG image.'), { status: 400 });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > MAX_IMAGE) throw Object.assign(new Error('Image is too large (max 3 MB).'), { status: 413 });
    const sig = buf.subarray(0, 12).toString('hex');
    const ext = sig.startsWith('ffd8ff') ? '.jpg' : sig.startsWith('89504e47') ? '.png'
      : (sig.startsWith('52494646') && buf.subarray(8, 12).toString() === 'WEBP') ? '.webp' : null;
    if (!ext) throw Object.assign(new Error('That file does not look like an image.'), { status: 400 });
    return { buf, ext };
  }
  /** Save a parsed (or raw data: URL) image, return its random filename. */
  async function saveImage(img, isPublic) {
    if (typeof img === 'string') img = parseImage(img);
    const name = crypto.randomBytes(12).toString('hex') + img.ext;
    await store.saveImage(name, img.buf, isPublic);
    return name;
  }
  async function serveImage(req, res, name, isPublic) {
    const buf = await store.readImage(name, isPublic);
    if (!buf) return send(req, res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    send(req, res, 200, buf, { 'Content-Type': MIME[path.extname(name)], 'Cache-Control': isPublic ? 'public, max-age=31536000, immutable' : 'private, max-age=86400' });
  }

  /** Send an SMS for a booking and log the attempt on it. kind: 'received' | 'confirm'. */
  async function smsBooking(b, data, kind) {
    const r = await sms.send(b.customer.mobile, CORE.smsText(b, data.settings, kind));
    b.sms = (b.sms || []).concat({ at: new Date().toISOString(), kind, ok: r.ok, error: r.error || undefined, to: r.to });
    await store.saveBooking(b);
    return r;
  }

  // Is the admin still using the default password? (cached per password hash)
  let pwCheck = { hash: null, isDefault: false };
  function usesDefaultPassword(data) {
    if (pwCheck.hash !== data.auth.hash) {
      pwCheck = { hash: data.auth.hash, isDefault: hashPassword('baybayin2026', data.auth.salt).hash === data.auth.hash };
    }
    return pwCheck.isDefault;
  }

  function serveFile(req, res, file, cacheControl) {
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return send(req, res, 404, 'Not found', { 'Content-Type': 'text/plain' });
      const etag = `"${st.size.toString(36)}-${st.mtimeMs.toString(36)}"`;
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      const headers = { 'Content-Type': type, 'Cache-Control': cacheControl, ETag: etag };
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
      fs.readFile(file, (e, buf) => (e ? send(req, res, 500, 'Error', { 'Content-Type': 'text/plain' }) : send(req, res, 200, buf, headers)));
    });
  }

  // ---------- route handlers ----------
  async function createBooking(req, res, data) {
    const body = await readBody(req);
    const draft = CORE.prepareBooking(data, body);
    const licenseImg = parseImage(body.license);
    const proofImg = draft.method === 'gcash' ? parseImage(body.payment.proof) : null;
    if (!CORE.hasFreeUnit(data, draft)) return fail(req, res, 409, 'Sorry, that scooter was just booked for those dates. Please pick another one.');
    const files = { licensePhoto: await saveImage(licenseImg, false), proof: proofImg ? await saveImage(proofImg, false) : null };
    // Re-check and write under a lock => no double-booking, even with several server instances.
    const booking = await store.withLock(async () => {
      const fresh = await store.load();
      const b = CORE.commitBooking(fresh, draft, files, genId);
      await store.saveBooking(b);
      await store.saveMeta(fresh);           // booking counter
      return b;
    });
    await notifyNewBooking(booking, data.settings);
    if (data.settings.smsOnReceived && sms.enabled()) await smsBooking(booking, data, 'received');
    ok(req, res, { booking: CORE.publicView(booking) });
  }

  async function login(req, res, data) {
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (await store.hit('login:' + ip, 300) > 10) return fail(req, res, 429, 'Too many attempts. Try again in a few minutes.');
    const body = await readBody(req);
    const { salt, hash } = data.auth;
    const given = hashPassword(String(body.password || ''), salt).hash;
    if (!crypto.timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(hash, 'hex'))) return fail(req, res, 401, 'Wrong password.');
    const token = makeToken(data);
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return send(req, res, 200, { ok: true }, { 'Set-Cookie': `bay_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}${secure}` });
  }

  async function adminRoute(req, res, sub, m, data) {
    let mm;
    if (sub === 'me') return ok(req, res, { ok: true });
    if (sub === 'data' && m === 'GET') {
      const { auth, ...rest } = data;
      const extra = { defaultPassword: usesDefaultPassword(data), smsEnabled: sms.enabled(), storage: store.kind };
      return ok(req, res, Object.assign({}, rest, extra, { summary: CORE.summary(data), now: BAY.nowLocal(), setup: CORE.setupChecklist(data, extra) }));
    }
    if (sub === 'summary') return ok(req, res, CORE.summary(data));
    if ((mm = /^bookings\/([a-f0-9]+)$/.exec(sub)) && m === 'PATCH') {
      const before = (data.bookings.find((x) => x.id === mm[1]) || {}).status;
      const booking = CORE.updateBooking(data, mm[1], await readBody(req));
      await store.saveBooking(booking); await store.saveMeta(data);   // unit status may change too
      let smsResult;
      if (booking.status === 'confirmed' && before !== 'confirmed' && data.settings.smsOnConfirm && sms.enabled()) {
        smsResult = await smsBooking(booking, data, 'confirm');
      }
      return ok(req, res, { booking, sms: smsResult });
    }
    if ((mm = /^bookings\/([a-f0-9]+)\/messages$/.exec(sub)) && m === 'GET') return ok(req, res, CORE.messages(data, mm[1]));
    if ((mm = /^bookings\/([a-f0-9]+)\/sms$/.exec(sub)) && m === 'POST') {
      const b = data.bookings.find((x) => x.id === mm[1]);
      if (!b) return fail(req, res, 404, 'Booking not found');
      if (!sms.enabled()) return fail(req, res, 400, 'SMS is not set up yet. Use "Copy message" instead.');
      const body = await readBody(req);
      const r = await smsBooking(b, data, body.kind === 'received' ? 'received' : 'confirm');
      return r.ok ? ok(req, res, { booking: b, sms: r }) : fail(req, res, 502, r.error);
    }
    if (sub === 'walkins' && m === 'POST') {
      const body = await readBody(req);
      const draft = CORE.prepareWalkIn(data, body);
      const files = { licensePhoto: body.license ? await saveImage(body.license, false) : null };
      const booking = await store.withLock(async () => {
        const fresh = await store.load();
        const b = CORE.commitWalkIn(fresh, draft, files, genId);
        await store.saveBooking(b);
        await store.saveMeta(fresh);          // counter + unit status
        return b;
      });
      return ok(req, res, { booking });
    }
    if (sub === 'sample-bookings' && m === 'DELETE') {
      const removed = CORE.clearSamples(data);
      for (const id of removed) await store.deleteBooking(id);
      await store.saveMeta(data);
      return ok(req, res, { removed: removed.length });
    }
    if (sub === 'units' && m === 'POST') { const unit = CORE.addUnit(data, await readBody(req), genId); await store.saveMeta(data); return ok(req, res, { unit }); }
    if ((mm = /^units\/([a-z0-9]+)$/.exec(sub))) {
      if (m === 'PUT') { const unit = CORE.editUnit(data, mm[1], await readBody(req)); await store.saveMeta(data); return ok(req, res, { unit }); }
      if (m === 'DELETE') { CORE.deleteUnit(data, mm[1]); await store.saveMeta(data); return ok(req, res, { ok: true }); }
    }
    if (sub === 'settings' && m === 'PUT') { const settings = CORE.updateSettings(data, await readBody(req)); await store.saveMeta(data); return ok(req, res, { settings }); }
    if (sub === 'password' && m === 'PUT') {
      const body = await readBody(req);
      if (String(body.password || '').length < 8) return fail(req, res, 400, 'Use at least 8 characters.');
      data.auth = hashPassword(body.password); await store.saveMeta(data);
      // Old sessions are now invalid; issue a fresh one for this admin.
      const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      return send(req, res, 200, { ok: true }, { 'Set-Cookie': `bay_admin=${makeToken(data)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}${secure}` });
    }
    if (sub === 'upload' && m === 'POST') return ok(req, res, { file: await saveImage((await readBody(req)).dataUrl, true) });
    if ((mm = /^files\/([a-f0-9]{24}\.(?:jpg|png|webp))$/.exec(sub)) && m === 'GET') return serveImage(req, res, mm[1], false);
    if (sub === 'export.csv' && m === 'GET') {
      return send(req, res, 200, CORE.exportCsv(data), {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="baybayin-bookings-${BAY.today()}.csv"`
      });
    }
    return fail(req, res, 404, 'Not found');
  }

  // ---------- router ----------
  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const m = req.method;
    try {
      let mm;
      if ((mm = /^\/(?:api\/)?media\/([a-f0-9]{24}\.(?:jpg|png|webp))$/.exec(p)) && (m === 'GET' || m === 'HEAD')) {
        if (!store) return fail(req, res, 404, 'Not found');
        return await serveImage(req, res, mm[1], true);
      }
      if (p === '/api/health' && m === 'GET') return ok(req, res, await health());
      if (p.startsWith('/api/')) {
        if (!store) return fail(req, res, 503, 'Online booking is being set up. Please message us on Facebook Messenger to book.');
        return await apiRoute(req, res, url, p, m, await store.load());
      }
      if (m !== 'GET' && m !== 'HEAD') return fail(req, res, 405, 'Method not allowed');
      const rel = p === '/' ? '/index.html' : p === '/admin' || p === '/admin/' ? '/admin.html' : p;
      const file = path.normalize(path.join(PUBLIC_DIR, rel));
      if (!file.startsWith(PUBLIC_DIR + path.sep)) return fail(req, res, 403, 'Forbidden');
      return serveFile(req, res, file, 'no-cache');
    } catch (e) {
      if (!e.status) console.error(e);
      return fail(req, res, e.status || 500, e.status ? e.message : 'Something went wrong. Please try again.');
    }
  }

  async function apiRoute(req, res, url, p, m, data) {
    if (p === '/api/config' && m === 'GET') {
      return ok(req, res, { settings: CORE.publicSettings(data), units: data.units.map(CORE.publicUnit), now: BAY.nowLocal() });
    }
    if (p === '/api/availability' && m === 'GET') {
      return ok(req, res, { models: CORE.availability(data, url.searchParams.get('pickup') || '', url.searchParams.get('return') || '') });
    }
    if (p === '/api/bookings' && m === 'POST') return await createBooking(req, res, data);
    if (p === '/api/bookings/lookup' && m === 'GET') {
      return ok(req, res, { booking: CORE.lookup(data, url.searchParams.get('ref'), url.searchParams.get('mobile')) });
    }
    if (p === '/api/admin/login' && m === 'POST') return await login(req, res, data);
    if (p === '/api/admin/logout' && m === 'POST') {
      return send(req, res, 200, { ok: true }, { 'Set-Cookie': 'bay_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    }
    if (p.startsWith('/api/admin/')) {
      if (!isAdmin(req, data)) return fail(req, res, 401, 'Please log in.');
      return await adminRoute(req, res, p.slice('/api/admin/'.length), m, data);
    }
    return fail(req, res, 404, 'Not found');
  }

  return { server: http.createServer(handle), handle, store };
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  const { server } = createApp();
  server.listen(port, () => {
    console.log(`Baybayin Scooter Rental running on http://localhost:${port}`);
    console.log(`Admin dashboard: http://localhost:${port}/admin`);
    if (!process.env.ADMIN_PASSWORD) console.log('Default admin password: baybayin2026 (change it in Admin → Settings)');
  });
}

module.exports = { createApp };
