@AGENTS.md

# Empty Wallet — Personal Expense Management Platform

## Quick Reference
- **Stack**: Next.js 16, React 19, Tailwind CSS v4, SQLite (`node:sqlite`), TypeScript, Node 24+
- **DB**: SQLite file at `$DB_PATH` (default `./raha.sqlite`); schema applied at startup by `lib/schema.ts`. The `db` shim in `lib/db.ts` exposes `db.execute(sql, [...])` returning `[rows, _]` so callsites read like the old `mysql2` API, plus `db.transaction((tx) => …)` with synchronous `tx.run` / `tx.all` for atomic multi-row writes (never `await` inside the callback).
- **Tests**: `npm test` runs `node:test` suites in `tests/` through `tsx` (path alias `@/` works). `npm run check` = lint (zero warnings) + `tsc --noEmit` + tests; CI runs the same before building.
- **Auth / users**: multi-user. `USER` rows (name, salted scrypt PIN hash, `IS_ADMIN`, `SESSION_VERSION`), each owning a personal `WORKSPACE` via `WORKSPACE_MEMBER`. Every data table carries `WORKSPACE_ID`; pages call `currentContext()` and actions call `requireAuth()` (both from `lib/auth.ts`) to get `{ userId, workspaceId, isAdmin }` and scope every query with `WORKSPACE_ID = ?`. Login is the 6-digit PIN alone: `findUserByPin` (`lib/users.ts`) checks every live user's hash, so PINs are kept unique across users on every write (`pinTaken`); lockout is per IP (`lib/ratelimit.ts`: 5 failures → 1 min, second time → 24 h hard lock, 1 h quiet resets) plus a site-wide pause (20 failures in 15 min → 15 min for everyone); admins unlock from Settings. New PINs must pass `lib/pin-policy.ts` (no repeats, sequences, patterns, common PINs or date-like digits). Optional email second factor per user (`USER.EMAIL`, `EMAIL_VERIFIED_AT`, `REQUIRE_2FA`): after a correct PIN on a browser without a valid `device` cookie, `lib/twofa.ts` mints a hashed 6-digit code (10 min, 5 attempts, 3 per 10 min) in `LOGIN_CHALLENGE`, `lib/mailer.ts` sends it, a signed `pending` cookie (`createPendingToken`) carries user + challenge to the code step on `/login`; "remember this device" stores a hashed token in `TRUSTED_DEVICE` for 30 days. Admins can switch the check off for a user (recovery). Sessions are HMAC-signed cookies `v2.<exp>.<userId>.<sessionVersion>.<nonce>.<sig>` (`lib/session.ts`), sliding one-year expiry refreshed by `proxy.ts`; a PIN change bumps that user's `SESSION_VERSION`, which `requireAuth` checks (the proxy only checks signature + expiry). Signing secret: 32 random bytes at `<dirname DB_PATH>/.auth-secret`. First boot shows the `/login` setup flow (name + PIN → admin user); the one-shot migration in `lib/schema.ts` turns a pre-multi-user DB (`APP_SETTING.pin_hash` or `AUTH_PIN_HASH`) into an "Owner" admin and assigns all rows to their workspace. Admins add/rename/remove users and reset PINs from Settings (`app/users/actions.ts`). Households: a WORKSPACE with `KIND = 'shared'` and several members (`lib/household.ts`, actions in `app/household/actions.ts`). The `ws` cookie picks the active workspace (`getAuthContext` honours it only for members, else falls back to the personal one); the sidebar `WorkspaceSwitcher` sets it. In a shared workspace every expense carries `LEDGER.PAID_BY` (defaults to whoever adds it, must be a member) and the month view shows a settle-up card (`lib/settle.ts`: equal share, fewest transfers). `AuthContext` carries `workspaceName` and `workspaceKind`.
- **Deploy**: Docker + Helm + GitHub Actions → K8s (raha.waushop.ee). Wauhost chart provisions a PVC at `/data` and (optionally) a Litestream sidecar replicating the SQLite file to S3-compatible object storage.

