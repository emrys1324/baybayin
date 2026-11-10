# Baybayin Scooter Rental: booking app

A mobile-first booking web app for **Baybayin Scooter Rental**, Sitio Sawang, Brgy. Dubduban, San Agustin, Romblon (beside the FilOil gas station and Mon's Pahuway Café).

- **Customers** check availability, pick a scooter and add-ons, see the price update as they choose, upload their license, pay cash or GCash, and get a `BAY-0001`-style reference.
- **Admin** (`/admin`) can manage bookings, see a fleet timeline, track deposits and payments, edit the fleet, prices, add-ons and terms, see weekly and monthly figures, and export CSV.

It's built for slow island data. There are **no dependencies** (only Node's standard library) and no frameworks, web fonts or tracking. The whole customer app downloads in about **17 KB gzipped**. Photos are resized in the phone's browser before upload, so a 4 MB camera photo becomes roughly 100–200 KB.

## Quick start

Requires Node.js 18 or newer.

```bash
npm start
```

- Customer site: http://localhost:3000
- Admin: http://localhost:3000/admin (default password **`baybayin2026`**; change it in Admin → Settings)

### Try it without a server: the one-file demo

`dist/baybayin-demo.html` is the whole app (customer site **and** admin) in a single file. It needs no server or internet: open it in any phone or computer browser, or send it to someone. Use the **Admin view →** button at the top to switch views (demo password `baybayin2026`).

In the demo, bookings are saved **only in that browser**, so it's for previewing and showing the owner, not for taking real bookings. After changing the code, rebuild it with:

```bash
npm run build:demo
```

### Sample data

The first server run creates `data/db.json` with **sample data**: 5 scooters (one is under maintenance) and 6 bookings in different statuses, dated around today.

```bash
npm test             # API, pricing and demo-build tests (9 tests)
npm run seed         # reset data/db.json to sample data (overwrites!)
```

