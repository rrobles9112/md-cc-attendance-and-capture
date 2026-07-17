# Design: Attendance & Data Capture Platform

## Technical Approach

Next.js 14+ App Router serves the UI. All reads/writes go through Dexie.js (IndexedDB) as the single source of truth for the UI — this makes every screen work offline instantly. A sync layer flushes queued mutations to Supabase REST (PostgREST) on reconnect. Supabase Realtime broadcasts `postgres_changes` back into Dexie, keeping local cache convergent. RLS is the hard security boundary; app-level guards are UX-only.

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

Offline path: write → Dexie + enqueue to `sync_queue` table in IndexedDB. Online flush: POST/PATCH with `upsert=true` to PostgREST. iOS Safari fallback: `setInterval`-based retry (no BackgroundSync API).

## Architecture Decisions

| Decision | Option A | Option B | Choice & Rationale |
|----------|----------|----------|--------------------|
| Backend platform | Supabase Cloud (managed) | Self-hosted Supabase | **Managed.** Delegates backups/PITR/ops. Region US/EU adequate under Ley 1581 Art. 26. |
| Offline sync | Dexie.js + custom sync queue | PowerSync (commercial) | **Dexie.** Free, battle-tested, no commercial dependency. Custom queue gives full control over conflict resolution. |
| Realtime | Supabase Realtime (`postgres_changes`) | Polling / GraphQL subs | **Supabase Realtime.** Built-in, zero infra, 200 conn free tier sufficient for ~20 concurrent users. |
| RBAC enforcement | RLS only | RLS + app-level guards | **Both.** RLS is tamper-proof boundary; app guards hide/disable UI for UX. |
| Export | Client-side SheetJS | Server-side Edge Function | **Client-side.** Bounded dataset (~100 rows), zero server cost, works offline. |
| Audit | Postgres triggers → `audit_log` | App-level logging | **DB triggers.** Tamper-proof, cannot be bypassed by direct API calls. |
| CI/CD | GitHub Actions (4 workflows) | Vercel-only CI | **GitHub Actions.** PR gates, migration dry-run, nightly scans — Vercel alone can't do this. |
| Sensitive encryption | `pgcrypto` for religious columns | App-level encryption | **pgcrypto.** Server-side, transparent to PostgREST, Ley 1581 compliant for sensitive data at rest. |

## Data Model (Postgres DDL Sketch)

```sql
-- Enable pgcrypto for sensitive field encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE app_role AS ENUM ('super_admin', 'leader', 'server');

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  role app_role NOT NULL DEFAULT 'server',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL, -- lower(trim(name))
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  birthday DATE,
  is_minor BOOLEAN NOT NULL DEFAULT false,
  legal_rep_name TEXT,
  has_whatsapp BOOLEAN DEFAULT false,
  consent_recorded BOOLEAN NOT NULL DEFAULT false,
  sensitive_consent_recorded BOOLEAN NOT NULL DEFAULT false,
  -- Encrypted sensitive fields (Ley 1581)
  denomination_encrypted BYTEA, -- pgcrypto; key from Supabase Vault
  community_name_encrypted BYTEA, -- pgcrypto; key from Supabase Vault
  duplicate_flag BOOLEAN DEFAULT false,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE social_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  platform TEXT NOT NULL, -- instagram|tiktok|facebook|x|other
  handle TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE whatsapp_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  is_primary_phone BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  session_date DATE NOT NULL,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id),
  session_id UUID NOT NULL REFERENCES sessions(id),
  marked_by UUID NOT NULL REFERENCES profiles(id),
  marked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(member_id, session_id) -- upsert target
);

CREATE TABLE consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id),
  consent_type TEXT NOT NULL, -- 'general' | 'sensitive'
  policy_version TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address INET
);

CREATE TABLE arco_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES members(id),
  request_type TEXT NOT NULL, -- ACCESS|RECTIFICATION|CANCELLATION|OPPOSITION
  status TEXT NOT NULL DEFAULT 'pending', -- pending|in_progress|fulfilled|overdue
  deadline DATE NOT NULL,
  fulfilled_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id UUID,
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by UUID REFERENCES profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- seed: ('dpo_contact_email', '') — configurable later by super_admin
```

### RLS Policy Pattern

```sql
-- Helper: extract role from JWT
CREATE OR REPLACE FUNCTION auth.user_role() RETURNS app_role AS $$
  SELECT (auth.jwt()->>'role')::app_role;
$$ LANGUAGE sql STABLE;

-- members: super_admin full; leader read+insert; server read-only
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
CREATE POLICY members_select ON members FOR SELECT USING (
  auth.user_role() IN ('super_admin','leader','server') AND deleted_at IS NULL
);
CREATE POLICY members_insert ON members FOR INSERT WITH CHECK (
  auth.user_role() IN ('super_admin','leader')
);
CREATE POLICY members_update ON members FOR UPDATE USING (
  auth.user_role() = 'super_admin'
);
CREATE POLICY members_delete ON members FOR DELETE USING (
  auth.user_role() = 'super_admin'
);

-- attendance: all roles can insert; super_admin can delete
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY attendance_select ON attendance FOR SELECT USING (true);
CREATE POLICY attendance_insert ON attendance FOR INSERT WITH CHECK (
  auth.user_role() IN ('super_admin','leader','server')
);

-- profiles: users see own profile; super_admin sees all
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_own ON profiles FOR SELECT USING (
  id = auth.uid() OR auth.user_role() = 'super_admin'
);
```

