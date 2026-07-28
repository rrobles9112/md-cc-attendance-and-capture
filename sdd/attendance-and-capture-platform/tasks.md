# Tasks: Attendance & Data Capture Platform

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 1800–2500 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 → PR 5 |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Foundation: scaffold + Supabase schema + RLS + auth + seed | PR 1 | base: main; DB is the security boundary — everything depends on it |
| 2 | Offline sync + realtime + service worker | PR 2 | base: main (after PR 1 merged); sync engine + realtime hooks |
| 3 | Capture + attendance UI + members list | PR 3 | base: main (after PR 2 merged); first user-facing features |
| 4 | Admin panel + export + ARCO + app_settings | PR 4 | base: main (after PR 3 merged); admin-only features |
| 5 | CI/CD workflows + all test layers | PR 5 | base: main (after PR 4 merged); quality gates + deployment automation |

## Phase 1: Foundation / Infrastructure

- [x] 1.1 `git init` + create project root: `package.json`, `tsconfig.json`, `next.config.ts`, `.gitignore`, `.env.example`
- [x] 1.2 `package.json` — deps: next, react, @supabase/supabase-js, @supabase/ssr, dexie, xlsx, tailwindcss, shadcn/ui, vitest, @testing-library/react, playwright
- [x] 1.3 `tsconfig.json` — strict mode, path aliases (`@/` → `src/`)
- [x] 1.4 `tailwind.config.ts` + `src/app/globals.css` — Tailwind + shadcn theme variables
- [x] 1.5 `npx shadcn@latest init` + add base components (button, input, checkbox, dialog, table, select, badge, card, label, toast)
- [x] 1.6 `supabase/config.toml` — project config for local dev + CLI
- [x] 1.7 `supabase/migrations/001_initial_schema.sql` — pgcrypto extension, app_role enum, 9 tables (profiles, members, social_media, whatsapp_numbers, sessions, attendance, consent_records, arco_requests, audit_log, app_settings), RLS policies for 3 roles, auth.user_role() helper, log_mutation() audit trigger on all mutable tables, pg_cron 90-day purge job, seed dpo_contact_email in app_settings
- [x] 1.8 `supabase/migrations/002_seed_roles.sql` — seed super_admin profile via Supabase Auth

## Phase 2: Core Implementation

- [x] 2.1 `src/lib/supabase/client.ts` + `src/lib/supabase/server.ts` — browser + SSR Supabase clients with @supabase/ssr
- [x] 2.2 `src/lib/sync/db.ts` — Dexie schema: members, sessions, attendance, social_media, whatsapp_numbers, sync_queue
- [x] 2.3 `src/lib/sync/queue.ts` — enqueue, flush (FIFO), retry, partial failure handling
- [x] 2.4 `src/lib/sync/conflict.ts` — member fuzzy dedup (name_normalized + phone), attendance upsert LWW
- [x] 2.5 `src/lib/realtime/manager.ts` — postgres_changes subscriptions → Dexie updates, auto-reconnect
- [x] 2.6 `src/lib/rbac/types.ts` + `src/lib/rbac/guards.ts` — AppRole enum, permission map, role check helpers
- [x] 2.7 `src/workers/sw.ts` — BackgroundSync + setInterval fallback for iOS Safari
- [x] 2.8 `src/hooks/useSync.ts` — sync status hook (pending count, status enum)
- [x] 2.9 `src/hooks/useRealtime.ts` — subscribe/unsubscribe lifecycle hook
- [x] 2.10 `src/hooks/useRole.ts` — current user role from JWT claims
- [x] 2.11 `src/lib/consent/validation.ts` — general required, sensitive separate opt-in, minor DOB → legal rep required
- [x] 2.12 `src/lib/consent/privacy-notice.ts` — Spanish privacy notice text, policy version pdtp-v1.0-2026-07-17
- [x] 2.13 `src/lib/audit/consent-logger.ts` — app-side CONSENT_GENERAL + CONSENT_SENSITIVE event logging to audit_log
- [x] 2.14 `src/lib/delete/soft-delete.ts` — deleted_at filter helpers, hard delete guard (super_admin only)
- [x] 2.15 `src/lib/arco/deadline.ts` — business-day calculator: 10bd access, 15bd rectification/cancellation/opposition
- [x] 2.16 `src/lib/arco/workflow.ts` — ARCO request create, fulfill, status transitions
- [x] 2.17 `src/lib/settings/app-settings.ts` — read/write app_settings (dpo_contact_email key)
- [x] 2.18 `src/lib/export/generate.ts` — SheetJS CSV/XLSX generation from Dexie local cache

## Phase 3: Integration / Wiring

