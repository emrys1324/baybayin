'use strict';
/* Message templates (plain text, SMS/Messenger friendly) + optional outbound notifications. */
const https = require('https');
const BAY = require('../public/js/shared');

function addonText(b) {
  return b.quote.addons.length ? b.quote.addons.map((a) => a.name + (a.qty > 1 ? ' ×' + a.qty : '')).join(', ') : 'none';
}

function adminAlert(b, s) {
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
  const text = adminAlert(b, s);
  console.log('\n' + text + '\n');
  const jobs = [];
  if (process.env.NOTIFY_WEBHOOK_URL) {
    jobs.push(post(process.env.NOTIFY_WEBHOOK_URL, { event: 'booking.created', ref: b.ref, text, booking: publicView(b) }));
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

/** What the customer may see about their own booking (no plate, no files). */
function publicView(b) {
  return {
    ref: b.ref, status: b.status, model: b.model, pickup: b.pickup, return: b.return,
    quote: b.quote, payment: { method: b.payment.method, status: b.payment.status },
    customer: { name: b.customer.name }, createdAt: b.createdAt
  };
}

module.exports = { adminAlert, customerConfirmation, notifyNewBooking, publicView };
