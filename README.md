# Empty Wallet (raha)

A small, fast, single-user expense and income tracker. Next.js 16 + React 19 on the front, SQLite (`node:sqlite`) underneath, no ORM, no external services. Runs as one container with one volume.

## Features

- Monthly ledger grouped by your own category groups, with income shown separately and a Spent / Income / Net summary; entries can carry a day and tags
- Dashboard with budgets and pacing, forecasting, insights, a monthly and a daily spending heatmap, savings rate, and "looks recurring" suggestions
- Year overview and 12-month analytics with income, savings rate, budget-vs-actual history and tag totals; side-by-side month comparison; search with filters; a full audit-backed activity timeline with restore
- Savings goals with pace and projected finish; a monthly review page that narrates a finished month
- Recurring items with one-click "add recurring" and "copy last month"; a subscription tracker with charge day, price changes and yearly cost
- Bank CSV import (Swedbank Estonia auto-detected, generic `Date,Name,Amount` otherwise) with learnable patterns plus a classifier trained on your own history
- JSON backup/restore of everything (ledger, groups, budgets, import patterns) and CSV export
- 6-digit PIN login, light/dark theme, installable PWA

## Running locally

Requires Node 24+.

```bash
npm install
npm run dev        # http://localhost:3000 — the SQLite file is created on first request
```

On first boot the login page asks you to choose a PIN. Everything is stored in `./raha.sqlite` (override with `DB_PATH`).

## Checks

```bash
npm run check      # lint (zero warnings) + tsc + unit tests
npm test           # unit tests only (node:test via tsx)
npx next build     # production build
```

CI runs the same three gates before building the image, so a failing lint or test blocks a deploy.

## Configuration

| Variable        | Default          | Purpose |
|-----------------|------------------|---------|
| `DB_PATH`       | `./raha.sqlite`  | Path to the SQLite database. The session-signing secret is stored beside it as `.auth-secret`. |
| `AUTH_PIN_HASH` | unset            | Optional SHA-256 of a bootstrap PIN. Only consulted until a PIN exists in the database; the first successful login stores a salted scrypt hash instead. |

## How auth works

- The PIN hash lives in the `APP_SETTING` table as salted scrypt. Older unsalted SHA-256 hashes (and the `AUTH_PIN_HASH` bootstrap) still verify and are upgraded in place on the next successful login.
- Five wrong PINs from one client IP lock it out for a minute, doubling per further failure up to fifteen minutes (`lib/ratelimit.ts`, in-memory).
- Sessions slide: the proxy re-issues the cookie once it is past half its one-year life, so an active device is never logged out.
- A successful login sets an HMAC-signed, one-year session cookie. The signing key is 32 random bytes in `<DB dir>/.auth-secret`, generated on first use.
- `proxy.ts` verifies the signature on every request before any route runs; every Server Action and API route also calls `requireAuth()` itself.
- Changing the PIN rotates the secret, which logs out every other device while re-issuing a cookie to the one that made the change.

## Data

- One table, `LEDGER`, holds both expenses and income, distinguished by `KIND`. Spending views filter `KIND = 'expense'`.
- Deletes are soft (`DELETED_AT`), and the activity page shows them.
- Schema and idempotent migrations live in `lib/schema.ts` and run at startup.
- Multi-row writes use `db.transaction()` so a failed import or restore leaves nothing half-applied.

## Deploying

Push to `main`. GitHub Actions lints, type-checks, tests, builds the standalone bundle, packages it into `ghcr.io/waushop/raha`, and bumps the image tag in the `wauhost` repo for Flux to roll out. The Helm chart in `deploy/` mounts a PVC at `/data` and can run a Litestream sidecar for off-site SQLite replication.