### Audit Trigger Function

```sql
CREATE OR REPLACE FUNCTION log_mutation() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_log(user_id, action, table_name, record_id, old_value, new_value)
  VALUES (
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 90-Day Purge (pg_cron)

```sql
-- pg_cron job: runs daily, hard-deletes records where deleted_at > 90 days ago
SELECT cron.schedule('purge-old-deletes', '0 3 * * *',
  $$DELETE FROM members WHERE deleted_at < now() - interval '90 days'$$
);
-- audit_log retains tombstone via the trigger (fires on DELETE)
```

## Data Flow

```
Capture Form ──▶ Dexie.members.put() + Dexie.sync_queue.add()
                        │                        │
                   [UI updates]            [if online]
                        │                        │
                        ▼                        ▼
                  Dexie liveQuery ──▶ syncFlush() ──▶ POST /rest/v1/members?upsert=true
                        │                                      │
                        │                              [RLS checks role]
                        │                                      │
                        ▼                                      ▼
                  other clients ◀── Realtime ◀── Postgres trigger ◀── INSERT committed
                  Dexie update       broadcast     audit_log written
```

Conflict path: attendance upsert on `(member_id, session_id)` → last-write-wins, audit log captures both attempts. Member duplicate: fuzzy match on `name_normalized` + phone → flag `duplicate_flag=true` for admin review.

## File Changes

| File Path | Action | Description |
|-----------|--------|-------------|
| `package.json` | Create | Project deps: next, react, @supabase/supabase-js, @supabase/ssr, dexie, xlsx, tailwind, shadcn/ui |
| `tsconfig.json` | Create | TypeScript strict config |
| `next.config.ts` | Create | Next.js config + PWA headers |
| `tailwind.config.ts` | Create | Tailwind + shadcn theme |
| `src/app/layout.tsx` | Create | Root layout with auth provider |
| `src/app/(auth)/login/page.tsx` | Create | Login page |
| `src/app/(dashboard)/layout.tsx` | Create | Dashboard shell with nav + offline indicator |
| `src/app/(dashboard)/capture/page.tsx` | Create | Member capture form |
| `src/app/(dashboard)/attendance/page.tsx` | Create | Session list + attendance grid |
| `src/app/(dashboard)/members/page.tsx` | Create | Member list with search |
| `src/app/(dashboard)/admin/page.tsx` | Create | Admin panel (users, audit, ARCO, purge) |
| `src/app/(dashboard)/export/page.tsx` | Create | Export page (CSV/XLSX) |
| `src/lib/supabase/client.ts` | Create | Browser Supabase client |
| `src/lib/supabase/server.ts` | Create | SSR Supabase client |
| `src/lib/sync/db.ts` | Create | Dexie schema definition |
| `src/lib/sync/queue.ts` | Create | Sync queue: enqueue, flush, retry |
| `src/lib/sync/conflict.ts` | Create | Conflict resolution logic |
| `src/lib/realtime/manager.ts` | Create | Realtime subscription manager |
| `src/lib/rbac/guards.ts` | Create | Role check helpers |
| `src/lib/rbac/types.ts` | Create | Role enum + permission map |
| `src/lib/export/generate.ts` | Create | SheetJS export logic |
| `src/hooks/useSync.ts` | Create | Sync status hook |
| `src/hooks/useRealtime.ts` | Create | Realtime subscription hook |
| `src/hooks/useRole.ts` | Create | Current user role hook |
| `src/components/ui/` | Create | shadcn/ui components |
| `src/components/forms/CaptureForm.tsx` | Create | Capture form with consent |
| `src/components/forms/AttendanceGrid.tsx` | Create | Attendance marking grid |
| `src/components/offline/SyncIndicator.tsx` | Create | Sync health badge |
| `src/workers/sw.ts` | Create | Service worker (offline + BackgroundSync) |
| `supabase/config.toml` | Create | Supabase project config |
| `supabase/migrations/001_initial_schema.sql` | Create | Full DDL + RLS + triggers + pg_cron |
| `supabase/migrations/002_seed_roles.sql` | Create | Seed super_admin user |
| `.github/workflows/ci.yml` | Create | PR gate: lint→typecheck→test→build |
| `.github/workflows/deploy-preview.yml` | Create | Vercel preview + migration dry-run |
| `.github/workflows/deploy-production.yml` | Create | Main push → migrate → deploy prod |
| `.github/workflows/nightly.yml` | Create | Full tests + Lighthouse + npm audit |
| `.github/dependabot.yml` | Create | Dependency vulnerability alerts |
| `public/manifest.json` | Create | PWA manifest |
| `public/sw.js` | Create | Service worker registration |

## Interfaces / Contracts

```typescript
type AppRole = 'super_admin' | 'leader' | 'server';