## Architecture

### Database
- **LEDGER** table: `ID` (UUID), `KIND` (`expense` | `income`), `CATEGORY`, `GROUP_ID`, `NAME`, `AMOUNT`, `MONTH` (YYYY-MM), `DAY` (1–31 or NULL), `NOTES`, `IS_RECURRING`, `TAGS` (normalised "#a, #b" text). Spending aggregates must filter `KIND = 'expense'`.
- **Splits**: `LEDGER.SPLIT_GROUP` groups the parts of one bank line (`lib/ledger.ts` `splitRow`: first part keeps the id, parts must sum to the original). **Bulk edits**: `bulkUpdate` / `bulkDelete` (category, group, tags, recurring, month; scoped to owned live rows; one audit entry per row).
- **Rules** live in **IMPORT_PATTERN** (`PATTERN` regex-or-substring, `CATEGORY`, `GROUP_ID`, `PRIORITY`, `SET_NAME`, `SET_TAGS`, `SET_RECURRING` 1/0/NULL, `AMOUNT_MIN`/`AMOUNT_MAX`). `lib/rules.ts` `applyRules` picks the highest-priority match; rules run on CSV import, on "apply to existing rows" (`applyRulesToRows`) and, name + tags only, on manual entry. `lib/merchants.ts` `cleanMerchant` normalises bank descriptions; `lib/quickadd.ts` parses "coffee 3.5 #work" / "+2850 salary".
- **LEDGER_TAG**: one row per tag per ledger row, kept in sync with `TAGS` by `lib/ledger.ts` (`syncTags`); search/analytics filter on it.
- **LEDGER_AUDIT**: before/after JSON for every ledger write (`lib/ledger.ts` `audit` / `auditedUpdate`); `/activity` reads it, falling back to timestamps on pre-audit databases.
- **CATEGORY_GROUP** table: `ID`, `NAME`, `ICON` (a `lib/icon-names.ts` name or NULL; the old `EMOJI` column is renamed and mapped by `migrateIcons`), `COLOR`, `SORT_ORDER` (reorderable from `/groups`)
- **SAVINGS_GOAL**: targets with optional deadline and starting balance; contributions are LEDGER rows with `GOAL_ID`.
- **NOTIFICATION** (in-app inbox: `KIND`, `DEDUP_KEY` unique per workspace, `TITLE`, `BODY`, `URL`, `READ_AT`) and **PUSH_SUBSCRIPTION** (web-push endpoints per user/device). `lib/nudges.ts` `evaluateNudges` (pure, tested) decides what deserves a nudge today: bill due tomorrow, trial ending, stable price increase, unused subscription, plan line at 80 %/100 %, safe-to-spend below zero, Sunday digest, monthly review on the 1st. `lib/nudges-db.ts` `runNudges` stores new rows (dedup), pushes via `web-push` (VAPID) and emails digest-type nudges to verified addresses. Runs hourly in-process from `instrumentation.ts` (`NUDGES=off` disables, `NUDGE_INTERVAL_MIN`) and on demand via `GET/POST /api/cron` with `CRON_SECRET`.
- **ACCOUNT** (`NAME`, `TYPE` cash|savings|investment|property|debt) and **ACCOUNT_SNAPSHOT** (`ACCOUNT_ID`, `MONTH`, `BALANCE`, unique per account+month): manual net worth. `lib/networth.ts` carries the last known balance forward and subtracts debts; `lib/networth-db.ts` builds the 24-month series.
- **Bank sync** (Enable Banking, PSD2 read-only): **BANK_CONNECTION** (one consent: `ASPSP_NAME`, `COUNTRY`, `SESSION_ID`, `VALID_UNTIL`, `STATUS` pending|active|expired|error|revoked, `LAST_SYNC_AT`, `LAST_ERROR`, `STATE` = nonce of an auth round-trip in flight) and **BANK_ACCOUNT** (`UID` per session, `IBAN`, `ENABLED`, `SYNC_FROM`, `LAST_BOOKING_DATE`, `NETWORTH_ACCOUNT_ID`). `LEDGER.EXTERNAL_ID` = the bank's transaction id, unique per workspace (deleted rows keep it so a re-sync never revives them; never copied by `SOURCE_COLUMNS`). Flow: `/bank` → `beginAuth` (`lib/bank-connect.ts`, reuses the connection for the same bank = reconnect) → POST /auth → bank → `/bank/callback?code&state` (STATE must belong to a workspace the user is in, < 1 h) → POST /sessions → accounts stored → first sync. `lib/banksync-db.ts` `syncConnection`: per enabled account, transactions from max(SYNC_FROM, LAST_BOOKING_DATE − 5 d) following `continuation_key`, `lib/banksync.ts` `reconcile` (known id → skip; hand-entered row same month/kind/amount ±0.005, day ±3 or none → link; else insert via `insertRow` with NOTES "Bank: …", category by rules → classifier → keyword guess; pending never written), then balances → today's BALANCE_CHECKPOINT for the main (oldest) account and ACCOUNT_SNAPSHOT when linked. Errors land in `LAST_ERROR` (consent gone → `expired`). `syncAll` runs every 6 h from `instrumentation.ts`. `lib/enablebanking.ts` holds the client (RS256 JWT via node:crypto) and the deterministic mock (two fake EE banks). Bank nudges: access ending ≤ 7 days / expired / failing.
- **AI (Claude API, `@anthropic-ai/sdk`)**: `lib/claude.ts` holds the mode (`live` with `ANTHROPIC_API_KEY`, `mock` with `AI_MOCK=1`, else `off` → features hidden), `createMessage` (beta Messages API with `fallbacks: "default"`, 30 s abort, friendly `AiError`s, refusal handling) and the in-memory hourly quota (`takeQuota`: 30 questions and 30 scans per user per hour). **Receipt scan**: camera button in the add form and quick-add bar (`components/ReceiptScanButton.tsx`) downscales to 1600 px JPEG in the browser → `scanReceipt` (`app/assistant/actions.ts`; ≤ 5 MB, magic-byte check, `next.config.ts` raises the action body limit to 6 MB) → structured output per `RECEIPT_SCHEMA` → `lib/receipt.ts` `validateReceipt` (finite amounts, ≤ 30 items, `check` when total and item sum differ by > 1 % or confidence < 0.6) → `cleanMerchant` + workspace rules for name/category/group/tags; the form is prefilled and can "Split by category" (`splitParts` → `splitExpense` after saving). **Ask your money** (`/assistant`): `lib/assistant.ts` runs a manual tool loop (≤ 6 tool rounds, then `tool_choice: none`) over the read-only tools in `lib/assistant-tools.ts` (fixed parameterised SQL, validated filters, workspace from `requireAuth()` only); answers render via `lib/assistant-text.ts` (relative markdown links → `<Link>`, all else plain text). Mock mode answers from one real tool by keywords. Privacy: photos are never stored, the chat lives in component state only, nothing logs prompts or ledger content.
- Reports: `lib/reports.ts` (pure, tested) computes the Sankey layout (income → groups → categories), merchant leaderboard with 3-month deltas, sparklines, weekday/weekend split and the savings-rate series used by `/analytics`; row queries in `lib/queries.ts` (`ledgerRowsBetween`, `merchantMonthly`).
- **PAYDAY** (expected income: `LABEL`, `AMOUNT`, `CADENCE` monthly|biweekly|weekly|once, `DAY` or `START_DATE`) and **BALANCE_CHECKPOINT** (`DATE`, `AMOUNT`: "my account had X on this date"; newest wins and is rolled forward with ledger rows entered after it). `lib/cashflow.ts` projects 60 days (paydays in, subscription charges out, variable daily rate from `lib/forecast.ts` drained daily) and derives safe-to-spend = lowest balance before the next payday − buffer (100 €), the low point and per-paycheck shortfalls; `lib/cashflow-db.ts` assembles it.
- **PLAN_LINE**: zero-based plan per month (`MONTH`, `KIND` income|expense|fund, `CATEGORY`, `GROUP_ID`, `LABEL`, `PLANNED`, `SORT_ORDER`, optional `SUBSCRIPTION_ID`). Ledger rows are matched to lines in `lib/plan.ts` (`matchRows`: subscription link → category+group → category-only line, generic lines before subscription lines); `summarise` gives planned/actual/remaining, "left to plan" (planned income − planned spending), unplanned groups and fund balances (`fund` lines carry planned − actual into later months, identity = category+group+label). `lib/plan-db.ts` builds a month from the previous plan, 3-month averages (rounded to 5 €) or active subscriptions.
- **SUBSCRIPTION**: recurring commitments (`NAME`, `CATEGORY`, `GROUP_ID`, `AMOUNT`, `CADENCE` weekly|monthly|quarterly|yearly, `DAY`, `MONTH_OF_YEAR`, `STATUS` active|paused|cancelled, `TRIAL_ENDS`, `CANCEL_URL`, `NOTES`). Charges are LEDGER rows with `SUBSCRIPTION_ID`; `lib/ledger.ts` `insertRow`/`linkSubscription` keep the link in step with `IS_RECURRING` (find-or-create by name+category+group, latest price wins, cancelled ones revive). `backfillSubscriptions` runs at startup, after restore and in the seed. Pure logic (cadence detection, next due, upcoming charges, unused detection, yearly calendar) in `lib/subscriptions.ts`; the list view with price history in `lib/subscriptions-db.ts`.
- **USER**, **WORKSPACE**, **WORKSPACE_MEMBER**: see Auth above. `BUDGET` and `BUDGET_HISTORY` are keyed by `(WORKSPACE_ID, …)`.
- **BUDGET** (current targets, `_total` pseudo-key), **BUDGET_HISTORY** (snapshot per month, written on edit and when the dashboard first renders a month; analytics "Budget vs actual" uses `resolveBudgetsFor`), **IMPORT_PATTERN**, **APP_SETTING** (legacy PIN hash; per-user preferences under `pref:<userId>:<name>` — `lib/preferences.ts` (pure, client-safe) + `lib/preferences-db.ts`: `landing` start page after sign-in, `sidebarMonths`, `safeBuffer` for cash flow, `weekStart` for the daily calendar / weekday chart; edited in Settings → Preferences)
- Soft deletes via `DELETED_AT` (config tables BUDGET / IMPORT_PATTERN hard-delete by design)
- Schema + idempotent migrations (EXPENSE→LEDGER rename, KIND and DAY columns, tag backfill): `lib/schema.ts`
- Import categorisation order: rules (`lib/rules.ts`) → `lib/classifier.ts` (naive Bayes trained on the ledger at page load) → keyword guesses. Dashboard forecast is `lib/forecast.ts` (spent + recurring still due + variable daily rate × days left).
- Shared write logic in `lib/ledger.ts` (copy/backfill/import/dedup, audit, tags); shared read queries in `lib/queries.ts`; month helpers in `lib/months.ts`; input parsing in `lib/validate.ts`

