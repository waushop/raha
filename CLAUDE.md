@AGENTS.md

# Empty Wallet — Personal Expense Management Platform

## Quick Reference
- **Stack**: Next.js 16, React 19, Tailwind CSS v4, SQLite (`node:sqlite`), TypeScript, Node 24+
- **DB**: SQLite file at `$DB_PATH` (default `./raha.sqlite`); schema applied at startup by `lib/schema.ts`. The `db` shim in `lib/db.ts` exposes `db.execute(sql, [...])` returning `[rows, _]` so callsites read like the old `mysql2` API, plus `db.transaction((tx) => …)` with synchronous `tx.run` / `tx.all` for atomic multi-row writes (never `await` inside the callback).
- **Tests**: `npm test` runs `node:test` suites in `tests/` through `tsx` (path alias `@/` works). `npm run check` = lint (zero warnings) + `tsc --noEmit` + tests; CI runs the same before building.
- **Auth**: PIN-based (6-digit, hash stored in `APP_SETTING.pin_hash`). Sessions are HMAC-signed cookies (`lib/session.ts`); the signing secret is 32 random bytes at `<dirname DB_PATH>/.auth-secret`, created on first use and rotated on PIN change. `proxy.ts` (Node runtime) verifies the signature on every request; every Server Action and API route also calls `requireAuth()` / `isAuthenticated()` from `lib/auth.ts`. First boot with an empty DB shows the `/login` setup flow; alternatively an `AUTH_PIN_HASH` env var bootstraps the first PIN and auto-migrates to the DB on first successful login.
- **Deploy**: Docker + Helm + GitHub Actions → K8s (raha.waushop.ee). Wauhost chart provisions a PVC at `/data` and (optionally) a Litestream sidecar replicating the SQLite file to S3-compatible object storage.

## Architecture

### Database
- **LEDGER** table: `ID` (UUID), `KIND` (`expense` | `income`), `CATEGORY`, `GROUP_ID`, `NAME`, `AMOUNT`, `MONTH` (YYYY-MM), `NOTES`, `IS_RECURRING`, `TAGS`. Spending aggregates must filter `KIND = 'expense'`.
- **CATEGORY_GROUP** table: `ID`, `NAME`, `EMOJI`, `COLOR`, `SORT_ORDER`
- **BUDGET**, **IMPORT_PATTERN**, **APP_SETTING** (PIN hash)
- Soft deletes via `DELETED_AT`
- Schema + idempotent migrations (EXPENSE→LEDGER rename, KIND column): `lib/schema.ts`

### Categories
25 predefined categories with icons in `types/expense.ts` (housing, fuel, groceries, etc.)
Users create custom **groups** to organize categories (Home, Car, Kids, etc.)

### Pages (11)
| Route | Purpose |
|-------|---------|
| `/dashboard` | Home — metrics, forecasting, insights, heatmap |
| `/` | Monthly view — expenses grouped by custom groups |
| `/search` | Global search across all months |
| `/groups` | Group management (CRUD) |
| `/recurring` | Recurring expense overview |
| `/activity` | Timeline of all changes |
| `/compare` | Side-by-side month comparison |
| `/analytics` | 12-month deep analytics |
| `/year` | Yearly overview |
| `/settings` | DB stats, budgets, backup/restore |
| `/login` | PIN authentication |

### APIs (3)
- `GET /api/export?month=` or `?year=` — CSV download
- `GET/POST /api/backup` — JSON backup/restore (v4: ledger + groups + budgets + import patterns; rows keep their IDs so restore is idempotent and overwrites to backup values)
- `POST /api/import` — CSV import

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
AUTH_PIN_HASH   # OPTIONAL: SHA-256 of a bootstrap PIN. Used only until the
                # first successful login persists it to APP_SETTING; after
                # that the env var can be removed and the DB is authoritative.
```

## Running Locally
```bash
npm run dev     # App on :3000; SQLite file is created on first query
npm run check   # lint + typecheck + tests (what CI runs)
```
