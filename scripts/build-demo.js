#!/usr/bin/env node
'use strict';
/* Builds dist/baybayin-demo.html: the whole app (customer + admin) in ONE self-contained file
   that runs with no server. Data is kept in the browser (see public/js/demo-api.js).
   Use it to preview on a phone or show the owner. For real bookings, run the server. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
const bodyOf = (html) => html.slice(html.indexOf('<body'), html.indexOf('<script')).replace(/^<body[^>]*>/, '').trim();

function safeScript(src, name) {
  if (/<\/script|<!--/i.test(src)) throw new Error(`${name} contains "</script" or "<!--"; cannot inline safely`);
  return src;
}

const css = read('css/app.css') + '\n' + read('css/admin.css') + `
.demo-ribbon { background: #17323f; color: #fff; font-size: .8rem; padding: 6px 0; }
.demo-ribbon .wrap { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; max-width: 1100px; }
.demo-ribbon b { color: #ffd36b; }
.demo-ribbon span { flex: 1; min-width: 160px; }
.demo-ribbon button { background: #fff; color: #17323f; border: 0; border-radius: 8px; padding: 6px 10px; font: inherit; font-weight: 700; min-height: 34px; cursor: pointer; }
.demo-ribbon button.ghost { background: transparent; color: #fff; border: 1px solid rgba(255,255,255,.4); }`;

const templates = { customer: bodyOf(read('index.html')), admin: bodyOf(read('admin.html')) };
const lib = ['js/shared.js', 'js/ui.js', 'js/core.js', 'js/demo-api.js'].map((f) => safeScript(read(f), f)).join('\n;\n');
const appSrc = safeScript(read('js/app.js'), 'app.js');
const adminSrc = safeScript(read('js/admin.js'), 'admin.js');

const loader = `
(function () {
  var mode = 'customer';
  try { mode = sessionStorage.getItem('bay_demo_mode') || 'customer'; } catch (e) {}
  var T = ${JSON.stringify(templates)};
  var other = mode === 'admin' ? 'customer' : 'admin';
  var ribbon = '<div class="demo-ribbon"><div class="wrap"><span><b>DEMO</b> · bookings are saved in this browser only' +
    (mode === 'admin' ? ' · password <b>' + BAY_DEMO.password + '</b>' : '') + '</span>' +
    '<button id="demoSwitch">' + (mode === 'admin' ? '← Customer view' : 'Admin view →') + '</button>' +
    '<button class="ghost" id="demoReset">Reset demo</button></div></div>';
  document.body.innerHTML = ribbon + T[mode];
  if (mode === 'admin') document.body.classList.add('admin');
  document.getElementById('demoSwitch').onclick = function () {
    try { sessionStorage.setItem('bay_demo_mode', other); } catch (e) {}
    location.hash = ''; location.reload();
  };
  document.getElementById('demoReset').onclick = function () {
    if (!confirm('Reset all demo bookings and settings back to the sample data?')) return;
    BAY_DEMO.reset(); location.hash = ''; location.reload();
  };
  (mode === 'admin' ? RUN_ADMIN : RUN_CUSTOMER)();
})();`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>Baybayin Scooter Rental (demo)</title>
<meta name="theme-color" content="#0b6e99">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='16' fill='%230b6e99'/%3E%3Cpath d='M4 20q6-4 12 0t12 0v8H4z' fill='%23f4e7cf'/%3E%3Ccircle cx='22' cy='10' r='4' fill='%23ffd36b'/%3E%3C/svg%3E">
<style>
${css}
</style>
</head>
<body>
<div class="spinner"></div>
<script>
${lib}
;
function RUN_CUSTOMER() {
${appSrc}
}
function RUN_ADMIN() {
${adminSrc}
}
${loader}
</script>
</body>
</html>
`;

const out = path.join(ROOT, 'dist', 'baybayin-demo.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`Built ${path.relative(ROOT, out)} (${(html.length / 1024).toFixed(1)} KB)`);
