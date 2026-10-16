@AGENTS.md

# Empty Wallet — Personal Expense Management Platform

## Quick Reference
- **Stack**: Next.js 16, React 19, Tailwind CSS v4, SQLite (`node:sqlite`), TypeScript, Node 24+
- **DB**: SQLite file at `$DB_PATH` (default `./raha.sqlite`); schema applied at startup by `lib/schema.ts`. The `db` shim in `lib/db.ts` exposes `db.execute(sql, [...])` returning `[rows, _]` so callsites read like the old `mysql2` API, plus `db.transaction((tx) => …)` with synchronous `tx.run` / `tx.all` for atomic multi-row writes (never `await` inside the callback).
- **Tests**: `npm test` runs `node:test` suites in `tests/` through `tsx` (path alias `@/` works). `npm run check` = lint (zero warnings) + `tsc --noEmit` + tests; CI runs the same before building.
- **Auth / users**: multi-user. `USER` rows (name, salted scrypt PIN hash, `IS_ADMIN`, `SESSION_VERSION`), each owning a personal `WORKSPACE` via `WORKSPACE_MEMBER`. Every data table carries `WORKSPACE_ID`; pages call `currentContext()` and actions call `requireAuth()` (both from `lib/auth.ts`) to get `{ userId, workspaceId, isAdmin }` and scope every query with `WORKSPACE_ID = ?`. Login is the 6-digit PIN alone: `findUserByPin` (`lib/users.ts`) checks every live user's hash, so PINs are kept unique across users on every write (`pinTaken`); lockout is per IP (`lib/ratelimit.ts`: 5 failures → 1 min, second time → 24 h hard lock, 1 h quiet resets; admins unlock from Settings). Sessions are HMAC-signed cookies `v2.<exp>.<userId>.<sessionVersion>.<nonce>.<sig>` (`lib/session.ts`), sliding one-year expiry refreshed by `proxy.ts`; a PIN change bumps that user's `SESSION_VERSION`, which `requireAuth` checks (the proxy only checks signature + expiry). Signing secret: 32 random bytes at `<dirname DB_PATH>/.auth-secret`. First boot shows the `/login` setup flow (name + PIN → admin user); the one-shot migration in `lib/schema.ts` turns a pre-multi-user DB (`APP_SETTING.pin_hash` or `AUTH_PIN_HASH`) into an "Owner" admin and assigns all rows to their workspace. Admins add/rename/remove users and reset PINs from Settings (`app/users/actions.ts`). A shared household workspace later = another WORKSPACE with two members plus a switcher.
- **Deploy**: Docker + Helm + GitHub Actions → K8s (raha.waushop.ee). Wauhost chart provisions a PVC at `/data` and (optionally) a Litestream sidecar replicating the SQLite file to S3-compatible object storage.

## Architecture

### Database
- **LEDGER** table: `ID` (UUID), `KIND` (`expense` | `income`), `CATEGORY`, `GROUP_ID`, `NAME`, `AMOUNT`, `MONTH` (YYYY-MM), `DAY` (1–31 or NULL), `NOTES`, `IS_RECURRING`, `TAGS` (normalised "#a, #b" text). Spending aggregates must filter `KIND = 'expense'`.
- **LEDGER_TAG**: one row per tag per ledger row, kept in sync with `TAGS` by `lib/ledger.ts` (`syncTags`); search/analytics filter on it.
- **LEDGER_AUDIT**: before/after JSON for every ledger write (`lib/ledger.ts` `audit` / `auditedUpdate`); `/activity` reads it, falling back to timestamps on pre-audit databases.
- **CATEGORY_GROUP** table: `ID`, `NAME`, `EMOJI`, `COLOR`, `SORT_ORDER` (reorderable from `/groups`)
- **SAVINGS_GOAL**: targets with optional deadline and starting balance; contributions are LEDGER rows with `GOAL_ID`.
- **USER**, **WORKSPACE**, **WORKSPACE_MEMBER**: see Auth above. `BUDGET` and `BUDGET_HISTORY` are keyed by `(WORKSPACE_ID, …)`.
- **BUDGET** (current targets, `_total` pseudo-key), **BUDGET_HISTORY** (snapshot per month, written on edit and when the dashboard first renders a month; analytics "Budget vs actual" uses `resolveBudgetsFor`), **IMPORT_PATTERN**, **APP_SETTING** (PIN hash)
- Soft deletes via `DELETED_AT` (config tables BUDGET / IMPORT_PATTERN hard-delete by design)
- Schema + idempotent migrations (EXPENSE→LEDGER rename, KIND and DAY columns, tag backfill): `lib/schema.ts`
- Import categorisation order: learned regex patterns → `lib/classifier.ts` (naive Bayes trained on the ledger at page load) → keyword guesses. Dashboard forecast is `lib/forecast.ts` (spent + recurring still due + variable daily rate × days left).
- Shared write logic in `lib/ledger.ts` (copy/backfill/import/dedup, audit, tags); shared read queries in `lib/queries.ts`; month helpers in `lib/months.ts`; input parsing in `lib/validate.ts`