## Configuration (environment variables)

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default 3000) |
| `DATA_DIR` | Where `db.json` and uploads live (default `./data`) |
| `ADMIN_PASSWORD` | Initial admin password, used only when the database is first created |
| `NOTIFY_WEBHOOK_URL` | Receives a JSON POST on every new booking (works with Make, Zapier, n8n, Google Apps Script, etc.) |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | Free, instant new-booking alerts to the owner's phone through Telegram |
| `RESEND_API_KEY` + `ADMIN_EMAIL` (+ `MAIL_FROM`) | New-booking email through [Resend](https://resend.com) (free tier available) |

Each new booking also prints an **SMS-ready alert** to the server log. The admin dashboard checks for new bookings every minute and shows a badge.

## How it works

| Area | Details |
|---|---|
| **Time zone** | Everything is Asia/Manila (UTC+8), whatever the phone's or server's time zone is. |
| **Hours** | Pickup and return times are offered only within shop hours (default **9:00 AM – 6:00 PM**, editable). |
| **No double-bookings** | The server checks availability again at the moment of booking. A unit counts as busy if it has an overlapping *pending*, *confirmed* or *picked-up* booking, plus a turnaround buffer (default 60 min). Units *under maintenance* are never offered. |
| **Fleet** | Customers pick a **model** (e.g. "Honda Click 125 – 2 available"). The server assigns a free unit, and admin can reassign the unit (plate) in the booking details. |
| **Pricing** | Up to 6 hrs = half-day rate (if set). Longer rentals are charged per started day, with a 60-min grace period. From 3 days on, the multi-day rate applies. Add-ons are a flat price or per day. The deposit is shown separately. All of these are editable. |
| **Uploads** | Licenses and GCash screenshots are stored privately and only logged-in admins can view them. Scooter photos, the GCash QR and shop photos are public. |
| **Messages** | Each booking has a **Copy message** button with a ready-made Messenger/SMS confirmation for the customer, plus an **Open SMS** shortcut. |
| **Terms** | Edited in Settings, one rule per line. `{deposit}`, `{lateFee}` and `{cancelHours}` fill in the current values automatically. |

### Sample prices (replace in Admin)

| Model | Units | Half-day (6 h) | Daily | 3+ days |
|---|---|---|---|---|
| Honda Click 125 | 2 | ₱350 | ₱500 | ₱450/day |
| Yamaha NMAX V3 | 1 | ₱550 | ₱800 | ₱700/day |
| Honda PCX 160 | 1 | ₱550 | ₱800 | ₱700/day |
| Honda BeAT | 1 (maintenance) | ₱300 | ₱400 | ₱350/day |

Deposit ₱1,000 · Extra helmet ₱50 · Phone holder ₱30 · Port/resort delivery ₱150 · Late fee ₱100/hr · Free cancellation up to 24 hrs before pickup.

**Placeholders to replace in Admin → Settings:** GCash number and name, GCash QR image, Messenger link (`https://m.me/yourpage`), phone number, Google Maps link (currently a search for the FilOil station), and shop photos.

## Project layout

```
server.js            HTTP server, API routes, static files, auth
lib/db.js            JSON-file storage (atomic writes)
lib/seed.js          Seeds the database (sample data from core.js + admin password)
lib/messages.js      Webhook / Telegram / email new-booking alerts
public/js/core.js    Booking rules (availability, validation, reports, messages), shared by server + demo
public/js/demo-api.js  In-browser backend for the one-file demo
scripts/build-demo.js  Builds dist/baybayin-demo.html
public/index.html    Customer app shell
public/js/app.js     Customer booking flow
public/js/admin.js   Admin dashboard
public/js/shared.js  Time + pricing logic, shared by browser and server
public/js/ui.js      Small UI helpers (modal, toast, image compression)
test/api.test.js     Tests
```

## Deploying

Any host that runs Node and keeps a **persistent disk** for `DATA_DIR` will work: a small VPS, Railway or Render with a volume, or Fly.io with a volume. Put it behind HTTPS (most hosts do this for you). The app sets `Secure` on the admin cookie when `X-Forwarded-Proto: https` is present. **Back up `DATA_DIR`** (db.json plus uploads) regularly.

> Serverless hosts with no persistent disk (e.g. Vercel or Netlify functions) are **not** suitable as-is, because bookings would be lost. See "Database upgrade" below.

---

## Scope: what's in v1 and what's next

### Delivered in v1

| # | Area | Status |
|---|---|---|
| 1 | Landing page: intro, fleet, hours, address/landmark, directions, Messenger, optional shop photos | ✅ |
| 2 | Date/time picker within shop hours, quick-duration chips (half day / 1 / 2 / 3 days / 1 week) | ✅ |
| 3 | Availability by model, double-booking prevention, maintenance units excluded | ✅ |
| 4 | Add-ons + live price breakdown incl. deposit (sticky total bar) | ✅ |
| 5 | Customer details, riders, license photo upload (compressed), terms modal + checkbox | ✅ |
| 6 | Cash or GCash (number, copy button, QR, reference no., screenshot) | ✅ |
| 7 | Confirmation with `BAY-0001` reference, summary, Messenger button (pre-filled), "Find my booking" lookup | ✅ |
| 8 | Admin: login, booking list with filters and search, one-tap status, license/GCash proof viewer | ✅ |
| 9 | Admin: deposit pending / collected / refunded, paid / unpaid, unit reassignment, notes | ✅ |
| 10 | Admin: 14-day fleet timeline, summary (week/month bookings and revenue, most-rented, deposits held, today's pickups/returns, overdue) | ✅ |
| 11 | Admin: fleet CRUD with photos, rates, status; settings for prices, add-ons, hours, terms, GCash, shop info; password change | ✅ |
| 12 | CSV export, copy-ready customer confirmation, SMS-ready admin alert, webhook/Telegram/email hooks | ✅ |

### Suggested next phases (estimates for one developer)

| Phase | Item | Estimate | Notes |
|---|---|---|---|
| **2: Go-live** | Deploy to a host with a persistent volume + domain + HTTPS | 0.5 day | Needs owner's domain/hosting choice |
| | Replace placeholders, real photos, real prices, test on staff phones | 0.5 day | Owner provides content |
| | Daily automatic backup of `data/` (e.g. to Google Drive or S3) | 0.5 day | |
| **3: Ops** | Automatic SMS to customer on confirmation (Semaphore / Movider PH SMS gateways) | 1–1.5 days | ~₱0.50/SMS, needs sender-name approval |
| | Admin creates walk-in bookings from the dashboard | 1 day | |
| | Late-return fee calculator on return + damage/fuel checklist with photos | 1–1.5 days | |
| | Customer self-cancellation within the free-cancel window | 0.5 day | |
| | Multiple admin/staff accounts with roles | 1 day | |
| **4: Growth** | Tagalog language toggle | 1 day | Copy is already centralised |
| | Offline-capable PWA (installable, caches the shell for patchy signal) | 1 day | |
| | Seasonal pricing (peak/holiday rates), promo codes | 1–2 days | |
| | Database upgrade to SQLite/Postgres (needed for serverless hosting or >1 server) | 1–2 days | JSON storage is fine for a single small shop |
| | Online payments (PayMongo: GCash/Maya/cards with automatic confirmation) | 2–3 days | Needs a PayMongo business account |

### Assumptions and open questions

1. **Pickup hours:** pickups and returns are limited to **9 AM–6 PM** (confirmed by the owner). Change it in one place: Admin → Settings → Pickup & return hours.
2. **Day counting:** a "day" is 24 hours from pickup, with a 60-min grace period. Rentals of 6 hours or less use the half-day rate when one is set.
3. **GCash pays the rental only.** The deposit is always collected in cash at pickup.
4. **New bookings start as Pending.** Admin confirms them (after checking GCash) and sends the copy-ready message.
5. Revenue counts confirmed, picked-up and returned bookings by pickup date, and excludes deposits.
