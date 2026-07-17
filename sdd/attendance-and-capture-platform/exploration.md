## Exploration: Attendance & Data Capture Platform

### Current State

Greenfield project — no source code, no framework, no CI. Two prior research documents establish the vendor landscape:

- **`baas-sql-react-platforms.md`** — 11 BaaS vendors evaluated against SQL + REST/GraphQL + React-TS. Shortlist: **Supabase** (Postgres-first, auto REST via PostgREST + GraphQL via pg_graphql, realtime WebSockets, first-class TS/React/Next.js SDK), Nhost, Appwrite, PocketBase.
- **`hosting-platforms-research.md`** — 17-vendor matrix (BaaS + PaaS). Same shortlist plus PaaS combos (Render, Railway, Fly.io, Vercel+Neon). Decision framework confirms Supabase as closest SQL-first Firebase analog.

Both documents converge on **Supabase** as the starting point. This exploration evaluates whether Supabase can satisfy the app's two hardest requirements: **offline-first sync** and **realtime concurrent sessions**.

### Affected Areas

Since greenfield, the app decomposes into these modules/subsystems:

```
src/
├── app/                        # Next.js App Router pages + layouts
│   ├── (auth)/                 # Login/register routes
│   ├── (dashboard)/            # Authenticated shell
│   │   ├── capture/            # Initial data capture form
│   │   ├── attendance/         # Per-session attendance marking
│   │   ├── members/            # Member list + search
│   │   ├── admin/              # Admin panel (users, roles, audit)
│   │   └── export/             # CSV/XLSX export
│   └── api/                    # Next.js route handlers (if needed)
├── lib/
│   ├── supabase/               # Supabase client, auth helpers, RLS types
│   ├── sync/                   # Offline sync engine (queue, conflict resolver)
│   ├── realtime/               # Realtime subscription manager
│   └── rbac/                   # Role guards + permission checks
├── components/
│   ├── forms/                  # Capture form, attendance grid
│   ├── ui/                     # Shared UI (shadcn/ui or similar)
│   └── offline/                # Offline indicator, sync status banner
├── hooks/                      # useSync, useRealtime, useRole, useOffline
├── types/                      # Database-generated types from Supabase
└── workers/                    # Service worker for offline + background sync
```

Database tables (Supabase/Postgres):
- `members` — captured person data (name, phone, email, birthday, religious background)
- `social_media` — 1:N from members (platform, handle, is_primary)
- `whatsapp_numbers` — 1:N from members (number, is_primary_phone)
- `sessions` — prayer group sessions (date, name, created_by)
- `attendance` — junction: member × session, with timestamp + marked_by
- `audit_log` — all mutations (who, what, when, old_value, new_value)
- `users` — auth users with role enum (super_admin, leader, server)
- All mutable tables have `deleted_at` (soft delete) + `is_permanently_deleted` flag

### Approaches

#### a. Backend/Data Platform

| Platform | SQL (Postgres) | Auto REST | GraphQL | Realtime | Offline Sync | TS/React SDK | Verdict |
|----------|:-:|:-:|:-:|:-:|:-:|:-:|---------|
| **Supabase** | ✅ Postgres | ✅ PostgREST | ✅ pg_graphql | ✅ WebSockets | ❌ No built-in | ✅ First-class | **Best fit** — only gap is offline sync |
| Nhost | ✅ Postgres | ⚠️ Via Hasura | ✅ Hasura | ✅ Hasura subs | ❌ No built-in | ✅ Good | GraphQL-first; adds Hasura complexity without solving offline |
| Appwrite | ✅ MariaDB | ✅ | ✅ (v1.5+) | ✅ | ❌ No built-in | ✅ Good | MariaDB less portable; smaller community |
| PocketBase | ⚠️ SQLite | ✅ | ❌ | ✅ SSE | ❌ No built-in | ✅ Basic | SQLite = no concurrent writes; single-binary = no horizontal scale |
| Vercel+Neon | ✅ Postgres | ❌ DIY | ❌ DIY | ❌ DIY | ❌ DIY | ✅ Best DX | Must build everything; no BaaS features |

