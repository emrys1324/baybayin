/* Customer booking flow (vanilla JS, hash routing). English / Tagalog via I18N. */
(function () {
  'use strict';
  var $ = UI.$, $$ = UI.$$, esc = UI.esc, peso = BAY.peso;
  var t = I18N.t, tx = I18N.tx;
  var te = function (s, v) { return esc(t(s, v)); };      // translated + HTML-escaped
  var app = $('#app');
  var CFG = null;             // { settings, units }
  var S = loadState();        // booking-in-progress
  var models = null;          // availability results for current window
  var files = { license: null, proof: null };   // compressed data URLs (kept in memory only)
  var STEPS = ['When', 'Scooter', 'Extras', 'Your details', 'Payment'];

  function blankState() {
    return { step: 0, pickupDate: '', pickupTime: '', returnDate: '', returnTime: '', model: '', addons: {},
      customer: { name: '', mobile: '', email: '', fb: '', stayingAt: '', riders: 1 }, agree: false,
      payMethod: 'cash', gcashRef: '' };
  }
  function loadState() {
    try { var s = JSON.parse(sessionStorage.getItem('bay_state')); if (s && s.customer) return s; } catch (e) {}
    return blankState();
  }
  function saveState() { try { sessionStorage.setItem('bay_state', JSON.stringify(S)); } catch (e) {} }
  function pickup() { return S.pickupDate && S.pickupTime ? S.pickupDate + 'T' + S.pickupTime : ''; }
  function ret() { return S.returnDate && S.returnTime ? S.returnDate + 'T' + S.returnTime : ''; }
  function chosen() { return models && models.filter(function (m) { return m.model === S.model && m.available > 0; })[0]; }
  function currentQuote() {
    var m = chosen();
    return m ? BAY.quote(m.unit, pickup(), ret(), S.addons, CFG.settings) : null;
  }
  function errBox(msg) { return '<div class="err-box">' + esc(tx(msg)) + '</div>'; }
  function hours(s) { return { open: BAY.fmtTime(s.openTime), close: BAY.fmtTime(s.closeTime) }; }

  // ---------- language toggle ----------
  function paintLangBtn() {
    var b = $('#langBtn'); if (!b) return;
    b.textContent = I18N.lang === 'tl' ? 'English' : 'Tagalog';
    b.setAttribute('aria-label', t('Switch language'));
  }
  if ($('#langBtn')) $('#langBtn').onclick = function () {
    I18N.setLang(I18N.lang === 'tl' ? 'en' : 'tl');
    paintLangBtn();
    if (CFG) route(true);
  };
  paintLangBtn();

  // ---------- boot ----------
  UI.api('GET', '/api/config').then(function (cfg) {
    CFG = cfg;
    $('#brandName').textContent = cfg.settings.shopName;
    window.addEventListener('hashchange', function () { route(); });
    route();
  }).catch(function (e) {
    app.innerHTML = '<div class="wrap">' + errBox(e.message) + '<button class="btn" onclick="location.reload()">' + te('Try again') + '</button></div>';
  });

  function route(keepScroll) {
    var h = location.hash.replace(/^#\/?/, '');
    $$('.modal').forEach(function (m) { m.remove(); });
    if (!keepScroll) window.scrollTo(0, 0);
    document.body.classList.remove('has-bar');
    if (h === 'book') return renderStep();
    if (h === 'done') return renderDone();
    if (h === 'lookup') return renderLookup();
    return renderHome();
  }

  // ---------- landing ----------
  function renderHome() {
    var s = CFG.settings, tl = I18N.lang === 'tl';
    var byModel = {};
    CFG.units.forEach(function (u) { if (u.status !== 'maintenance' && !byModel[u.name]) byModel[u.name] = u; });
    var fleet = Object.keys(byModel).map(function (k) {
      var u = byModel[k];
      return '<div class="card"><img class="scooter-img" loading="lazy" alt="' + esc(u.name) + '" src="' + UI.unitPhoto(u) + '">' +
        '<div class="name">' + esc(u.name) + '</div><div class="small muted">' + te('from') + ' <b>' + peso(u.halfDayRate || u.dailyRate) + '</b></div></div>';
    }).join('');
    var gallery = (s.gallery || []).map(function (g) { return '<img loading="lazy" alt="' + te('Shop photo') + '" src="' + UI.mediaUrl(g) + '">'; }).join('');
    app.innerHTML =
      '<div class="hero"><div class="wrap">' +
        '<h1>' + esc(s.shopName) + '</h1><p class="tag">' + esc(tl && s.taglineTl ? s.taglineTl : s.tagline) + '</p>' +
        heroArt() +
        '<a class="btn big" href="#/book" id="bookBtn">🛵 ' + te('Book a Scooter') + '</a>' +
        '<div class="chips"><span class="chip">🕘 ' + te('{open} – {close} daily', hours(s)) + '</span>' +
        '<span class="chip">⛑️ ' + te('Helmet included') + '</span><span class="chip">💵 ' + te('Cash or GCash') + '</span></div>' +
      '</div></div>' +
      '<section><div class="wrap"><p>' + esc(tl && s.introTl ? s.introTl : s.intro) + '</p></div></section>' +
      '<section><div class="wrap"><h2>' + te('Our scooters') + '</h2><div class="fleet-mini">' + fleet + '</div>' +
        '<p class="small muted" style="margin-top:8px">' + te('Refundable deposit {deposit}. Multi-day discounts for {days}+ days.', { deposit: peso(s.deposit), days: s.multiDayMinDays }) + '</p></div></section>' +
      (gallery ? '<section><div class="wrap"><h2>' + te('Photos') + '</h2><div class="gallery">' + gallery + '</div></div></section>' : '') +
      '<section><div class="wrap"><h2>' + te('Find us') + '</h2><div class="card"><ul class="info-list">' +
        '<li><span class="ico">📍</span><div><b>' + esc(s.address) + '</b><div class="small muted">' + esc(s.landmark) + '</div></div></li>' +
        '<li><span class="ico">🕘</span><div>' + te('Pickup & return') + '<div class="small muted">' + te('{open} – {close}, every day', hours(s)) + '</div></div></li>' +
        '<li><span class="ico">⛴️</span><div>' + te('Coming by ferry or RoRo?') + '<div class="small muted">' + te('Add port delivery and we\'ll meet you there.') + '</div></div></li>' +
        (s.phone ? '<li><span class="ico">📞</span><div><a href="tel:' + esc(s.phone.replace(/\s/g, '')) + '">' + esc(s.phone) + '</a></div></li>' : '') +
      '</ul><div class="row" style="margin-top:10px"><a class="btn alt" target="_blank" rel="noopener" href="' + esc(s.mapsUrl) + '">🗺️ ' + te('Directions') + '</a>' +
      '<a class="btn messenger" target="_blank" rel="noopener" href="' + esc(s.messengerUrl) + '">💬 Messenger</a></div></div>' +
      '<a class="btn big" href="#/book">' + te('Book a Scooter') + '</a></div></section>' +
      footer();
  }
  function heroArt() {
    return '<svg class="hero-art" viewBox="0 0 360 120" aria-hidden="true">' +
      '<circle cx="300" cy="30" r="18" fill="#ffd36b"/>' +
      '<path d="M0 70 Q60 55 120 70 T240 70 T360 70 V120 H0Z" fill="#2bb3c0" opacity=".35"/>' +
      '<path d="M0 84 Q60 72 120 84 T240 84 T360 84 V120 H0Z" fill="#0b6e99" opacity=".55"/>' +
      '<path d="M0 100 Q90 88 180 100 T360 100 V120 H0Z" fill="#f4e7cf"/>' +
      '<path d="M40 100 L44 60 M44 60 Q30 52 22 58 M44 60 Q56 50 66 56 M44 60 Q40 46 30 44 M44 60 Q52 44 62 44" stroke="#3c7a3a" stroke-width="3" fill="none" stroke-linecap="round"/>' +
      '</svg>';
  }
  function footer() {
    var s = CFG.settings;
    return '<footer class="site"><div class="wrap"><b>' + esc(s.shopName) + '</b><br>' + esc(s.address) + '<br>' +
      '<a href="#/lookup">' + te('Find my booking') + '</a> · <a href="#" data-terms>' + te('Rental terms') + '</a><br><span class="small">' + te('Salamat po sa pagbisita!') + ' 🌴</span></div></footer>';
  }
  app.addEventListener('click', function (e) {
    if (e.target.closest('[data-terms]')) { e.preventDefault(); showTerms(); }
  });
  function showTerms() {
    var s = CFG.settings;
    var terms = I18N.lang === 'tl' && s.termsTl && s.termsTl.length ? s.termsTl : s.terms;
    UI.modal(t('Rental terms'), '<ol class="terms">' + terms.map(function (x) { return '<li>' + esc(BAY.fillTerms(x, s)) + '</li>'; }).join('') +
      '</ol><button class="btn" data-close>' + te('Got it') + '</button>');
  }

  // ---------- booking steps ----------
  function stepHeader() {
    return '<div class="steps">' + STEPS.map(function (_, i) { return '<i class="' + (i <= S.step ? 'on' : '') + '"></i>'; }).join('') + '</div>' +
      '<div class="step-title">' + te('Step {n} of {total}', { n: S.step + 1, total: STEPS.length }) + ' · ' + te(STEPS[S.step]) + '</div>';
  }
  function bar(label, opts) {
    opts = opts || {};
    var q = currentQuote();
    return '<div class="bottombar"><div class="wrap">' +
      (S.step > 0 ? '<button class="btn alt back" data-back aria-label="' + te('Back') + '">←</button>' : '') +
      '<div class="sum">' + (q ? '<span class="small muted">' + te('Total') + '</span><b id="barTotal">' + peso(q.total) + '</b>' : '<span class="small muted">' + esc(opts.hint ? t(opts.hint) : '') + '</span>') + '</div>' +
      '<button class="btn" data-next ' + (opts.disabled ? 'disabled' : '') + '>' + te(label) + '</button></div></div>';
  }
  function go(step) { S.step = step; saveState(); renderStep(); window.scrollTo(0, 0); }

  function renderStep() {
    if (!CFG) return;
    if (S.step > 0 && BAY.validateWindow(pickup(), ret(), CFG.settings)) S.step = 0;
    if (S.step > 1 && !chosen()) { if (!models) return loadModels().then(renderStep, function () { go(0); }); S.step = Math.min(S.step, 1); }
    document.body.classList.add('has-bar');
    [stepWhen, stepScooter, stepExtras, stepDetails, stepPayment][S.step]();
  }

  // Step 1 — dates
  function defaultDates() {
    var s = CFG.settings, slots = BAY.timeSlots(s);
    var earliest = BAY.fromEpoch(Date.now() + (s.leadMinutes || 0) * 60e3);
    var d = BAY.today(), tm = slots.filter(function (x) { return d + 'T' + x >= earliest; })[0];
    if (!tm || !BAY.withinHours(d + 'T' + tm, s.openTime, s.closeTime)) { d = BAY.addDays(d, 1); tm = slots[0]; }
    if (BAY.minutesOf(tm) < BAY.minutesOf('09:00') && slots.indexOf('09:00') >= 0) tm = '09:00';
    S.pickupDate = d; S.pickupTime = tm; S.returnDate = BAY.addDays(d, 1); S.returnTime = tm;
  }
  function stepWhen() {
    var s = CFG.settings;
    if (!S.pickupDate) defaultDates();
    var slots = BAY.timeSlots(s);
    var opt = function (sel) { return slots.map(function (x) { return '<option value="' + x + '"' + (x === sel ? ' selected' : '') + '>' + BAY.fmtTime(x) + '</option>'; }).join(''); };
    var today = BAY.today();
    app.innerHTML = '<div class="wrap">' + stepHeader() +
      '<h2>' + te('When do you need it?') + '</h2>' +
      '<p class="small muted">' + te('Pickup & return at our shop, {open} – {close} (Philippine time).', hours(s)) + '</p>' +
      '<div class="card"><h3>🛵 ' + te('Pickup') + '</h3><div class="row">' +
        '<input type="date" id="pDate" min="' + today + '" value="' + S.pickupDate + '" aria-label="' + te('Pickup date') + '">' +
        '<select id="pTime" aria-label="' + te('Pickup time') + '">' + opt(S.pickupTime) + '</select></div></div>' +
      '<label class="f">' + te('How long?') + '</label><div class="quick" id="quick">' +
        '<button data-h="half">' + te('Half day') + '</button><button data-d="1">' + te('1 day') + '</button><button data-d="2">' + te('2 days') + '</button>' +
        '<button data-d="3">' + te('3 days') + '</button><button data-d="7">' + te('1 week') + '</button></div>' +
      '<div class="card" style="margin-top:12px"><h3>🏁 ' + te('Return') + '</h3><div class="row">' +
        '<input type="date" id="rDate" min="' + today + '" value="' + S.returnDate + '" aria-label="' + te('Return date') + '">' +
        '<select id="rTime" aria-label="' + te('Return time') + '">' + opt(S.returnTime) + '</select></div></div>' +
      '<div id="whenMsg"></div></div>' + bar('See scooters', { hint: '' });
    function sync() {
      S.pickupDate = $('#pDate').value; S.pickupTime = $('#pTime').value;
      S.returnDate = $('#rDate').value; S.returnTime = $('#rTime').value;
      models = null; saveState();
      var err = BAY.validateWindow(pickup(), ret(), s);
      var hrs = err ? 0 : (BAY.toEpoch(ret()) - BAY.toEpoch(pickup())) / 36e5;
      $('#whenMsg').innerHTML = err ? errBox(err) :
        '<p class="center muted" style="margin-top:12px">' + te('Rental length:') + ' <b>' + esc(tx(BAY.durationText(hrs))) + '</b></p>';
      $('[data-next]').disabled = !!err;
      $$('#quick button').forEach(function (b) { b.classList.remove('on'); });
    }
    ['#pDate', '#pTime', '#rDate', '#rTime'].forEach(function (id) { $(id).addEventListener('change', sync); });
    $('#pDate').addEventListener('change', function () { if ($('#rDate').value < $('#pDate').value) { $('#rDate').value = BAY.addDays($('#pDate').value, 1); sync(); } });
    $('#quick').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var p = $('#pDate').value + 'T' + $('#pTime').value, r;
      if (b.dataset.h) {
        r = BAY.addHours(p, s.halfDayHours || 6);
        if (r.slice(0, 10) !== p.slice(0, 10) || !BAY.withinHours(r, s.openTime, s.closeTime)) r = p.slice(0, 10) + 'T' + s.closeTime;
      } else r = BAY.addDays(p.slice(0, 10), +b.dataset.d) + 'T' + p.slice(11);
      $('#rDate').value = r.slice(0, 10);
      var rt = slots.indexOf(r.slice(11)) >= 0 ? r.slice(11) : slots.filter(function (x) { return x <= r.slice(11); }).pop();
      $('#rTime').value = rt; sync(); b.classList.add('on');
    });
    sync();
    $('[data-next]').onclick = function () { loadModels().then(function () { go(1); }, function (e) { $('#whenMsg').innerHTML = errBox(e.message); }); };
  }

  function loadModels() {
    var btn = $('[data-next]'); if (btn) { btn.disabled = true; btn.textContent = t('Checking…'); }
    return UI.api('GET', '/api/availability?pickup=' + encodeURIComponent(pickup()) + '&return=' + encodeURIComponent(ret()))
      .then(function (r) { models = r.models; return models; })
      .finally(function () { if (btn && document.body.contains(btn)) { btn.disabled = false; btn.textContent = t('See scooters'); } });
  }

  // Step 2 — choose scooter
  function stepScooter() {
    if (!models) { app.innerHTML = '<div class="spinner"></div>'; return loadModels().then(stepScooter, function () { go(0); }); }
    if (S.model && !chosen()) S.model = '';
    var any = models.some(function (m) { return m.available > 0; });
    app.innerHTML = '<div class="wrap">' + stepHeader() +
      '<h2>' + te('Choose your scooter') + '</h2><p class="small muted">' + BAY.fmtLocal(pickup()) + ' → ' + BAY.fmtLocal(ret()) + '</p>' +
      (any ? '' : errBox('All scooters are booked for these dates. Try different dates or message us on Messenger.')) +
      models.map(function (m) {
        var avail = m.available > 0;
        return '<button class="pick' + (S.model === m.model ? ' on' : '') + '" data-model="' + esc(m.model) + '"' + (avail ? '' : ' disabled') + '>' +
          '<div class="thumb"><img alt="" loading="lazy" src="' + UI.unitPhoto(m.unit) + '"></div><div class="body">' +
          '<div class="title">' + esc(m.model) + '</div><div class="small muted">' + esc(m.unit.description || '') + '</div>' +
          '<div class="row" style="margin-top:4px"><span class="price">' + peso(m.quote.rental) + '</span>' +
          (avail ? '<span class="badge ok" style="flex:none">' + (m.available === 1 ? te('1 left') : te('{n} available', { n: m.available })) + '</span>'
            : '<span class="badge no" style="flex:none">' + te('Booked') + '</span>') +
          '</div><div class="small muted">' + esc(tx(m.quote.rentalLabel)) + '</div></div></button>';
      }).join('') +
      '<button class="btn ghost" data-back2>' + te('Change dates') + '</button></div>' + bar('Continue', { disabled: !chosen(), hint: 'Tap a scooter' });
    $$('.pick').forEach(function (b) {
      b.onclick = function () { S.model = b.dataset.model; saveState(); stepScooter(); };
    });
    $('[data-back2]').onclick = function () { go(0); };
    wireBar(function () { go(2); });
  }

  // Step 3 — add-ons + breakdown
  function breakdownHTML(q) {
    return '<table class="breakdown"><tr><td>' + esc(S.model) + '<div class="small muted">' + esc(tx(q.rentalLabel)) + '</div></td><td>' + peso(q.rental) + '</td></tr>' +
      q.addons.map(function (a) { return '<tr><td>' + te(a.name) + (a.qty > 1 ? ' × ' + a.qty : '') + '</td><td>' + peso(a.amount) + '</td></tr>'; }).join('') +
      '<tr class="total"><td>' + te('Rental total') + '</td><td>' + peso(q.total) + '</td></tr>' +
      '<tr class="dep"><td>' + te('Refundable deposit') + '<div class="small">' + te('paid in cash at pickup, returned after') + '</div></td><td>' + peso(q.deposit) + '</td></tr>' +
      '<tr class="due"><td>' + te('Bring at pickup') + (S.payMethod === 'gcash' ? ' ' + te('(deposit only)') : '') + '</td><td>' + peso(S.payMethod === 'gcash' ? q.deposit : q.dueAtPickup) + '</td></tr></table>';
  }
  function stepExtras() {
    var s = CFG.settings;
    var active = s.addons.filter(function (a) { return a.active; });
    app.innerHTML = '<div class="wrap">' + stepHeader() + '<h2>' + te('Add extras') + '</h2>' +
      (active.length ? '<div class="card">' + active.map(function (a) {
        var qty = S.addons[a.id] || 0;
        var ctrl = (a.maxQty || 1) > 1
          ? '<div class="qty"><button data-minus="' + a.id + '" aria-label="' + te('Less') + '">−</button><span>' + qty + '</span><button data-plus="' + a.id + '" aria-label="' + te('More') + '">+</button></div>'
          : '<button class="toggle' + (qty ? ' on' : '') + '" data-toggle="' + a.id + '" role="switch" aria-checked="' + !!qty + '" aria-label="' + te(a.name) + '"></button>';
        return '<div class="addon"><div class="name">' + te(a.name) + '<div class="small muted">' + peso(a.price) + (a.perDay ? ' ' + te('/ day') : '') + '</div></div>' + ctrl + '</div>';
      }).join('') + '</div>' : '') +
      '<h3 style="margin-top:18px">' + te('Price breakdown') + '</h3><div class="card sand" id="bd"></div>' +
      '<p class="small muted">⛑️ ' + te('One helmet is included. Riding with a passenger? Add an extra helmet.') + '</p></div>' + bar('Continue');
    function refresh() {
      var q = currentQuote();
      $('#bd').innerHTML = breakdownHTML(q);
      $('#barTotal').textContent = peso(q.total);
    }
    $$('[data-plus],[data-minus],[data-toggle]').forEach(function (b) {
      b.onclick = function () {
        var id = b.dataset.plus || b.dataset.minus || b.dataset.toggle;
        var a = s.addons.filter(function (x) { return x.id === id; })[0];
        var q = S.addons[id] || 0;
        if (b.dataset.toggle) q = q ? 0 : 1; else q = Math.max(0, Math.min(a.maxQty || 1, q + (b.dataset.plus ? 1 : -1)));
        if (q) S.addons[id] = q; else delete S.addons[id];
        saveState();
        if (b.dataset.toggle) { b.classList.toggle('on', !!q); b.setAttribute('aria-checked', !!q); } else b.parentNode.querySelector('span').textContent = q;
        refresh();
      };
    });
    refresh();
    wireBar(function () { go(3); });
  }

  // Step 4 — details, license, terms
  var STAY_CHIPS = ['Arriving by ferry', 'Arriving by RoRo', 'San Agustin town', 'Local resident'];
  function stepDetails() {
    var c = S.customer, s = CFG.settings;
    var riders = []; for (var i = 1; i <= (s.maxRiders || 2); i++) riders.push(i);
    var termsLink = '<a href="#" data-terms>' + te('rental terms') + '</a>';
    app.innerHTML = '<div class="wrap">' + stepHeader() + '<h2>' + te('Your details') + '</h2>' +
      '<label class="f" for="name">' + te('Full name') + '</label><input id="name" autocomplete="name" value="' + esc(c.name) + '" placeholder="Juan Dela Cruz">' +
      '<label class="f" for="mobile">' + te('Mobile number') + '</label><input id="mobile" type="tel" inputmode="tel" autocomplete="tel" value="' + esc(c.mobile) + '" placeholder="0917 123 4567">' +
      '<div class="hint">' + te('Foreign number? Start with + and country code.') + '</div>' +
      '<label class="f" for="fb">' + te('Facebook / Messenger name') + '</label><input id="fb" value="' + esc(c.fb) + '" placeholder="' + te('So we can message you') + '">' +
      '<label class="f" for="stay">' + te('Where are you staying?') + '</label><input id="stay" value="' + esc(c.stayingAt) + '" placeholder="' + te('Resort, homestay or barangay') + '">' +
      '<div class="quick" style="margin-top:8px" id="stayQuick">' + STAY_CHIPS.map(function (x) { return '<button>' + te(x) + '</button>'; }).join('') + '</div>' +
      '<label class="f" for="email">' + te('Email') + ' <span class="opt">' + te('(optional)') + '</span></label><input id="email" type="email" inputmode="email" autocomplete="email" value="' + esc(c.email) + '">' +
      '<label class="f">' + te('Number of riders') + '</label><div class="seg" id="riders">' + riders.map(function (r) {
        return '<button data-r="' + r + '" class="' + (c.riders === r ? 'on' : '') + '">' + (r === 1 ? te('1 rider') : te('{n} riders', { n: r })) + '</button>'; }).join('') + '</div>' +
      '<label class="f">' + te('Driver\'s license photo') + '</label>' +
      '<label class="upload" id="licBox"><input type="file" accept="image/*" id="lic">' + uploadInner(files.license, 'Tap to take or upload a photo of your license') + '</label>' +
      '<div class="hint">' + te('Clear photo of the front side. Bring the original at pickup.') + '</div>' +
      '<label class="check"><input type="checkbox" id="agree"' + (S.agree ? ' checked' : '') + '><span>' +
        esc(t('I agree to the {terms} (license, helmet, damage, fuel, late fees, cancellation).')).replace('{terms}', termsLink) + '</span></label>' +
      '<div id="detMsg"></div></div>' + bar('Continue to payment');
    function read() {
      c.name = $('#name').value.trim(); c.mobile = $('#mobile').value.trim(); c.fb = $('#fb').value.trim();
      c.stayingAt = $('#stay').value.trim(); c.email = $('#email').value.trim(); S.agree = $('#agree').checked; saveState();
    }
    $$('input', app).forEach(function (el) { el.addEventListener('change', read); });
    $('#stayQuick').onclick = function (e) { var b = e.target.closest('button'); if (b) { $('#stay').value = b.textContent; read(); } };
    $('#riders').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      c.riders = +b.dataset.r; saveState(); $$('#riders button').forEach(function (x) { x.classList.toggle('on', x === b); });
      if (c.riders > 1 && !S.addons.helmet) UI.toast(t('Tip: add an extra helmet for your passenger'));
    };
    wireUpload('#lic', '#licBox', 'license', 'Tap to take or upload a photo of your license');
    wireBar(function () {
      read();
      var err = !c.name || c.name.length < 2 ? 'Please enter your full name.'
        : !/^(\+?63|0)9\d{9}$/.test(c.mobile.replace(/[\s-]/g, '')) && !/^\+\d{8,15}$/.test(c.mobile.replace(/[\s-]/g, '')) ? 'Please enter a valid mobile number (e.g. 0917 123 4567).'
        : c.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email) ? 'Please check your email address.'
        : !files.license ? 'Please add a photo of your driver\'s license.'
        : !S.agree ? 'Please agree to the rental terms.' : null;
      if (err) { $('#detMsg').innerHTML = errBox(err); $('#detMsg').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      go(4);
    });
  }
  function uploadInner(dataUrl, text) {
    return dataUrl ? '<img src="' + dataUrl + '" alt="' + te('Preview') + '"><span class="small">✅ ' + te('Photo added · tap to change') + '</span>'
      : '<div class="big-ico">📷</div><div><b>' + te(text) + '</b></div>';
  }
  function wireUpload(inputSel, boxSel, key, text) {
    $(inputSel).addEventListener('change', function (e) {
      var f = e.target.files[0]; if (!f) return;
      var box = $(boxSel), input = $(inputSel);
      var label = box.querySelector('b, span.small'); if (label) label.textContent = t('Compressing photo…');
      UI.compressImage(f, 1400, 0.72).then(function (d) {
        files[key] = d;
        box.innerHTML = ''; box.appendChild(input); box.insertAdjacentHTML('beforeend', uploadInner(d, text));
      }, function (err) { UI.toast(tx(err.message)); });
    });
  }

  // Step 5 — payment + submit
  function stepPayment() {
    var s = CFG.settings, q = currentQuote();
    var gc = S.payMethod === 'gcash';
    app.innerHTML = '<div class="wrap">' + stepHeader() + '<h2>' + te('Payment') + '</h2>' +
      '<div class="seg" id="pay"><button data-m="cash" class="' + (!gc ? 'on' : '') + '">💵 ' + te('Pay at pickup (cash)') + '</button>' +
        '<button data-m="gcash" class="' + (gc ? 'on' : '') + '">📱 ' + te('Pay via GCash') + '</button></div>' +
      (gc ? '<div class="gcash" style="margin-top:12px"><div class="small">' + esc(t('Send {amount} to:')).replace('{amount}', '<b>' + peso(q.total) + '</b>') + '</div>' +
        '<div class="num">' + esc(s.gcashNumber) + '</div><div class="small">' + esc(s.gcashName) + '</div>' +
        '<button class="btn sm alt" id="copyNum" style="margin-top:8px">' + te('Copy number') + '</button>' +
        (s.gcashQr ? '<img src="' + UI.mediaUrl(s.gcashQr) + '" alt="' + te('GCash QR code') + '">' : '') +
        '<label class="f" for="gref">' + te('GCash reference number') + '</label><input id="gref" inputmode="numeric" value="' + esc(S.gcashRef) + '" placeholder="' + te('e.g. 1009 123 456789') + '">' +
        '<label class="f">' + te('Payment screenshot') + '</label><label class="upload" id="proofBox"><input type="file" accept="image/*" id="proof">' + uploadInner(files.proof, 'Upload GCash screenshot') + '</label>' +
        '</div>' : '<p class="small muted" style="margin-top:10px">' + te('Pay the rental and deposit in cash when you pick up your scooter.') + '</p>') +
      '<h3 style="margin-top:18px">' + te('Summary') + '</h3><div class="card sand">' +
        '<p><b>' + BAY.fmtLocal(pickup()) + '</b> → <b>' + BAY.fmtLocal(ret()) + '</b></p>' + breakdownHTML(q) + '</div>' +
      '<div id="payMsg"></div></div>' + bar('Confirm booking');
    $('#pay').onclick = function (e) { var b = e.target.closest('button'); if (b) { S.payMethod = b.dataset.m; saveState(); stepPayment(); } };
    if (gc) {
      $('#copyNum').onclick = function () { UI.copy(s.gcashNumber.replace(/\s/g, '')); };
      $('#gref').addEventListener('input', function () { S.gcashRef = this.value; saveState(); });
      wireUpload('#proof', '#proofBox', 'proof', 'Upload GCash screenshot');
    }
    wireBar(submit);
  }

  function submit() {
    var btn = $('[data-next]');
    var msgBox = $('#payMsg');
    if (S.payMethod === 'gcash') {
      if ((S.gcashRef || '').replace(/\D/g, '').length < 6) { msgBox.innerHTML = errBox('Please enter your GCash reference number.'); return; }
      if (!files.proof) { msgBox.innerHTML = errBox('Please upload your GCash payment screenshot.'); return; }
    }
    if (!files.license) { UI.toast(t('Please add your license photo again')); return go(3); }
    btn.disabled = true; btn.textContent = t('Sending…');
    var c = S.customer;
    UI.api('POST', '/api/bookings', {
      pickup: pickup(), return: ret(), model: S.model, addons: S.addons, lang: I18N.lang,
      customer: { name: c.name, mobile: c.mobile.replace(/[\s-]/g, ''), email: c.email, fb: c.fb, stayingAt: c.stayingAt, riders: c.riders },
      license: files.license, agreeTerms: S.agree,
      payment: { method: S.payMethod, gcashRef: S.gcashRef, proof: S.payMethod === 'gcash' ? files.proof : null }
    }).then(function (r) {
      try { localStorage.setItem('bay_last', JSON.stringify(r.booking)); } catch (e) {}
      var keep = S.customer;
      S = blankState(); S.customer = keep; files = { license: null, proof: null }; models = null; saveState();
      location.hash = '#/done';
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = t('Confirm booking');
      msgBox.innerHTML = errBox(e.message);
      if (e.status === 409) { models = null; setTimeout(function () { go(1); }, 1800); }
    });
  }

  function wireBar(next) {
    var n = $('[data-next]'), b = $('[data-back]');
    if (n) n.onclick = next;
    if (b) b.onclick = function () { go(Math.max(0, S.step - 1)); };
  }

  // ---------- confirmation ----------
  function bookingSummary(b) {
    var q = b.quote;
    return '<div class="card sand" style="text-align:left"><p><b>' + esc(b.model) + '</b></p>' +
      '<p>🛵 ' + BAY.fmtLocal(b.pickup) + '<br>🏁 ' + BAY.fmtLocal(b.return) + '</p>' +
      '<table class="breakdown"><tr><td>' + esc(tx(q.rentalLabel)) + '</td><td>' + peso(q.rental) + '</td></tr>' +
      q.addons.map(function (a) { return '<tr><td>' + te(a.name) + (a.qty > 1 ? ' × ' + a.qty : '') + '</td><td>' + peso(a.amount) + '</td></tr>'; }).join('') +
      '<tr class="total"><td>' + te('Rental total') + '</td><td>' + peso(q.total) + '</td></tr>' +
      '<tr class="dep"><td>' + te('Refundable deposit (at pickup)') + '</td><td>' + peso(q.deposit) + '</td></tr></table>' +
      '<p class="small muted" style="margin-top:8px">' + te('Payment:') + ' ' + (b.payment.method === 'gcash' ? te('GCash (we\'ll verify your reference)') : te('Cash at pickup')) +
      ' · ' + te('Status:') + ' <b>' + te(BAY.STATUS_LABELS[b.status]) + '</b></p></div>';
  }
  function messengerLink(b) {
    var url = CFG.settings.messengerUrl || '';
    var text = t('Hi! I just booked {ref} ({model}, {when}).', { ref: b.ref, model: b.model, when: BAY.fmtLocal(b.pickup) });
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'text=' + encodeURIComponent(text);
  }
  function renderDone() {
    var b; try { b = JSON.parse(localStorage.getItem('bay_last')); } catch (e) {}
    if (!b) { location.hash = '#/'; return; }
    var s = CFG.settings;
    app.innerHTML = '<div class="wrap center"><div class="done-ico">✓</div><h2>' + te('Salamat, {name}!', { name: (b.customer.name || '').split(' ')[0] }) + '</h2>' +
      '<p>' + te('Your booking request is in. Your reference code:') + '</p><div class="ref">' + esc(b.ref) + '</div>' +
      '<p class="small muted">' + te('We\'ll confirm on Messenger or SMS shortly. Screenshot this page for easy reference.') + '</p>' +
      bookingSummary(b) +
      '<a class="btn messenger big" target="_blank" rel="noopener" href="' + esc(messengerLink(b)) + '">💬 ' + te('Message us on Messenger') + '</a>' +
      '<div class="spacer"></div><div class="card" style="text-align:left"><b>📍 ' + te('Pickup point') + '</b><p class="small">' + esc(s.address) + '<br>' + esc(s.landmark) + '</p>' +
      '<a class="btn alt" target="_blank" rel="noopener" href="' + esc(s.mapsUrl) + '">🗺️ ' + te('Get directions') + '</a></div>' +
      '<p class="small">' + te('Don\'t forget your original driver\'s license and {deposit} cash deposit. Ingat sa biyahe!', { deposit: peso(b.quote.deposit) }) + ' 🌴</p>' +
      '<a class="btn ghost" href="#/">' + te('Back to home') + '</a></div>' + footer();
  }

  // ---------- lookup ----------
  function renderLookup() {
    app.innerHTML = '<div class="wrap"><section><h2>' + te('Find my booking') + '</h2>' +
      '<label class="f" for="lref">' + te('Booking reference') + '</label><input id="lref" placeholder="BAY-0001" autocapitalize="characters">' +
      '<label class="f" for="lmob">' + te('Mobile number used') + '</label><input id="lmob" type="tel" inputmode="tel" value="' + esc(S.customer.mobile) + '">' +
      '<div class="spacer"></div><button class="btn" id="lgo">' + te('Find booking') + '</button><div id="lres" style="margin-top:14px"></div></section></div>' + footer();
    $('#lgo').onclick = function () {
      UI.api('GET', '/api/bookings/lookup?ref=' + encodeURIComponent($('#lref').value) + '&mobile=' + encodeURIComponent($('#lmob').value))
        .then(function (r) {
          $('#lres').innerHTML = '<div class="center"><div class="ref">' + esc(r.booking.ref) + '</div></div>' + bookingSummary(r.booking) +
            '<a class="btn messenger" target="_blank" rel="noopener" href="' + esc(messengerLink(r.booking)) + '">💬 ' + te('Message us') + '</a>';
        }, function (e) { $('#lres').innerHTML = errBox(e.message); });
    };
  }
})();
