# Vortex SMM — Reseller Panel

A self-hosted reseller panel: plug in one or more upstream SMM providers' API
keys, mark up their rates, and sell to your own customers who sign up, add
funds, place orders, and track status.

## What's included

- **Accounts** — register/login with username + email + password, JWT sessions
- **Password reset by email** — "forgot password" flow with an emailed reset link
- **Multiple providers** — add as many SMM providers as you resell from.
  When two providers offer the same service, customers automatically see
  whichever one is cheapest — no manual comparison needed
- **Services** — pulled live from your providers' APIs, with a markup % you
  control per service
- **Orders** — customers place orders against your service catalog; the panel
  calls the right provider's API for that specific service, deducts their
  balance, and refunds automatically if the provider rejects the order
- **Add funds** — JazzCash/Easypaisa/other manual top-ups an admin approves,
  plus optional Stripe card checkout
- **Branding & footer** — site name, tagline, and WhatsApp/Instagram/TikTok/
  Facebook/Telegram links, all editable from Admin, shown in the footer on
  every page
- **Admin panel** — manage users and roles, adjust balances, approve top-ups,
  manage providers, sync/edit services and markups, view all orders, check
  every provider's balance

## How it's built

- **Backend**: Node.js + Express + SQLite (`server/`)
- **Frontend**: a small vanilla-JS single-page app (`public/`), served by the
  same backend — no separate build step
- No framework lock-in, no external services required to run it locally
  (email and card payments are optional and degrade gracefully if unconfigured)

## 1. Get provider account(s)

You need an account with each SMM provider you resell from (this is what
"the provider API key" refers to). Almost all of them speak the same
"standard SMM API" — `action=services / add / status / balance` — which is
what `server/providerClient.js` implements. Get your API key from each
provider's dashboard. You can add multiple providers - if you have, say, a
cheap one for Instagram services and a different cheap one for YouTube
services, add both, and the panel automatically shows customers whichever is
cheapest for each individual service.

## 2. Configure

```bash
cd server
cp .env.example .env
```

Edit `.env`:

| Variable | What it's for |
|---|---|
| `JWT_SECRET` | any long random string — used to sign login sessions |
| `PROVIDER_API_URL` / `PROVIDER_API_KEY` | your **first** provider — auto-imported into Admin → Providers on first boot, for convenience. Add any additional providers from Admin → Providers once running, not here |
| `DEFAULT_MARKUP_PERCENT` | starting markup applied to newly synced services (edit per-service later in Admin) |
| `SMTP_*` | your email provider's SMTP credentials, for password-reset emails. If left blank, reset links are printed to the server console instead — fine for local testing, not for production |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | optional — enables card top-ups. Leave blank to only offer manual top-up requests |
| `ADMIN_EMAIL` / `ADMIN_USERNAME` / `ADMIN_PASSWORD` | your first admin login, created automatically the first time the server starts |

## Upgrading an existing deployment

If you're updating from an older version of this panel that only supported
one provider, this update migrates your database automatically the first
time it starts — your existing provider becomes "Provider 1 (migrated)" in
Admin → Providers (rename it there if you want), and all your existing
services and orders are carried over pointing at it. Nothing is lost, but as
always with a schema change: **back up `panel.db` before deploying this
update**, the same way described further down for any other backup.

## 3. Run it

```bash
cd server
npm install
npm start
```

Visit `http://localhost:4000`. Log in with the admin credentials from your
`.env`, then:

1. Go to **Admin → Providers** to confirm your first provider imported
   correctly, and add any additional providers
2. Go to **Admin → Services → Sync from providers now** to pull in your catalog
3. Adjust markup % per service if you want different margins per category
4. Go to **Admin → Branding** to set your site name, tagline, and social/
   WhatsApp links for the footer
5. Go to **Admin → Payment Settings** to add your JazzCash/Easypaisa details
6. Change your admin password from **My Account**

Customers register their own accounts, add funds, and place orders from the
same site.

## Multi-provider "cheapest wins" pricing

When you sync, every provider's version of every service is stored
separately (visible in **Admin → Services**, with a ⭐ marking whichever one
is currently cheapest). Customers only ever see one option per service — the
cheapest one, automatically, based on matching by service name + category.
This means:

