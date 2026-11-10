'use strict';
/* Seed database: sample settings/fleet/bookings (from core.js) + hashed admin password. */
const crypto = require('crypto');
const CORE = require('../public/js/core');

function hashPassword(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 32).toString('hex');
  return { salt, hash };
}

function buildSeed() {
  const data = CORE.buildSeedData(() => crypto.randomBytes(6).toString('hex'));
  data.auth = hashPassword(process.env.ADMIN_PASSWORD || 'baybayin2026');
  return data;
}

module.exports = { buildSeed, hashPassword };

if (require.main === module) {
  // `npm run seed` — reset the database to sample data
  const fs = require('fs');
  const path = require('path');
  const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const file = path.join(dir, 'db.json');
  if (fs.existsSync(file) && !process.argv.includes('--force')) {
    console.log('db.json exists; pass --force to overwrite'); process.exit(1);
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(buildSeed(), null, 1));
  console.log('Seeded', file);
}
