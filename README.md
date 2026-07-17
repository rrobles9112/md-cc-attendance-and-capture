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
| `ci.yml` | PR to main | lint → typecheck → test → build |
| `deploy-preview.yml` | PR to main | Build + Vercel preview + Supabase migration dry-run |
| `deploy-production.yml` | Push to main | test → migrate → Vercel production deploy |
| `nightly.yml` | 2am UTC daily | Full test suite + Lighthouse PWA audit + npm audit |

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
