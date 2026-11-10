'use strict';
/* Outbound SMS to customers via Semaphore (semaphore.co, a Philippine SMS gateway).
   Env: SEMAPHORE_API_KEY (required to enable), SEMAPHORE_SENDER_NAME (approved sender name;
   if unset Semaphore uses its default "SEMAPHORE"), SEMAPHORE_API_URL (override, for tests).
   Alternative: SMS_WEBHOOK_URL receives {to, message} as JSON for any other gateway. */

function enabled() { return !!(process.env.SEMAPHORE_API_KEY || process.env.SMS_WEBHOOK_URL); }

/** Normalise to 09XXXXXXXXX. Returns null for non-Philippine numbers (Semaphore is PH-only). */
function phMobile(n) {
  const d = String(n || '').replace(/\D/g, '');
  if (/^09\d{9}$/.test(d)) return d;
  if (/^639\d{9}$/.test(d)) return '0' + d.slice(2);
  return null;
}

async function send(number, message) {
  const to = phMobile(number);
  if (!to) return { ok: false, error: 'Not a Philippine mobile number; send it on Messenger instead.' };
  if (!enabled()) return { ok: false, error: 'SMS is not set up.' };
  try {
    if (process.env.SEMAPHORE_API_KEY) {
      const form = new URLSearchParams({ apikey: process.env.SEMAPHORE_API_KEY, number: to, message });
      if (process.env.SEMAPHORE_SENDER_NAME) form.set('sendername', process.env.SEMAPHORE_SENDER_NAME);
      const r = await fetch(process.env.SEMAPHORE_API_URL || 'https://api.semaphore.co/api/v4/messages', {
        method: 'POST', body: form, signal: AbortSignal.timeout(10000)
      });
      const j = await r.json().catch(() => null);
      const first = Array.isArray(j) ? j[0] : null;
      if (r.ok && first && first.message_id) return { ok: true, id: String(first.message_id), to };
      return { ok: false, error: 'SMS gateway: ' + (j && typeof j === 'object' ? JSON.stringify(j).slice(0, 200) : 'HTTP ' + r.status), to };
    }
    const r = await fetch(process.env.SMS_WEBHOOK_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, message }),
      signal: AbortSignal.timeout(10000)
    });
    return r.ok ? { ok: true, to } : { ok: false, error: 'SMS webhook: HTTP ' + r.status, to };
  } catch (e) {
    return { ok: false, error: 'SMS failed: ' + e.message, to };
  }
}

module.exports = { enabled, send, phMobile };
