'use strict';
/* Optional outbound new-booking notifications (webhook / Telegram / Resend email).
   Message text comes from public/js/core.js. */
const https = require('https');
const CORE = require('../public/js/core');

function post(url, body, headers) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const data = typeof body === 'string' ? body : JSON.stringify(body);
      const req = https.request({
        method: 'POST', hostname: u.hostname, path: u.pathname + u.search, port: u.port || 443,
        headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, headers),
        timeout: 8000
      }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', (e) => { console.warn('[notify] failed:', e.message); resolve(0); });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.end(data);
    } catch (e) { console.warn('[notify] bad url', e.message); resolve(0); }
  });
}

/** Fire-and-forget admin notification. Configure via environment variables (see README). */
function notifyNewBooking(b, s) {
  const text = CORE.adminAlert(b);
  console.log('\n' + text + '\n');
  const jobs = [];
  if (process.env.NOTIFY_WEBHOOK_URL) {
    jobs.push(post(process.env.NOTIFY_WEBHOOK_URL, { event: 'booking.created', ref: b.ref, text, booking: CORE.publicView(b) }));
  }
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    jobs.push(post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      { chat_id: process.env.TELEGRAM_CHAT_ID, text }));
  }
  if (process.env.RESEND_API_KEY && (process.env.ADMIN_EMAIL || s.adminEmail)) {
    jobs.push(post('https://api.resend.com/emails', {
      from: process.env.MAIL_FROM || 'Baybayin Bookings <onboarding@resend.dev>',
      to: [process.env.ADMIN_EMAIL || s.adminEmail],
      subject: `New booking ${b.ref} – ${b.model}`,
      text
    }, { Authorization: 'Bearer ' + process.env.RESEND_API_KEY }));
  }
  return Promise.all(jobs);
}

module.exports = { notifyNewBooking };
