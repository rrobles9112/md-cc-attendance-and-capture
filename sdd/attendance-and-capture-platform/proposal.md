# Proposal: Attendance & Data Capture Platform

## Intent

Prayer groups running large-scale membership recruitment campaigns need a tool to (1) capture first-time visitor data in the field and (2) track per-session attendance. Current process is paper-based, slow, and loses data when connectivity is unreliable. This app delivers a responsive web platform that works offline during field capture, syncs automatically on reconnect, and provides realtime visibility across concurrent sessions — all enforced by role-based access control.

## Scope

### In Scope
- **Capture module**: name, phone, email; conditional social media (Instagram, TikTok, Facebook, X, other); WhatsApp number; birthday; religious background (Christian community membership, denomination, community name)
- **Attendance module**: per-session attendance marking (member × session junction)
- **Offline-first sync engine**: Dexie.js local cache → sync queue → Supabase REST flush on reconnect; BackgroundSync safety net
- **Realtime**: Supabase Realtime (`postgres_changes`) for concurrent session visibility
- **Auth & RBAC**: Supabase Auth + RLS enforcement + app-level UX guards; 3 roles (Super Admin, Leader, Server)
- **Audit**: Postgres triggers → `audit_log` table; all mutations logged
- **Soft + hard delete**: `deleted_at` column; hard delete gated to Super Admin via RLS
- **Export**: client-side SheetJS (xlsx) — CSV/XLSX compatible with Numbers/Google Sheets/Excel
- **CI/CD pipeline**: GitHub Actions workflow(s) on the `rroles9112` repository — lint, typecheck, test, build, Supabase migration dry-run, and preview/production deploys; gates PRs before merge so delegated work is verified automatically
- **Hosting**: Vercel (Next.js) + Supabase Cloud (backend)

### Out of Scope
- Native mobile apps (iOS/Android) — responsive PWA only for v1
- SMS/email gateway for birthday campaigns — future enhancement
- Payment processing
- Push notifications (beyond PWA)
- Multi-language / i18n
- Member-facing self-service portal
- CRDT-based conflict resolution (overkill for this domain)

## Capabilities

### New Capabilities
- `member-capture`: First-time visitor data capture form with conditional fields (social media, WhatsApp, religious background)
- `attendance-tracking`: Per-session attendance marking with member × session junction
- `offline-sync`: Dexie.js local cache + sync queue + conflict resolution (last-write-wins + audit trail)
- `realtime-presence`: Supabase Realtime subscriptions for concurrent session visibility
- `rbac-auth`: Supabase Auth + RLS + JWT custom claims; 3-role model (super_admin, leader, server)
- `audit-soft-delete`: Postgres trigger-based audit log + soft delete (deleted_at) + hard delete (super_admin only)
- `data-export`: Client-side CSV/XLSX export via SheetJS
- `cicd-pipeline`: GitHub Actions CI/CD on repo `rroles9112` — PR gates (lint/typecheck/test/build) + migration dry-run + preview deploy + production deploy on main
- `admin-panel`: User management, role assignment, audit log viewer, sync health dashboard

### Modified Capabilities
None — greenfield project.

## Approach

**Stack**: Supabase (Postgres, PostgREST, Realtime, Auth, RLS, Edge Functions) + Next.js 14+ App Router + TypeScript + Tailwind + shadcn/ui + Dexie.js + SheetJS.

**Offline sync flow**:
1. App loads → Dexie hydrates local cache from IndexedDB
2. UI renders from local cache (instant, works offline)
3. Supabase Realtime subscription updates Dexie on remote changes
4. User writes (capture/attendance) → write to Dexie + enqueue to `sync_queue`
5. Online? Flush queue to Supabase REST (POST/PATCH with upsert)
6. Offline? Queue persists in IndexedDB; BackgroundSync retries on reconnect

**Conflict resolution**:
- Attendance: upsert on `(member_id, session_id)` — last-write-wins; audit log captures `marked_by`
- Member capture: unique constraint on `(name_normalized, phone)` or `(email)`; fuzzy match flags duplicates for admin review
- Member update: `updated_at` timestamp comparison; last-write-wins with audit trail

**RBAC model**: RLS is the enforcement boundary (no row readable/writable without matching policy). JWT custom claims carry `role`. App-level guards hide/disable UI elements. Leader role: can read all + create, but CANNOT modify or delete existing records (RLS policy: `USING (auth.jwt()->>'role' IN ('super_admin', 'leader'))` for SELECT/INSERT; `USING (auth.jwt()->>'role' = 'super_admin')` for UPDATE/DELETE).

