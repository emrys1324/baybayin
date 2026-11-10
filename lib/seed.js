'use strict';
/* Default settings + sample fleet and bookings so the app is testable right away.
   All prices are SAMPLE values — change them in Admin → Settings / Fleet. */
const crypto = require('crypto');
const BAY = require('../public/js/shared');

function hashPassword(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 32).toString('hex');
  return { salt, hash };
}

function defaultSettings() {
  return {
    shopName: 'Baybayin Scooter Rental',
    tagline: 'Explore San Agustin & Tablas Island on two wheels',
    intro: 'Fresh off the ferry? Grab a well-maintained scooter and ride to the falls, beaches and viewpoints of Tablas at your own pace. Helmets included. Mabuhay!',
    address: 'Sitio Sawang, Brgy. Dubduban, San Agustin, Romblon',
    landmark: 'Beside the FilOil gas station and Mon\'s Pahuway Café',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=FilOil+Dubduban+San+Agustin+Romblon',
    phone: '0917 000 0000',
    messengerUrl: 'https://m.me/yourpage',
    gcashNumber: '0917 000 0000',
    gcashName: 'BAYBAYIN S. R.',
    gcashQr: null,
    gallery: [],
    openTime: '09:00',
    closeTime: '18:00',
    slotMinutes: 30,
    leadMinutes: 60,       // earliest pickup = now + this
    bufferMinutes: 60,     // turnaround time between rentals of the same unit
    graceMinutes: 60,      // extra minutes allowed before another day is charged
    minHours: 2,
    maxDays: 30,
    halfDayHours: 6,
    multiDayMinDays: 3,
    deposit: 1000,
    lateFeePerHour: 100,
    freeCancelHours: 24,
    maxRiders: 2,
    adminEmail: '',
    addons: [
      { id: 'helmet', name: 'Extra helmet', price: 50, perDay: false, maxQty: 2, active: true },
      { id: 'holder', name: 'Phone holder', price: 30, perDay: false, maxQty: 1, active: true },
      { id: 'delivery', name: 'Delivery to port / resort', price: 150, perDay: false, maxQty: 1, active: true }
    ],
    terms: [
      'A valid driver\'s license is required. Please bring the original at pickup.',
      'Helmets must be worn at all times by the driver and passenger.',
      'The renter is responsible for any damage, loss, and traffic violations during the rental.',
      'Return the scooter with the same fuel level as pickup.',
      'Late returns are charged {lateFee} per hour.',
      'A refundable security deposit of {deposit} is collected at pickup and returned when the scooter comes back in good condition.',
      'Free cancellation up to {cancelHours} hours before pickup. Please message us on Messenger to cancel.'
    ]
  };
}

function defaultUnits() {
  const u = (id, name, plate, color, daily, half, multi, desc, status) => ({
    id, name, plate, color, photo: null, dailyRate: daily, halfDayRate: half, multiDayRate: multi,
    description: desc, status: status || 'available'
  });
  return [
    u('u1', 'Honda Click 125', 'ABC 1234', '#e74c3c', 500, 350, 450, '125cc automatic · easy and fuel-efficient · fits 2'),
    u('u2', 'Honda Click 125', 'ABC 5678', '#2c3e50', 500, 350, 450, '125cc automatic · easy and fuel-efficient · fits 2'),
    u('u3', 'Yamaha NMAX V3', 'NMX 2025', '#1f6fb2', 800, 550, 700, '155cc · comfy for long rides around Tablas · ABS'),
    u('u4', 'Honda PCX 160', 'PCX 1600', '#7f8c8d', 800, 550, 700, '160cc · smooth, roomy seat and storage'),
    u('u5', 'Honda BeAT', 'BTT 1100', '#f39c12', 400, 300, 350, '110cc · light and nimble · perfect for town trips', 'maintenance')
  ];
}

function sampleBookings(settings, units) {
  const t = BAY.today();
  const d = (n) => BAY.addDays(t, n);
  const mk = (n, unitId, pickup, ret, status, cust, addons, pay, extra) => {
    const unit = units.find((x) => x.id === unitId);
    const q = BAY.quote(unit, pickup, ret, addons, settings);
    return Object.assign({
      id: crypto.randomBytes(6).toString('hex'),
      ref: 'BAY-' + String(n).padStart(4, '0'),
      createdAt: new Date(Date.now() - (10 - n) * 86400e3).toISOString(),
      status, scooterId: unitId, model: unit.name, pickup, return: ret,
      addonSel: addons, quote: q,
      customer: Object.assign({ email: '', riders: 1 }, cust),
      licensePhoto: null,
      payment: Object.assign({ method: 'cash', gcashRef: '', proof: null, status: 'unpaid' }, pay),
      deposit: 'pending', notes: '', history: [{ at: new Date().toISOString(), status }], sample: true
    }, extra || {});
  };
  return [
    mk(1, 'u1', d(-6) + 'T09:00', d(-4) + 'T17:00', 'returned',
      { name: 'Maria Santos', mobile: '09171234567', fb: 'Maria Santos', stayingAt: 'Tablas Bay Inn', riders: 2 },
      { helmet: 1 }, { status: 'paid' }, { deposit: 'refunded' }),
    mk(2, 'u3', d(-2) + 'T10:00', d(1) + 'T10:00', 'picked_up',
      { name: 'Jake Miller', mobile: '09181112222', email: 'jake@example.com', fb: 'Jake Miller', stayingAt: 'Cantingas homestay' },
      { holder: 1 }, { method: 'gcash', gcashRef: '1009 876 543210', status: 'paid' }, { deposit: 'collected' }),
    mk(3, 'u2', d(1) + 'T09:30', d(2) + 'T09:30', 'confirmed',
      { name: 'Paolo Reyes', mobile: '09209998888', fb: 'Pao Reyes', stayingAt: 'Arriving by RoRo from Batangas', riders: 2 },
      { helmet: 1, delivery: 1 }, {}),
    mk(4, 'u4', d(5) + 'T13:00', d(5) + 'T18:00', 'pending',
      { name: 'Anna Lim', mobile: '09175556666', fb: 'Anna Lim', stayingAt: 'San Agustin town proper' },
      {}, { method: 'gcash', gcashRef: '5021 333 444555', status: 'unpaid' }),
    mk(5, 'u1', d(4) + 'T09:00', d(8) + 'T09:00', 'pending',
      { name: 'Lukas Weber', mobile: '09271239876', email: 'lukas@example.com', fb: 'Lukas Weber', stayingAt: 'Looc resort', riders: 1 },
      { holder: 1 }, {}),
    mk(6, 'u3', d(4) + 'T09:00', d(5) + 'T09:00', 'cancelled',
      { name: 'Grace Tan', mobile: '09391110000', fb: 'Grace T', stayingAt: 'Odiongan' }, {}, {})
  ];
}

function buildSeed() {
  const settings = defaultSettings();
  const units = defaultUnits();
  const bookings = sampleBookings(settings, units);
  units.find((u) => u.id === 'u3').status = 'rented'; // matches the picked-up sample booking
  return {
    version: 1,
    counter: bookings.length,
    settings,
    units,
    bookings,
    auth: hashPassword(process.env.ADMIN_PASSWORD || 'baybayin2026')
  };
}

module.exports = { buildSeed, defaultSettings, hashPassword };

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
