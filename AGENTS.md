<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project Rules

## Code Style
- TypeScript strict mode, no `any`
- Server Components by default, `"use client"` only when needed
- Server Actions for all data mutations (no API routes for CRUD); every action starts with `await requireAuth()`, parses its inputs with `lib/validate.ts`, and form-driven mutations return `ActionResult` (`{ ok: false, error }` for validation failures, shown via `toast.showError`). Ledger write logic lives in `lib/ledger.ts` so it is unit-testable.
- Multi-row writes go through `db.transaction((tx) => …)` with the synchronous `tx.run` / `tx.all` — never `await` inside
- Tailwind CSS only — no CSS modules, no styled-components
- All strings in English

## Database
- Table/column names in UPPERCASE
- Always filter `DELETED_AT IS NULL` in queries, and always scope by `WORKSPACE_ID = ?` (from `currentContext()` in pages / `requireAuth()` in actions) on LEDGER, CATEGORY_GROUP, BUDGET, BUDGET_HISTORY, IMPORT_PATTERN and SAVINGS_GOAL; mutations by id must include `AND WORKSPACE_ID = ?`
- Spending aggregates must also filter `KIND = 'expense'`; income rows live in the same LEDGER table
- Use `CAST(AMOUNT AS REAL)` when selecting amounts (SQLite has no DOUBLE)
- Generate UUIDs with `crypto.randomUUID()`, not MySQL UUID()
- Soft delete: set `DELETED_AT=CURRENT_TIMESTAMP`, never hard delete. Exception: `BUDGET` and `IMPORT_PATTERN` are configuration, not records, and are hard-deleted by design.

## Components
- Keep components in `/components/`, pages in `/app/`
- Card containers use `.card` class from globals.css
- Inner card surfaces use `bg-white/[0.03]` or `.surface`
- Text hierarchy: `text-white` (primary), `text-[#9ca3c0]` (secondary), `text-[#5a6380]` (muted)
- Borders: `border-white/[0.08]` (primary), `border-white/[0.06]` (subtle)
- All animations use classes from globals.css (animate-fade-up, animate-fade-in)
- Icons: `lucide-react` components only (no inline `<svg>` glyphs except charts); category glyphs via `components/CategoryIcon.tsx`

## Forms
- Use `useRef<HTMLFormElement>` + `FormData` pattern
- Server actions called via `useTransition`
- Toast notifications for user feedback (`useToast()`)
- Haptic feedback on mobile: `navigator.vibrate?.(10)`

## Testing & Deploy
- Before pushing: `npm run check` (lint with zero warnings, `tsc --noEmit`, `node --test`) and `npx next build` must pass. CI runs the same gates.
- Deploy: push to `main` → GitHub Actions builds Docker image → Helm deploys to K8s
- Production URL: raha.waushop.ee
