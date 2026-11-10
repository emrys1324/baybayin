/* Admin dashboard (password protected via HttpOnly session cookie). */
(function () {
  'use strict';
  var $ = UI.$, $$ = UI.$$, esc = UI.esc, peso = BAY.peso;
  var app = $('#app');
  var D = null;                       // { settings, units, bookings, summary }
  var filter = 'pending', query = '';
  var calStart = null;
  var lastSeen = +(localStorage.getItem('bay_admin_seen') || 0);
  var FILTERS = [['pending', 'Pending'], ['confirmed', 'Confirmed'], ['picked_up', 'Picked Up'], ['returned', 'Returned'], ['cancelled', 'Cancelled'], ['all', 'All']];

  // ---------- auth ----------
  function boot() {
    UI.api('GET', '/api/admin/me').then(load, showLogin);
  }
  function showLogin() {
    $('#tabs').classList.add('hidden'); $('#logout').classList.add('hidden');
    app.innerHTML = '<div class="wrap"><section><h2>Admin login</h2><form id="lf">' +
      '<label class="f" for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" autofocus>' +
      '<div id="lmsg"></div><div class="spacer"></div><button class="btn">Log in</button></form></section></div>';
    $('#lf').onsubmit = function (e) {
      e.preventDefault();
      UI.api('POST', '/api/admin/login', { password: $('#pw').value }).then(load, function (err) {
        $('#lmsg').innerHTML = '<div class="err-box">' + esc(err.message) + '</div>';
      });
    };
  }
  $('#logout').onclick = function () { UI.api('POST', '/api/admin/logout').then(showLogin); };
  $('#refresh').onclick = function () { load().then(function () { UI.toast('Updated'); }); };

  function load() {
    return UI.api('GET', '/api/admin/data').then(function (d) {
      var prevPending = D ? D.summary.pending : null;
      D = d;
      $('#tabs').classList.remove('hidden'); $('#logout').classList.remove('hidden');
      var pc = $('#pendingCount');
      pc.textContent = d.summary.pending; pc.classList.toggle('hidden', !d.summary.pending);
      document.title = (d.summary.pending ? '(' + d.summary.pending + ') ' : '') + 'Admin · ' + d.settings.shopName;
      if (prevPending !== null && d.summary.pending > prevPending) UI.toast('🛵 New booking received!');
      route();
    }, function (e) { if (e.status === 401) showLogin(); else UI.toast(e.message); });
  }
  setInterval(function () { if (D && !$('.modal') && document.visibilityState === 'visible') load(); }, 60000);

  function route() {
    $$('.modal').forEach(function (m) { m.remove(); });
    var tab = (location.hash || '#bookings').slice(1);
    $$('#tabs a').forEach(function (a) { a.classList.toggle('on', a.dataset.tab === tab); });
    ({ bookings: renderBookings, calendar: renderCalendar, summary: renderSummary, fleet: renderFleet, settings: renderSettings }[tab] || renderBookings)();
  }
  window.addEventListener('hashchange', function () { if (D) { route(); window.scrollTo(0, 0); } });

  function unitOf(b) { return D.units.filter(function (u) { return u.id === b.scooterId; })[0]; }
  function statusPill(s) { return '<span class="st ' + s + '">' + BAY.STATUS_LABELS[s] + '</span>'; }

  // ---------- bookings ----------
  function sorted(list) {
    var active = list.filter(function (b) { return BAY.ACTIVE_STATUSES.indexOf(b.status) >= 0; }).sort(function (a, b) { return a.pickup.localeCompare(b.pickup); });
    var done = list.filter(function (b) { return BAY.ACTIVE_STATUSES.indexOf(b.status) < 0; }).sort(function (a, b) { return b.pickup.localeCompare(a.pickup); });
    return active.concat(done);
  }
  function renderBookings() {
    var counts = {};
    D.bookings.forEach(function (b) { counts[b.status] = (counts[b.status] || 0) + 1; });
    counts.all = D.bookings.length;
    var q = query.toLowerCase();
    var list = sorted(D.bookings.filter(function (b) {
      if (filter !== 'all' && b.status !== filter) return false;
      if (!q) return true;
      return [b.ref, b.customer.name, b.customer.mobile, b.customer.fb, b.model].join(' ').toLowerCase().indexOf(q) >= 0;
    }));
    app.innerHTML = '<div class="wrap wide">' + setupBanner() +
      '<button class="btn" id="walkIn" style="margin-top:12px">＋ Walk-in booking</button>' +
      '<input class="search" id="q" type="search" placeholder="Search name, mobile, ref…" value="' + esc(query) + '">' +
      '<div class="filters">' + FILTERS.map(function (f) {
        return '<button data-f="' + f[0] + '" class="' + (filter === f[0] ? 'on' : '') + '">' + f[1] + '<small>' + (counts[f[0]] || 0) + '</small></button>';
      }).join('') + '</div>' +
      (list.length ? '<div class="bklist">' + list.map(bookingCard).join('') + '</div>' : '<p class="muted center" style="padding:30px 0">No bookings here.</p>') + '</div>';
    $$('.filters button').forEach(function (b) { b.onclick = function () { filter = b.dataset.f; renderBookings(); }; });
    $('#q').addEventListener('input', function () { query = this.value; var pos = this.selectionStart; renderBookings(); var el = $('#q'); el.focus(); el.setSelectionRange(pos, pos); });
    $$('.bk').forEach(function (el) { el.onclick = function () { openBooking(el.dataset.id); }; });
    $('#walkIn').onclick = openWalkIn;
    wireSetupBanner();
    var newest = D.bookings.reduce(function (m, b) { return Math.max(m, Date.parse(b.createdAt)); }, 0);
    setTimeout(function () { lastSeen = newest; localStorage.setItem('bay_admin_seen', newest); }, 3000);
  }
  function bookingCard(b) {
    var u = unitOf(b);
    var isNew = Date.parse(b.createdAt) > lastSeen && b.status === 'pending';
    return '<button class="bk" data-id="' + b.id + '"><div class="top"><span><span class="ref">' + esc(b.ref) + '</span>' + (isNew ? '<span class="new">NEW</span>' : '') +
      (b.source === 'walk-in' ? '<span class="tag">Walk-in</span>' : '') + (b.lang === 'tl' ? '<span class="tag">Tagalog</span>' : '') +
      '</span>' + statusPill(b.status) + '</div>' +
      '<div><b>' + esc(b.customer.name) + '</b> · ' + esc(b.model) + (u ? ' <span class="muted small">' + esc(u.plate) + '</span>' : '') + '</div>' +
      '<div class="small muted">' + BAY.fmtLocal(b.pickup) + ' → ' + BAY.fmtLocal(b.return) + '</div>' +
      '<div class="small">' + peso(b.quote.total) + ' · ' + (b.payment.method === 'gcash' ? 'GCash' : 'Cash') + (b.payment.status === 'paid' ? ' ✅' : '') +
      ' · Deposit: ' + b.deposit + '</div></button>';
  }

  function patch(b, body) {
    return UI.api('PATCH', '/api/admin/bookings/' + b.id, body).then(function (r) {
      var i = D.bookings.indexOf(b); D.bookings[i] = r.booking;
      if (r.sms) setTimeout(function () { UI.toast(r.sms.ok ? '📱 Confirmation SMS sent' : '⚠️ SMS not sent: ' + r.sms.error); }, 1200);
      return load().then(function () { return r.booking; });
    }, function (e) { UI.toast(e.message); throw e; });
  }

  function openBooking(id) {
    var b = D.bookings.filter(function (x) { return x.id === id; })[0];
    if (!b) return;
    var u = unitOf(b), c = b.customer, q = b.quote;
    var phone = c.mobile.replace(/^0/, '+63');
    var unitOpts = D.units.map(function (x) {
      return '<option value="' + x.id + '"' + (x.id === b.scooterId ? ' selected' : '') + '>' + esc(x.name + ' · ' + x.plate) + (x.status === 'maintenance' ? ' (maintenance)' : '') + '</option>';
    }).join('');
    var statusBtns = [['confirmed', '✅ Confirm'], ['picked_up', '🛵 Picked up'], ['returned', '🏁 Returned'], ['cancelled', '✕ Cancel'], ['pending', '⏳ Pending']]
      .map(function (s) { return '<button class="btn alt' + (b.status === s[0] ? ' on' : '') + '" data-status="' + s[0] + '">' + s[1] + '</button>'; }).join('');
    var html =
      '<p>' + statusPill(b.status) + (b.source === 'walk-in' ? ' <span class="tag">Walk-in</span>' : '') + (b.lang === 'tl' ? ' <span class="tag">Tagalog</span>' : '') +
        ' <span class="small muted">booked ' + new Date(b.createdAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) + '</span></p>' +
      '<div class="actions">' + statusBtns + '</div>' +
      '<h3 style="margin-top:16px">Rental</h3><dl class="kv">' +
        '<dt>Pickup</dt><dd>' + BAY.fmtLocal(b.pickup) + '</dd><dt>Return</dt><dd>' + BAY.fmtLocal(b.return) + '</dd>' +
        '<dt>Scooter</dt><dd><select id="unitSel">' + unitOpts + '</select></dd>' +
        '<dt>Add-ons</dt><dd>' + (q.addons.length ? q.addons.map(function (a) { return esc(a.name) + (a.qty > 1 ? ' ×' + a.qty : ''); }).join(', ') : '—') + '</dd>' +
        '<dt>Rental</dt><dd>' + esc(q.rentalLabel) + ' = ' + peso(q.rental) + '</dd>' +
        '<dt>Total</dt><dd><b>' + peso(q.total) + '</b> + ' + peso(q.deposit) + ' deposit</dd></dl>' +
      '<h3 style="margin-top:16px">Customer</h3><dl class="kv">' +
        '<dt>Name</dt><dd>' + esc(c.name) + '</dd><dt>Mobile</dt><dd><a href="tel:' + esc(phone) + '">' + esc(c.mobile) + '</a></dd>' +
        (c.email ? '<dt>Email</dt><dd><a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a></dd>' : '') +
        '<dt>Facebook</dt><dd>' + esc(c.fb || '—') + '</dd><dt>Staying at</dt><dd>' + esc(c.stayingAt || '—') + '</dd>' +
        '<dt>Riders</dt><dd>' + c.riders + '</dd></dl>' +
      '<div class="row" style="margin-top:10px"><a class="btn sm alt" href="tel:' + esc(phone) + '">📞 Call</a><a class="btn sm alt" href="sms:' + esc(phone) + '">💬 SMS</a></div>' +
      '<h3 style="margin-top:16px">Payment &amp; deposit</h3><dl class="kv">' +
        '<dt>Method</dt><dd>' + (b.payment.method === 'gcash' ? 'GCash · ref <b>' + esc(b.payment.gcashRef) + '</b>' : 'Cash at pickup') + '</dd></dl>' +
      '<div class="seg" style="margin-top:8px" id="paySeg"><button data-pay="unpaid" class="' + (b.payment.status !== 'paid' ? 'on' : '') + '">Unpaid</button><button data-pay="paid" class="' + (b.payment.status === 'paid' ? 'on' : '') + '">Paid ✅</button></div>' +
      '<div class="seg" style="margin-top:8px" id="depSeg">' + [['pending', 'Deposit pending'], ['collected', 'Collected'], ['refunded', 'Refunded']].map(function (d) {
        return '<button data-dep="' + d[0] + '" class="' + (b.deposit === d[0] ? 'on' : '') + '">' + d[1] + '</button>'; }).join('') + '</div>' +
      '<div class="proof">' +
        (b.licensePhoto ? '<h3 style="margin-top:16px">Driver\'s license</h3><a href="' + UI.fileUrl(b.licensePhoto) + '" target="_blank"><img loading="lazy" src="' + UI.fileUrl(b.licensePhoto) + '" alt="License"></a>' : '<p class="small muted" style="margin-top:12px">No license photo (sample booking).</p>') +
        (b.payment.proof ? '<h3>GCash proof</h3><a href="' + UI.fileUrl(b.payment.proof) + '" target="_blank"><img loading="lazy" src="' + UI.fileUrl(b.payment.proof) + '" alt="GCash proof"></a>' : '') +
      '</div>' +
      '<h3 style="margin-top:16px">Messages</h3><div id="msgs"><div class="spinner"></div></div>' +
      '<label class="f" for="notes">Internal notes</label><textarea id="notes" placeholder="e.g. fuel level, damage, helmet no.">' + esc(b.notes || '') + '</textarea>' +
      '<button class="btn sand" id="saveNotes" style="margin-top:8px">Save notes</button>';
    UI.modal(b.ref + ' · ' + c.name, html, function (body, close) {
      var reopen = function (nb) { close(); openBooking(nb.id); };
      $$('[data-status]', body).forEach(function (btn) {
        btn.onclick = function () {
          if (btn.dataset.status === 'cancelled' && !confirm('Cancel booking ' + b.ref + '?')) return;
          patch(b, { status: btn.dataset.status }).then(function (nb) { UI.toast(BAY.STATUS_LABELS[nb.status]); reopen(nb); });
        };
      });
      $$('[data-pay]', body).forEach(function (btn) { btn.onclick = function () { patch(b, { paymentStatus: btn.dataset.pay }).then(reopen); }; });
      $$('[data-dep]', body).forEach(function (btn) { btn.onclick = function () { patch(b, { deposit: btn.dataset.dep }).then(reopen); }; });
      $('#unitSel', body).onchange = function () {
        var sel = this;
        patch(b, { scooterId: sel.value }).then(function (nb) { UI.toast('Scooter reassigned'); reopen(nb); }, function () { sel.value = b.scooterId; });
      };
      $('#saveNotes', body).onclick = function () { patch(b, { notes: $('#notes', body).value }).then(function () { UI.toast('Notes saved'); }); };
      UI.api('GET', '/api/admin/bookings/' + b.id + '/messages').then(function (m) {
        var smsHref = 'sms:' + phone + (/iPhone|iPad/.test(navigator.userAgent) ? '&' : '?') + 'body=' + encodeURIComponent(m.customer);
        $('#msgs', body).innerHTML =
          '<p class="small"><b>Confirmation for customer</b> (Messenger / SMS)</p><pre class="msg">' + esc(m.customer) + '</pre>' +
          '<div class="row"><button class="btn sm" id="cpC">📋 Copy message</button><a class="btn sm alt" href="' + esc(smsHref) + '">Open SMS</a></div>' +
          smsBlock(b, m.sms) +
          '<p class="small" style="margin-top:12px"><b>New-booking alert</b> (SMS-ready)</p><pre class="msg">' + esc(m.admin) + '</pre>' +
          '<button class="btn sm alt" id="cpA">📋 Copy alert</button>';
        $('#cpC', body).onclick = function () { UI.copy(m.customer); };
        $('#cpA', body).onclick = function () { UI.copy(m.admin); };
        if ($('#sendSms', body)) $('#sendSms', body).onclick = function () {
          var btn = this; btn.disabled = true; btn.textContent = 'Sending…';
          UI.api('POST', '/api/admin/bookings/' + b.id + '/sms', { kind: 'confirm' }).then(function () {
            UI.toast('📱 SMS sent'); load().then(function () { close(); openBooking(b.id); });
          }, function (e) { UI.toast(e.message); btn.disabled = false; btn.textContent = '📱 Send SMS now'; });
        };
      });
    });
  }

  function smsBlock(b, text) {
    var log = (b.sms || []).map(function (x) {
      return '<li>' + (x.ok ? '✅' : '⚠️') + ' ' + esc(x.kind === 'received' ? '"Booking received"' : '"Confirmed"') + ' · ' +
        new Date(x.at).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) + (x.ok ? '' : ' · ' + esc(x.error || '')) + '</li>';
    }).join('');
    return '<p class="small" style="margin-top:12px"><b>Text message (SMS)</b> · ' + (text.length > 160 ? '2 SMS credits' : '1 SMS credit') + '</p><pre class="msg">' + esc(text) + '</pre>' +
      (D.smsEnabled
        ? '<button class="btn sm alt" id="sendSms">📱 Send SMS now</button>' + (D.settings.smsOnConfirm ? '<span class="small muted"> · sent automatically when you tap Confirm</span>' : '')
        : '<p class="small muted">Automatic SMS is not set up yet (needs a Semaphore account). Use Copy message or Open SMS for now.</p>') +
      (log ? '<ul class="small sms-log">' + log + '</ul>' : '');
  }

  // ---------- setup checklist ----------
  function setupBanner() {
    var items = (D.setup || []).filter(function (x) { return x.id !== 'sms'; });
    var left = items.filter(function (x) { return !x.done; }).length;
    if (!left) return '';
    return '<button class="setup-banner" id="setupBanner">🚀 <b>Go-live setup:</b> ' + (items.length - left) + ' of ' + items.length + ' done · <u>See what\'s left</u></button>';
  }
  function wireSetupBanner() { var b = $('#setupBanner'); if (b) b.onclick = function () { location.hash = '#summary'; }; }
  function setupCard() {
    var items = D.setup || [];
    var req = items.filter(function (x) { return x.id !== 'sms'; });
    var done = req.filter(function (x) { return x.done; }).length;
    return '<div class="card setup"><h3>🚀 Go-live checklist <span class="small muted">' + done + ' of ' + req.length + ' done</span></h3><ul class="checklist">' +
      items.map(function (x) {
        var action = x.done ? '' : x.id === 'samples' ? '<button class="btn sm alt" id="clearSamples">Delete samples</button>'
          : x.id === 'prices' ? '<button class="btn sm alt" id="pricesOk">Mark reviewed</button>'
          : x.tab ? '<a class="btn sm alt" href="#' + x.tab + '">Open</a>' : '';
        return '<li class="' + (x.done ? 'done' : '') + '"><span class="ck">' + (x.done ? '✅' : '⬜') + '</span><div><b>' + esc(x.label) + '</b>' +
          (x.done ? '' : '<div class="small muted">' + esc(x.hint) + '</div>') + '</div>' + action + '</li>';
      }).join('') + '</ul></div>';
  }
  function wireSetupCard() {
    if ($('#clearSamples')) $('#clearSamples').onclick = function () {
      if (!confirm('Delete all sample bookings? Real bookings are not affected.')) return;
      UI.api('DELETE', '/api/admin/sample-bookings').then(function (r) { UI.toast('Deleted ' + r.removed + ' sample bookings'); load(); }, function (e) { UI.toast(e.message); });
    };
    if ($('#pricesOk')) $('#pricesOk').onclick = function () {
      if (!confirm('Have you checked the scooter rates (Fleet tab), deposit, late fee and add-on prices (Settings)?')) return;
      UI.api('PUT', '/api/admin/settings', { pricesReviewed: true }).then(function () { UI.toast('Marked as reviewed'); load(); });
    };
  }

  // ---------- walk-in booking ----------
  function roundedNow() {
    var n = BAY.nowLocal(), m = BAY.minutesOf(n.slice(11));
    m = Math.ceil(m / 15) * 15;
    return BAY.fromEpoch(BAY.toEpoch(n.slice(0, 10) + 'T00:00') + m * 60e3);
  }
  function openWalkIn() {
    var s = D.settings;
    var units = D.units.filter(function (u) { return u.status !== 'maintenance'; });
    var start = roundedNow(), end = BAY.addHours(start, 24);
    var st = { status: 'picked_up', addons: {}, method: 'cash', paid: true, deposit: true, license: null };
    var riders = []; for (var i = 1; i <= (s.maxRiders || 2); i++) riders.push(i);
    var html =
      '<div class="seg" id="wStatus"><button data-s="picked_up" class="on">🛵 Renting now</button><button data-s="confirmed">📅 Reserve for later</button></div>' +
      '<label class="f" for="wUnit">Scooter</label><select id="wUnit">' + units.map(function (u) {
        return '<option value="' + u.id + '">' + esc(u.name + ' · ' + u.plate) + (u.status === 'rented' ? ' (rented)' : '') + '</option>'; }).join('') + '</select>' +
      '<div class="grid2"><div><label class="f" for="wPd">Pickup</label><input type="date" id="wPd" value="' + start.slice(0, 10) + '"></div>' +
        '<div><label class="f" for="wPt">&nbsp;</label><input type="time" id="wPt" step="900" value="' + start.slice(11) + '"></div>' +
        '<div><label class="f" for="wRd">Return</label><input type="date" id="wRd" value="' + end.slice(0, 10) + '"></div>' +
        '<div><label class="f" for="wRt">&nbsp;</label><input type="time" id="wRt" step="900" value="' + end.slice(11) + '"></div></div>' +
      '<div class="quick" id="wQuick" style="margin-top:8px"><button data-h="' + (s.halfDayHours || 6) + '">Half day</button><button data-h="24">1 day</button><button data-h="48">2 days</button><button data-h="72">3 days</button><button data-h="168">1 week</button></div>' +
      '<div id="wAvail" class="small" style="margin-top:6px"></div>' +
      '<label class="f" for="wName">Customer name</label><input id="wName" autocomplete="off">' +
      '<div class="grid2"><div><label class="f" for="wMob">Mobile <span class="opt">(optional)</span></label><input id="wMob" type="tel" inputmode="tel"></div>' +
        '<div><label class="f" for="wFb">Facebook <span class="opt">(optional)</span></label><input id="wFb"></div></div>' +
      '<label class="f" for="wStay">Staying at <span class="opt">(optional)</span></label><input id="wStay">' +
      '<label class="f">Riders</label><div class="seg" id="wRiders">' + riders.map(function (r) { return '<button data-r="' + r + '" class="' + (r === 1 ? 'on' : '') + '">' + r + '</button>'; }).join('') + '</div>' +
      '<label class="f">Add-ons</label><div class="card" style="padding:4px 12px">' + s.addons.filter(function (a) { return a.active; }).map(function (a) {
        return '<div class="addon"><div class="name">' + esc(a.name) + ' <span class="small muted">' + peso(a.price) + (a.perDay ? '/day' : '') + '</span></div>' +
          '<div class="qty"><button data-minus="' + a.id + '">−</button><span id="wq_' + a.id + '">0</span><button data-plus="' + a.id + '">+</button></div></div>'; }).join('') + '</div>' +
      '<div class="card sand" id="wPrice"></div>' +
      '<label class="f">Payment</label><div class="seg" id="wMethod"><button data-m="cash" class="on">💵 Cash</button><button data-m="gcash">📱 GCash</button></div>' +
      '<input id="wRef" class="hidden" placeholder="GCash reference no." style="margin-top:8px">' +
      '<label class="check"><input type="checkbox" id="wPaid" checked><span>Rental paid</span></label>' +
      '<label class="check" id="wDepRow"><input type="checkbox" id="wDep" checked><span>Deposit collected</span></label>' +
      '<label class="f">License photo <span class="opt">(optional)</span></label>' +
      '<label class="upload" id="wLicBox"><input type="file" accept="image/*" id="wLic"><div><b>Tap to photograph the license</b></div></label>' +
      '<label class="f" for="wNotes">Notes <span class="opt">(fuel level, helmet no., ID left…)</span></label><textarea id="wNotes"></textarea>' +
      '<div id="wMsg"></div><button class="btn big" id="wSave" style="margin-top:12px">Save walk-in booking</button>';
    UI.modal('Walk-in booking', html, function (body, close) {
      var q = function (sel) { return $(sel, body); };
      var win = function () { return { p: q('#wPd').value + 'T' + q('#wPt').value, r: q('#wRd').value + 'T' + q('#wRt').value }; };
      function refresh() {
        var w = win(), u = D.units.filter(function (x) { return x.id === q('#wUnit').value; })[0];
        var valid = BAY.isLocal(w.p) && BAY.isLocal(w.r) && BAY.toEpoch(w.r) > BAY.toEpoch(w.p);
        if (!u || !valid) { q('#wPrice').innerHTML = '<span class="small muted">Set a return time after pickup.</span>'; q('#wAvail').textContent = ''; return; }
        var clash = D.bookings.filter(function (b) {
          return b.scooterId === u.id && BAY.ACTIVE_STATUSES.indexOf(b.status) >= 0 && BAY.overlaps(w.p, w.r, b.pickup, b.return, s.bufferMinutes);
        })[0];
        q('#wAvail').innerHTML = clash ? '<span style="color:var(--err)">⚠️ Booked by ' + esc(clash.customer.name) + ' (' + esc(clash.ref) + ') ' + BAY.fmtLocal(clash.pickup) + ' → ' + BAY.fmtLocal(clash.return) + '</span>'
          : '<span style="color:var(--ok)">✓ Free for this time</span>';
        var qt = BAY.quote(u, w.p, w.r, st.addons, s);
        q('#wPrice').innerHTML = '<table class="breakdown"><tr><td>' + esc(qt.rentalLabel) + '</td><td>' + peso(qt.rental) + '</td></tr>' +
          qt.addons.map(function (a) { return '<tr><td>' + esc(a.name) + (a.qty > 1 ? ' × ' + a.qty : '') + '</td><td>' + peso(a.amount) + '</td></tr>'; }).join('') +
          '<tr class="total"><td>Rental total</td><td>' + peso(qt.total) + '</td></tr><tr class="dep"><td>Deposit</td><td>' + peso(qt.deposit) + '</td></tr>' +
          '<tr class="due"><td>Collect now</td><td>' + peso((st.paid ? qt.total : 0) + (st.deposit && st.status === 'picked_up' ? qt.deposit : 0)) + '</td></tr></table>';
      }
      function seg(id, key, attr, after) {
        q(id).onclick = function (e) {
          var b = e.target.closest('button'); if (!b) return;
          st[key] = b.dataset[attr]; $$(id + ' button', body).forEach(function (x) { x.classList.toggle('on', x === b); });
          if (after) after(); refresh();
        };
      }
      seg('#wStatus', 'status', 's', function () {
        q('#wDepRow').classList.toggle('hidden', st.status !== 'picked_up');
        if (st.status === 'confirmed') { q('#wPaid').checked = st.paid = false; }
      });
      seg('#wMethod', 'method', 'm', function () { q('#wRef').classList.toggle('hidden', st.method !== 'gcash'); });
      seg('#wRiders', 'riders', 'r');
      ['#wUnit', '#wPd', '#wPt', '#wRd', '#wRt'].forEach(function (id) { q(id).addEventListener('change', refresh); });
      q('#wQuick').onclick = function (e) {
        var b = e.target.closest('button'); if (!b) return;
        var r = BAY.addHours(win().p, +b.dataset.h);
        q('#wRd').value = r.slice(0, 10); q('#wRt').value = r.slice(11); refresh();
      };
      $$('[data-plus],[data-minus]', body).forEach(function (b) {
        b.onclick = function () {
          var id = b.dataset.plus || b.dataset.minus, a = s.addons.filter(function (x) { return x.id === id; })[0];
          var n = Math.max(0, Math.min(a.maxQty || 1, (st.addons[id] || 0) + (b.dataset.plus ? 1 : -1)));
          if (n) st.addons[id] = n; else delete st.addons[id];
          q('#wq_' + id).textContent = n; refresh();
        };
      });
      q('#wPaid').onchange = function () { st.paid = this.checked; refresh(); };
      q('#wDep').onchange = function () { st.deposit = this.checked; refresh(); };
      q('#wLic').onchange = function (e) {
        var box = q('#wLicBox'), input = this; box.querySelector('b').textContent = 'Compressing…';
        UI.compressImage(e.target.files[0], 1400, 0.72).then(function (d) {
          st.license = d; box.innerHTML = ''; box.appendChild(input);
          box.insertAdjacentHTML('beforeend', '<img src="' + d + '" alt="License"><span class="small">✅ Photo added · tap to change</span>');
        }, function (er) { UI.toast(er.message); box.querySelector('b').textContent = 'Tap to photograph the license'; });
      };
      q('#wSave').onclick = function () {
        var btn = this, w = win();
        btn.disabled = true; btn.textContent = 'Saving…';
        UI.api('POST', '/api/admin/walkins', {
          scooterId: q('#wUnit').value, pickup: w.p, return: w.r, status: st.status, addons: st.addons,
          customer: { name: q('#wName').value, mobile: q('#wMob').value, fb: q('#wFb').value, stayingAt: q('#wStay').value, riders: +(st.riders || 1) },
          method: st.method, gcashRef: q('#wRef').value, paid: st.paid, depositCollected: st.deposit,
          license: st.license, notes: q('#wNotes').value
        }).then(function (r) {
          close(); UI.toast('Saved ' + r.booking.ref);
          filter = r.booking.status; load();
        }, function (e) {
          q('#wMsg').innerHTML = '<div class="err-box">' + esc(e.message) + '</div>';
          btn.disabled = false; btn.textContent = 'Save walk-in booking';
        });
      };
      refresh();
    });
  }

  // ---------- calendar / timeline ----------
  function renderCalendar() {
    var DAYS = 14, PX = window.innerWidth < 600 ? 72 : 96;
    if (!calStart) calStart = BAY.addDays(BAY.today(), -1);
    var t0 = BAY.toEpoch(calStart + 'T00:00'), t1 = t0 + DAYS * 864e5;
    var x = function (local) { return Math.max(0, Math.min(DAYS * PX, (BAY.toEpoch(local) - t0) / 864e5 * PX)); };
    var days = []; for (var i = 0; i < DAYS; i++) days.push(BAY.addDays(calStart, i));
    var today = BAY.today();
    var grid = days.map(function (d, i) { return '<div class="tl-day' + (d === today ? ' today' : '') + '" style="left:' + i * PX + 'px;width:' + PX + 'px"></div>'; }).join('');
    var head = '<div class="tl-row tl-head"><div class="tl-label"><b>Scooter</b></div><div class="tl-track" style="width:' + DAYS * PX + 'px">' +
      days.map(function (d, i) { return '<div class="tl-day' + (d === today ? ' today' : '') + '" style="left:' + i * PX + 'px;width:' + PX + 'px">' + BAY.fmtDate(d).replace(', ', '<br>') + '</div>'; }).join('') + '</div></div>';
    var rows = D.units.map(function (u) {
      var bars = D.bookings.filter(function (b) {
        return b.scooterId === u.id && b.status !== 'cancelled' && BAY.toEpoch(b.return) > t0 && BAY.toEpoch(b.pickup) < t1;
      }).map(function (b) {
        var l = x(b.pickup), w = Math.max(18, x(b.return) - l);
        return '<button class="tl-bar ' + b.status + '" data-id="' + b.id + '" style="left:' + l + 'px;width:' + w + 'px" title="' + esc(b.ref + ' ' + b.customer.name) + '">' +
          esc(b.customer.name.split(' ')[0]) + '<br>' + esc(b.ref) + '</button>';
      }).join('');
      return '<div class="tl-row"><div class="tl-label"><b>' + esc(u.name) + '</b>' + esc(u.plate) + '</div><div class="tl-track" style="width:' + DAYS * PX + 'px">' +
        (u.status === 'maintenance' ? '<div class="tl-maint" title="Under maintenance"></div>' : '') + grid + bars + '</div></div>';
    }).join('');
    app.innerHTML = '<div class="wrap wide"><section><div class="row" style="margin-bottom:10px">' +
      '<button class="btn sm alt" id="prev">← Week</button><button class="btn sm alt" id="tod">Today</button><button class="btn sm alt" id="next">Week →</button></div>' +
      '<div class="tl-wrap"><div class="tl">' + head + rows + '</div></div>' +
      '<div class="legend"><span><i style="background:#e0a326"></i>Pending</span><span><i style="background:#2a78c2"></i>Confirmed</span><span><i style="background:#1e9e63"></i>Picked up</span><span><i style="background:#9aa9b1"></i>Returned</span><span><i style="background:#ddd"></i>Maintenance</span></div>' +
      '<p class="small muted">Tap a booking to open it. Swipe sideways to see more days.</p></section></div>';
    $('#prev').onclick = function () { calStart = BAY.addDays(calStart, -7); renderCalendar(); };
    $('#next').onclick = function () { calStart = BAY.addDays(calStart, 7); renderCalendar(); };
    $('#tod').onclick = function () { calStart = null; renderCalendar(); };
    $$('.tl-bar').forEach(function (el) { el.onclick = function () { openBooking(el.dataset.id); }; });
  }

  // ---------- summary ----------
  function renderSummary() {
    var s = D.summary, t = BAY.today();
    var stat = function (v, l) { return '<div class="stat"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>'; };
    var mini = function (list, field) {
      return list.length ? list.map(function (b) {
        return '<button class="bk" data-id="' + b.id + '"><b>' + BAY.fmtTime(b[field].slice(11)) + '</b> · ' + esc(b.customer.name) + ' · ' + esc(b.model) + ' ' + statusPill(b.status) + '</button>';
      }).join('') : '<p class="small muted">None</p>';
    };
    var pick = D.bookings.filter(function (b) { return ['pending', 'confirmed'].indexOf(b.status) >= 0 && b.pickup.indexOf(t) === 0; }).sort(function (a, b) { return a.pickup.localeCompare(b.pickup); });
    var rets = D.bookings.filter(function (b) { return b.status === 'picked_up' && b.return.indexOf(t) === 0; }).sort(function (a, b) { return a.return.localeCompare(b.return); });
    var late = D.bookings.filter(function (b) { return b.status === 'picked_up' && BAY.toEpoch(b.return) < Date.now(); });
    app.innerHTML = '<div class="wrap wide"><section>' + setupCard() +
      '<h2>This week <span class="small muted">(from ' + BAY.fmtDate(s.weekStart) + ')</span></h2><div class="stats">' +
        stat(s.week.bookings, 'Bookings') + stat(peso(s.week.revenue), 'Revenue') + stat(s.pending, 'Awaiting confirmation') + stat(s.outNow, 'Scooters out now') + '</div>' +
      '<h2 style="margin-top:18px">This month</h2><div class="stats">' +
        stat(s.month.bookings, 'Bookings') + stat(peso(s.month.revenue), 'Revenue') +
        stat(s.topModel ? esc(s.topModel.model) : '—', 'Most rented' + (s.topModel ? ' (' + s.topModel.count + ')' : '')) + stat(peso(s.depositsHeld), 'Deposits held') + '</div>' +
      '<p class="small muted">Revenue counts confirmed, picked-up and returned bookings by pickup date (deposits excluded).</p>' +
      (late.length ? '<h3 style="color:var(--err)">⚠️ Overdue returns</h3>' + mini(late, 'return') : '') +
      '<h3 style="margin-top:14px">Pickups today</h3>' + mini(pick, 'pickup') +
      '<h3 style="margin-top:14px">Returns today</h3>' + mini(rets, 'return') +
      '<div class="spacer"></div><a class="btn alt" id="exportCsv" href="/api/admin/export.csv">⬇️ Export all bookings (CSV)</a></section></div>';
    if (UI.exportCsv) $('#exportCsv').onclick = function (e) { e.preventDefault(); UI.exportCsv(); };
    $$('.bk').forEach(function (el) { el.onclick = function () { openBooking(el.dataset.id); }; });
    wireSetupCard();
  }

  // ---------- fleet ----------
  function renderFleet() {
    app.innerHTML = '<div class="wrap wide"><section><button class="btn" id="addUnit">＋ Add scooter</button><div class="spacer"></div>' +
      D.units.map(function (u) {
        var badge = u.status === 'available' ? 'ok' : u.status === 'maintenance' ? 'no' : 'warn';
        return '<button class="bk" data-id="' + u.id + '"><div class="unit-row"><img alt="" src="' + UI.unitPhoto(u) + '"><div style="flex:1">' +
          '<b>' + esc(u.name) + '</b> <span class="small muted">' + esc(u.plate) + '</span><br><span class="badge ' + badge + '">' + esc(u.status.replace('maintenance', 'under maintenance')) + '</span>' +
          '<div class="small">' + peso(u.dailyRate) + '/day' + (u.halfDayRate ? ' · ' + peso(u.halfDayRate) + ' half-day' : '') + (u.multiDayRate ? ' · ' + peso(u.multiDayRate) + '/day ' + D.settings.multiDayMinDays + '+ days' : '') + '</div></div></div></button>';
      }).join('') + '</section></div>';
    $('#addUnit').onclick = function () { editUnit(null); };
    $$('.bk').forEach(function (el) { el.onclick = function () { editUnit(el.dataset.id); }; });
  }
  function photoPicker(id, current, label) {
    return '<label class="upload" id="' + id + 'Box"><input type="file" accept="image/*" id="' + id + '">' +
      (current ? '<img src="' + current + '" alt="">' : '') + '<div><b>' + esc(label) + '</b></div></label>';
  }
  function uploadPublic(file, maxSide) {
    return UI.compressImage(file, maxSide || 900, 0.72).then(function (d) { return UI.api('POST', '/api/admin/upload', { dataUrl: d }); }).then(function (r) { return r.file; });
  }
  function editUnit(id) {
    var u = id ? D.units.filter(function (x) { return x.id === id; })[0] : { name: '', plate: '', color: '#1f6fb2', dailyRate: 500, halfDayRate: 0, multiDayRate: 0, description: '', status: 'available', photo: null };
    var photo = u.photo;
    var f = function (k, label, type, extra) { return '<label class="f" for="u_' + k + '">' + label + '</label><input id="u_' + k + '" type="' + (type || 'text') + '" value="' + esc(u[k]) + '"' + (extra || '') + '>'; };
    UI.modal(id ? 'Edit scooter' : 'Add scooter',
      photoPicker('uPhoto', u.photo ? UI.mediaUrl(u.photo) : '', u.photo ? 'Tap to change photo' : 'Tap to add a photo') +
      f('name', 'Model name', 'text', ' placeholder="Honda Click 125"') + f('plate', 'Plate number (admin only)') +
      f('description', 'Short description') +
      '<div class="grid2">' + f('dailyRate', 'Daily rate ₱', 'number', ' inputmode="numeric"') + f('halfDayRate', 'Half-day ₱ (0 = off)', 'number', ' inputmode="numeric"') +
      f('multiDayRate', 'Multi-day ₱/day (0 = off)', 'number', ' inputmode="numeric"') + f('color', 'Colour', 'color') + '</div>' +
      '<label class="f">Status</label><div class="seg" id="uStatus">' + [['available', 'Available'], ['rented', 'Rented'], ['maintenance', 'Maintenance']].map(function (s) {
        return '<button data-s="' + s[0] + '" class="' + (u.status === s[0] ? 'on' : '') + '">' + s[1] + '</button>'; }).join('') + '</div>' +
      '<div class="spacer"></div><button class="btn" id="uSave">Save</button>' + (id ? '<button class="btn ghost" id="uDel" style="color:var(--err)">Delete scooter</button>' : ''),
      function (body, close) {
        var status = u.status;
        $('#uStatus', body).onclick = function (e) { var b = e.target.closest('button'); if (!b) return; status = b.dataset.s; $$('#uStatus button', body).forEach(function (x) { x.classList.toggle('on', x === b); }); };
        $('#uPhoto', body).onchange = function (e) {
          var box = $('#uPhotoBox', body); box.querySelector('b').textContent = 'Uploading…';
          uploadPublic(e.target.files[0]).then(function (file) {
            photo = file; var img = box.querySelector('img') || box.insertBefore(document.createElement('img'), box.querySelector('div'));
            img.src = UI.mediaUrl(file); box.querySelector('b').textContent = 'Tap to change photo';
          }, function (err) { UI.toast(err.message); box.querySelector('b').textContent = 'Tap to add a photo'; });
        };
        $('#uSave', body).onclick = function () {
          var data = { photo: photo, status: status };
          ['name', 'plate', 'description', 'dailyRate', 'halfDayRate', 'multiDayRate', 'color'].forEach(function (k) { data[k] = $('#u_' + k, body).value; });
          UI.api(id ? 'PUT' : 'POST', '/api/admin/units' + (id ? '/' + id : ''), data).then(function () { close(); UI.toast('Saved'); load(); }, function (e) { UI.toast(e.message); });
        };
        if (id) $('#uDel', body).onclick = function () {
          if (!confirm('Delete ' + u.name + ' (' + u.plate + ')?')) return;
          UI.api('DELETE', '/api/admin/units/' + id).then(function () { close(); UI.toast('Deleted'); load(); }, function (e) { UI.toast(e.message); });
        };
      });
  }

  // ---------- settings ----------
  function renderSettings() {
    var s = D.settings;
    var inp = function (k, label, type, extra) { return '<label class="f" for="s_' + k + '">' + label + '</label><input id="s_' + k + '" data-k="' + k + '" type="' + (type || 'text') + '" value="' + esc(s[k]) + '"' + (extra || '') + '>'; };
    var numIn = function (k, label) { return inp(k, label, 'number', ' inputmode="numeric" data-num'); };
    app.innerHTML = '<div class="wrap wide"><section>' +
      '<div class="card"><h3>💰 Pricing &amp; rules</h3><div class="grid2">' +
        numIn('deposit', 'Security deposit ₱') + numIn('lateFeePerHour', 'Late fee ₱ / hour') +
        numIn('multiDayMinDays', 'Multi-day rate from (days)') + numIn('halfDayHours', 'Half-day = up to (hrs)') +
        numIn('freeCancelHours', 'Free cancel up to (hrs before)') + numIn('graceMinutes', 'Grace before extra day (min)') +
        numIn('bufferMinutes', 'Turnaround between rentals (min)') + numIn('leadMinutes', 'Earliest pickup from now (min)') +
        numIn('minHours', 'Minimum rental (hrs)') + numIn('maxRiders', 'Max riders') + '</div>' +
        '<p class="small muted">Per-scooter daily / half-day / multi-day rates are set in the Fleet tab.</p></div>' +
      '<div class="card"><h3>🕘 Pickup &amp; return hours</h3><div class="grid2">' + inp('openTime', 'Opens', 'time') + inp('closeTime', 'Closes', 'time') + '</div>' + numIn('slotMinutes', 'Time slot step (min)') + '</div>' +
      '<div class="card"><h3>➕ Add-ons</h3><div class="edit-list" id="addons"></div><button class="btn sm alt" id="addAddon">＋ Add add-on</button>' +
        '<p class="small muted">Price · Max qty · tick "/day" to charge per day.</p></div>' +
      '<div class="card"><h3>📜 Rental terms</h3><p class="small muted">One rule per line. Use {deposit}, {lateFee}, {cancelHours} to insert current values.</p>' +
        '<textarea id="terms" style="min-height:200px">' + esc(s.terms.join('\n')) + '</textarea>' +
        '<label class="f" for="termsTl">Tagalog version <span class="opt">(shown when customers switch to Tagalog; leave empty to show English)</span></label>' +
        '<textarea id="termsTl" style="min-height:200px">' + esc((s.termsTl || []).join('\n')) + '</textarea></div>' +
      '<div class="card"><h3>💬 Text messages (SMS)</h3>' +
        '<p class="small ' + (D.smsEnabled ? '' : 'muted') + '">' + (D.smsEnabled ? '✅ SMS gateway connected.' : 'Not connected yet. Add your Semaphore API key to the server settings (see README) to turn this on.') + '</p>' +
        '<label class="check"><input type="checkbox" data-k="smsOnConfirm" data-bool' + (s.smsOnConfirm ? ' checked' : '') + '><span>Text the customer automatically when I tap <b>Confirm</b></span></label>' +
        '<label class="check"><input type="checkbox" data-k="smsOnReceived" data-bool' + (s.smsOnReceived ? ' checked' : '') + '><span>Also text "we got your booking" as soon as they book <span class="small muted">(uses more credits)</span></span></label></div>' +
      '<div class="card"><h3>📱 GCash</h3>' + inp('gcashNumber', 'GCash number') + inp('gcashName', 'Account name') +
        '<label class="f">GCash QR code</label>' + photoPicker('qr', s.gcashQr ? UI.mediaUrl(s.gcashQr) : '', s.gcashQr ? 'Tap to replace QR' : 'Upload QR image') +
        (s.gcashQr ? '<button class="btn sm ghost" id="rmQr">Remove QR</button>' : '') + '</div>' +
      '<div class="card"><h3>🏝️ Shop info</h3>' + inp('shopName', 'Shop name') + inp('tagline', 'Tagline') + inp('taglineTl', 'Tagline (Tagalog)') +
        '<label class="f" for="s_intro">Intro</label><textarea id="s_intro" data-k="intro">' + esc(s.intro) + '</textarea>' +
        '<label class="f" for="s_introTl">Intro (Tagalog)</label><textarea id="s_introTl" data-k="introTl">' + esc(s.introTl || '') + '</textarea>' +
        inp('address', 'Address') + inp('landmark', 'Landmark') + inp('mapsUrl', 'Google Maps link', 'url') + inp('phone', 'Phone', 'tel') +
        inp('messengerUrl', 'Messenger link (m.me/…)', 'url') + inp('adminEmail', 'Admin email for alerts', 'email') +
        '<label class="f">Shop photos (landing page)</label><div class="thumbs" id="gal"></div>' +
        '<label class="btn sm alt" style="margin-top:8px">＋ Add photo<input type="file" accept="image/*" id="galAdd" class="hidden"></label></div>' +
      '<button class="btn big" id="saveSettings">Save settings</button>' +
      '<div class="card" style="margin-top:18px"><h3>🔒 Change admin password</h3><input id="newPw" type="password" autocomplete="new-password" placeholder="New password (8+ characters)">' +
        '<button class="btn sm alt" id="savePw" style="margin-top:8px">Update password</button></div>' +
      '</section></div>';

    var addons = JSON.parse(JSON.stringify(s.addons));
    var gallery = (s.gallery || []).slice();
    var qr = s.gcashQr;
    function drawAddons() {
      $('#addons').innerHTML = addons.map(function (a, i) {
        return '<div class="item addon"><input data-i="' + i + '" data-f="name" value="' + esc(a.name) + '" aria-label="Name">' +
          '<input data-i="' + i + '" data-f="price" type="number" inputmode="numeric" value="' + a.price + '" aria-label="Price">' +
          '<div><input data-i="' + i + '" data-f="maxQty" type="number" inputmode="numeric" value="' + a.maxQty + '" aria-label="Max qty" style="padding:8px 4px"><label class="mini-check"><input type="checkbox" data-i="' + i + '" data-f="perDay"' + (a.perDay ? ' checked' : '') + '>/day</label></div>' +
          '<button class="iconbtn" data-rm="' + i + '" aria-label="Remove">🗑</button></div>';
      }).join('');
    }
    function drawGallery() {
      $('#gal').innerHTML = gallery.map(function (g, i) { return '<div class="t"><img src="' + UI.mediaUrl(g) + '" alt=""><button data-g="' + i + '" aria-label="Remove">✕</button></div>'; }).join('') || '<span class="small muted">No photos yet</span>';
    }
    drawAddons(); drawGallery();
    $('#addons').addEventListener('input', function (e) {
      var el = e.target, a = addons[el.dataset.i]; if (!a) return;
      a[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value;
    });
    $('#addons').addEventListener('change', function (e) { var el = e.target; if (el.type === 'checkbox') addons[el.dataset.i].perDay = el.checked; });
    $('#addons').addEventListener('click', function (e) { var b = e.target.closest('[data-rm]'); if (b) { addons.splice(+b.dataset.rm, 1); drawAddons(); } });
    $('#addAddon').onclick = function () { addons.push({ id: 'a' + Date.now().toString(36), name: '', price: 0, perDay: false, maxQty: 1, active: true }); drawAddons(); };
    $('#gal').addEventListener('click', function (e) { var b = e.target.closest('[data-g]'); if (b) { gallery.splice(+b.dataset.g, 1); drawGallery(); } });
    $('#galAdd').onchange = function (e) { UI.toast('Uploading…'); uploadPublic(e.target.files[0], 1200).then(function (f) { gallery.push(f); drawGallery(); UI.toast('Added — remember to Save'); }, function (er) { UI.toast(er.message); }); };
    $('#qr').onchange = function (e) {
      UI.toast('Uploading…');
      uploadPublic(e.target.files[0], 700).then(function (f) {
        qr = f; var box = $('#qrBox'); var img = box.querySelector('img') || box.insertBefore(document.createElement('img'), box.querySelector('div'));
        img.src = UI.mediaUrl(f); UI.toast('QR uploaded — remember to Save');
      }, function (er) { UI.toast(er.message); });
    };
    if ($('#rmQr')) $('#rmQr').onclick = function () { qr = null; var img = $('#qrBox img'); if (img) img.remove(); };
    $('#saveSettings').onclick = function () {
      var data = { addons: addons.filter(function (a) { return a.name.trim(); }), gallery: gallery, gcashQr: qr,
        terms: $('#terms').value.split('\n').map(function (t) { return t.trim(); }).filter(Boolean),
        termsTl: $('#termsTl').value.split('\n').map(function (t) { return t.trim(); }).filter(Boolean) };
      $$('[data-k]').forEach(function (el) { data[el.dataset.k] = el.hasAttribute('data-bool') ? el.checked : el.hasAttribute('data-num') ? +el.value : el.value; });
      UI.api('PUT', '/api/admin/settings', data).then(function () { UI.toast('Settings saved'); load(); }, function (e) { UI.toast(e.message); });
    };
    $('#savePw').onclick = function () {
      UI.api('PUT', '/api/admin/password', { password: $('#newPw').value }).then(function () { $('#newPw').value = ''; UI.toast('Password updated'); }, function (e) { UI.toast(e.message); });
    };
  }

  boot();
})();