### Categories
25 predefined categories with icons in `types/expense.ts` (housing, fuel, groceries, etc.)
Users create custom **groups** to organize categories (Home, Car, Kids, etc.)

### Pages (21)
| Route | Purpose |
|-------|---------|
| `/dashboard` | Home — metrics, forecasting, insights, heatmap |
| `/` | Monthly view — expenses grouped by custom groups |
| `/search` | Global search across all months with URL filters (kind, category, group, tag, amount, month range) |
| `/groups` | Group management (CRUD) |
| `/inbox` | Nudge inbox: mark read, clear, "check now" |
| `/networth` | Manual net worth: accounts, monthly balance snapshots, 24-month chart |
| `/bank` | Bank sync: connect (Enable Banking), connections, accounts, sync now / reconnect / disconnect; `/bank/callback` is the auth redirect route |
| `/cashflow` | 60-day balance projection: safe to spend, low point, next payday, SVG chart, paycheck shortfalls, paydays and balance editors |
| `/plan` | Zero-based plan for a month: income lines, lines per group with planned/spent/remaining, funds that roll over, unplanned spend; quick starts copy last plan / build from averages / add subscriptions |
| `/subscriptions` | Subscription hub: monthly burn, upcoming bills with one-tap "Paid", price changes, unused/trial alerts, cadence editor (`/recurring` redirects here) |
| `/activity` | Timeline of all changes |
| `/compare` | Side-by-side month comparison |
| `/analytics` | 12-month deep analytics: savings rate bars, Sankey "where the money went", category sparklines, weekday vs weekend, top merchants |
| `/year` | Yearly overview + year-in-review card (biggest/cheapest month, top merchant, subscriptions added/cancelled, goals reached) with PNG export |
| `/goals` | Savings goals (SAVINGS_GOAL + LEDGER.GOAL_ID), progress/pace from `lib/goals.ts` |
| `/assistant` | "Ask your money" chat (Claude tool use over read-only ledger tools), suggestion chips; hidden pill on the dashboard when AI is off |
| `/review` | Monthly review narrative for a finished month (defaults to last month) |
| `/settings` | DB stats, budgets, backup/restore |
| `/login` | PIN authentication |
| `/privacy`, `/terms` | Public legal pages (no session, no app chrome; `lib/public-pages.ts` + `PUBLIC_PATHS` in `proxy.ts`), linked from `/login` and registered with Enable Banking |

