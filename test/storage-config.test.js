'use strict';
/* Finding Upstash credentials however Vercel named them, and the setup diagnostics on /api/health. */
const { test } = require('node:test');
const assert = require('node:assert');
const { redisConfig, storageEnvNames } = require('../lib/store');

test('standard names', () => {
  assert.deepStrictEqual(redisConfig({ KV_REST_API_URL: 'https://a.upstash.io', KV_REST_API_TOKEN: 't1' }),
    { url: 'https://a.upstash.io', token: 't1', source: 'KV_REST_API_URL' });
  assert.strictEqual(redisConfig({ UPSTASH_REDIS_REST_URL: 'https://b.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't2' }).token, 't2');
});

test('custom prefix added by Vercel on connect', () => {
  const c = redisConfig({ STORAGE_KV_REST_API_URL: 'https://c.upstash.io', STORAGE_KV_REST_API_TOKEN: 't3', STORAGE_KV_REST_API_READ_ONLY_TOKEN: 'ro' });
  assert.deepStrictEqual(c, { url: 'https://c.upstash.io', token: 't3', source: 'STORAGE_KV_REST_API_URL' });
  assert.strictEqual(redisConfig({ BAYBAYIN_UPSTASH_REDIS_REST_URL: 'https://d.upstash.io', BAYBAYIN_UPSTASH_REDIS_REST_TOKEN: 't4' }).token, 't4');
});

test('URL without its matching token is ignored', () => {
  assert.strictEqual(redisConfig({ KV_REST_API_URL: 'https://a.upstash.io', OTHER_KV_REST_API_TOKEN: 'x' }), null);
});

test('Upstash connection string only (REDIS_URL / KV_URL)', () => {
  assert.deepStrictEqual(redisConfig({ REDIS_URL: 'rediss://default:AbC123@fine-cat-1234.upstash.io:6379' }),
    { url: 'https://fine-cat-1234.upstash.io', token: 'AbC123', source: 'REDIS_URL' });
  assert.strictEqual(redisConfig({ STORAGE_KV_URL: 'rediss://default:Zz@x.upstash.io:6379' }).url, 'https://x.upstash.io');
  assert.strictEqual(redisConfig({ REDIS_URL: 'redis://default:pw@redis-123.redis-cloud.com:6379' }), null, 'non-Upstash Redis has no REST API');
});

test('/api/health on Vercel with no database explains what to do, showing names only', async () => {
  process.env.VERCEL = '1';
  process.env.REDIS_URL = 'redis://default:secretpw@redis-1.redis-cloud.com:6379';
  try {
    const { createApp } = require('../server');
    const app = createApp();
    assert.strictEqual(app.store, null);
    await new Promise((r) => app.server.listen(0, r));
    const base = 'http://127.0.0.1:' + app.server.address().port;
    const h = await (await fetch(base + '/api/health')).json();
    assert.strictEqual(h.ok, false);
    assert.strictEqual(h.storage, 'none');
    assert.deepStrictEqual(h.envSeen, ['REDIS_URL']);
    assert.match(h.hint, /Upstash/);
    assert.ok(!JSON.stringify(h).includes('secretpw'));
    assert.strictEqual((await fetch(base + '/api/config')).status, 503);
    app.server.close();
  } finally {
    delete process.env.VERCEL; delete process.env.REDIS_URL;
  }
  assert.deepStrictEqual(storageEnvNames({ A: 1, KV_URL: 2, MY_REDIS_URL: 3 }), ['KV_URL', 'MY_REDIS_URL']);
});