### Categories
25 predefined categories with icons in `types/expense.ts` (housing, fuel, groceries, etc.)
Users create custom **groups** to organize categories (Home, Car, Kids, etc.)

### Pages (14)
| Route | Purpose |
|-------|---------|
| `/dashboard` | Home — metrics, forecasting, insights, heatmap |
| `/` | Monthly view — expenses grouped by custom groups |
| `/search` | Global search across all months with URL filters (kind, category, group, tag, amount, month range) |
| `/groups` | Group management (CRUD) |
| `/recurring` | Recurring expense overview |
| `/activity` | Timeline of all changes |
| `/compare` | Side-by-side month comparison |
| `/analytics` | 12-month deep analytics |
| `/year` | Yearly overview |
| `/goals` | Savings goals (SAVINGS_GOAL + LEDGER.GOAL_ID), progress/pace from `lib/goals.ts` |
| `/review` | Monthly review narrative for a finished month (defaults to last month) |
| `/settings` | DB stats, budgets, backup/restore |
| `/login` | PIN authentication |

### APIs (3)
- `GET /api/export?month=` or `?year=` — CSV download
- `GET/POST /api/backup` — JSON backup/restore (v6: ledger incl. DAY and GOAL_ID + goals + groups + budgets + budget history + import patterns; rows keep their IDs so restore is idempotent and overwrites to backup values; tags are rebuilt from TAGS)
- `POST /api/import` — CSV import matching the export's columns by header (Kind, Notes, Recurring, Day honoured; old Estonian headers accepted), deduplicated by name+amount+month

## Conventions
- All SQL uses UPPERCASE table/column names
- Server Actions in `app/actions.ts` for all mutations; each starts with `await requireAuth()`
- `revalidatePath("/")` after every mutation
- UUIDs generated with `crypto.randomUUID()`
- All dates stored as `TEXT` month strings (YYYY-MM)
- Number formatting: `en-US` locale with 2 decimal places
- Text colors: `#5a6380` (muted), `#9ca3c0` (secondary)
- Cards use `.card` CSS class, inner surfaces use `.surface`
- SQLite specifics: `CAST(... AS REAL)` (no `DOUBLE`), `ON CONFLICT(...) DO ...` (no `ON DUPLICATE KEY`), `UPDATED_AT` maintained by triggers in `lib/schema.ts`.
- Headline font (Caveat) is self-hosted via `next/font` and exposed as `var(--font-hand)`; don't add `<link>` tags to Google Fonts.

## Environment Variables
```
DB_PATH         # path to the SQLite file (default ./raha.sqlite). The session
                # signing secret is created beside it as .auth-secret.
AUTH_PIN_HASH   # OPTIONAL: SHA-256 of a bootstrap PIN (upgraded to scrypt in the DB on first login). Used only until the
                # first successful login persists it to APP_SETTING; after
                # that the env var can be removed and the DB is authoritative.
```

## Running Locally
```bash
npm run dev     # App on :3000; SQLite file is created on first query
npm run check   # lint + typecheck + tests (what CI runs)
```
