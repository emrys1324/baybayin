'use strict';
/* Storage backends. Both expose the same async interface:
     load()                      -> { settings, units, counter, auth, bookings[] }
     saveMeta(data)              settings, units, counter, auth
     saveBooking(booking) / deleteBooking(id)
     saveImage(name, buf, isPublic) / readImage(name, isPublic) -> Buffer|null
     withLock(fn)                run fn exclusively (prevents double-booking across instances)
     hit(key, windowSec)         -> count of hits in window (login rate limiting)

   FileStore  : JSON file + image folders. For local use or a VPS (single process).
   RedisStore : Upstash Redis over its REST API (no dependencies). For Vercel/serverless,
                where the disk is temporary and many instances run at once. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildSeed } = require('./seed');
const CORE = require('../public/js/core');

const META_KEYS = ['version', 'settings', 'units', 'counter', 'auth'];
const pickMeta = (d) => Object.fromEntries(META_KEYS.map((k) => [k, d[k]]));

class FileStore {
  constructor(dir) {
    this.kind = 'file';
    this.file = path.join(dir, 'db.json');
    this.privateDir = path.join(dir, 'uploads');      // licenses, GCash proofs (admin only)
    this.publicDir = path.join(dir, 'media');          // scooter photos, QR, gallery
    fs.mkdirSync(this.privateDir, { recursive: true });
    fs.mkdirSync(this.publicDir, { recursive: true });
    this.data = CORE.upgrade(fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : buildSeed());
    if (!fs.existsSync(this.file)) this.write();
    this.hits = new Map();
    this.queue = Promise.resolve();
  }
  write() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.file);
  }
  // Single process: the in-memory object is the source of truth.
  async load() { return this.data; }
  async saveMeta(d) { Object.assign(this.data, pickMeta(d)); this.write(); }
  async saveBooking(b) {
    const i = this.data.bookings.findIndex((x) => x.id === b.id);
    if (i < 0) this.data.bookings.push(b); else this.data.bookings[i] = b;
    this.write();
  }
  async deleteBooking(id) { this.data.bookings = this.data.bookings.filter((b) => b.id !== id); this.write(); }
  async saveImage(name, buf, isPublic) { fs.writeFileSync(path.join(isPublic ? this.publicDir : this.privateDir, name), buf); }
  async readImage(name, isPublic) {
    try { return fs.readFileSync(path.join(isPublic ? this.publicDir : this.privateDir, name)); } catch { return null; }
  }
  withLock(fn) { const run = this.queue.then(fn, fn); this.queue = run.catch(() => {}); return run; }
  async hit(key, windowSec) {
    const now = Date.now(), h = this.hits.get(key);
    if (!h || h.until < now) { this.hits.set(key, { n: 1, until: now + windowSec * 1000 }); return 1; }
    return ++h.n;
  }
}

class RedisStore {
  constructor(url, token, prefix) {
    this.kind = 'redis';
    this.url = url.replace(/\/$/, '');
    this.token = token;
    this.p = prefix || 'bay:';
  }
  async cmd(...args) {
    const r = await fetch(this.url, {
      method: 'POST', headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error('Storage error: ' + (j.error || r.status));
    return j.result;
  }
  async load() {
    let meta = await this.cmd('GET', this.p + 'meta');
    if (!meta) {
      // First run: seed sample data exactly once (SET NX), even if several instances start together.
      const seed = buildSeed();
      const created = await this.cmd('SET', this.p + 'meta', JSON.stringify(pickMeta(seed)), 'NX');
      if (created) {
        const args = ['HSET', this.p + 'bookings'];
        seed.bookings.forEach((b) => args.push(b.id, JSON.stringify(b)));
        await this.cmd(...args);
      }
      meta = await this.cmd('GET', this.p + 'meta');
    }
    const flat = (await this.cmd('HGETALL', this.p + 'bookings')) || [];
    const bookings = [];
    for (let i = 1; i < flat.length; i += 2) bookings.push(JSON.parse(flat[i]));
    return CORE.upgrade(Object.assign(JSON.parse(meta), { bookings }));
  }
  async saveMeta(d) { await this.cmd('SET', this.p + 'meta', JSON.stringify(pickMeta(d))); }
  async saveBooking(b) { await this.cmd('HSET', this.p + 'bookings', b.id, JSON.stringify(b)); }
  async deleteBooking(id) { await this.cmd('HDEL', this.p + 'bookings', id); }
  async saveImage(name, buf, isPublic) { await this.cmd('SET', this.p + (isPublic ? 'media:' : 'file:') + name, buf.toString('base64')); }
  async readImage(name, isPublic) {
    const v = await this.cmd('GET', this.p + (isPublic ? 'media:' : 'file:') + name);
    return v ? Buffer.from(v, 'base64') : null;
  }
  async withLock(fn) {
    const key = this.p + 'lock', id = crypto.randomBytes(8).toString('hex');
    for (let i = 0; i < 50; i++) {
      if (await this.cmd('SET', key, id, 'NX', 'PX', '10000')) {
        try { return await fn(); }
        finally { await this.cmd('EVAL', "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) end return 0", '1', key, id).catch(() => {}); }
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Object.assign(new Error('Busy, please try again.'), { status: 503 });
  }
  async hit(key, windowSec) {
    const k = this.p + 'hit:' + key;
    const n = await this.cmd('INCR', k);
    if (n === 1) await this.cmd('EXPIRE', k, String(windowSec));
    return n;
  }
}

/** Find Upstash REST credentials in the environment, however Vercel named them.
    Accepts UPSTASH_REDIS_REST_URL/TOKEN, KV_REST_API_URL/TOKEN, the same with a custom prefix
    (e.g. STORAGE_KV_REST_API_URL, which Vercel adds when a prefix is set on connect), or an
    Upstash connection string (REDIS_URL / KV_URL, rediss://default:TOKEN@host.upstash.io:6379). */
function redisConfig(env = process.env) {
  const keys = Object.keys(env).sort((a, b) => a.length - b.length);   // exact names before prefixed ones
  for (const [u, t] of [['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'], ['KV_REST_API_URL', 'KV_REST_API_TOKEN']]) {
    for (const k of keys) {
      if (!k.endsWith(u) || !env[k]) continue;
      const tk = k.slice(0, k.length - u.length) + t;
      if (env[tk]) return { url: env[k].trim(), token: env[tk].trim(), source: k };
    }
  }
  for (const k of keys) {
    if (!/(^|_)(REDIS_URL|KV_URL)$/.test(k) || !env[k]) continue;
    try {
      const c = new URL(env[k].trim());
      if (/^rediss?:$/.test(c.protocol) && /\.upstash\.io$/.test(c.hostname) && c.password) {
        return { url: 'https://' + c.hostname, token: decodeURIComponent(c.password), source: k };
      }
    } catch { /* not a URL */ }
  }
  return null;
}

/** Names (never values) of environment variables that look storage-related, for /api/health. */
function storageEnvNames(env = process.env) {
  return Object.keys(env).filter((k) => /REDIS|KV_|UPSTASH/.test(k)).sort();
}

/** Pick a backend from the environment. */
function createStore(opts = {}) {
  const cfg = opts.dataDir ? null : redisConfig();
  if (cfg) return new RedisStore(cfg.url, cfg.token, process.env.REDIS_PREFIX);
  if (process.env.VERCEL && !opts.dataDir) return null;   // serverless with no database: refuse rather than lose bookings
  return new FileStore(opts.dataDir || process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
}

module.exports = { FileStore, RedisStore, createStore, redisConfig, storageEnvNames };