### APIs (4)
- `GET /api/export?month=` or `?year=` — CSV download
- `GET/POST /api/backup` — JSON backup/restore (v14, + EXTERNAL_ID, bank connections deliberately not backed up; v13 + PAID_BY; ledger incl. DAY, GOAL_ID, SUBSCRIPTION_ID and SPLIT_GROUP + subscriptions + plan_lines + paydays + balance_checkpoints + accounts + account_snapshots + goals + groups (ICON names; older files' EMOJI is mapped on restore) + budgets + budget history + import patterns; rows keep their IDs so restore is idempotent and overwrites to backup values; tags are rebuilt from TAGS)
- `GET|POST /api/cron` — runs the nudges for every workspace; `Authorization: Bearer $CRON_SECRET` (header only, constant-time compare)
- `POST /api/import` — CSV import matching the export's columns by header (Kind, Notes, Recurring, Day honoured; old Estonian headers accepted), deduplicated by name+amount+month

### Deep link: `/add` (Siri Shortcuts / Android intents)
`GET /add?amount=12.50&name=Coffee&category=dining&tags=work&kind=expense` (`app/add/route.ts`, params parsed by `lib/add-link.ts`; each invalid param is dropped). With a valid `name` and `amount` it creates the row at once through the `createExpense` action (today's date, category defaults to `other`, kind to `expense`) and 303s to `/?month=<current>#e-<id>`; otherwise — or when the request is cross-site (`Sec-Fetch-Site: cross-site`) — it opens the month view's add form prefilled (`/?add=1&…`). Use it as an iOS Shortcuts "Open URL" action (`https://raha.waushop.ee/add?amount=[Ask]&name=[Ask]`) or an Android intent / home-screen shortcut; signed-out devices land on `/login`. The manifest's "Add expense" shortcut points here without params.

### Offline
`public/sw.js` precaches the shell (`/`, `/dashboard`, `/login`, manifest, icons), serves navigations network-first (fallback: cached copy of that URL → `/` → `/login`), and `/_next/static/*` stale-while-revalidate; cached pages are dropped when `/login` is shown. Adds from the quick-add bar and the add form that fail offline go to IndexedDB (`lib/offline-queue.ts`) and are replayed through `createExpense` by `components/OfflineSync.tsx` on start and on `online`, which also shows the "Offline" pill. Bump `CACHE_NAME` when changing caching.

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
- Icons come from `lucide-react` (`import { Pencil } from "lucide-react"`, `size={14}`); no hand-written `<svg>` glyphs and no emoji in the UI. Standard categories render through `components/CategoryIcon.tsx` (`<CategoryIcon category={key} size={16} />`); user-picked group/goal icons are names from `lib/icon-names.ts` (`ICON_NAMES`, curated Lucide set) stored in `ICON`, rendered by `components/Glyph.tsx` (`<Glyph name={g.ICON} fallback="target" />`) and chosen with `components/IconPicker.tsx` (form field `icon`, validated by `parseIcon`). Colour via `currentColor`.
- Headline font (Caveat) is self-hosted via `next/font` and exposed as `var(--font-hand)`; don't add `<link>` tags to Google Fonts.

## Environment Variables
```
DB_PATH         # path to the SQLite file (default ./raha.sqlite). The session
                # signing secret is created beside it as .auth-secret.
SMTP_HOST, SMTP_PORT (587), SMTP_SECURE ("true" for 465), SMTP_USER, SMTP_PASS, SMTP_FROM
                # OPTIONAL: outbound email for the sign-in code on new devices
                # (lib/mailer.ts). Unset → codes are logged in dev, sending fails in prod.
VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…)
                # OPTIONAL: web push for nudges (`npx web-push generate-vapid-keys`). Unset → the Settings card explains how.
CRON_SECRET     # OPTIONAL: enables GET/POST /api/cron for an external scheduler.
NUDGES=off, NUDGE_INTERVAL_MIN (60)
                # OPTIONAL: in-process hourly nudge scheduler (instrumentation.ts).
APP_URL         # OPTIONAL: absolute base for links in nudge emails (e.g. https://raha.waushop.ee).
ENABLE_BANKING_APP_ID, ENABLE_BANKING_PRIVATE_KEY (PEM, "\n"-escaped ok)
                # OPTIONAL: bank sync. Redirect URL registered at Enable Banking: https://raha.waushop.ee/bank/callback
ENABLE_BANKING_API (https://api.enablebanking.com), ENABLE_BANKING_REDIRECT_URL (${APP_URL}/bank/callback, else the request origin)
ENABLE_BANKING_MOCK=1
                # fake banks (also the default in development without an app id); e2e uses it.
BANK_SYNC=off, BANK_SYNC_INTERVAL_MIN (360)
                # in-process bank sync scheduler; skipped when neither configured nor mocked.
ANTHROPIC_API_KEY
                # OPTIONAL: enables receipt scanning and /assistant (Claude API). Unset → both hidden.
ANTHROPIC_MODEL (claude-sonnet-5-5), AI_MOCK=1
                # model override; deterministic offline mock for dev without a key and e2e.
AUTH_PIN_HASH   # OPTIONAL: SHA-256 of a bootstrap PIN (upgraded to scrypt in the DB on first login). Used only until the
                # first successful login persists it to APP_SETTING; after
                # that the env var can be removed and the DB is authoritative.
```

## Running Locally
```bash
npm run dev     # App on :3000; SQLite file is created on first query
npm run check   # lint + typecheck + tests (what CI runs)
npm run e2e     # Playwright (Chromium; first time: npx playwright install chromium).
                # Builds the app, wipes and seeds .e2e/e2e.sqlite (Demo 123456, Mari 482916)
                # and serves it on 127.0.0.1:3199 — never touches raha.sqlite or :3000.
                # Projects "phone" (iPhone 14 viewport) and "desktop"; add --project=phone
                # to run one. Specs live in e2e/*.spec.ts. Not part of `npm run check`.
```
