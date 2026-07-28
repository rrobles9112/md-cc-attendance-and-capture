# Attendance & Data Capture Platform

A PWA for prayer group attendance tracking and first-time visitor data capture. Works offline, syncs automatically on reconnect, and enforces role-based access control.

## Architecture

```
Browser ────────────────────────────────────────────────── Supabase Cloud
┌──────────────┐   ┌──────────┐   ┌────────────┐   ┌──────────────────┐
│  Next.js UI  │──▶│  Dexie   │──▶│ sync_queue │──▶│ PostgREST upsert │
│  (App Router) │◀──│ (IDB)    │◀──│ (IDB)      │   │ + RLS policies   │
└──────────────┘   └──────────┘   └────────────┘   └────────┬─────────┘
       ▲                                                      │
       │            ┌─────────────────────┐                   │
       └────────────│ Supabase Realtime   │◀──────────────────┘
                    │ (postgres_changes)  │
                    └─────────────────────┘
```

**Offline-first**: writes go to Dexie.js (IndexedDB) → sync queue → flush to Supabase REST on reconnect. iOS Safari fallback uses `setInterval`-based retry.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14+ App Router, TypeScript, Tailwind CSS, shadcn/ui |
| Local cache | Dexie.js (IndexedDB) |
| Backend | Supabase (Postgres, PostgREST, Realtime, Auth, RLS) |
| Export | SheetJS (xlsx) — client-side CSV/XLSX |
| Audit | Postgres triggers → `audit_log` table |
| Encryption | `pgcrypto` for sensitive fields |
| PWA | Service worker + BackgroundSync |
| Testing | Vitest (unit), Playwright (e2e), pgTAP/SQL (integration) |
| CI/CD | GitHub Actions (4 workflows) |
| Hosting | Vercel (Next.js) + Supabase Cloud (backend) |

## Setup

### Prerequisites

- Node.js 20+
- npm
- Supabase CLI (`npm i -g supabase`)
- A Supabase project (Cloud or local)

### Local Development

```bash
# Clone and install
git clone <repo-url>
cd md-cc-attendance-and-capture
npm install

# Configure environment
cp .env.example .env.local
# Edit .env.local with your Supabase credentials

# Start Supabase local (optional — uses Docker)
supabase start

# Apply migrations
supabase db reset

# Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment Variables

See `.env.example` for all required variables. Key ones:

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service role key (never in client) |

## Module Access Guide

### Frontend Modules

All dashboard routes require authentication — unauthenticated users are redirected to `/`. Navigation items are hidden per role (UX-only); real enforcement lives in Postgres RLS.

| Route | Module | Access | What it does |
|-------|--------|--------|--------------|
| `/` | Sign in | Public | Supabase Auth (email/password); home page is the login form |
| `/login` | Sign in redirect | Public | Redirects to `/` |
| `/capture` | Visitor capture | super_admin, leader | First-time visitor data capture with Ley 1581 consent; offline-first |
| `/attendance` | Attendance | All roles | Mark attendance per session; realtime presence via Supabase Realtime |
| `/members` | Member directory | All authenticated | Browse/search members; edit/delete gated by role |
| `/export` | Data export | super_admin, leader | Client-side CSV/XLSX export (SheetJS) |
| `/admin` | Admin panel | super_admin | Tabs: **users** (role management), **audit** (audit_log viewer), **arco** (ARCO request workflow), **settings** (DPO email etc.), **sync** (offline queue), **purge** (90-day soft-delete purge) |

### Demo / Test Logins (local only)

After `supabase db reset`, demo data is loaded from `supabase/seed.sql` (see `supabase/config.toml` `[db.seed]`). Password for all: `test-password`

| Email | Role | What to verify |
|-------|------|----------------|
| `test-superadmin@test.com` | super_admin | Full CRUD, admin panel, purge, hard delete |
| `test-leader@test.com` | leader | Capture + create sessions; cannot edit/delete |
| `test-server@test.com` | server | Attendance only; no capture/admin |

Sample domain data is also seeded: members (incl. minor + soft-deleted purge candidate), social/WhatsApp contacts, consent records, two prayer sessions with attendance, and ARCO requests.

**Production note:** `supabase db push` applies migrations only — it does **not** run `seed.sql`. Migration `002_remove_demo_seed_accounts.sql` strips any deterministic demo accounts that may have been introduced by an earlier embedded seed in `001`.

### First Login & Admin Bootstrap (fresh signup)

New signups outside the seed are auto-provisioned with the `server` role (via the `handle_new_user()` trigger). Promote an admin manually if needed:

```sql
-- Run in Supabase SQL Editor after signing up in the app
UPDATE profiles SET role = 'super_admin' WHERE id = '<your-user-uuid>';
```

### Backend Modules (Supabase)

There are no Next.js API routes — the frontend talks directly to Supabase (PostgREST + Realtime + Auth), with RLS enforcing permissions.

**Tables:**

| Table | Module | Notes |
|-------|--------|-------|
| `profiles` | RBAC | User roles (`app_role` enum); auto-created on signup |
| `members` | Members | Person records; sensitive religious fields encrypted via `pgcrypto` |
| `social_media`, `whatsapp_numbers` | Members | Contact channels per member |
| `sessions` | Attendance | Gathering/meeting instances |
| `attendance` | Attendance | Check-ins per session; realtime broadcast |
| `consent_records` | Consent | Ley 1581 consent evidence (separate sensitive-data opt-in) |
| `arco_requests` | ARCO | Access/Rectification/Cancelation/Opposition workflow with legal deadlines |
| `audit_log` | Audit | Written by `log_mutation()` triggers on every table; 90-day purge eligibility |
| `app_settings` | Settings | Configurable values (e.g. DPO contact email) |

**Access paths:**

| Path | URL / How |
|------|-----------|
| Cloud dashboard | `https://supabase.com/dashboard/project/<project-ref>` — Table Editor, SQL Editor, Auth users, Vault |
| Local Studio | `http://localhost:54323` (only when running `supabase start` locally) |
| PostgREST API | `<NEXT_PUBLIC_SUPABASE_URL>/rest/v1/<table>` with `apikey` + user JWT header |
| Realtime | `postgres_changes` channel on `attendance` / `sessions` |
| Migrations | `supabase/migrations/` — apply with `supabase db push` (cloud) or `supabase db reset` (local) |

