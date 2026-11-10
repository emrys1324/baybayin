'use strict';
/* Tiny JSON-file database. Single process, synchronous writes (atomic rename).
   Plenty for a small shop (thousands of bookings). Swap for SQLite/Postgres later if needed. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildSeed } = require('./seed');

class DB {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'db.json');
    this.privateDir = path.join(dir, 'uploads');      // licenses, GCash proofs (admin only)
    this.publicDir = path.join(dir, 'media');          // scooter photos, QR, gallery
    fs.mkdirSync(this.privateDir, { recursive: true });
    fs.mkdirSync(this.publicDir, { recursive: true });
    if (!fs.existsSync(this.file)) {
      this.data = buildSeed();
      this.save();
    } else {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    }
  }
  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.file);
  }
  get settings() { return this.data.settings; }
  get units() { return this.data.units; }
  get bookings() { return this.data.bookings; }
  nextRef() {
    this.data.counter = (this.data.counter || 0) + 1;
    return 'BAY-' + String(this.data.counter).padStart(4, '0');
  }
  static id() { return crypto.randomBytes(6).toString('hex'); }
}

module.exports = { DB };
