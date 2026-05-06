<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project Rules

## Code Style
- TypeScript strict mode, no `any`
- Server Components by default, `"use client"` only when needed
- Server Actions for all data mutations (no API routes for CRUD)
- Tailwind CSS only — no CSS modules, no styled-components
- All strings in English

## Database
- Table/column names in UPPERCASE
- Always filter `DELETED_AT IS NULL` in queries
- Use `CAST(AMOUNT AS DOUBLE)` when selecting amounts
- Generate UUIDs with `crypto.randomUUID()`, not MySQL UUID()
- Soft delete: set `DELETED_AT=CURRENT_TIMESTAMP`, never hard delete

## Components
- Keep components in `/components/`, pages in `/app/`
- Card containers use `.card` class from globals.css
- Inner card surfaces use `bg-white/[0.03]` or `.surface`
- Text hierarchy: `text-white` (primary), `text-[#9ca3c0]` (secondary), `text-[#5a6380]` (muted)
- Borders: `border-white/[0.08]` (primary), `border-white/[0.06]` (subtle)
- All animations use classes from globals.css (animate-fade-up, animate-fade-in)

## Forms
- Use `useRef<HTMLFormElement>` + `FormData` pattern
- Server actions called via `useTransition`
- Toast notifications for user feedback (`useToast()`)
- Haptic feedback on mobile: `navigator.vibrate?.(10)`

## Testing & Deploy
- Build check: `npx next build` must pass with zero errors
- Deploy: push to `main` → GitHub Actions builds Docker image → Helm deploys to K8s
- Production URL: raha.vaus.ee
