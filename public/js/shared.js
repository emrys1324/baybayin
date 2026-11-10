/* Shared time + pricing logic. Loaded by the browser (window.BAY) and by Node (require).
   All times are Asia/Manila local wall-clock strings: "YYYY-MM-DDTHH:mm" (UTC+8, no DST). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BAY = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var OFFSET = 8 * 3600e3; // Asia/Manila
  var HOUR = 3600e3;
  var ACTIVE_STATUSES = ['pending', 'confirmed', 'picked_up'];
  var STATUS_LABELS = {
    pending: 'Pending', confirmed: 'Confirmed', picked_up: 'Picked Up',
    returned: 'Returned', cancelled: 'Cancelled'
  };
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  var LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  function isLocal(s) { return typeof s === 'string' && LOCAL_RE.test(s) && !isNaN(toEpoch(s)); }
  function toEpoch(local) { return Date.parse(local + ':00+08:00'); }
  function fromEpoch(ms) {
    var d = new Date(ms + OFFSET);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) +
      'T' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
  }
  function nowLocal() { return fromEpoch(Date.now()); }
  function today() { return nowLocal().slice(0, 10); }
  function addHours(local, h) { return fromEpoch(toEpoch(local) + h * HOUR); }
  function addDays(dateStr, n) { return fromEpoch(toEpoch(dateStr + 'T00:00') + n * 24 * HOUR).slice(0, 10); }
  function minutesOf(hhmm) { var p = hhmm.split(':'); return +p[0] * 60 + +p[1]; }
  function withinHours(local, open, close) {
    var m = minutesOf(local.slice(11));
    return m >= minutesOf(open) && m <= minutesOf(close);
  }
  function fmtTime(hhmm) {
    var m = minutesOf(hhmm), h = Math.floor(m / 60), mm = m % 60;
    var ap = h >= 12 ? 'PM' : 'AM', h12 = h % 12 || 12;
    return h12 + ':' + pad(mm) + ' ' + ap;
  }
  function fmtDate(dateStr) {
    var d = new Date(toEpoch(dateStr + 'T00:00') + OFFSET);
    return DAYS[d.getUTCDay()] + ', ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate();
  }
  function fmtLocal(local) { return fmtDate(local.slice(0, 10)) + ' · ' + fmtTime(local.slice(11)); }
  function peso(n) {
    n = Math.round(Number(n) || 0);
    return '₱' + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function durationText(hours) {
    if (hours < 24) return (Math.round(hours * 10) / 10) + ' hrs';
    var d = Math.floor(hours / 24), h = Math.round(hours - d * 24);
    return d + (d === 1 ? ' day' : ' days') + (h ? ' ' + h + ' hrs' : '');
  }
  /** Time slots (HH:mm) offered within shop hours. */
  function timeSlots(settings) {
    var out = [], step = settings.slotMinutes || 30;
    for (var m = minutesOf(settings.openTime); m <= minutesOf(settings.closeTime); m += step) {
      out.push(pad(Math.floor(m / 60)) + ':' + pad(m % 60));
    }
    return out;
  }
  /** Replace {deposit}, {lateFee}, {cancelHours} tokens in terms text. */
  function fillTerms(text, s) {
    return String(text)
      .replace(/\{deposit\}/g, peso(s.deposit))
      .replace(/\{lateFee\}/g, peso(s.lateFeePerHour))
      .replace(/\{cancelHours\}/g, String(s.freeCancelHours));
  }

  /**
   * Validate a pickup/return window against shop rules. Returns an error string or null.
   * opts.skipLead: don't enforce "pickup must be in the future" (admin edits / tests).
   */
  function validateWindow(pickup, ret, s, opts) {
    opts = opts || {};
    if (!isLocal(pickup) || !isLocal(ret)) return 'Please choose pickup and return date & time.';
    if (!withinHours(pickup, s.openTime, s.closeTime)) return 'Pickup must be between ' + fmtTime(s.openTime) + ' and ' + fmtTime(s.closeTime) + '.';
    if (!withinHours(ret, s.openTime, s.closeTime)) return 'Return must be between ' + fmtTime(s.openTime) + ' and ' + fmtTime(s.closeTime) + '.';
    var p = toEpoch(pickup), r = toEpoch(ret);
    if (!opts.skipLead && p < Date.now() + (s.leadMinutes || 0) * 60e3) {
      return 'Pickup needs to be at least ' + (s.leadMinutes || 0) + ' minutes from now.';
    }
    if (r <= p) return 'Return must be after pickup.';
    if (r - p < (s.minHours || 1) * HOUR) return 'Minimum rental is ' + (s.minHours || 1) + ' hours.';
    if (r - p > (s.maxDays || 30) * 24 * HOUR) return 'For rentals longer than ' + (s.maxDays || 30) + ' days, please message us.';
    return null;
  }

  /**
   * Price quote for one unit.
   * addonSel: { addonId: qty }
   * Returns { hours, days, rentalLabel, rental, addons:[{id,name,price,qty,amount}], addonsTotal, total, deposit, dueAtPickup }
   */
  function quote(unit, pickup, ret, addonSel, s) {
    var hours = (toEpoch(ret) - toEpoch(pickup)) / HOUR;
    var rental, label, days;
    if (unit.halfDayRate > 0 && hours <= (s.halfDayHours || 6)) {
      days = 1; // per-day add-ons count as 1 day
      rental = unit.halfDayRate;
      label = 'Half-day (up to ' + (s.halfDayHours || 6) + ' hrs)';
    } else {
      var grace = (s.graceMinutes || 0) / 60;
      days = Math.max(1, Math.ceil((hours - grace) / 24));
      var multi = unit.multiDayRate > 0 && days >= (s.multiDayMinDays || 3);
      var rate = multi ? unit.multiDayRate : unit.dailyRate;
      rental = rate * days;
      label = days + (days === 1 ? ' day' : ' days') + ' × ' + peso(rate) + (multi ? ' (multi-day rate)' : '');
    }
    var lines = [], addonsTotal = 0;
    (s.addons || []).forEach(function (a) {
      if (!a.active) return;
      var qty = Math.max(0, Math.min(a.maxQty || 1, parseInt((addonSel || {})[a.id], 10) || 0));
      if (!qty) return;
      var amount = a.price * qty * (a.perDay ? days : 1);
      addonsTotal += amount;
      lines.push({ id: a.id, name: a.name, price: a.price, perDay: !!a.perDay, qty: qty, amount: amount });
    });
    var total = rental + addonsTotal;
    return {
      hours: hours, days: days, rentalLabel: label, rental: rental,
      addons: lines, addonsTotal: addonsTotal, total: total,
      deposit: s.deposit || 0, dueAtPickup: total + (s.deposit || 0)
    };
  }

  /** True if two windows overlap, with a turnaround buffer (minutes) between rentals. */
  function overlaps(aStart, aEnd, bStart, bEnd, bufferMin) {
    var buf = (bufferMin || 0) * 60e3;
    return toEpoch(aStart) < toEpoch(bEnd) + buf && toEpoch(bStart) < toEpoch(aEnd) + buf;
  }

  return {
    ACTIVE_STATUSES: ACTIVE_STATUSES, STATUS_LABELS: STATUS_LABELS,
    pad: pad, isLocal: isLocal, toEpoch: toEpoch, fromEpoch: fromEpoch, nowLocal: nowLocal, today: today,
    addHours: addHours, addDays: addDays, withinHours: withinHours, minutesOf: minutesOf,
    fmtTime: fmtTime, fmtDate: fmtDate, fmtLocal: fmtLocal, peso: peso, durationText: durationText,
    timeSlots: timeSlots, fillTerms: fillTerms, validateWindow: validateWindow, quote: quote, overlaps: overlaps
  };
});