interface Member {
  id: string;
  name: string;
  name_normalized: string;
  phone: string;
  email: string;
  birthday?: string;
  is_minor: boolean;
  legal_rep_name?: string;
  has_whatsapp: boolean;
  consent_recorded: boolean;
  sensitive_consent_recorded: boolean;
  denomination_encrypted?: Uint8Array;
  community_name_encrypted?: Uint8Array;
  duplicate_flag: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface Attendance {
  id: string;
  member_id: string;
  session_id: string;
  marked_by: string;
  marked_at: string;
}

interface SyncQueueItem {
  id: string;          // uuid
  table: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  payload: Record<string, unknown>;
  timestamp: string;
  retry_count: number;
  error?: string;
}

// Dexie schema (src/lib/sync/db.ts)
// db.version(1).stores({
//   members: 'id, name_normalized, phone, email, deleted_at, duplicate_flag',
//   sessions: 'id, session_date, deleted_at',
//   attendance: 'id, member_id, session_id, [member_id+session_id]',
//   social_media: 'id, member_id',
//   whatsapp_numbers: 'id, member_id',
//   sync_queue: 'id, timestamp, table'
// });
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit (Vitest) | RLS policy logic (mock JWT claims), sync conflict resolver, form validation, consent checkbox logic, ARCO deadline calculator | `vitest` + `@testing-library/react` |
| Integration | Supabase local (`supabase start`), migrations apply, RLS policies enforce 3-role model, audit trigger fires, pgcrypto encrypt/decrypt | `supabase db reset` in CI + test DB |
| E2E (Playwright) | Offline capture→sync, attendance marking + realtime, role enforcement (leader can't delete), export generates valid XLSX | Playwright with network throttle for offline scenarios |
| CI gating | All above must pass before merge | GitHub Actions required status checks on `main` |

## Migration / Rollout

Greenfield — no data migration. Sequence:
1. `git init` + scaffold Next.js + Supabase project
2. First migration: `001_initial_schema.sql` (DDL + RLS + triggers + pgcrypto)
3. Seed: create super_admin user via Supabase Auth + insert profile
4. First deploy: Vercel preview → verify → merge → production
5. Configure Supabase Cloud region (US — adequate under Ley 1581 Art. 26)
6. Set GitHub branch protection on `main`

## Resolved Questions (from user, 2026-07-17)

- [x] Supabase project ref and anon key — will be provisioned during apply; no blocker
- [x] **pgcrypto encryption key management** → **Supabase Vault.** All sensitive keys, values, credentials, and API keys required for the project are stored in Supabase Vault (not env vars). The pgcrypto encryption key is fetched server-side via `vault.decrypted_secrets` in an Edge Function / RPC; the raw key never reaches the client or CI. See "Secrets management" below.
- [x] **Consent policy version string** → initial version `pdtp-v1.0-2026-07-17` (format: `pdtp-<major.minor>-<YYYY-MM-DD>`). Stored on `consent_records.policy_version`; bumped only when the PDTP text changes.
- [x] **DPO / ARCO contact email** → **configurable at runtime**, not hardcoded. Stored in a `app_settings` table (key/value, super_admin-editable via the admin panel) under key `dpo_contact_email`. The capture-form privacy notice reads this value; defaults to empty and shows "contact the coordinator" placeholder until set. This lets the priest set the real address later without a code deploy.

## Secrets management (Supabase Vault)

All sensitive material lives in Supabase Vault — Postgres-level secret storage encrypted at rest:

| Secret | Stored in | Accessed by |
|--------|-----------|-------------|
| pgcrypto encryption key (denomination/community fields) | Vault | Edge Function / RPC decrypts; key never sent to client |
| Supabase service-role key | Vault (managed by Supabase) | Server-only code; NOT in GitHub Actions secrets, NOT in Vercel env for client |
| Third-party API keys (future: Hootsuite/WhatsApp orchestrator) | Vault | Edge Functions only |
| GitHub Actions secrets (`SUPABASE_ACCESS_TOKEN`, `VERCEL_TOKEN`, `SUPABASE_DB_URL`) | GitHub Actions encrypted secrets | CI only — deploy/ci workflows; OIDC where supported |

**Decryption pattern** (sensitive religious fields): client requests via RPC → Edge Function pulls key from Vault → `pgp_sym_decrypt(denomination_encrypted, key)` → returns plaintext only to authorized roles (super_admin). Leader/Server never receive decrypted sensitive data unless RLS+RPC policy permits.

## UI component framework (confirmed)

**shadcn/ui** is the UI component framework for the frontend, built on Radix UI primitives + Tailwind CSS. Components live in `src/components/ui/` (added via `npx shadcn@latest add <component>`), composed into feature components in `src/components/forms/`, `src/components/attendance/`, `src/components/admin/`. Theme via `tailwind.config.ts` + `src/app/globals.css`. Rationale: copy-into-repo ownership (no version-lock-in), accessible by default (Radix), Tailwind-native, pairs cleanly with Next.js App Router + server components.
