/* Standalone demo backend: answers the app's API calls inside the browser using core.js,
   storing data and images in localStorage (falls back to memory when storage is blocked).
   Only used by the single-file demo build (npm run build:demo). Not for production:
   data lives on one device, and the admin password is checked in the browser. */
(function () {
  'use strict';
  var DEMO_PASSWORD = 'baybayin2026';
  var KEY = 'bay_demo_db_v1', IMG = 'bay_demo_img_', ADMIN = 'bay_demo_admin';
  var mem = {};
  var store = {
    get: function (k) { try { var v = localStorage.getItem(k); return v === null ? (k in mem ? mem[k] : null) : v; } catch (e) { return k in mem ? mem[k] : null; } },
    set: function (k, v) {
      try { localStorage.setItem(k, v); } catch (e) {
        if (e && /quota/i.test(e.name + e.message)) { var err = new Error('Demo storage is full. Tap "Reset demo" to clear it.'); err.status = 413; throw err; }
        mem[k] = v;
      }
    },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} delete mem[k]; }
  };
  var session = {
    get: function () { try { return sessionStorage.getItem(ADMIN) === '1'; } catch (e) { return !!mem[ADMIN]; } },
    set: function (on) { try { on ? sessionStorage.setItem(ADMIN, '1') : sessionStorage.removeItem(ADMIN); } catch (e) { mem[ADMIN] = on; } }
  };

  var data;
  try { data = JSON.parse(store.get(KEY)); } catch (e) { data = null; }
  if (!data || !data.settings) { data = CORE.buildSeedData(); data.demoPassword = DEMO_PASSWORD; save(); }
  CORE.upgrade(data);
  function save() { store.set(KEY, JSON.stringify(data)); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function saveImage(dataUrl) {
    var m = /^data:image\/(jpeg|png|webp);base64,/.exec(dataUrl || '');
    if (!m) CORE.fail(400, 'Please upload a JPG or PNG image.');
    var name = CORE.randomId(12) + (m[1] === 'jpeg' ? '.jpg' : '.' + m[1]);
    store.set(IMG + name, dataUrl);
    return name;
  }

  function route(method, url, body) {
    var u = new URL(url, 'http://demo');
    var p = u.pathname, q = u.searchParams, mm;
    body = body || {};
    if (p === '/api/config') return { settings: CORE.publicSettings(data), units: data.units.map(CORE.publicUnit), now: BAY.nowLocal() };
    if (p === '/api/availability') return { models: CORE.availability(data, q.get('pickup') || '', q.get('return') || '') };
    if (p === '/api/bookings' && method === 'POST') {
      var draft = CORE.prepareBooking(data, body);
      if (!CORE.hasFreeUnit(data, draft)) CORE.fail(409, 'Sorry, that scooter was just booked for those dates. Please pick another one.');
      var files = { licensePhoto: saveImage(body.license), proof: draft.method === 'gcash' ? saveImage(body.payment.proof) : null };
      var b = CORE.commitBooking(data, draft, files);
      save();
      return { booking: CORE.publicView(b) };
    }
    if (p === '/api/bookings/lookup') return { booking: CORE.lookup(data, q.get('ref'), q.get('mobile')) };
    if (p === '/api/admin/login') {
      if (String(body.password || '') !== (data.demoPassword || DEMO_PASSWORD)) CORE.fail(401, 'Wrong password. (Demo password: ' + DEMO_PASSWORD + ')');
      session.set(true); return { ok: true };
    }
    if (p === '/api/admin/logout') { session.set(false); return { ok: true }; }
    if (p.indexOf('/api/admin/') === 0) {
      if (!session.get()) CORE.fail(401, 'Please log in.');
      var sub = p.slice(11), res;
      if (sub === 'me') return { ok: true };
      if (sub === 'data') {
        var d = clone(data); delete d.demoPassword;
        var extra = { defaultPassword: (data.demoPassword || DEMO_PASSWORD) === DEMO_PASSWORD, smsEnabled: false, storage: 'browser' };
        return Object.assign(d, extra, { summary: CORE.summary(data), now: BAY.nowLocal(), setup: CORE.setupChecklist(data, extra) });
      }
      if ((mm = /^bookings\/([a-f0-9]+)$/.exec(sub))) { res = CORE.updateBooking(data, mm[1], body); save(); return { booking: res }; }
      if ((mm = /^bookings\/([a-f0-9]+)\/messages$/.exec(sub))) return CORE.messages(data, mm[1]);
      if (/^bookings\/[a-f0-9]+\/sms$/.test(sub)) CORE.fail(400, 'SMS is not available in the demo.');
      if (sub === 'walkins') {
        var wd = CORE.prepareWalkIn(data, body);
        var wb = CORE.commitWalkIn(data, wd, { licensePhoto: body.license ? saveImage(body.license) : null });
        save(); return { booking: wb };
      }
      if (sub === 'sample-bookings') { var n = CORE.clearSamples(data).length; save(); return { removed: n }; }
      if (sub === 'units' && method === 'POST') { res = CORE.addUnit(data, body); save(); return { unit: res }; }
      if ((mm = /^units\/([a-z0-9]+)$/.exec(sub))) {
        if (method === 'PUT') { res = CORE.editUnit(data, mm[1], body); save(); return { unit: res }; }
        if (method === 'DELETE') { CORE.deleteUnit(data, mm[1]); save(); return { ok: true }; }
      }
      if (sub === 'settings') { res = CORE.updateSettings(data, body); save(); return { settings: res }; }
      if (sub === 'password') {
        if (String(body.password || '').length < 8) CORE.fail(400, 'Use at least 8 characters.');
        data.demoPassword = body.password; save(); return { ok: true };
      }
      if (sub === 'upload') return { file: saveImage(body.dataUrl) };
    }
    CORE.fail(404, 'Not found');
  }

  UI.api = function (method, url, body) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {   // async like a real request
        try { resolve(clone(route(method, url, body === undefined ? undefined : clone(body)) || {})); }
        catch (e) { if (!e.status) { console.error(e); e = new Error('Something went wrong. Please try again.'); } reject(e); }
      }, 60);
    });
  };
  UI.mediaUrl = UI.fileUrl = function (name) { return store.get(IMG + name) || ''; };
  UI.exportCsv = function () {
    var blob = new Blob([CORE.exportCsv(data)], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'baybayin-bookings-' + BAY.today() + '.csv';
    document.body.appendChild(a); a.click(); a.parentNode.removeChild(a);
  };
  window.BAY_DEMO = {
    reset: function () {
      try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('bay_') === 0) localStorage.removeItem(k); }); } catch (e) {}
      try { sessionStorage.clear(); } catch (e) {}
      mem = {};
      store.del(KEY);
    },
    password: DEMO_PASSWORD
  };
})();