**Audit + delete**: Postgres `AFTER INSERT OR UPDATE OR DELETE` trigger writes to `audit_log` (user_id, action, table, record_id, old_value JSONB, new_value JSONB, timestamp). Soft delete via `deleted_at` column; all queries filter `WHERE deleted_at IS NULL`. Hard delete via RLS: only `super_admin` can issue real DELETE; audit trigger logs permanently before row removal.

**Data entities**: `members`, `social_media` (1:N), `whatsapp_numbers` (1:N), `sessions`, `attendance` (junction), `audit_log`, `users` (with role enum). All mutable tables carry `created_at`, `updated_at`, `deleted_at`.

**CI/CD pipeline (GitHub Actions, repo `rroles9112`)**:
- **PR gate (on pull_request)**: install (pnpm/npm), lint (ESLint), typecheck (tsc --noEmit), unit/component tests (Vitest), e2e smoke (Playwright on preview build), build (next build). PR cannot merge until all green (branch protection required status checks).
- **Supabase migration dry-run**: `supabase db diff` / `supabase migration list` against a ephemeral branch (Supabase branching on Pro) or `supabase db reset` against a CI ephemeral DB to validate SQL migrations + RLS policies before merge.
- **Preview deploy (on pull_request)**: Vercel preview deployment per PR; Supabase preview project/branch if available. Secrets via GitHub Actions secrets + Vercel/Supabase OIDC (no long-lived keys where possible).
- **Production deploy (on push to main)**: run migrations against staging then production Supabase, deploy Next.js to Vercel production. Database migrations are gated: `supabase db push` only after tests + build pass.
- **Nightly job (schedule)**: full test suite + Lighthouse/PWA audit + dependency vulnerability scan (Dependabot/`npm audit`).
- **Secrets**: `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_URL`, `VERCEL_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` as GitHub Actions secrets; production service-role key NOT in CI — only in Vercel/Supabase runtime.
- **Branch protection**: `main` requires PR review + passing CI; no direct pushes; no force-push.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/app/(auth)/` | New | Login/register routes via Supabase Auth |
| `src/app/(dashboard)/capture/` | New | First-time visitor capture form |
| `src/app/(dashboard)/attendance/` | New | Per-session attendance grid |
| `src/app/(dashboard)/members/` | New | Member list, search, detail view |
| `src/app/(dashboard)/admin/` | New | User/role management, audit log, sync health |
| `src/app/(dashboard)/export/` | New | CSV/XLSX export page |
| `src/lib/supabase/` | New | Client setup, SSR helpers, RLS types |
| `src/lib/sync/` | New | Dexie schema, sync queue, flush logic, conflict resolver |
| `src/lib/realtime/` | New | Realtime subscription manager |
| `src/lib/rbac/` | New | Role guards, permission checks |
| `src/workers/` | New | Service worker for offline + BackgroundSync |
| `supabase/migrations/` | New | Schema, RLS policies, audit triggers |
| `.github/workflows/` | New | GitHub Actions: ci.yml (PR gate), deploy-preview.yml, deploy-production.yml, nightly.yml |
| `.github/dependabot.yml` | New | Dependency vulnerability alerts + scheduled PRs |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Offline conflict resolution complexity | High | Start with last-write-wins + audit log. Fuzzy dedup for member capture. No CRDTs. |
| iOS Safari lacks BackgroundSync API | Medium | `setInterval`-based retry fallback in service worker; prompt user to keep app open during sync. |
| PII/consent (contact, birthday, social media) | High | Consent checkbox on capture form. Consider `pgcrypto` for sensitive fields. Data retention policy. |
| Dexie sync queue corruption | Medium | Checksums on queued items; sync health indicator in UI; manual retry button. |
| Supabase Realtime connection limits | Low | Free tier: 200 concurrent. Prayer group unlikely to exceed 50. Upgrade to Pro ($25/mo) if needed. |
| Role escalation via JWT tampering | Low | Supabase signs JWTs server-side; client cannot modify claims. RLS is the enforcement boundary. |

## Rollback Plan

1. **Data**: Supabase Cloud has point-in-time recovery (Pro tier). Free tier: daily backups. Export all data via Supabase dashboard before any destructive migration.
2. **App**: Vercel supports instant rollback to any previous deployment. Keep the last known-good deployment tagged.
3. **Schema**: All migrations are versioned in `supabase/migrations/`. Roll back by reverting migration files and running `supabase db reset`.
4. **Offline data**: Dexie stores are client-side only. If sync issues arise, users can export local data manually before clearing IndexedDB.

## Dependencies

- Supabase Cloud account (free tier sufficient for launch)
- Vercel account (free tier for hobby; Pro for team)
- GitHub repository under `rroles9112` with Actions enabled + branch protection on `main`
- Node.js 18+ (Next.js 14 requirement)
- No external SMS/email providers for v1

## Success Criteria

- [ ] Capture form works offline: data persists in IndexedDB and syncs on reconnect
- [ ] Attendance marking works across 3+ concurrent sessions with realtime visibility
- [ ] Super Admin can delete records; Leader and Server cannot
- [ ] All mutations appear in audit log with user, action, timestamp, old/new values
- [ ] Export produces valid XLSX/CSV openable in Numbers, Google Sheets, and Excel
- [ ] PWA installable on iOS and Android; offline indicator shows sync status
- [ ] No data loss during offline-to-online transition (verified with network throttling)
- [ ] GitHub Actions CI gates every PR (lint, typecheck, test, build) — blocked merge on red
- [ ] Pushing to `main` runs migrations + deploys to Vercel production automatically
- [ ] Preview deployment created per PR with its own URL

## Key Decisions & Tradeoffs

| Decision | Rationale | Source |
|----------|-----------|--------|
| Supabase over Nhost/Appwrite/PocketBase/Vercel+Neon | Postgres-first, auto REST + GraphQL, realtime, RLS, first-class TS/Next.js SDK. Both research docs converge here. | `baas-sql-react-platforms.md`, `hosting-platforms-research.md` |
| Dexie.js over custom IndexedDB or PowerSync/RxDB | Battle-tested reactive IndexedDB wrapper; free; custom sync layer gives control without commercial dependency | Exploration §b |
| RLS over app-only auth | DB-level enforcement is tamper-proof; works for REST + GraphQL + Realtime; app-level checks are UX-only | Exploration §e |
| Client-side SheetJS over server-side export | Dataset bounded (<5k rows); zero server cost; works offline; instant | Exploration §g |
| Postgres triggers over app-level audit | Tamper-proof; survives any client manipulation; cannot be bypassed | Exploration §g |
| Supabase Realtime over polling or GraphQL subscriptions | Built-in; zero infra; sufficient for prayer group scale; 200 conn free tier | Exploration §c |

## Resolved Decisions (from user, 2026-07-16)

The original open questions have been answered by the product owner:

1. **Member volume**: ~100 users on average, ~20 concurrent at any time. Comfortably within Supabase Free/Pro tier (200 realtime connections free). Export pagination not a concern at this scale.
2. **Hosting model**: **Supabase Cloud (managed)** — not self-hosted. Scaling, backups, PITR, and Postgres maintenance are delegated to Supabase. Self-hosting via Docker remains technically possible (Supabase is open source) but is explicitly out of scope for v1. Region must be in a country with "adequate" protection under Colombian Law 1581 Art. 26 (e.g., US/EU/UK) to keep cross-border transfers compliant. See `compliance-colombia-ley1581.md`.
3. **Birthday campaigns / messaging**: Optional, deferred to a later phase. A future integration could use a third-party publishing orchestrator (e.g., Hootsuite or a WhatsApp/social publishing API). NOT in scope for v1.
4. **Native mobile**: No. Web-only, delivered as a **PWA** for cross-platform installability. No React Native companion.
5. **Data retention**: **90 days** for soft-deleted records before eligible for purge. **Hard delete is exclusive to the Super Admin** (the priest coordinating the prayer groups). Aligns with Colombian ARCO "cancellation" right once processing purpose is fulfilled.
6. **Legal compliance**: **Colombian Law 1581 de 2012 (Habeas Data)** + Decree 1377/2013, regulated by the SIC. Key impact: the **religious-background field is SENSITIVE data** — requires a separate, explicit opt-in and a notice that the person is NOT obliged to provide it. Full requirements captured in `compliance-colombia-ley1581.md`.

## Out of Scope for This Proposal

- Detailed database schema (DDL) → spec phase
- API contracts / endpoint definitions → spec phase
- UI wireframes / component specs → design phase
- Service worker implementation details → design phase
- Testing strategy → tasks phase