- [x] 3.1 `src/app/layout.tsx` + `src/app/(auth)/login/page.tsx` — root layout with AuthProvider, login page via Supabase Auth
- [x] 3.2 `src/app/(dashboard)/layout.tsx` — dashboard shell: nav sidebar, offline indicator (SyncIndicator), role-based nav filtering
- [x] 3.3 `src/components/forms/CaptureForm.tsx` — shadcn form: required fields, conditional social media/WhatsApp, dual consent (general + sensitive), Spanish privacy notice, minor DOB handling
- [x] 3.4 `src/app/(dashboard)/capture/page.tsx` — capture route, writes to Dexie + sync_queue
- [x] 3.5 `src/components/forms/AttendanceGrid.tsx` — session list + member checkbox grid, realtime updates
- [x] 3.6 `src/app/(dashboard)/attendance/page.tsx` — attendance route, session creation (leader+), upsert marking
- [x] 3.7 `src/app/(dashboard)/members/page.tsx` — member list with search, duplicate_flag badge, detail view
- [x] 3.8 `src/app/(dashboard)/admin/page.tsx` — admin panel: user mgmt, role assignment, audit viewer (filter by table/action/date), sync health, ARCO management, app_settings editor (dpo_contact_email), purge controls
- [x] 3.9 `src/app/(dashboard)/export/page.tsx` — export page: member/attendance CSV/XLSX, session/date-range filters, ARCO single-subject export
- [x] 3.10 `public/manifest.json` + `public/sw.js` — PWA manifest, service worker registration
- [x] 3.11 `src/components/offline/SyncIndicator.tsx` — sync health badge (synced/syncing/offline/error + pending count)

## Phase 4: CI/CD + Testing

- [x] 4.1 `.github/workflows/ci.yml` — PR gate: install → lint → typecheck → test → build; required status checks
- [x] 4.2 `.github/workflows/deploy-preview.yml` — Vercel preview + Supabase migration dry-run per PR
- [x] 4.3 `.github/workflows/deploy-production.yml` — push to main → migrate → Vercel production deploy
- [x] 4.4 `.github/workflows/nightly.yml` — full test suite + Lighthouse PWA audit + npm audit
- [x] 4.5 `.github/dependabot.yml` — dependency vulnerability alerts + auto PRs
- [x] 4.6 Vitest unit tests: RLS role logic (mock JWT), sync conflict resolver (LWW + dedup), form validation, consent checkbox logic, ARCO deadline calculator
- [x] 4.7 Supabase integration tests: `supabase db reset`, migration apply, RLS 3-role enforcement (super_admin CRUD, leader read+insert, server read-only + attendance insert), audit trigger fires, pgcrypto encrypt/decrypt, pg_cron purge eligibility
- [x] 4.8 Playwright e2e: offline capture → sync (spec: offline-sync/Full offline-to-online cycle), attendance marking + realtime (spec: realtime-presence/Attendance mark visible), role enforcement — leader can't delete (spec: rbac-auth/Leader cannot delete), export generates valid XLSX (spec: data-export/Export as XLSX)

## Phase 5: Cleanup

- [x] 5.1 `README.md` — setup instructions, architecture overview, local dev, deployment
- [x] 5.2 `.env.example` — all required env vars with descriptions
- [x] 5.3 `docs/vault-setup.md` — Supabase Vault pgcrypto key setup, secret rotation
- [x] 5.4 `docs/deploy-runbook.md` — production deployment steps, rollback procedure, breach notification workflow

## Phase 6: CI/CD Gap Closure (post-verdict)

Closes gaps vs `specs/cicd-pipeline/spec.md` after migration consolidation and local-seed work:

- [x] 6.1 Isolate demo seed from production migrate path — `supabase/seed.sql` + `config.toml` `[db.seed]`; migration `002_remove_demo_seed_accounts.sql` strips deterministic demo Auth users/sample rows on cloud `db push`
- [x] 6.2 Harden PR DB validation — replace soft `db diff || true` with ephemeral local Supabase apply (`db reset`) that fails on SQL errors
- [x] 6.3 Wire SQL integration tests into CI — run `supabase/tests/*.sql` against ephemeral DB after migrate (RLS, audit, pgcrypto)
- [x] 6.4 Fix nightly Lighthouse — add `.lighthouserc.json`, start `next start` before audit; URLs include `/` and `/login`
- [x] 6.5 Tighten nightly `npm audit` — fail on high+ (remove blanket `continue-on-error`) so failures surface via `create-issue-on-failure`
- [x] 6.6 Fail-fast on missing `NEXT_PUBLIC_SUPABASE_*` build vars in CI/build jobs
- [x] 6.7 Nightly Playwright smoke — documented skip until ephemeral Auth stack is wired for Actions (see `e2e-smoke-note` job)
- [x] 6.8 Update README Module Access / Demo Logins for seed.sql vs production cleanup migration