- If Provider A is cheaper for Instagram services and Provider B is cheaper
  for YouTube services, customers automatically get the best price on both,
  from whichever provider actually delivers each one
- The matching is by **exact name + category**, so if two providers name the
  same thing slightly differently (e.g. "Instagram Followers" vs "IG
  Followers [HQ]"), they won't be recognized as the same service and will
  both show up as separate options. There's no fuzzy matching — this is
  intentional, so the panel never silently substitutes a lower-quality
  service just because its name resembles a cheaper one
- If you know two differently-named services really are equivalent and want
  only the cheaper one shown, deactivate the pricier one manually in Admin →
  Services

## Deploying for real customers

This is a working app, but a few things to handle before taking real money
from real customers:

- **Host it** somewhere persistent (a VPS, Render, Railway, Fly.io, etc.) —
  right now it's built to run as one Node process
- **Put it behind HTTPS** — a reverse proxy like Caddy or nginx in front of
  it is the easiest way
- **Use a real SMTP provider** (Postmark, SES, Resend, etc.) so password
  resets actually deliver
- **Set up Stripe for real** if you want card payments — create a webhook
  pointing at `https://yourdomain.com/api/wallet/webhook` for the
  `checkout.session.completed` event, and use the signing secret it gives you
- **Back up `server/panel.db`** regularly — it's a single SQLite file holding
  every user, order, and transaction
- **Watch your provider balance** (Admin → Provider tab) — if it runs out,
  customer orders will fail (they get auto-refunded, but it's a bad look)

## Order status auto-refresh & service auto-sync

The server checks your provider for status updates on every unfinished order,
and separately re-syncs your service catalog (names, rates, min/max limits),
both automatically and on their own schedules - `STATUS_REFRESH_MINUTES` and
`SERVICE_SYNC_MINUTES` in `.env` (10 minutes each by default). Both run
inside the same Node process, so **you don't need a cron job for either of
these**; they start automatically when the server starts. Your per-service
markup % and active/inactive flags always survive a sync - only name, rate,
and min/max get refreshed. Admins can still force an instant sync from
Admin → Services → "Sync from provider now."

## Backing up panel.db (this one *is* a cron job)

This is a separate, unrelated thing — your database is a single file, and
nothing backs it up automatically. Set up an OS-level cron job on your Oracle
box for this. Because the app uses SQLite's WAL mode, a plain `cp` while the
server is running can miss data still sitting in the `-wal` file, so use
SQLite's own online-safe backup command instead:

```bash
# make sure the sqlite3 CLI is installed: sudo apt install sqlite3

crontab -e
```

Add a line like this (backs up daily at 3am, keeps 14 days):

```
0 3 * * * cd /path/to/smm-panel/server && sqlite3 panel.db ".backup '/path/to/backups/panel-$(date +\%F).db'" && find /path/to/backups -mtime +14 -delete
```

Even better: also copy those backup files off the box entirely (e.g. to
another server, or cloud storage) so a disk failure can't take out both the
live database and its backups at once.

## Security notes

- Admin pages/actions are enforced **server-side** by role check — hiding the
  Admin tab in the UI is just convenience, not the actual protection
- `helmet` sets standard security headers; `express-rate-limit` throttles
  register (8/hour/IP), login (12/15min/IP), forgot-password (5/hour/IP), and
  reset-password (15/hour/IP) to slow down brute-forcing and spam
- If you put this behind nginx (recommended), `trust proxy` is already
  enabled so rate limiting sees each visitor's real IP instead of nginx's
- Admin can delete a user from **Admin → Users → Delete** — this permanently
  removes the user and all their orders/transactions and can't be undone.
  You can't delete your own logged-in account or the last remaining admin

## Notes on how money moves

- A customer's balance is only ever changed in the same database transaction
  as the thing that justifies it (an order, a refund, an approved top-up, an
  admin adjustment) — see `orders.js` and `wallet.js`
- If placing an order with the provider fails after the customer's balance
  was already deducted, the panel automatically refunds them and marks the
  order `failed`
- Manual top-up requests sit as `pending` transactions until an admin
  approves or rejects them — the balance isn't touched either way until then