**Backend logic in the frontend bundle** (`src/lib/`): `rbac/` (permission guards), `sync/` (Dexie offline queue), `consent/`, `arco/` (legal deadline calc), `audit/`, `delete/` (soft-delete + purge), `export/`, `realtime/`, `settings/`, `supabase/` (client factories).

## Testing

```bash
# Unit tests (Vitest)
npm test

# E2E tests (Playwright) — requires running dev server
npm run test:e2e

# Typecheck
npx tsc --noEmit

# Lint
npm run lint
```

### Test Layers

| Layer | Command | What it tests |
|-------|---------|---------------|
| Unit (Vitest) | `npm test` | RBAC guards, sync conflict resolution, consent validation, ARCO deadlines, soft-delete logic |
| Integration (SQL) | `supabase db test` | RLS policies (3-role enforcement), audit trigger, pgcrypto encrypt/decrypt |
| E2E (Playwright) | `npm run test:e2e` | Offline sync, attendance + realtime, role enforcement, export |

## Deployment

### Vercel + Supabase Cloud

1. Connect the GitHub repo to Vercel
2. Set environment variables in Vercel dashboard
3. Set GitHub Actions secrets: `VERCEL_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`
4. Push to `main` → CI runs → migrations applied → production deploy

### CI/CD Workflows

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `ci.yml` | PR to main | lint → typecheck → Vitest → **local Supabase migrate + SQL tests** → build (fails if public Supabase vars missing) |
| `deploy-preview.yml` | PR to main | Build + Vercel preview + **ephemeral `db reset` migration validation** (no soft-fail) |
| `deploy-production.yml` | Push to main | test → `db push` migrations (no seed) → Vercel production |
| `nightly.yml` | 2am UTC daily / manual | Full suite + Lighthouse (with `next start`) + npm audit high+ |

## RBAC Model

| Role | Create | Modify | Delete | Attendance | Admin |
|------|--------|--------|--------|------------|-------|
| super_admin | ✅ | ✅ | ✅ (soft + hard) | ✅ | ✅ |
| leader | ✅ | ❌ | ❌ | ✅ | ❌ |
| server | ❌ | ❌ | ❌ | ✅ | ❌ |

Enforced at database layer (RLS) — app-level guards are UX-only.

## Compliance — Colombian Ley 1581 (Habeas Data)

- **Religious fields** (denomination, community) are classified as **sensitive data** per Ley 1581 Art. 6
- Separate explicit opt-in required for sensitive data collection
- Encrypted at rest via `pgcrypto` (Supabase Vault stores the key)
- ARCO rights supported: Access (10 business days), Rectification/Cancelation/Opposition (15 business days)
- 90-day retention for soft-deleted records, then eligible for purge
- Breach notification: 15 business days to SIC

## License

MIT
