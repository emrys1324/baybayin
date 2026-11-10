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
const { DB } = require('./lib/db');
const { hashPassword } = require('./lib/seed');
const { notifyNewBooking } = require('./lib/messages');

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
  const db = new DB(opts.dataDir || process.env.DATA_DIR || path.join(__dirname, 'data'));
  const data = db.data;
  const sessions = new Map();          // token -> expiry
  const loginAttempts = new Map();     // ip -> {count, until}

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
  function isAdmin(req) {
    const t = cookies(req).bay_admin;
    const exp = t && sessions.get(t);
    if (!exp) return false;
    if (exp < Date.now()) { sessions.delete(t); return false; }
    return true;
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
  function saveImage(img, isPublic) {
    if (typeof img === 'string') img = parseImage(img);
    const name = crypto.randomBytes(12).toString('hex') + img.ext;
    fs.writeFileSync(path.join(isPublic ? db.publicDir : db.privateDir, name), img.buf);
    return name;
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
  async function createBooking(req, res) {
    const body = await readBody(req);
    const draft = CORE.prepareBooking(data, body);
    const licenseImg = parseImage(body.license);
    const proofImg = draft.method === 'gcash' ? parseImage(body.payment.proof) : null;
    if (!CORE.hasFreeUnit(data, draft)) return fail(req, res, 409, 'Sorry, that scooter was just booked for those dates. Please pick another one.');
    // Everything below is synchronous => no double-booking race in a single process.
    const files = { licensePhoto: saveImage(licenseImg, false), proof: proofImg ? saveImage(proofImg, false) : null };
    const booking = CORE.commitBooking(data, draft, files, genId);
    db.save();
    notifyNewBooking(booking, data.settings);
    ok(req, res, { booking: CORE.publicView(booking) });
  }

  async function login(req, res) {
    const ip = req.socket.remoteAddress;
    const att = loginAttempts.get(ip) || { count: 0, until: 0 };
    if (att.until > Date.now()) return fail(req, res, 429, 'Too many attempts. Try again in a few minutes.');
    const body = await readBody(req);
    const { salt, hash } = data.auth;
    const given = hashPassword(String(body.password || ''), salt).hash;
    if (!crypto.timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(hash, 'hex'))) {
      att.count++; if (att.count >= 5) { att.until = Date.now() + 5 * 60e3; att.count = 0; }
      loginAttempts.set(ip, att);
      return fail(req, res, 401, 'Wrong password.');
    }
    loginAttempts.delete(ip);
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, Date.now() + SESSION_TTL);
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return send(req, res, 200, { ok: true }, { 'Set-Cookie': `bay_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}${secure}` });
  }

  async function adminRoute(req, res, sub, m) {
    let mm;
    if (sub === 'me') return ok(req, res, { ok: true });
    if (sub === 'data' && m === 'GET') {
      const { auth, ...rest } = data;
      return ok(req, res, Object.assign(rest, { summary: CORE.summary(data), now: BAY.nowLocal() }));
    }
    if (sub === 'summary') return ok(req, res, CORE.summary(data));
    if ((mm = /^bookings\/([a-f0-9]+)$/.exec(sub)) && m === 'PATCH') {
      const booking = CORE.updateBooking(data, mm[1], await readBody(req)); db.save(); return ok(req, res, { booking });
    }
    if ((mm = /^bookings\/([a-f0-9]+)\/messages$/.exec(sub)) && m === 'GET') return ok(req, res, CORE.messages(data, mm[1]));
    if (sub === 'units' && m === 'POST') { const unit = CORE.addUnit(data, await readBody(req), genId); db.save(); return ok(req, res, { unit }); }
    if ((mm = /^units\/([a-z0-9]+)$/.exec(sub))) {
      if (m === 'PUT') { const unit = CORE.editUnit(data, mm[1], await readBody(req)); db.save(); return ok(req, res, { unit }); }
      if (m === 'DELETE') { CORE.deleteUnit(data, mm[1]); db.save(); return ok(req, res, { ok: true }); }
    }
    if (sub === 'settings' && m === 'PUT') { const settings = CORE.updateSettings(data, await readBody(req)); db.save(); return ok(req, res, { settings }); }
    if (sub === 'password' && m === 'PUT') {
      const body = await readBody(req);
      if (String(body.password || '').length < 8) return fail(req, res, 400, 'Use at least 8 characters.');
      data.auth = hashPassword(body.password); db.save();
      return ok(req, res, { ok: true });
    }
    if (sub === 'upload' && m === 'POST') return ok(req, res, { file: saveImage((await readBody(req)).dataUrl, true) });
    if ((mm = /^files\/([a-f0-9]{24}\.(?:jpg|png|webp))$/.exec(sub)) && m === 'GET') {
      return serveFile(req, res, path.join(db.privateDir, mm[1]), 'private, max-age=86400');
    }
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
      if (p === '/api/config' && m === 'GET') {
        return ok(req, res, { settings: CORE.publicSettings(data), units: data.units.map(CORE.publicUnit), now: BAY.nowLocal() });
      }
      if (p === '/api/availability' && m === 'GET') {
        return ok(req, res, { models: CORE.availability(data, url.searchParams.get('pickup') || '', url.searchParams.get('return') || '') });
      }
      if (p === '/api/bookings' && m === 'POST') return await createBooking(req, res);
      if (p === '/api/bookings/lookup' && m === 'GET') {
        return ok(req, res, { booking: CORE.lookup(data, url.searchParams.get('ref'), url.searchParams.get('mobile')) });
      }
      if (p === '/api/admin/login' && m === 'POST') return await login(req, res);
      if (p === '/api/admin/logout' && m === 'POST') {
        sessions.delete(cookies(req).bay_admin);
        return send(req, res, 200, { ok: true }, { 'Set-Cookie': 'bay_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
      }
      if (p.startsWith('/api/admin/')) {
        if (!isAdmin(req)) return fail(req, res, 401, 'Please log in.');
        return await adminRoute(req, res, p.slice('/api/admin/'.length), m);
      }
      if (p.startsWith('/api/')) return fail(req, res, 404, 'Not found');

      // --- media + static ---
      if (m !== 'GET' && m !== 'HEAD') return fail(req, res, 405, 'Method not allowed');
      const mm = /^\/media\/([a-f0-9]{24}\.(?:jpg|png|webp))$/.exec(p);
      if (mm) return serveFile(req, res, path.join(db.publicDir, mm[1]), 'public, max-age=31536000, immutable');
      const rel = p === '/' ? '/index.html' : p === '/admin' || p === '/admin/' ? '/admin.html' : p;
      const file = path.normalize(path.join(PUBLIC_DIR, rel));
      if (!file.startsWith(PUBLIC_DIR + path.sep)) return fail(req, res, 403, 'Forbidden');
      return serveFile(req, res, file, 'no-cache');
    } catch (e) {
      if (!e.status) console.error(e);
      return fail(req, res, e.status || 500, e.status ? e.message : 'Something went wrong. Please try again.');
    }
  }

  return { server: http.createServer(handle), db };
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
