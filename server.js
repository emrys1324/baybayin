'use strict';
/* Baybayin Scooter Rental — zero-dependency Node server.
   Serves the static SPA (public/), a JSON API (/api/*), and uploaded images. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const BAY = require('./public/js/shared');
const { DB } = require('./lib/db');
const { hashPassword } = require('./lib/seed');
const msg = require('./lib/messages');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 8 * 1024 * 1024;       // 8 MB (images are compressed in the browser first)
const MAX_IMAGE = 3 * 1024 * 1024;
const SESSION_TTL = 7 * 24 * 3600e3;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain'
};

function createApp(opts = {}) {
  const db = new DB(opts.dataDir || process.env.DATA_DIR || path.join(__dirname, 'data'));
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
  const ok = (req, res, data) => send(req, res, 200, data);
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

  const str = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);
  const num = (v, min = 0, max = 1e7) => { const n = Number(v); return isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : min; };

  function publicSettings() {
    const s = db.settings;
    const { adminEmail, ...rest } = s;
    return rest;
  }
  function publicUnit(u) { const { plate, ...rest } = u; return rest; }

  function unitBusy(unitId, pickup, ret, excludeId) {
    return db.bookings.some((b) => b.scooterId === unitId && b.id !== excludeId &&
      BAY.ACTIVE_STATUSES.includes(b.status) && BAY.overlaps(pickup, ret, b.pickup, b.return, db.settings.bufferMinutes));
  }
  function freeUnits(pickup, ret, excludeId) {
    return db.units.filter((u) => u.status !== 'maintenance' && !unitBusy(u.id, pickup, ret, excludeId));
  }
  /** Group fleet by model name for the customer view. */
  function availability(pickup, ret) {
    const free = new Set(freeUnits(pickup, ret).map((u) => u.id));
    const groups = new Map();
    db.units.forEach((u) => {
      if (!groups.has(u.name)) groups.set(u.name, { model: u.name, total: 0, available: 0, unit: null, first: u });
      const g = groups.get(u.name);
      if (u.status !== 'maintenance') g.total++;
      if (free.has(u.id)) { g.available++; if (!g.unit) g.unit = u; }
    });
    return [...groups.values()].filter((g) => g.total > 0).map((g) => {
      const u = g.unit || g.first;
      return { model: g.model, available: g.available, total: g.total, unit: publicUnit(u), quote: BAY.quote(u, pickup, ret, {}, db.settings) };
    }).sort((a, b) => (b.available > 0) - (a.available > 0) || a.unit.dailyRate - b.unit.dailyRate);
  }

  function summary() {
    const t = BAY.today();
    const dow = new Date(BAY.toEpoch(t + 'T00:00') + 8 * 3600e3).getUTCDay();
    const weekStart = BAY.addDays(t, -((dow + 6) % 7));     // Monday
    const monthStart = t.slice(0, 8) + '01';
    const counted = db.bookings.filter((b) => ['confirmed', 'picked_up', 'returned'].includes(b.status));
    const period = (from, to) => {
      const list = counted.filter((b) => b.pickup.slice(0, 10) >= from && b.pickup.slice(0, 10) <= to);
      return { bookings: list.length, revenue: list.reduce((s, b) => s + b.quote.total, 0) };
    };
    const byModel = {};
    counted.forEach((b) => { byModel[b.model] = (byModel[b.model] || 0) + 1; });
    const top = Object.entries(byModel).sort((a, b) => b[1] - a[1])[0];
    return {
      week: period(weekStart, BAY.addDays(weekStart, 6)), month: period(monthStart, t.slice(0, 8) + '31'), weekStart, monthStart,
      topModel: top ? { model: top[0], count: top[1] } : null,
      pending: db.bookings.filter((b) => b.status === 'pending').length,
      depositsHeld: db.bookings.filter((b) => b.deposit === 'collected').reduce((s, b) => s + b.quote.deposit, 0),
      outNow: db.bookings.filter((b) => b.status === 'picked_up').length,
      pickupsToday: db.bookings.filter((b) => ['confirmed', 'pending'].includes(b.status) && b.pickup.startsWith(t)).length,
      returnsToday: db.bookings.filter((b) => b.status === 'picked_up' && b.return.startsWith(t)).length
    };
  }

  function csv(rows) {
    return rows.map((r) => r.map((v) => {
      let s = String(v == null ? '' : v);
      if (/^[=+\-@]/.test(s)) s = "'" + s;                 // avoid spreadsheet formula injection
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\r\n');
  }

  // ---------- route handlers ----------
  async function createBooking(req, res) {
    const body = await readBody(req);
    const s = db.settings;
    const pickup = str(body.pickup, 16), ret = str(body.return, 16);
    const err = BAY.validateWindow(pickup, ret, s);
    if (err) return fail(req, res, 400, err);
    const c = body.customer || {};
    const customer = {
      name: str(c.name, 80), mobile: str(c.mobile, 20).replace(/[^\d+]/g, ''), email: str(c.email, 120),
      fb: str(c.fb, 80), stayingAt: str(c.stayingAt, 120), riders: num(c.riders, 1, s.maxRiders || 2)
    };
    if (customer.name.length < 2) return fail(req, res, 400, 'Please enter your full name.');
    if (!/^(\+?63|0)9\d{9}$/.test(customer.mobile) && !/^\+\d{8,15}$/.test(customer.mobile)) {
      return fail(req, res, 400, 'Please enter a valid mobile number (e.g. 0917 123 4567).');
    }
    if (customer.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customer.email)) return fail(req, res, 400, 'Please check your email address.');
    if (!body.agreeTerms) return fail(req, res, 400, 'Please agree to the rental terms.');
    if (!body.license) return fail(req, res, 400, 'Please upload a photo of your driver\'s license.');
    const method = body.payment && body.payment.method === 'gcash' ? 'gcash' : 'cash';
    const gcashRef = method === 'gcash' ? str(body.payment.gcashRef, 40) : '';
    if (method === 'gcash' && gcashRef.replace(/\D/g, '').length < 6) return fail(req, res, 400, 'Please enter your GCash reference number.');
    if (method === 'gcash' && !body.payment.proof) return fail(req, res, 400, 'Please upload your GCash payment screenshot.');
    const licenseImg = parseImage(body.license);
    const proofImg = method === 'gcash' ? parseImage(body.payment.proof) : null;

    // Availability check + write happen synchronously => no double-booking race in a single process.
    const model = str(body.model, 80);
    const unit = freeUnits(pickup, ret).find((u) => u.name === model);
    if (!unit) return fail(req, res, 409, 'Sorry, that scooter was just booked for those dates. Please pick another one.');
    const addonSel = {};
    Object.entries(body.addons || {}).forEach(([k, v]) => { addonSel[str(k, 40)] = num(v, 0, 10); });
    const licensePhoto = saveImage(licenseImg, false);
    const proof = proofImg ? saveImage(proofImg, false) : null;

    const booking = {
      id: DB.id(), ref: db.nextRef(), createdAt: new Date().toISOString(), status: 'pending',
      scooterId: unit.id, model: unit.name, pickup, return: ret,
      addonSel, quote: BAY.quote(unit, pickup, ret, addonSel, s), customer, licensePhoto,
      payment: { method, gcashRef, proof, status: 'unpaid' }, deposit: 'pending', notes: '',
      history: [{ at: new Date().toISOString(), status: 'pending' }]
    };
    db.bookings.push(booking);
    db.save();
    msg.notifyNewBooking(booking, s);
    ok(req, res, { booking: msg.publicView(booking) });
  }

  async function updateBooking(req, res, id) {
    const b = db.bookings.find((x) => x.id === id);
    if (!b) return fail(req, res, 404, 'Booking not found');
    const body = await readBody(req);
    if (body.scooterId && body.scooterId !== b.scooterId) {
      const u = db.units.find((x) => x.id === body.scooterId);
      if (!u) return fail(req, res, 400, 'Unknown scooter');
      if (unitBusy(u.id, b.pickup, b.return, b.id)) return fail(req, res, 409, `${u.name} (${u.plate}) is already booked during this time.`);
      b.scooterId = u.id; b.model = u.name;
      b.quote = BAY.quote(u, b.pickup, b.return, b.addonSel, db.settings);
    }
    if (body.status && body.status !== b.status) {
      if (!BAY.STATUS_LABELS[body.status]) return fail(req, res, 400, 'Bad status');
      if (BAY.ACTIVE_STATUSES.includes(body.status) && !BAY.ACTIVE_STATUSES.includes(b.status) && unitBusy(b.scooterId, b.pickup, b.return, b.id)) {
        return fail(req, res, 409, 'This scooter is now booked by someone else for these dates. Reassign a scooter first.');
      }
      b.status = body.status;
      b.history.push({ at: new Date().toISOString(), status: b.status });
      const unit = db.units.find((u) => u.id === b.scooterId);
      if (unit && b.status === 'picked_up') unit.status = 'rented';
      if (unit && ['returned', 'cancelled'].includes(b.status) && unit.status === 'rented') unit.status = 'available';
    }
    if (body.deposit && ['pending', 'collected', 'refunded'].includes(body.deposit)) b.deposit = body.deposit;
    if (body.paymentStatus && ['unpaid', 'paid'].includes(body.paymentStatus)) b.payment.status = body.paymentStatus;
    if (typeof body.notes === 'string') b.notes = str(body.notes, 1000);
    db.save();
    ok(req, res, { booking: b });
  }

  function cleanUnit(body, existing = {}) {
    const status = ['available', 'rented', 'maintenance'].includes(body.status) ? body.status : (existing.status || 'available');
    return {
      id: existing.id || DB.id(),
      name: str(body.name, 60) || existing.name || 'Scooter',
      plate: str(body.plate, 20),
      color: /^#[0-9a-f]{6}$/i.test(body.color || '') ? body.color : (existing.color || '#1f6fb2'),
      photo: body.photo === null ? null : (typeof body.photo === 'string' && /^[a-f0-9]{24}\.(jpg|png|webp)$/.test(body.photo) ? body.photo : existing.photo || null),
      dailyRate: num(body.dailyRate, 0), halfDayRate: num(body.halfDayRate, 0), multiDayRate: num(body.multiDayRate, 0),
      description: str(body.description, 160), status
    };
  }

  function updateSettings(body) {
    const s = db.settings;
    ['shopName', 'tagline', 'address', 'landmark', 'mapsUrl', 'phone', 'messengerUrl', 'gcashNumber', 'gcashName', 'adminEmail']
      .forEach((k) => { if (k in body) s[k] = str(body[k], 300); });
    if ('intro' in body) s.intro = str(body.intro, 1000);
    ['openTime', 'closeTime'].forEach((k) => { if (/^\d{2}:\d{2}$/.test(body[k] || '')) s[k] = body[k]; });
    const nums = { slotMinutes: [15, 120], leadMinutes: [0, 10080], bufferMinutes: [0, 1440], graceMinutes: [0, 600], minHours: [1, 48],
      maxDays: [1, 365], halfDayHours: [1, 23], multiDayMinDays: [2, 60], deposit: [0, 1e6], lateFeePerHour: [0, 1e5],
      freeCancelHours: [0, 720], maxRiders: [1, 3] };
    Object.entries(nums).forEach(([k, [lo, hi]]) => { if (k in body) s[k] = num(body[k], lo, hi); });
    if ('gcashQr' in body) s.gcashQr = body.gcashQr && /^[a-f0-9]{24}\.(jpg|png|webp)$/.test(body.gcashQr) ? body.gcashQr : null;
    if (Array.isArray(body.gallery)) s.gallery = body.gallery.filter((g) => /^[a-f0-9]{24}\.(jpg|png|webp)$/.test(g)).slice(0, 8);
    if (Array.isArray(body.terms)) s.terms = body.terms.map((t) => str(t, 500)).filter(Boolean).slice(0, 30);
    if (Array.isArray(body.addons)) {
      s.addons = body.addons.slice(0, 20).map((a) => ({
        id: str(a.id, 40).replace(/[^a-z0-9_-]/gi, '') || DB.id(), name: str(a.name, 60) || 'Add-on',
        price: num(a.price, 0), perDay: !!a.perDay, maxQty: num(a.maxQty, 1, 10), active: a.active !== false
      }));
    }
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

  // ---------- router ----------
  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const m = req.method;
    try {
      // --- public API ---
      if (p === '/api/config' && m === 'GET') {
        return ok(req, res, { settings: publicSettings(), units: db.units.map(publicUnit), now: BAY.nowLocal() });
      }
      if (p === '/api/availability' && m === 'GET') {
        const pickup = url.searchParams.get('pickup') || '', ret = url.searchParams.get('return') || '';
        const err = BAY.validateWindow(pickup, ret, db.settings);
        if (err) return fail(req, res, 400, err);
        return ok(req, res, { models: availability(pickup, ret) });
      }
      if (p === '/api/bookings' && m === 'POST') return await createBooking(req, res);
      if (p === '/api/bookings/lookup' && m === 'GET') {
        const ref = (url.searchParams.get('ref') || '').trim().toUpperCase();
        const mobile = (url.searchParams.get('mobile') || '').replace(/\D/g, '').slice(-10);
        const b = db.bookings.find((x) => x.ref === ref && x.customer.mobile.replace(/\D/g, '').slice(-10) === mobile);
        return b ? ok(req, res, { booking: msg.publicView(b) }) : fail(req, res, 404, 'No booking found with that reference and mobile number.');
      }

      // --- admin auth ---
      if (p === '/api/admin/login' && m === 'POST') {
        const ip = req.socket.remoteAddress;
        const att = loginAttempts.get(ip) || { count: 0, until: 0 };
        if (att.until > Date.now()) return fail(req, res, 429, 'Too many attempts. Try again in a few minutes.');
        const body = await readBody(req);
        const { salt, hash } = db.data.auth;
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
      if (p === '/api/admin/logout' && m === 'POST') {
        sessions.delete(cookies(req).bay_admin);
        return send(req, res, 200, { ok: true }, { 'Set-Cookie': 'bay_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
      }
      if (p.startsWith('/api/admin/')) {
        if (!isAdmin(req)) return fail(req, res, 401, 'Please log in.');
        const sub = p.slice('/api/admin/'.length);
        let mm;
        if (sub === 'me') return ok(req, res, { ok: true });
        if (sub === 'data' && m === 'GET') {
          return ok(req, res, { settings: db.settings, units: db.units, bookings: db.bookings, summary: summary(), now: BAY.nowLocal() });
        }
        if (sub === 'summary') return ok(req, res, summary());
        if ((mm = /^bookings\/([a-f0-9]+)$/.exec(sub)) && m === 'PATCH') return await updateBooking(req, res, mm[1]);
        if ((mm = /^bookings\/([a-f0-9]+)\/messages$/.exec(sub)) && m === 'GET') {
          const b = db.bookings.find((x) => x.id === mm[1]);
          if (!b) return fail(req, res, 404, 'Not found');
          return ok(req, res, { admin: msg.adminAlert(b, db.settings), customer: msg.customerConfirmation(b, db.settings) });
        }
        if (sub === 'units' && m === 'POST') {
          const u = cleanUnit(await readBody(req)); db.units.push(u); db.save(); return ok(req, res, { unit: u });
        }
        if ((mm = /^units\/([a-z0-9]+)$/.exec(sub))) {
          const i = db.units.findIndex((x) => x.id === mm[1]);
          if (i < 0) return fail(req, res, 404, 'Scooter not found');
          if (m === 'PUT') { db.units[i] = cleanUnit(await readBody(req), db.units[i]); db.save(); return ok(req, res, { unit: db.units[i] }); }
          if (m === 'DELETE') {
            if (db.bookings.some((b) => b.scooterId === mm[1] && BAY.ACTIVE_STATUSES.includes(b.status))) {
              return fail(req, res, 409, 'This scooter has active bookings. Reassign or cancel them first, or set it to Under maintenance.');
            }
            db.units.splice(i, 1); db.save(); return ok(req, res, { ok: true });
          }
        }
        if (sub === 'settings' && m === 'PUT') { updateSettings(await readBody(req)); db.save(); return ok(req, res, { settings: db.settings }); }
        if (sub === 'password' && m === 'PUT') {
          const body = await readBody(req);
          if (String(body.password || '').length < 8) return fail(req, res, 400, 'Use at least 8 characters.');
          db.data.auth = hashPassword(body.password); db.save();
          return ok(req, res, { ok: true });
        }
        if (sub === 'upload' && m === 'POST') {
          const body = await readBody(req);
          return ok(req, res, { file: saveImage(body.dataUrl, true) });
        }
        if ((mm = /^files\/([a-f0-9]{24}\.(?:jpg|png|webp))$/.exec(sub)) && m === 'GET') {
          return serveFile(req, res, path.join(db.privateDir, mm[1]), 'private, max-age=86400');
        }
        if (sub === 'export.csv' && m === 'GET') {
          const unitById = Object.fromEntries(db.units.map((u) => [u.id, u]));
          const rows = [['Ref', 'Created', 'Status', 'Scooter', 'Plate', 'Pickup', 'Return', 'Name', 'Mobile', 'Email', 'Facebook', 'Staying at',
            'Riders', 'Add-ons', 'Rental', 'Add-ons total', 'Total', 'Deposit', 'Deposit status', 'Payment', 'GCash ref', 'Payment status', 'Notes']];
          db.bookings.slice().sort((a, b) => a.pickup.localeCompare(b.pickup)).forEach((b) => rows.push([
            b.ref, b.createdAt, BAY.STATUS_LABELS[b.status], b.model, (unitById[b.scooterId] || {}).plate, b.pickup.replace('T', ' '), b.return.replace('T', ' '),
            b.customer.name, b.customer.mobile, b.customer.email, b.customer.fb, b.customer.stayingAt, b.customer.riders,
            b.quote.addons.map((a) => a.name + ' x' + a.qty).join('; '), b.quote.rental, b.quote.addonsTotal, b.quote.total,
            b.quote.deposit, b.deposit, b.payment.method, b.payment.gcashRef, b.payment.status, b.notes
          ]));
          return send(req, res, 200, '﻿' + csv(rows), {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="baybayin-bookings-${BAY.today()}.csv"`
          });
        }
        return fail(req, res, 404, 'Not found');
      }
      if (p.startsWith('/api/')) return fail(req, res, 404, 'Not found');

      // --- media + static ---
      if (m !== 'GET' && m !== 'HEAD') return fail(req, res, 405, 'Method not allowed');
      let mm;
      if ((mm = /^\/media\/([a-f0-9]{24}\.(?:jpg|png|webp))$/.exec(p))) {
        return serveFile(req, res, path.join(db.publicDir, mm[1]), 'public, max-age=31536000, immutable');
      }
      let rel = p === '/' ? '/index.html' : p === '/admin' || p === '/admin/' ? '/admin.html' : p;
      const file = path.normalize(path.join(PUBLIC_DIR, rel));
      if (!file.startsWith(PUBLIC_DIR + path.sep)) return fail(req, res, 403, 'Forbidden');
      return serveFile(req, res, file, 'no-cache');
    } catch (e) {
      if (!e.status) console.error(e);
      return fail(req, res, e.status || 500, e.status ? e.message : 'Something went wrong. Please try again.');
    }
  }

  const server = http.createServer(handle);
  return { server, db };
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