**Recommendation: Supabase.** Postgres-first, auto REST + GraphQL, realtime WebSockets, RLS for RBAC, Edge Functions for server-side logic, first-class `@supabase/supabase-js` + `@supabase/ssr` for Next.js App Router. The offline sync gap is addressed separately below.

#### b. Offline-First + Sync Architecture (CRITICAL RISK)

This is the single hardest technical problem. Three approaches:

| Approach | Description | Pros | Cons | Effort |
|----------|-------------|------|------|--------|
| **(i) IndexedDB queue + custom sync to Supabase REST** | Store pending writes in IndexedDB (via `idb` or `localforage`). On reconnect, flush queue to Supabase REST API. | Full control; no extra deps; Supabase REST is simple POST/PATCH | Must build: queue, dedup, conflict resolution, retry, partial failure handling; significant custom code | **High** |
| **(ii) Local-first DB with sync layer (Dexie + liveQuery over Supabase)** | Use **Dexie.js** (IndexedDB wrapper with reactive queries) as local cache. Sync via Dexie Cloud or custom sync to Supabase. Alternative: **PowerSync** (commercial, Postgres-native sync) or **RxDB** (open-source, pluggable sync). | Battle-tested sync primitives; reactive local queries; conflict resolution built-in | Extra dependency; PowerSync is commercial (free tier limited); RxDB learning curve; Dexie Cloud is paid for multi-device | **Medium** |
| **(iii) Service Worker + Background Sync API** | Register a service worker. Queue failed POST/PUT in `BackgroundSyncManager`. Browser retries automatically when online. | Native browser API; zero custom sync logic; works with any backend | Only retries network requests — no conflict resolution; no offline reads (need IndexedDB anyway); browser support varies (no iOS Safari BackgroundSync) | **Medium-Low** (but incomplete) |

**Conflict resolution for concurrent attendance writes:**
- Attendance is a junction record (member × session). Two servers marking the same person in the same session = duplicate. Solution: **upsert on `(member_id, session_id)` with `marked_by` audit** — last-write-wins is acceptable because the audit log captures who marked.
- Member capture during offline: two devices capture the same person. Solution: **fuzzy match on name + phone** during sync, flag for admin review if conflict detected.

**Recommendation: (ii) Dexie.js as local cache + custom sync to Supabase.** Dexie provides reactive IndexedDB queries (the UI works offline immediately). A sync layer pushes queued writes to Supabase on reconnect. Supabase RLS + upsert constraints prevent duplicates. The BackgroundSync API (iii) can supplement as a safety net for write retries but is insufficient alone (no iOS support, no offline reads).

#### c. Realtime for Concurrent Sessions

| Approach | Description | Pros | Cons | Fit |
|----------|-------------|------|------|-----|
| **Supabase Realtime** | Postgres changes broadcast via WebSocket channels. `supabase.channel('attendance').on('postgres_changes', ...)` | Built-in; zero infra; scales with Supabase; works with RLS | Limited to Postgres changes (no arbitrary events); 200 concurrent connections on free tier, 500 on Pro ($25/mo) | **Excellent** |
| Polling (SWR/React Query `refetchInterval`) | Client polls REST endpoint every N seconds | Simple; no WebSocket complexity | Latency (N seconds); wastes bandwidth; doesn't scale | Poor |
| GraphQL subscriptions (Nhost/Hasura) | Hasura subscriptions over WebSocket | Rich query subscriptions | Adds Hasura dependency; more complex setup than Supabase Realtime | Good (if Nhost chosen) |

**Recommendation: Supabase Realtime.** Subscribe to `postgres_changes` on `attendance` and `members` tables. When a server marks attendance, all connected clients see it instantly. The 200-connection free tier is sufficient for a prayer group; Pro tier ($25/mo) handles 500.

#### d. Frontend Framework

