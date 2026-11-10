/* Booking business rules, shared by the Node server and the standalone browser demo.
   Pure functions over a plain data object { settings, units, bookings, counter }; no I/O.
   Errors are thrown as Error objects with a numeric .status (HTTP-style). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shared'));
  else root.CORE = factory(root.BAY);
})(typeof self !== 'undefined' ? self : this, function (BAY) {
  'use strict';
  const IMAGE_NAME = /^[a-f0-9]{24}\.(jpg|png|webp)$/;

  function fail(status, message) { const e = new Error(message); e.status = status; throw e; }
  const str = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);
  const num = (v, min = 0, max = 1e7) => { const n = Number(v); return isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : min; };
  function randomId(len) {
    let s = '';
    const c = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto.getRandomValues(new Uint8Array(len)) : null;
    for (let i = 0; i < len; i++) s += ((c ? c[i] : Math.random() * 256) & 255).toString(16).padStart(2, '0');
    return s;
  }

  // ---------- defaults & sample data (all prices are SAMPLES, editable in Admin) ----------
  function defaultSettings() {
    return {
      shopName: 'Baybayin Scooter Rental',
      tagline: 'Explore San Agustin & Tablas Island on two wheels',
      taglineTl: 'Libutin ang San Agustin at Tablas Island sakay ng scooter',
      intro: 'Fresh off the ferry? Grab a well-maintained scooter and ride to the falls, beaches and viewpoints of Tablas at your own pace. Helmets included. Mabuhay!',
      introTl: 'Kababa lang ng barko? Mag-rent ng maayos na scooter at puntahan ang mga talon, beach at viewpoint ng Tablas sa sarili mong oras. Kasama na ang helmet. Mabuhay!',
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
      smsOnReceived: false,  // auto-SMS "we got your booking" (needs SMS gateway configured)
      smsOnConfirm: true,    // auto-SMS when admin confirms a booking
      pricesReviewed: false, // go-live checklist
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
      ],
      termsTl: [
        'Kailangan ng valid na driver\'s license. Dalhin ang original sa pickup.',
        'Laging magsuot ng helmet, pati ang angkas.',
        'Sagot ng nag-rent ang anumang sira, pagkawala, at traffic violation habang naka-rent.',
        'Ibalik ang scooter na pareho ang dami ng gasolina gaya noong kinuha.',
        'May bayad na {lateFee} kada oras ang late na pagbalik.',
        'May refundable na security deposit na {deposit} na kukunin sa pickup at ibabalik kapag maayos ang scooter.',
        'Libre ang pag-cancel hanggang {cancelHours} oras bago ang pickup. Mag-message lang sa amin sa Messenger.'
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

  function sampleBookings(settings, units, genId) {
    const t = BAY.today();
    const d = (n) => BAY.addDays(t, n);
    const mk = (n, unitId, pickup, ret, status, cust, addons, pay, extra) => {
      const unit = units.find((x) => x.id === unitId);
      return Object.assign({
        id: genId(),
        ref: 'BAY-' + String(n).padStart(4, '0'),
        createdAt: new Date(Date.now() - (10 - n) * 86400e3).toISOString(),
        status, scooterId: unitId, model: unit.name, pickup, return: ret,
        addonSel: addons, quote: BAY.quote(unit, pickup, ret, addons, settings),
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

  function buildSeedData(genId) {
    genId = genId || (() => randomId(6));
    const settings = defaultSettings();
    const units = defaultUnits();
    const bookings = sampleBookings(settings, units, genId);
    units.find((u) => u.id === 'u3').status = 'rented'; // matches the picked-up sample booking
    return { version: 1, counter: bookings.length, settings, units, bookings };
  }

  // ---------- views ----------
  function publicSettings(data) { const { adminEmail, ...rest } = data.settings; return rest; }
  function publicUnit(u) { const { plate, ...rest } = u; return rest; }
  function publicView(b) {
    return {
      ref: b.ref, status: b.status, model: b.model, pickup: b.pickup, return: b.return,
      quote: b.quote, payment: { method: b.payment.method, status: b.payment.status },
      customer: { name: b.customer.name }, createdAt: b.createdAt
    };
  }

  // ---------- availability ----------
  function unitBusy(data, unitId, pickup, ret, excludeId) {
    return data.bookings.some((b) => b.scooterId === unitId && b.id !== excludeId &&
      BAY.ACTIVE_STATUSES.includes(b.status) && BAY.overlaps(pickup, ret, b.pickup, b.return, data.settings.bufferMinutes));
  }
  function freeUnits(data, pickup, ret, excludeId) {
    return data.units.filter((u) => u.status !== 'maintenance' && !unitBusy(data, u.id, pickup, ret, excludeId));
  }
  /** Fleet grouped by model name for the customer view. */
  function availability(data, pickup, ret) {
    const err = BAY.validateWindow(pickup, ret, data.settings);
    if (err) fail(400, err);
    const free = new Set(freeUnits(data, pickup, ret).map((u) => u.id));
    const groups = new Map();
    data.units.forEach((u) => {
      if (!groups.has(u.name)) groups.set(u.name, { model: u.name, total: 0, available: 0, unit: null, first: u });
      const g = groups.get(u.name);
      if (u.status !== 'maintenance') g.total++;
      if (free.has(u.id)) { g.available++; if (!g.unit) g.unit = u; }
    });
    return [...groups.values()].filter((g) => g.total > 0).map((g) => {
      const u = g.unit || g.first;
      return { model: g.model, available: g.available, total: g.total, unit: publicUnit(u), quote: BAY.quote(u, pickup, ret, {}, data.settings) };
    }).sort((a, b) => (b.available > 0) - (a.available > 0) || a.unit.dailyRate - b.unit.dailyRate);
  }

  // ---------- bookings ----------
  /**
   * Validate a customer booking request. Returns a "draft" (everything except saved image names)
   * or throws. Does not mutate data. Caller then saves images and calls commitBooking().
   */
  function prepareBooking(data, body) {
    const s = data.settings;
    const pickup = str(body.pickup, 16), ret = str(body.return, 16);
    const err = BAY.validateWindow(pickup, ret, s);
    if (err) fail(400, err);
    const c = body.customer || {};
    const customer = {
      name: str(c.name, 80), mobile: str(c.mobile, 20).replace(/[^\d+]/g, ''), email: str(c.email, 120),
      fb: str(c.fb, 80), stayingAt: str(c.stayingAt, 120), riders: num(c.riders, 1, s.maxRiders || 2)
    };
    if (customer.name.length < 2) fail(400, 'Please enter your full name.');
    if (!/^(\+?63|0)9\d{9}$/.test(customer.mobile) && !/^\+\d{8,15}$/.test(customer.mobile)) {
      fail(400, 'Please enter a valid mobile number (e.g. 0917 123 4567).');
    }
    if (customer.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customer.email)) fail(400, 'Please check your email address.');
    if (!body.agreeTerms) fail(400, 'Please agree to the rental terms.');
    if (!body.license) fail(400, 'Please upload a photo of your driver\'s license.');
    const method = body.payment && body.payment.method === 'gcash' ? 'gcash' : 'cash';
    const gcashRef = method === 'gcash' ? str(body.payment.gcashRef, 40) : '';
    if (method === 'gcash' && gcashRef.replace(/\D/g, '').length < 6) fail(400, 'Please enter your GCash reference number.');
    if (method === 'gcash' && !body.payment.proof) fail(400, 'Please upload your GCash payment screenshot.');
    const addonSel = {};
    Object.entries(body.addons || {}).forEach(([k, v]) => { addonSel[str(k, 40)] = num(v, 0, 10); });
    return { pickup, ret, customer, method, gcashRef, addonSel, model: str(body.model, 80), lang: body.lang === 'tl' ? 'tl' : 'en' };
  }
  /** Re-check availability and store the booking. Must run synchronously after the final check (no double-booking race). */
  function commitBooking(data, draft, files, genId) {
    const unit = freeUnits(data, draft.pickup, draft.ret).find((u) => u.name === draft.model);
    if (!unit) fail(409, 'Sorry, that scooter was just booked for those dates. Please pick another one.');
    data.counter = (data.counter || 0) + 1;
    const now = new Date().toISOString();
    const booking = {
      id: (genId || (() => randomId(6)))(), ref: 'BAY-' + String(data.counter).padStart(4, '0'), createdAt: now, status: 'pending',
      scooterId: unit.id, model: unit.name, pickup: draft.pickup, return: draft.ret,
      addonSel: draft.addonSel, quote: BAY.quote(unit, draft.pickup, draft.ret, draft.addonSel, data.settings),
      customer: draft.customer, licensePhoto: files.licensePhoto || null,
      payment: { method: draft.method, gcashRef: draft.gcashRef, proof: files.proof || null, status: 'unpaid' },
      deposit: 'pending', notes: '', history: [{ at: now, status: 'pending' }],
      lang: draft.lang || 'en', source: 'online', sms: []
    };
    data.bookings.push(booking);
    return booking;
  }

  /** Validate an admin walk-in booking (customer at the counter). Returns a draft or throws. */
  function prepareWalkIn(data, body) {
    const unit = data.units.find((u) => u.id === body.scooterId);
    if (!unit) fail(400, 'Please choose a scooter.');
    if (unit.status === 'maintenance') fail(400, `${unit.name} (${unit.plate}) is under maintenance.`);
    const pickup = str(body.pickup, 16), ret = str(body.return, 16);
    if (!BAY.isLocal(pickup) || !BAY.isLocal(ret)) fail(400, 'Please set the pickup and return date & time.');
    if (BAY.toEpoch(ret) <= BAY.toEpoch(pickup)) fail(400, 'Return must be after pickup.');
    if (BAY.toEpoch(ret) - BAY.toEpoch(pickup) > (data.settings.maxDays || 30) * 864e5) fail(400, 'That rental is longer than the maximum allowed.');
    const c = body.customer || {};
    const customer = {
      name: str(c.name, 80), mobile: str(c.mobile, 20).replace(/[^\d+]/g, ''), email: str(c.email, 120),
      fb: str(c.fb, 80), stayingAt: str(c.stayingAt, 120), riders: num(c.riders, 1, data.settings.maxRiders || 2)
    };
    if (customer.name.length < 2) fail(400, 'Please enter the customer\'s name.');
    if (customer.mobile && !/^(\+?63|0)9\d{9}$/.test(customer.mobile) && !/^\+\d{8,15}$/.test(customer.mobile)) fail(400, 'Please check the mobile number.');
    const status = body.status === 'confirmed' ? 'confirmed' : 'picked_up';
    const addonSel = {};
    Object.entries(body.addons || {}).forEach(([k, v]) => { addonSel[str(k, 40)] = num(v, 0, 10); });
    return {
      unitId: unit.id, pickup, ret, customer, status, addonSel,
      method: body.method === 'gcash' ? 'gcash' : 'cash', gcashRef: str(body.gcashRef, 40),
      paid: !!body.paid, depositCollected: status === 'picked_up' && body.depositCollected !== false,
      notes: str(body.notes, 1000), lang: body.lang === 'tl' ? 'tl' : 'en'
    };
  }
  /** Store a walk-in booking. Re-checks that the chosen unit is free (call under the store lock). */
  function commitWalkIn(data, draft, files, genId) {
    const unit = data.units.find((u) => u.id === draft.unitId);
    if (!unit) fail(400, 'Please choose a scooter.');
    if (unitBusy(data, unit.id, draft.pickup, draft.ret)) fail(409, `${unit.name} (${unit.plate}) is already booked during this time.`);
    data.counter = (data.counter || 0) + 1;
    const now = new Date().toISOString();
    const booking = {
      id: (genId || (() => randomId(6)))(), ref: 'BAY-' + String(data.counter).padStart(4, '0'), createdAt: now, status: draft.status,
      scooterId: unit.id, model: unit.name, pickup: draft.pickup, return: draft.ret,
      addonSel: draft.addonSel, quote: BAY.quote(unit, draft.pickup, draft.ret, draft.addonSel, data.settings),
      customer: draft.customer, licensePhoto: (files && files.licensePhoto) || null,
      payment: { method: draft.method, gcashRef: draft.gcashRef, proof: null, status: draft.paid ? 'paid' : 'unpaid' },
      deposit: draft.depositCollected ? 'collected' : 'pending', notes: draft.notes,
      history: [{ at: now, status: draft.status }], lang: draft.lang, source: 'walk-in', sms: []
    };
    if (draft.status === 'picked_up') unit.status = 'rented';
    data.bookings.push(booking);
    return booking;
  }

  /** Remove the sample bookings shipped with a fresh install. Returns removed ids. */
  function clearSamples(data) {
    const removed = data.bookings.filter((b) => b.sample).map((b) => b.id);
    data.bookings = data.bookings.filter((b) => !b.sample);
    data.units.forEach((u) => {
      if (u.status === 'rented' && !data.bookings.some((b) => b.scooterId === u.id && b.status === 'picked_up')) u.status = 'available';
    });
    return removed;
  }
  function hasFreeUnit(data, draft) {
    return freeUnits(data, draft.pickup, draft.ret).some((u) => u.name === draft.model);
  }

  function lookup(data, ref, mobile) {
    ref = String(ref || '').trim().toUpperCase();
    mobile = String(mobile || '').replace(/\D/g, '').slice(-10);
    const b = data.bookings.find((x) => x.ref === ref && x.customer.mobile.replace(/\D/g, '').slice(-10) === mobile);
    if (!b) fail(404, 'No booking found with that reference and mobile number.');
    return publicView(b);
  }

  /** Admin changes to a booking (status, unit, deposit, payment, notes). */
  function updateBooking(data, id, body) {
    const b = data.bookings.find((x) => x.id === id);
    if (!b) fail(404, 'Booking not found');
    if (body.scooterId && body.scooterId !== b.scooterId) {
      const u = data.units.find((x) => x.id === body.scooterId);
      if (!u) fail(400, 'Unknown scooter');
      if (unitBusy(data, u.id, b.pickup, b.return, b.id)) fail(409, `${u.name} (${u.plate}) is already booked during this time.`);
      b.scooterId = u.id; b.model = u.name;
      b.quote = BAY.quote(u, b.pickup, b.return, b.addonSel, data.settings);
    }
    if (body.status && body.status !== b.status) {
      if (!BAY.STATUS_LABELS[body.status]) fail(400, 'Bad status');
      if (BAY.ACTIVE_STATUSES.includes(body.status) && !BAY.ACTIVE_STATUSES.includes(b.status) && unitBusy(data, b.scooterId, b.pickup, b.return, b.id)) {
        fail(409, 'This scooter is now booked by someone else for these dates. Reassign a scooter first.');
      }
      b.status = body.status;
      b.history.push({ at: new Date().toISOString(), status: b.status });
      const unit = data.units.find((u) => u.id === b.scooterId);
      if (unit && b.status === 'picked_up') unit.status = 'rented';
      if (unit && ['returned', 'cancelled'].includes(b.status) && unit.status === 'rented') unit.status = 'available';
    }
    if (body.deposit && ['pending', 'collected', 'refunded'].includes(body.deposit)) b.deposit = body.deposit;
    if (body.paymentStatus && ['unpaid', 'paid'].includes(body.paymentStatus)) b.payment.status = body.paymentStatus;
    if (typeof body.notes === 'string') b.notes = str(body.notes, 1000);
    return b;
  }

  // ---------- fleet & settings ----------
  function cleanUnit(body, existing, genId) {
    existing = existing || {};
    const status = ['available', 'rented', 'maintenance'].includes(body.status) ? body.status : (existing.status || 'available');
    return {
      id: existing.id || (genId || (() => randomId(6)))(),
      name: str(body.name, 60) || existing.name || 'Scooter',
      plate: str(body.plate, 20),
      color: /^#[0-9a-f]{6}$/i.test(body.color || '') ? body.color : (existing.color || '#1f6fb2'),
      photo: body.photo === null ? null : (typeof body.photo === 'string' && IMAGE_NAME.test(body.photo) ? body.photo : existing.photo || null),
      dailyRate: num(body.dailyRate, 0), halfDayRate: num(body.halfDayRate, 0), multiDayRate: num(body.multiDayRate, 0),
      description: str(body.description, 160), status
    };
  }
  function addUnit(data, body, genId) { const u = cleanUnit(body, null, genId); data.units.push(u); return u; }
  function editUnit(data, id, body) {
    const i = data.units.findIndex((x) => x.id === id);
    if (i < 0) fail(404, 'Scooter not found');
    data.units[i] = cleanUnit(body, data.units[i]);
    return data.units[i];
  }
  function deleteUnit(data, id) {
    const i = data.units.findIndex((x) => x.id === id);
    if (i < 0) fail(404, 'Scooter not found');
    if (data.bookings.some((b) => b.scooterId === id && BAY.ACTIVE_STATUSES.includes(b.status))) {
      fail(409, 'This scooter has active bookings. Reassign or cancel them first, or set it to Under maintenance.');
    }
    data.units.splice(i, 1);
  }

  function updateSettings(data, body) {
    const s = data.settings;
    ['shopName', 'tagline', 'address', 'landmark', 'mapsUrl', 'phone', 'messengerUrl', 'gcashNumber', 'gcashName', 'adminEmail']
      .forEach((k) => { if (k in body) s[k] = str(body[k], 300); });
    if ('intro' in body) s.intro = str(body.intro, 1000);
    if ('introTl' in body) s.introTl = str(body.introTl, 1000);
    if ('taglineTl' in body) s.taglineTl = str(body.taglineTl, 300);
    ['smsOnReceived', 'smsOnConfirm', 'pricesReviewed'].forEach((k) => { if (k in body) s[k] = !!body[k]; });
    if (Array.isArray(body.termsTl)) s.termsTl = body.termsTl.map((t) => str(t, 500)).filter(Boolean).slice(0, 30);
    ['openTime', 'closeTime'].forEach((k) => { if (/^\d{2}:\d{2}$/.test(body[k] || '')) s[k] = body[k]; });
    const nums = { slotMinutes: [15, 120], leadMinutes: [0, 10080], bufferMinutes: [0, 1440], graceMinutes: [0, 600], minHours: [1, 48],
      maxDays: [1, 365], halfDayHours: [1, 23], multiDayMinDays: [2, 60], deposit: [0, 1e6], lateFeePerHour: [0, 1e5],
      freeCancelHours: [0, 720], maxRiders: [1, 3] };
    Object.entries(nums).forEach(([k, [lo, hi]]) => { if (k in body) s[k] = num(body[k], lo, hi); });
    if ('gcashQr' in body) s.gcashQr = body.gcashQr && IMAGE_NAME.test(body.gcashQr) ? body.gcashQr : null;
    if (Array.isArray(body.gallery)) s.gallery = body.gallery.filter((g) => IMAGE_NAME.test(g)).slice(0, 8);
    if (Array.isArray(body.terms)) s.terms = body.terms.map((t) => str(t, 500)).filter(Boolean).slice(0, 30);
    if (Array.isArray(body.addons)) {
      s.addons = body.addons.slice(0, 20).map((a) => ({
        id: str(a.id, 40).replace(/[^a-z0-9_-]/gi, '') || randomId(6), name: str(a.name, 60) || 'Add-on',
        price: num(a.price, 0), perDay: !!a.perDay, maxQty: num(a.maxQty, 1, 10), active: a.active !== false
      }));
    }
    return s;
  }

  // ---------- reports ----------
  function summary(data) {
    const t = BAY.today();
    const dow = new Date(BAY.toEpoch(t + 'T00:00') + 8 * 3600e3).getUTCDay();
    const weekStart = BAY.addDays(t, -((dow + 6) % 7));     // Monday
    const monthStart = t.slice(0, 8) + '01';
    const B = data.bookings;
    const counted = B.filter((b) => ['confirmed', 'picked_up', 'returned'].includes(b.status));
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
      pending: B.filter((b) => b.status === 'pending').length,
      depositsHeld: B.filter((b) => b.deposit === 'collected').reduce((s, b) => s + b.quote.deposit, 0),
      outNow: B.filter((b) => b.status === 'picked_up').length,
      pickupsToday: B.filter((b) => ['confirmed', 'pending'].includes(b.status) && b.pickup.startsWith(t)).length,
      returnsToday: B.filter((b) => b.status === 'picked_up' && b.return.startsWith(t)).length
    };
  }

  function exportCsv(data) {
    const unitById = Object.fromEntries(data.units.map((u) => [u.id, u]));
    const rows = [['Ref', 'Created', 'Status', 'Scooter', 'Plate', 'Pickup', 'Return', 'Name', 'Mobile', 'Email', 'Facebook', 'Staying at',
      'Riders', 'Add-ons', 'Rental', 'Add-ons total', 'Total', 'Deposit', 'Deposit status', 'Payment', 'GCash ref', 'Payment status', 'Source', 'Language', 'Notes']];
    data.bookings.slice().sort((a, b) => a.pickup.localeCompare(b.pickup)).forEach((b) => rows.push([
      b.ref, b.createdAt, BAY.STATUS_LABELS[b.status], b.model, (unitById[b.scooterId] || {}).plate, b.pickup.replace('T', ' '), b.return.replace('T', ' '),
      b.customer.name, b.customer.mobile, b.customer.email, b.customer.fb, b.customer.stayingAt, b.customer.riders,
      b.quote.addons.map((a) => a.name + ' x' + a.qty).join('; '), b.quote.rental, b.quote.addonsTotal, b.quote.total,
      b.quote.deposit, b.deposit, b.payment.method, b.payment.gcashRef, b.payment.status, b.source || 'online', b.lang || 'en', b.notes
    ]));
    return '﻿' + rows.map((r) => r.map((v) => {
      let s = String(v == null ? '' : v);
      if (/^[=+\-@]/.test(s)) s = "'" + s;                 // avoid spreadsheet formula injection
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\r\n');
  }

  // ---------- message templates (plain text, SMS / Messenger friendly) ----------
  function addonText(b) {
    return b.quote.addons.length ? b.quote.addons.map((a) => a.name + (a.qty > 1 ? ' ×' + a.qty : '')).join(', ') : 'none';
  }
  function adminAlert(b) {
    return [
      `🛵 NEW BOOKING ${b.ref}`,
      `${b.model}`,
      `Pickup: ${BAY.fmtLocal(b.pickup)}`,
      `Return: ${BAY.fmtLocal(b.return)}`,
      `Name: ${b.customer.name} (${b.customer.riders} rider${b.customer.riders > 1 ? 's' : ''})`,
      `Mobile: ${b.customer.mobile}`,
      `FB: ${b.customer.fb || '-'}`,
      `Staying at: ${b.customer.stayingAt || '-'}`,
      `Add-ons: ${addonText(b)}`,
      `Total: ${BAY.peso(b.quote.total)} + ${BAY.peso(b.quote.deposit)} deposit`,
      `Payment: ${b.payment.method === 'gcash' ? 'GCash ref ' + (b.payment.gcashRef || '-') : 'Cash at pickup'}`
    ].join('\n');
  }
  function customerConfirmation(b, s) {
    const first = (b.customer.name || '').split(' ')[0] || 'there';
    if (b.lang === 'tl') {
      return [
        `Hi ${first}! CONFIRMED na ang scooter booking mo na ${b.ref} sa ${s.shopName}. 🛵`,
        ``,
        `Scooter: ${b.model}`,
        `Pickup: ${BAY.fmtLocal(b.pickup)}`,
        `Balik: ${BAY.fmtLocal(b.return)}`,
        `Add-ons: ${b.quote.addons.length ? addonText(b) : 'wala'}`,
        `Kabuuang renta: ${BAY.peso(b.quote.total)}${b.payment.method === 'gcash' && b.payment.status === 'paid' ? ' (bayad na via GCash, salamat!)' : ''}`,
        `Refundable deposit: ${BAY.peso(b.quote.deposit)} (cash sa pickup)`,
        ``,
        `📍 ${s.address} — ${s.landmark}`,
        `Mapa: ${s.mapsUrl}`,
        `Dalhin ang original na driver's license. Kita-kits — Salamat po!`
      ].join('\n');
    }
    return [
      `Hi ${first}! Your scooter booking ${b.ref} with ${s.shopName} is CONFIRMED. 🛵`,
      ``,
      `Scooter: ${b.model}`,
      `Pickup: ${BAY.fmtLocal(b.pickup)}`,
      `Return: ${BAY.fmtLocal(b.return)}`,
      `Add-ons: ${addonText(b)}`,
      `Rental total: ${BAY.peso(b.quote.total)}${b.payment.method === 'gcash' && b.payment.status === 'paid' ? ' (paid via GCash, salamat!)' : ''}`,
      `Refundable deposit: ${BAY.peso(b.quote.deposit)} (cash at pickup)`,
      ``,
      `📍 ${s.address} — ${s.landmark}`,
      `Map: ${s.mapsUrl}`,
      `Please bring your original driver's license. See you soon — Salamat po!`
    ].join('\n');
  }
  /** Short SMS texts. Plain GSM characters only ("P" not "₱", no emoji) so each fits in 1–2 SMS credits. */
  function smsText(b, s, kind) {
    const when = BAY.fmtLocal(b.pickup).replace(/^\w+, /, '').replace(' · ', ' ').replace(' AM', 'AM').replace(' PM', 'PM');
    const dep = 'P' + Math.round(b.quote.deposit).toLocaleString('en-US');
    const tl = b.lang === 'tl';
    if (kind === 'received') {
      return tl
        ? `${s.shopName}: Natanggap namin ang booking ${b.ref} (${b.model}, ${when}). Kukumpirmahin namin agad. Salamat po!`
        : `${s.shopName}: We got your booking ${b.ref} (${b.model}, ${when}). We'll confirm shortly. Salamat!`;
    }
    return tl
      ? `${s.shopName}: CONFIRMED na ang booking ${b.ref}. ${b.model}, pickup ${when}. Dalhin ang lisensya at ${dep} deposit. Salamat po!`
      : `${s.shopName}: Booking ${b.ref} CONFIRMED. ${b.model}, pickup ${when}. Please bring your license and ${dep} deposit. Salamat po!`;
  }
  function messages(data, id) {
    const b = data.bookings.find((x) => x.id === id);
    if (!b) fail(404, 'Not found');
    return { admin: adminAlert(b), customer: customerConfirmation(b, data.settings), sms: smsText(b, data.settings, 'confirm') };
  }

  /** Go-live checklist: what still looks like sample/placeholder setup. */
  function setupChecklist(data, extra) {
    const s = data.settings;
    const item = (id, done, label, hint, tab) => ({ id, done: !!done, label, hint, tab });
    return [
      item('password', !extra.defaultPassword, 'Change the admin password', 'Still using the default password.', 'settings'),
      item('gcash', !/0917 000 0000/.test(s.gcashNumber) && s.gcashName !== 'BAYBAYIN S. R.', 'Enter your GCash number and name', 'GCash details are placeholders.', 'settings'),
      item('qr', s.gcashQr, 'Upload your GCash QR code', 'Customers scan this to pay.', 'settings'),
      item('messenger', !/yourpage/.test(s.messengerUrl), 'Set your Messenger link', 'Still m.me/yourpage.', 'settings'),
      item('phone', !/0917 000 0000/.test(s.phone), 'Set the shop phone number', 'Phone is a placeholder.', 'settings'),
      item('photos', data.units.length && data.units.every((u) => u.photo), 'Add a photo for every scooter', data.units.filter((u) => !u.photo).length + ' scooter(s) have no photo.', 'fleet'),
      item('prices', s.pricesReviewed, 'Review prices, deposit and add-ons', 'Sample prices were filled in for you.', 'settings'),
      item('samples', !data.bookings.some((b) => b.sample), 'Delete the sample bookings', 'Test bookings from the demo data.', 'summary'),
      item('storage', extra.storage !== 'none', 'Connect booking storage', 'Needed on Vercel (Upstash Redis).', null),
      item('sms', extra.smsEnabled, 'Optional: connect SMS (Semaphore)', 'For automatic text confirmations.', null)
    ];
  }

  return {
    IMAGE_NAME, fail, randomId,
    defaultSettings, defaultUnits, buildSeedData,
    publicSettings, publicUnit, publicView,
    unitBusy, freeUnits, availability,
    prepareBooking, hasFreeUnit, commitBooking, prepareWalkIn, commitWalkIn, clearSamples, lookup, updateBooking,
    addUnit, editUnit, deleteUnit, updateSettings,
    summary, exportCsv, adminAlert, customerConfirmation, smsText, messages, setupChecklist
  };
});
