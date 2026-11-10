/* Small browser helpers shared by the customer app and the admin dashboard. */
(function () {
  'use strict';
  var UI = {};
  UI.$ = function (sel, el) { return (el || document).querySelector(sel); };
  UI.$$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };
  UI.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  UI.api = function (method, url, body) {
    var opts = { method: method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) { var e = new Error(data.error || 'Network error, please try again.'); e.status = r.status; throw e; }
        return data;
      });
    }, function () { throw new Error('No connection. Please check your signal and try again.'); });
  };

  var toastTimer;
  UI.toast = function (text) {
    var t = UI.$('.toast') || document.body.appendChild(Object.assign(document.createElement('div'), { className: 'toast' }));
    t.textContent = text; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 2600);
  };

  UI.modal = function (title, html, onOpen) {
    var m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" aria-label="' + UI.esc(title) + '"><header><h2>' + UI.esc(title) +
      '</h2><button class="iconbtn" data-close aria-label="Close">✕</button></header><div class="mbody">' + html + '</div></div>';
    function close() { m.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    m.addEventListener('click', function (e) { if (e.target === m || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(m);
    if (onOpen) onOpen(m.querySelector('.mbody'), close);
    return close;
  };

  UI.copy = function (text) {
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); UI.toast('Copied!'); } catch (e) { UI.toast('Could not copy — please select and copy.'); }
      ta.remove();
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { UI.toast('Copied!'); }, fallback);
    else fallback();
  };

  /** Resize + re-encode an image file in the browser so uploads stay small on slow data. Resolves to a JPEG data URL. */
  UI.compressImage = function (file, maxSide, quality) {
    maxSide = maxSide || 1280; quality = quality || 0.72;
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) return reject(new Error('Please choose a photo (JPG or PNG).'));
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
        var ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not read that photo. Try another one.')); };
      img.src = url;
    });
  };

  /** Lightweight inline scooter illustration used when no photo is uploaded (~1 KB). */
  UI.scooterArt = function (color) {
    color = color || '#0b6e99';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><rect width="160" height="120" fill="#e6f6fa"/>' +
      '<path d="M0 98 Q40 90 80 98 T160 98 V120 H0Z" fill="#f4e7cf"/>' +
      '<circle cx="40" cy="88" r="15" fill="#17323f"/><circle cx="40" cy="88" r="6" fill="#ccd"/>' +
      '<circle cx="122" cy="88" r="15" fill="#17323f"/><circle cx="122" cy="88" r="6" fill="#ccd"/>' +
      '<path d="M30 78 Q34 58 62 58 H92 L100 78 Z" fill="' + color + '"/>' +
      '<path d="M58 52 H90 Q96 52 94 58 H56 Q54 52 58 52Z" fill="#17323f"/>' +
      '<path d="M98 78 L110 34 H118 L106 80 Z" fill="' + color + '"/>' +
      '<path d="M104 30 H126" stroke="#17323f" stroke-width="5" stroke-linecap="round"/>' +
      '<path d="M100 78 Q118 70 134 82" stroke="' + color + '" stroke-width="8" fill="none" stroke-linecap="round"/>' +
      '<circle cx="124" cy="40" r="4" fill="#ffd36b"/></svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  };
  UI.unitPhoto = function (u) { return u && u.photo ? '/media/' + u.photo : UI.scooterArt(u && u.color); };

  window.UI = UI;
})();