| Framework | Offline/PWA | SSR/SSG | Mobile | DX | Effort |
|-----------|:-:|:-:|:-:|:-:|:-:|
| **Next.js (App Router)** | ✅ Via next-pwa or manual SW | ✅ Best | ⚠️ Web only (React Native separate) | ✅ Best | **Medium** |
| Vite + React (SPA) | ✅ Easier (no SSR to work around) | ❌ No SSR | ⚠️ Web only | ✅ Fast | **Low** |
| Remix | ✅ Via SW | ✅ Good | ⚠️ Web only | ✅ Good | **Medium** |

**Recommendation: Next.js 14+ (App Router).** Rationale: Supabase has first-class `@supabase/ssr` + `auth-helpers-nextjs` for App Router; server components reduce client bundle (important for mobile); API routes can host Edge Functions. PWA via `@ducanh2912/next-pwa` or manual service worker registration.

#### e. RBAC Enforcement

| Approach | Description | Pros | Cons |
|----------|-------------|------|------|
| **DB-level RLS (Supabase)** | Row Level Security policies on every table. Role checked via `auth.jwt()` claim. | Enforced at DB layer — impossible to bypass via API; works for REST + GraphQL + Realtime | Policy complexity; harder to debug; migration overhead |
| App-level middleware | Next.js middleware + server components check role before DB call | Easier to reason about; TypeScript type safety | Bypassable if someone hits Supabase directly; doesn't protect Realtime subscriptions |
| **Both (recommended)** | RLS as the security boundary; app-level checks for UX (hide/disable buttons) | Defense in depth | More code, but the right tradeoff |

**Recommendation: Both.** Supabase RLS is the enforcement layer (no row is readable/writable without a matching policy). App-level role guards in React provide UX (hide delete button for Leaders). JWT custom claims carry the role; a Supabase Edge Function or DB trigger sets the claim on signup/role change.

#### f. Export

| Approach | Pros | Cons |
|----------|------|------|
| **Server-side (Supabase Edge Function)** | Handles large datasets; doesn't block UI; can generate XLSX via `exceljs` | Edge Function cold start; 10s timeout on Supabase free tier |
| **Client-side (SheetJS/xlsx)** | No server cost; instant for <10k rows | Blocks UI for large exports; memory pressure on mobile |

**Recommendation: Client-side with SheetJS.** The dataset is bounded (prayer group membership, likely <5k rows). SheetJS generates CSV/XLSX in-browser — zero server cost, works offline, compatible with Numbers/Google Sheets/Excel. Add server-side export as a future enhancement if dataset grows.

#### g. Audit + Soft/Hard Delete

| Component | Approach |
|-----------|----------|
| **Audit log** | Supabase DB trigger (`AFTER INSERT OR UPDATE OR DELETE`) writes to `audit_log` table with `user_id` (from `auth.uid()`), `action`, `table`, `record_id`, `old_value` (JSONB), `new_value` (JSONB), `timestamp`. App cannot bypass this — it's at the DB layer. |
| **Soft delete** | `deleted_at TIMESTAMP` column on mutable tables. All queries filter `WHERE deleted_at IS NULL` (enforced via RLS policy or view). |
| **Hard delete** | `DELETE` gated by RLS policy: `USING (auth.jwt()->>'role' = 'super_admin')`. Only Super Admin can issue a real `DELETE`. The audit trigger logs it permanently before the row is gone. |

**Recommendation: DB triggers for audit + RLS for delete gating.** This is the Supabase-native approach and is tamper-proof.

### Recommendation

**Recommended Stack:**

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Backend** | **Supabase** (Postgres, PostgREST, pg_graphql, Realtime, Edge Functions, Auth) | SQL-first, auto REST + GraphQL, realtime WebSockets, RLS for RBAC, first-class TS/React SDK. Both research docs converge here. |
| **Frontend** | **Next.js 14+ (App Router)** + TypeScript + Tailwind CSS + shadcn/ui | Supabase SSR helpers; server components for mobile perf; PWA via next-pwa |
| **Offline** | **Dexie.js** (IndexedDB) as local cache + custom sync queue to Supabase REST | Reactive offline queries; queue pending writes; flush on reconnect; upsert constraints prevent duplicates |
| **Realtime** | **Supabase Realtime** (`postgres_changes` channels) | Zero infra; built-in with Supabase; sufficient for prayer group scale |
| **RBAC** | **Supabase RLS** (enforcement) + app-level role guards (UX) | Defense in depth; JWT custom claims carry role |
| **Export** | **SheetJS (xlsx)** client-side | Works offline; instant for <5k rows; no server cost |
| **Audit** | **Postgres triggers** → `audit_log` table | Tamper-proof; survives any client manipulation |
| **Hosting** | **Vercel** (Next.js) + **Supabase Cloud** (backend) | Canonical pairing; free tiers sufficient for launch |
| **Auth** | **Supabase Auth** (email/password + magic link) | Built-in; integrates with RLS; supports custom JWT claims for roles |

**Offline sync flow (the critical path):**

```
1. User opens app → Dexie loads local cache (members, sessions, attendance)
2. UI renders from IndexedDB (instant, works offline)
3. Supabase Realtime subscription → updates Dexie cache on changes
4. User captures member / marks attendance → write to Dexie + enqueue to sync_queue
5. Online? → flush sync_queue to Supabase REST (POST/PATCH with upsert)
6. Conflict? → Supabase upsert constraint resolves; audit log captures both attempts
7. Offline? → queue persists in IndexedDB; retry on reconnect (SW BackgroundSync as backup)
```

**Conflict resolution strategy:**
- **Attendance**: Upsert on `(member_id, session_id)`. Last-write-wins is acceptable; audit log records `marked_by` for each attempt.
- **Member capture**: Unique constraint on `(name_normalized, phone)` or `(email)`. Fuzzy match during sync flags potential duplicates for admin review.
- **Member update**: `updated_at` timestamp comparison; last-write-wins with audit trail.

### Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Offline conflict resolution complexity** | HIGH | Start with last-write-wins + audit log. Add fuzzy dedup for member capture. Avoid CRDTs initially — overkill for this domain. |
| **iOS Safari lacks BackgroundSync API** | MEDIUM | Use `setInterval`-based retry in the service worker as fallback; prompt user to keep app open during sync. |
| **Supabase Realtime connection limits** | LOW | Free tier: 200 concurrent. Prayer group unlikely to exceed 50. Monitor and upgrade to Pro ($25/mo) if needed. |
| **PII/consent (contact, birthday, social media)** | HIGH | Add consent checkbox on capture form. Encrypt sensitive fields at rest (Supabase supports `pgcrypto`). Implement data retention policy. GDPR/LFPDPPP compliance if applicable. |
| **Role escalation via JWT tampering** | LOW | Supabase signs JWTs server-side; client cannot modify claims. RLS policies are the enforcement boundary. |
| **Export volume on mobile** | LOW | SheetJS handles <10k rows fine. Add pagination/virtualization for the member list UI. |
| **Dexie sync queue corruption** | MEDIUM | Implement checksums on queued items; add "sync health" indicator in UI; manual retry button. |
| **Supabase vendor lock-in** | LOW | Postgres is portable; PostgREST is open-source; can self-host Supabase or migrate to any Postgres host. |

### Ready for Proposal

**Yes.** The exploration confirms Supabase as the backend with Dexie.js for offline-first sync is the strongest architectural fit. The two critical risks (offline sync complexity, concurrent session realtime) have concrete mitigation strategies.

The orchestrator should tell the user:
1. The stack is **Supabase + Next.js + Dexie.js + Supabase Realtime** — grounded in both research documents.
2. The biggest technical risk is **offline sync** — we'll use Dexie.js as a local cache with a sync queue, not a full CRDT solution (overkill for this domain).
3. **RBAC is enforced at the database layer** via Supabase RLS — app-level checks are UX only.
4. Ready to move to **SDD Proposal** phase.
