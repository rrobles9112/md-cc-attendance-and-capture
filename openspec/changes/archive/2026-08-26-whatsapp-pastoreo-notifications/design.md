# Design — WhatsApp Pastoreo Notifications

> **Change:** `whatsapp-pastoreo-notifications`
> **Date:** 2026-02-14 (design)
> **Status:** draft — pending review before `sdd-tasks`
> **Artifact store:** `both` — `openspec/changes/whatsapp-pastoreo-notifications/design.md` + Engram `sdd/whatsapp-pastoreo-notifications/design`
> **Upstream contracts:** `proposal.md` (proposal, G1–G6) + `specs/whatsapp-pastoreo-notifications/spec.md` (spec — normative for US1/US2/US3, Data Contracts, API contract) + `explore.md` (codebase findings, indexes, queries)
> **Stack constraints:** Next.js 15.5.22 + React 19 + TS 5.8 strict + Supabase Postgres 15 + Dexie offline-first + Vercel + `strict_tdd: true` + budget 400 changed-lines + `supabase-postgres-best-practices` (`security_invoker`, partial indexes, Vault, `CONCURRENTLY`)
> **Approval state:** Proposal approved; D2 (`WHATSAPP_PHONE_NUMBER_ID`) pending client consult — modelled as Vault/`app_settings` placeholder configurable without migration; Edge Function fails closed if missing. D1, D3–D12 defaults accepted per spec.

---

## 1. Architecture Overview & Diagram

### 1.1 High-level

```
                              ┌──────────────────────────────────────────────────────────┐
                              │              Supabase Postgres 15 (public schema)         │
                              │                                                          │
                              │  pg_cron  "daily-digest"  0 12 * * *  UTC               │
                              │   (= 07:00 America/Bogota, UTC-5, no DST)               │
                              │       │                                                  │
                              │       ├── net.http_post ─────────────────────────┐       │
                              │       │  {kind:"absence"}  then {kind:"birthday"}│       │
                              │       │  Authorization: Bearer <service_role>     │       │
                              │       │  x-cron-secret: <Vault CRON_SECRET>      │       │
                              │       │                                          │       │
                              │       ├── notification_log (audit + idempotency)  │       │
                              │       ├── members (+ sex, age_years GENERATED,    │       │
                              │       │     whatsapp_opt_in, whatsapp_opt_out_at) │       │
                              │       ├── profiles (+ whatsapp_number,            │       │
                              │       │     whatsapp_opt_in)                      │       │
                              │       ├── whatsapp_numbers + members.phone        │       │
                              │       ├── consent_records (whatsapp_messaging)    │       │
                              │       ├── app_settings (whatsapp_enabled, cap,    │       │
                              │       │     chronic threshold/lookback)            │       │
                              │       └── Vault: WHATSAPP_TOKEN,                  │       │
                              │                 WHATSAPP_PHONE_NUMBER_ID (D2      │       │
                              │                 placeholder), CRON_SECRET          │       │
                              │                 pgcrypto_encryption_key (existing) │       │
                              └──────────────────────────┬─────────────────────────┘       │
                                                         │  https://<project>.supabase.co/functions/v1/send-whatsapp
                                                         ▼
                              ┌──────────────────────────────────────────────────────────┐
                              │   Supabase Edge Function: send-whatsapp (Deno)         │
                              │   - Verify JWT (service_role via x-cron-secret)        │
                              │     or user JWT via supabase.auth.getUser()            │
                              │   - Gate: consent triple-check + opt_out_at + cap      │
                              │   - Normalize E.164 via libphonenumber-js (server)     │
                              │   - Validate against ^\+[1-9]\d{7,14}$ + +57 prefix    │
                              │   - Idempotency check against partial unique indexes   │
                              │   - Chunk 50, POST Graph API, write notification_log   │
                              │   - Structured JSON logs (kind, member_id, latency)    │
                              └──────────────────────────┬───────────────────────────────┘
                                                         │ POST https://graph.facebook.com/v20.0/{phone_number_id}/messages
                                                         │ Authorization: Bearer <WHATSAPP_TOKEN from Vault>
                                                         ▼
                              ┌──────────────────────────────────────────────────────────┐
                              │        Meta WhatsApp Cloud API (official)                │
                              │  Templates: absence_followup, birthday_staff_digest,     │
                              │             shepherding_checkin (utility, es_CO)         │
                              │  Test/trial: Meta test number or Twilio sandbox (dev)   │
                              └──────────────────────────┬───────────────────────────────┘
                                                         │ WhatsApp message
                                                         ▼
                                                    Recipient phone (E.164)

                              ┌──────────────────────────────────────────────────────────┐
                              │  Next.js 15 (Vercel) — /(dashboard)/pastoreo            │
                              │  Server Components (RLS-aware via createServerClient)   │
                              │  WITH (security_invoker=true) views for Pastoreo stats  │
                              │  Client islands: filters (nuqs/useSearchParams),         │
                              │                export button, Notify action              │
                              │  Reads: members/attendance/sessions/notification_log     │
                              │  Actions: "Notify" → Edge Function (user JWT)           │
                              │  Export: SheetJS (xlsx) — reused src/lib/export pattern │
                              │  Banner: whatsapp_enabled=false / cap / missing creds    │
                              └──────────────────────────────────────────────────────────┘

  Fallback path (only if pg_cron/pg_net unavailable):
     Vercel Cron (vercel.json 0 12 * * *) → /api/cron/daily-digest (Route Handler, verifies CRON_SECRET)
                                        → same Edge Function with service_role (identical contract & idempotency)
```

### 1.2 Secret & PII boundaries

| Secret / PII | Canonical store | Exposed to | Never in |
| --- | --- | --- | --- |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `CRON_SECRET` | Supabase Vault (`vault.secrets` + `vault.decrypted_secrets`) — pattern per `docs/vault-setup.md` | Edge Function env via `supabase secrets set` + `Deno.env.get(...)`; fallback `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name=...` via `service_role` RPC if needed | `NEXT_PUBLIC_*`, client bundle, `supabase/config.toml`, git |
| `pgcrypto_encryption_key` | Vault (existing) | Same RPC (`get_decryption_key()`) | Client |
| Phone E.164 (PII) | `members.phone`, `whatsapp_numbers.number`, `profiles.whatsapp_number` | Server-side only; UI shows masked `***1234`; full value only in Edge logs with `super_admin`-gated log viewer | Client query without RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Vault / Vercel env (server-only) | `pg_cron` `net.http_post` header via `current_setting('app.settings.service_role_key')` or Vault lookup; `/api/cron/daily-digest` server handler only | Client |

### 1.3 Where E.164 normalization lives

1. **On write** (capture / members edit): Zod schema in `src/lib/validation` + `libphonenumber-js` (`parsePhoneNumberFromString(value, 'CO')`) → store canonical `+57…`. Reuses existing capture form pattern; adds `whatsapp_number` field with same validator.
2. **Before send** (Edge Function): re-normalize `COALESCE(wn.number, m.phone)` and `profiles.whatsapp_number` via `libphonenumber-js` (Deno ESM import `npm:libphonenumber-js`) — authoritative gate before any `POST` to Graph API. Invalid → `skipped_invalid_phone`, no provider call.
3. **No normalization in SQL** — DB `CHECK (whatsapp_number ~ '^\+[1-9]\d{7,14}$')` is a guard rail only; canonical form is application-enforced.

### 1.4 Fallback note

Vercel Cron fallback (`/api/cron/daily-digest`) reuses the Edge Function contract verbatim (same `kind` payloads, same idempotency indexes). It exists solely because `pg_cron`/`pg_net` require Dashboard > Extensions enablement; if that enablement is blocked, the fallback avoids a migration revert. Only one path is active at a time — `app_settings.whatsapp_cron_driver = 'pg_cron' | 'vercel'` documents which is live.

---

## 2. Data Design (DDL Sketch — not final migration SQL)

All DDL below is a sketch for `sdd-tasks`/`sdd-apply` to turn into `supabase migration new whatsapp_pastoreo` files. Follow `supabase-postgres-best-practices` and existing migration style (001, 006, 011): `IF NOT EXISTS` guards, `CONCURRENTLY` for indexes in a separate transaction, `security_invoker` views, `TO authenticated USING (...)` policies, no bare `TO authenticated`.

### 2.1 `members` — new columns

```sql
-- Migration 012a (additive, nullable/defaulted — safe to re-run)
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS sex TEXT
    CHECK (sex IN ('M','F','other','prefer_not_to_say')),
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_opt_out_at TIMESTAMPTZ;

-- Generated column — PG12+ STORED, recomputed on birthday write
-- NOTE: EXTRACT(YEAR FROM age(birthday)) returns int; age() is stable.
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS age_years INT
    GENERATED ALWAYS AS (EXTRACT(YEAR FROM age(birthday))::int) STORED;

COMMENT ON COLUMN public.members.sex IS 'Ley 1581 sensitive; nullable, prefer_not_to_say allowed; excluded from default export';
COMMENT ON COLUMN public.members.age_years IS 'GENERATED STORED from birthday; NULL when birthday IS NULL; used for age_bucket CASE';
COMMENT ON COLUMN public.members.whatsapp_opt_out_at IS 'Set on unsubscribe; blocks sends even if opt_in=true';
```

No data migration for `sex` — existing rows stay `NULL` ("No especificado" bucket). No trigger needed; `update_updated_at` already covers `members`.

### 2.2 `profiles` — new columns (chosen over `auth.users.phone`)

```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS whatsapp_number TEXT
    CHECK (whatsapp_number ~ '^\+[1-9]\d{7,14}$'),
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.whatsapp_number IS 'Staff WhatsApp for birthday digests; E.164; NULL until opted in';
```

**Justification vs `auth.users.phone` join:**

| Option | Why not chosen |
| --- | --- |
| `auth.users.phone` | Lives in `auth` schema (not in `public` PostgREST exposure by default), not RLS-controllable, not reliably populated (seed sets `providers: [email]` only), and `auth.users` is `SECURITY DEFINER`-sensitive. Joining from Edge would require `service_role` or a `SECURITY DEFINER` helper — both widen the attack surface for a field that needs RLS and audit. |
| `profiles.whatsapp_number` (chosen) | Stays in `public`, inherits existing `profiles` RLS pattern, auditable via `log_mutation()`, indexable for E.164 validation, and decoupled from Supabase Auth phone auth (which the project does not use). One extra column, zero new tables, minimal migration. |

### 2.3 New table — `notification_log`

```sql
CREATE TABLE IF NOT EXISTS public.notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES public.members(id) ON DELETE SET NULL,
  recipient_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('absence','birthday','shepherding_checkin')),
  channel TEXT NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp')),
  template_name TEXT NOT NULL, -- absence_followup | birthday_staff_digest | shepherding_checkin
  status TEXT NOT NULL CHECK (status IN (
    'queued','sent','failed',
    'skipped_no_consent','skipped_invalid_phone','skipped_duplicate',
    'skipped_no_birthdays','skipped_no_recipients','skipped_cap'
  )),
  notification_date DATE, -- Bogota date for birthday/kind idempotency; NULL for absence (uses session_id)
  provider_message_id TEXT, -- wamid from Graph API
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id) -- NULL for cron, auth.uid() for manual Pastoreo
);

COMMENT ON TABLE public.notification_log IS 'Audit + idempotency for every WhatsApp attempt; append-only';
COMMENT ON COLUMN public.notification_log.notification_date IS 'Bogota date (CURRENT_DATE AT TIME ZONE America/Bogota) for birthday dedup; NULL for absence';
```

### 2.4 `consent_records` — no DDL

Add application-level rows with `consent_type = 'whatsapp_messaging'` alongside `personal_data` / `sensitive_religious`. Columns `policy_version`, `accepted_at`, `ip_address` already exist. Insert on capture checkbox + bulk admin toggle (see §7).

### 2.5 Vault secrets & helper

```sql
-- Enable Vault extension (once, via Dashboard > Extensions or migration guard)
CREATE EXTENSION IF NOT EXISTS supabase_vault SCHEMA vault;

-- Secrets are created via SQL or Dashboard Vault UI (not in migration with literal values).
-- In design, name them; values are injected per environment.
-- Dev: Twilio sandbox / Meta test number; Prod: Business WABA number (D2 placeholder)
--   vault.create_secret('<token>', 'WHATSAPP_TOKEN', 'Meta system-user token')
--   vault.create_secret('<phone_number_id>', 'WHATSAPP_PHONE_NUMBER_ID', 'Meta phone_number_id — D2 pending')
--   vault.create_secret('<random>', 'CRON_SECRET', 'Shared secret for pg_cron / Vercel Cron auth')

-- Optional helper for Edge/DB access (service_role only) — mirrors docs/vault-setup.md get_decryption_key pattern
CREATE OR REPLACE FUNCTION public.get_whatsapp_secret(p_name TEXT) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = p_name $$;

REVOKE ALL ON FUNCTION public.get_whatsapp_secret(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_whatsapp_secret(TEXT) TO service_role;
-- Do NOT grant to anon/authenticated
```

Secrets are exposed to the Edge Function via `supabase secrets set` (Supabase CLI) which injects them as `Deno.env.get('WHATSAPP_TOKEN')`. The `vault.decrypted_secrets` lookup is a fallback for DB-side cron header construction if `current_setting('app.settings.service_role_key')` is not used.

### 2.6 `app_settings` keys (parametrizable without migration)

```sql
INSERT INTO public.app_settings (key, value) VALUES
  ('whatsapp_enabled', 'true'),
  ('whatsapp_monthly_cap', '900'),
  ('whatsapp_monthly_alert_at', '800'),
  ('whatsapp_phone_number_id', ''), -- placeholder for D2; Vault is primary, app_settings is fallback/readable flag
  ('whatsapp_cron_driver', 'pg_cron'), -- pg_cron | vercel
  ('pastoreo_chronic_threshold', '3'),
  ('pastoreo_chronic_lookback_days', '90')
ON CONFLICT (key) DO NOTHING;
```

All values are `TEXT` (existing `app_settings.value TEXT`); Edge reads and casts (`::int`). `whatsapp_enabled` is the kill switch (spec Non-Functional).

### 2.7 Indexes (create `CONCURRENTLY` — separate transaction / migration step)

```sql
-- Must run outside transaction or in dedicated migration that does not wrap in BEGIN/COMMIT.
-- Supabase CLI runs migrations in a transaction by default — use two-step: DDL in 012a, indexes CONCURRENTLY in 012b
-- with statement_timeout large.

-- Birthday daily scan — expression + partial
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_members_birthday_month_day
  ON public.members ((EXTRACT(MONTH FROM birthday)), (EXTRACT(DAY FROM birthday)))
  WHERE deleted_at IS NULL AND birthday IS NOT NULL;

-- Attendance hot path
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attendance_member_session
  ON public.attendance (member_id, session_id) WHERE deleted_at IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attendance_session
  ON public.attendance (session_id) WHERE deleted_at IS NULL;

-- Sessions by date
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_session_date
  ON public.sessions (session_date) WHERE deleted_at IS NULL;

-- Sex filter
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_members_sex
  ON public.members (sex) WHERE deleted_at IS NULL;

-- Notification dedup — idempotency (partial unique, exclude failed/skipped so retries allowed)
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_notification_log_dedup
  ON public.notification_log (session_id, member_id, kind)
  WHERE status IN ('sent','queued');

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_notification_log_birthday
  ON public.notification_log (member_id, kind, notification_date)
  WHERE kind = 'birthday' AND status IN ('sent','queued');

-- Per-recipient birthday dedup (digest is per staffer)
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_notification_log_birthday_recipient
  ON public.notification_log (member_id, recipient_profile_id, kind, notification_date)
  WHERE kind = 'birthday' AND status IN ('sent','queued');

-- Ops: monthly cap check (optional, helps count per month)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_log_sent_at_status
  ON public.notification_log (sent_at, status) WHERE status = 'sent';
```

`EXPLAIN ANALYZE` expectation: birthday scan → `Index Scan` on `idx_members_birthday_month_day`; Pastoreo aggregations → `Index Only Scan` / `Index Scan` (no `Seq Scan` at 1k members). Documented in Pastoreo design tests.

### 2.8 RLS, GRANTs, and views

**`notification_log` policies (spec §6.3 — normative):**

```sql
ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

-- Grants — explicit, per supabase skill rule 4
REVOKE ALL ON TABLE public.notification_log FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.notification_log TO authenticated;
-- No INSERT/UPDATE/DELETE grants to authenticated — writes are service_role only via Edge

CREATE POLICY notification_log_select ON public.notification_log
  FOR SELECT TO authenticated
  USING ((SELECT public.user_role()) IN ('super_admin','leader'));

-- No INSERT/UPDATE/DELETE policies for authenticated
-- service_role bypasses RLS for Edge writes (verified via Edge service_role key)
```

**Existing tables** — new columns inherit table policies; no new policies needed for `members`/`profiles` reads. `app_settings` update already `super_admin`-only (migration 001/006).

**Pastoreo views (if any) — `security_invoker` (PG15):**

```sql
-- Example: if a view is introduced for Pastoreo stats, it MUST be security_invoker
CREATE OR REPLACE VIEW public.v_pastoreo_stats
WITH (security_invoker = true) AS
SELECT
  CASE WHEN age_years IS NULL THEN NULL
       WHEN age_years < 13 THEN '0-12'
       WHEN age_years < 18 THEN '13-17'
       WHEN age_years < 26 THEN '18-25'
       WHEN age_years < 36 THEN '26-35'
       WHEN age_years < 51 THEN '36-50'
       ELSE '51+' END AS age_bucket,
  sex,
  COUNT(*) AS total_members
FROM public.members
WHERE deleted_at IS NULL
GROUP BY 1, 2;
-- RLS still enforced via underlying members policies; view adds no privilege escalation
```

Views that expose `birthday`/`sex` aggregations MUST also have a `SELECT` policy that denies `server` (predicate `public.user_role() IN ('super_admin','leader')`), so RLS — not just the Next.js guard — is the enforcement boundary.

### 2.9 Triggers — audit & `updated_at`

```sql
-- Audit: add notification_log to existing log_mutation coverage (spec traceability)
CREATE TRIGGER audit_notification_log
  AFTER INSERT OR UPDATE OR DELETE ON public.notification_log
  FOR EACH ROW EXECUTE FUNCTION public.log_mutation();

-- No updated_at trigger on notification_log (append-only, no updates except sent_at via Edge service_role)
```

`log_mutation()` is already `SECURITY DEFINER SET search_path=''` (migration 005/006 hardening) — reuse as-is.

---

## 3. API & Edge Function Design

### 3.1 Function identity

- **Path:** `supabase/functions/send-whatsapp/index.ts` (Supabase Edge Functions, Deno)
- **Runtime:** Deno (Supabase Edge), `npm:libphonenumber-js` for E.164, `npm:@supabase/supabase-js` for DB
- **Env:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `CRON_SECRET` — all from Vault/`supabase secrets` (never `NEXT_PUBLIC_*`)
- **Single egress:** All WhatsApp `POST https://graph.facebook.com/v20.0/{phone_number_id}/messages` calls go through this function. No client or cron SQL calls Graph API directly.

### 3.2 Auth (two modes — spec API contract)

| Caller | Header | Verification | RLS effect | `notification_log.created_by` |
| --- | --- | --- | --- | --- |
| `pg_cron`/`pg_net` (service_role) | `Authorization: Bearer <service_role_jwt>` + `x-cron-secret: <CRON_SECRET>` | Verify `x-cron-secret` equals `get_whatsapp_secret('CRON_SECRET')` or `Deno.env.get('CRON_SECRET')`; also verify JWT is `service_role` via `supabase.auth.getClaims()` | `service_role` bypasses RLS — can INSERT `notification_log` | `NULL` |
| `/api/cron/daily-digest` (Vercel fallback) | Same `x-cron-secret` | Same check | Same | `NULL` |
| Pastoreo manual `shepherding_checkin` | `Authorization: Bearer <user_jwt>` (from `createClient()` session) | `supabase.auth.getUser(token)` / `getClaims()`; enforce `public.user_role() IN ('super_admin','leader')` for `shepherding_checkin` | Authenticated — Edge uses `service_role` client internally for writes (so manual still writes despite RLS) | `auth.uid()` |

`anon` → `401` with no DB writes. Missing/invalid `x-cron-secret` → `401`.

### 3.3 Request / Response shapes (normative — spec API contract)

**Cron request:**

```json
{ "kind": "absence" | "birthday" | "shepherding_checkin",
  "session_id": "uuid (optional — if omitted scan yesterday sessions)",
  "dry_run": false,
  "triggered_by": "cron" | "manual" }
```

**Manual Pastoreo request:**

```json
{ "kind": "shepherding_checkin",
  "member_ids": ["uuid", "..."],          // 1..50 per call (validated)
  "template_name": "shepherding_checkin",
  "custom_params": { "community_name": "Iglesia ..." } }
```

**Success response — always HTTP 200 for cron (avoid `pg_net` retry storms; errors in body):**

```json
{ "ok": true,
  "kind": "absence",
  "sessions_processed": 1,
  "attempted": 42,
  "sent": 30,
  "skipped_no_consent": 8,
  "skipped_invalid_phone": 3,
  "skipped_duplicate": 1,
  "skipped_cap": 0,
  "failed": 0,
  "errors": [{ "member_id": "uuid", "error": "..." }],
  "provider": "meta_cloud_api",
  "dry_run": false }
```

**Error taxonomy (body, not HTTP 5xx unless auth failure):**

| Condition | HTTP | Body signal | Handling |
| --- | --- | --- | --- |
| Missing/invalid JWT / `x-cron-secret` | 401 | `{ ok:false, error:"unauthorized" }` | Reject, no DB writes |
| `whatsapp_enabled='false'` (kill switch) | 200 | `skipped_cap` + `error='whatsapp disabled'` | Early return, no provider calls |
| Missing `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` (D2 pending) | 200 | `failed` + `error='missing whatsapp credentials — D2 pending'` | No provider calls; Pastoreo banner "WhatsApp not configured" |
| Monthly cap exceeded (`sent` in calendar month ≥ 900) | 200 | `skipped_cap` | No provider calls; banner |
| Provider 400 (invalid template params / phone) | 200 | `failed` + provider error in `notification_log.error` | Recorded, not retried automatically |
| Provider 429 (rate limit) | 200 | `failed` + `error` with retry hint | Retryable next cron (row is `failed`, not covered by dedup index) |
| Phone invalid / fails E.164 | 200 | `skipped_invalid_phone` | No provider call |

### 3.4 Batching, idempotency, retries, rate limiting

- **Batching:** Inputs `>50` are chunked into batches of 50 (Meta practical limit + Edge 10s timeout — proposal R10). Chunks are sequential; per-chunk latency budget `<5s`; total job `<30s`. Pastoreo manual call with 120 `member_ids` → 3 chunks `50/50/20`, aggregated counts returned.
- **Idempotency:** Before each `POST` to Graph API, Edge does `SELECT 1 FROM notification_log WHERE <dedup key> AND status IN ('sent','queued')`. If exists → `skipped_duplicate`, no provider call. Dedup keys: `(session_id, member_id, kind)` for `absence`/`shepherding_checkin`; `(member_id, recipient_profile_id, kind, notification_date)` for `birthday` (per-recipient). Unique partial indexes enforce this at DB level as second line of defense.
- **Retries:** `failed` rows are retryable on next cron (unique index excludes `failed`). No in-function retry loop — next cron invocation retries. `sent`/`queued` are never retried.
- **Rate limiting:** Meta Cloud API per-`phone_number_id` throughput (tiered, starts ~1k msgs/day). Edge enforces chunk sequentiality + 50-per-call cap; no parallel fan-out. `429` is captured as `failed` with backoff via next cron (no busy loop).
- **Dry run:** `dry_run=true` runs all gates and logs `skipped_*` / `would_send` without calling Graph API — used for dev/Twilio sandbox validation and for D2-missing dev flows.

### 3.5 Phone normalization & provider call

```ts
// Pseudocode contract for Edge (Deno)
import { parsePhoneNumberFromString } from 'npm:libphonenumber-js';

function normalizeE164(raw: string | null): string | null {
  if (!raw) return null;
  const parsed = parsePhoneNumberFromString(raw, 'CO');
  if (!parsed || !parsed.isValid()) return null;
  const e164 = parsed.format('E.164'); // +57...
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) return null;
  if (!e164.startsWith('+57')) return null; // Colombia scope; log warning if not +57 but still E.164
  return e164;
}

// Graph API call
// POST https://graph.facebook.com/v20.0/{phone_number_id}/messages
// Headers: Authorization: Bearer ${WHATSAPP_TOKEN}, Content-Type: application/json
// Body for absence:
// { messaging_product:"whatsapp", to: e164, type:"template",
//   template:{ name:"absence_followup", language:{code:"es_CO"}, components:[{type:"body", parameters:[{type:"text", text: memberName},{type:"text", text: sessionName},{type:"text", text: ddMMyyyy}]}] } }
// Response: { messages:[{id:"wamid...."}] } → store as provider_message_id
```

### 3.6 Observability

Structured logs (JSON) per attempt: `{ kind, member_id, session_id, template_name, status, provider_message_id, latency_ms, error }` via `console.log(JSON.stringify(...))` (Supabase Edge logs). Every attempt also has a `notification_log` row — logs are ephemeral, `notification_log` is durable.

### 3.7 Contract for `pg_net.http_post` & manual Pastoreo call

- **From `pg_cron`:** `SELECT net.http_post(url := 'https://<project>.supabase.co/functions/v1/send-whatsapp', headers := '{"Content-Type":"application/json","Authorization":"Bearer '|| get_whatsapp_secret('SERVICE_ROLE_KEY') ||'","x-cron-secret":"'|| get_whatsapp_secret('CRON_SECRET') ||'"}'::jsonb, body := '{"kind":"absence"}'::jsonb);` — two sequential calls (absence then birthday) in same cron tick; `pg_net` is async fire-and-forget, Edge is authoritative.
- **From Pastoreo UI:** `supabase.functions.invoke('send-whatsapp', { body: { kind:'shepherding_checkin', member_ids:[...], template_name:'shepherding_checkin' } })` under authenticated `leader`/`super_admin` JWT — Edge verifies role and sets `created_by`.

---

## 4. Cron & Scheduling Design

### 4.1 Recommendation: 1 consolidated job (fits 400-line budget, Hobby-safe)

**One daily-digest job** that sequentially handles both automations (absence first, then birthday) at `0 12 * * *` UTC (= 07:00 America/Bogota). Two separate jobs are equivalent functionally but cost an extra cron slot; Vercel Hobby allows 2 crons so consolidation avoids slot pressure (proposal D10, spec Cron & Scheduling). If the team later wants independent retry per kind, splitting into two jobs is a one-line `cron.schedule` change without migration.

**DDK schedule (primary — `pg_cron` + `pg_net`):**

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Idempotent: unschedule if exists, then schedule
SELECT cron.unschedule('daily-digest') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='daily-digest');

SELECT cron.schedule(
  'daily-digest',
  '0 12 * * *', -- 12:00 UTC = 07:00 America/Bogota (UTC-5, no DST)
  $$
  SELECT net.http_post(
    url := 'https://<project>.supabase.co/functions/v1/send-whatsapp',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SERVICE_ROLE_KEY'),
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='CRON_SECRET')
    ),
    body := '{"kind":"absence","triggered_by":"cron"}'::jsonb
  );
  SELECT net.http_post(
    url := 'https://<project>.supabase.co/functions/v1/send-whatsapp',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SERVICE_ROLE_KEY'),
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='CRON_SECRET')
    ),
    body := '{"kind":"birthday","triggered_by":"cron"}'::jsonb
  );
  $$
);
```

**Fallback (`vercel.json`):**

```json
{ "crons": [{ "path": "/api/cron/daily-digest", "schedule": "0 12 * * *" }] }
```

Route handler `POST /api/cron/daily-digest` verifies `Authorization: Bearer <CRON_SECRET>` (constant-time compare), then calls the same Edge Function twice with `service_role` key. Contract and idempotency identical to `pg_cron` path.

### 4.2 Reference queries (normative — spec Cron & Scheduling)

**Sessions needing notification (yesterday, Bogota-anchored):**

```sql
SELECT s.id, s.name, s.session_date
FROM public.sessions s
WHERE s.deleted_at IS NULL
  AND s.session_date = (CURRENT_DATE AT TIME ZONE 'America/Bogota') - INTERVAL '1 day'
  AND NOT EXISTS (
    SELECT 1 FROM public.notification_log nl
    WHERE nl.session_id = s.id AND nl.kind = 'absence' AND nl.status IN ('sent','queued')
  );
```

**Absentees per session (anti-join — explore §4.2 / spec):**

```sql
SELECT m.id, m.name, COALESCE(wn.number, m.phone) AS wa_number
FROM public.members m
LEFT JOIN public.attendance a
  ON a.member_id = m.id AND a.session_id = :sid AND a.deleted_at IS NULL
LEFT JOIN public.whatsapp_numbers wn
  ON wn.member_id = m.id AND wn.is_primary_phone AND wn.deleted_at IS NULL
WHERE m.deleted_at IS NULL
  AND a.id IS NULL;
```

**Birthdays today (including Feb 29 → Feb 28 in non-leap years, spec D9):**

```sql
-- Helper: is_leap_year(y int) boolean — inline or SQL function
-- is_leap_year(y) = (y % 4 = 0 AND y % 100 <> 0) OR (y % 400 = 0)

SELECT m.id, m.name, m.birthday, EXTRACT(YEAR FROM age(m.birthday))::int AS age_today
FROM public.members m
WHERE m.deleted_at IS NULL
  AND m.birthday IS NOT NULL
  AND (
    (EXTRACT(MONTH FROM m.birthday) = EXTRACT(MONTH FROM CURRENT_DATE AT TIME ZONE 'America/Bogota')
     AND EXTRACT(DAY FROM m.birthday) = EXTRACT(DAY FROM CURRENT_DATE AT TIME ZONE 'America/Bogota'))
    OR (
      EXTRACT(MONTH FROM m.birthday) = 2 AND EXTRACT(DAY FROM m.birthday) = 29
      AND NOT is_leap_year(EXTRACT(YEAR FROM CURRENT_DATE AT TIME ZONE 'America/Bogota')::int)
      AND EXTRACT(MONTH FROM CURRENT_DATE AT TIME ZONE 'America/Bogota') = 2
      AND EXTRACT(DAY FROM CURRENT_DATE AT TIME ZONE 'America/Bogota') = 28
    )
  );
```

**Timezone invariant:** Every `CURRENT_DATE` / `now()` comparison is wrapped as `(CURRENT_DATE AT TIME ZONE 'America/Bogota')` or `now() AT TIME ZONE 'America/Bogota'`. `sessions.session_date` is `DATE` (tz-naive) so the cron must anchor to Bogota, not UTC. Migration comments MUST document this.

### 4.3 Monitoring

- **Primary:** `cron.job_run_details` (Supabase `pg_cron` history) + `net._http_response` (for `pg_net` outcomes) — `super_admin` queryable.
- **Durable:** `notification_log` counts per day (`GROUP BY kind, status, notification_date`) — surfaced in Pastoreo monitoring strip.
- **Edge logs:** structured JSON (see §3.6) — Supabase Dashboard > Edge Functions > Logs.
- **Monthly cap:** `SELECT COUNT(*) FROM notification_log WHERE status='sent' AND date_trunc('month', sent_at)=date_trunc('month', now())` — checked before each send; cap 900, alert 800 via Pastoreo banner + `notification_log` `skipped_cap`.

### 4.4 Cap 900 conversations/month note

Meta's 1,000 free service conversations/month (proposal §3.1) is a Meta-side counter; the project's 900 cap is a conservative local guard (leaves 100 headroom). At ~200 msgs/month the project stays at $0 for 5+ months.

---

## 5. Pastoreo Module Design — `/(dashboard)/pastoreo`

### 5.1 Route & access

- **Path:** `/(dashboard)/pastoreo` (Spanish, matches domain language per spec US3).
- **Layout:** Uses existing `src/app/(dashboard)/layout.tsx` sidebar (add nav item `Pastoreo` with icon `HeartHandshake` or `Users`, gated by `canViewPastoreo(role)` helper — new RBAC helper, `super_admin`+`leader` only).
- **Access enforcement:** Two layers — Next.js route guard (UX, redirects `server` with insufficient-permission notice) + Postgres RLS (enforcement, `server` gets zero rows from any Pastoreo view/table — predicate `public.user_role() IN ('super_admin','leader')`). RLS is authoritative; guard is convenience.

### 5.2 Server vs Client Components

| Piece | Component type | Why |
| --- | --- | --- |
| Page shell, KPI cards, chronic table data fetch, birthday list, monitoring strip | **Server Components** (async `createClient()` from `@/lib/supabase/server`, RLS-aware, no client secret) | RLS enforcement, no bundle cost, `security_invoker` views evaluated as authenticated user, timezone-safe server date |
| Filters (age_bucket multi-select, sex multi-select, date range preset+custom, tab switch Resumen/Ausentes crónicos/Cumpleaños) | **Client islands** (`'use client'`, `nuqs` or `useSearchParams` + `useRouter`) | URL-synced state, instant UX, re-fetches Server Components via `router.refresh()` or `use()` pattern |
| Export button, Notify via WhatsApp button | Client (calls SheetJS + `supabase.functions.invoke`) | Client-side file download + authenticated Edge call |
| Charts (bar by age bucket / sex / week) | Client (recharts or existing chart lib) fed by Server-fetched data | Interactivity without server round-trip |

No new Dexie version for Pastoreo v1 — Pastoreo reads are server-side only (spec Data Contracts). Offline cache for Pastoreo is deferred.

### 5.3 Filters & tabs

**Filters (spec US3):**

| Filter | Control | Source | Default |
| --- | --- | --- | --- |
| `age_bucket` | Multi-select chips | Derived `age_years` via `CASE` (see §4.2 age bucket) | All |
| `sex` | Multi-select | `members.sex` (nullable → "No especificado" bucket) | All |
| `date range` | Preset (last 4/8/12 weeks) + custom `from`/`to` | `sessions.session_date BETWEEN :from AND :to` | Last 12 weeks |
| Tab | `Resumen` \| `Ausentes crónicos` \| `Cumpleaños` | — | Resumen |

Filter values are URL params (`?age=18-25,26-35&sex=F&from=2026-05-01&to=2026-08-01&tab=cronicos`). Server Components parse them server-side; queries include them as `WHERE` predicates (not client-filtered subsets — spec US3 Filters scenario).

**Tabs:**

- **Resumen:** KPI cards (total active members, attendance rate, avg per session) + bar chart by age bucket + by sex + by week. Data from Server Components with the filter predicates.
- **Ausentes crónicos:** Table with `name, age (from age_years), sex, last_attended_date, missed_streak, wa_number (masked last 4), actions (Notify, View history)`. Data from chronic query (§5.4).
- **Cumpleaños:** Upcoming birthdays next 30 days + completeness warning `"N members without birthday"` with link to `/members` data-quality view.

### 5.4 Chronic-absentee query (parametrized, window-function — explore §5.2 session-order variant)

Tunable via `app_settings.pastoreo_chronic_threshold` (default 3) and `pastoreo_chronic_lookback_days` (default 90). No migration to retune.

```sql
-- Chronic absentees: ≥1 attendance in last :lookback_days, then ≥:threshold consecutive misses by session_date order
WITH params AS (
  SELECT
    COALESCE(NULLIF((SELECT value FROM public.app_settings WHERE key='pastoreo_chronic_threshold'), ''), '3')::int AS threshold,
    COALESCE(NULLIF((SELECT value FROM public.app_settings WHERE key='pastoreo_chronic_lookback_days'), ''), '90')::int AS lookback_days
),
ordered_sessions AS (
  SELECT id, session_date, ROW_NUMBER() OVER (ORDER BY session_date) AS rn
  FROM public.sessions, params
  WHERE deleted_at IS NULL
    AND session_date >= (CURRENT_DATE AT TIME ZONE 'America/Bogota') - (SELECT lookback_days FROM params) * INTERVAL '1 day'
),
member_last_attendance AS (
  SELECT a.member_id, MAX(s.session_date) AS last_attended_date, MAX(s.rn) AS last_attended_rn
  FROM public.attendance a
  JOIN ordered_sessions s ON s.id = a.session_id
  WHERE a.deleted_at IS NULL
  GROUP BY a.member_id
),
missed_streak AS (
  SELECT mla.member_id, COUNT(os.id) AS missed_count
  FROM member_last_attendance mla
  JOIN ordered_sessions os ON os.rn > mla.last_attended_rn
  LEFT JOIN public.attendance a ON a.member_id = mla.member_id AND a.session_id = os.id AND a.deleted_at IS NULL
  WHERE a.id IS NULL
  GROUP BY mla.member_id
)
SELECT m.id, m.name, m.birthday, m.sex, m.age_years,
       mla.last_attended_date, ms.missed_count,
       COALESCE(wn.number, m.phone) AS wa_number
FROM missed_streak ms
JOIN member_last_attendance mla ON mla.member_id = ms.member_id
JOIN public.members m ON m.id = ms.member_id
LEFT JOIN public.whatsapp_numbers wn ON wn.member_id = m.id AND wn.is_primary_phone AND wn.deleted_at IS NULL
CROSS JOIN params
WHERE m.deleted_at IS NULL
  AND ms.missed_count >= (SELECT threshold FROM params)
ORDER BY ms.missed_count DESC, mla.last_attended_date ASC;
```

`NULL` `sex` rows are included and displayed as "No especificado". `age_years` is used for the age bucket `CASE` in the Resumen tab.

### 5.5 Export

Reuse `src/lib/export` + `xlsx` (SheetJS) client-side pattern from `/export`. Columns: `name, age, sex, last_attended_date, missed_streak, wa_number(masked last 4)`. `birthday`/`sex` raw values excluded from default export unless `super_admin` checks an explicit "Include sensitive fields" checkbox (audit note logged — Ley 1581 purpose limitation, spec US3 Export scenario).

### 5.6 "Notify via WhatsApp" (manual `shepherding_checkin`)

Client button → `supabase.functions.invoke('send-whatsapp', { body: { kind:'shepherding_checkin', member_ids:[...], template_name:'shepherding_checkin', custom_params:{community_name} } })` under `leader`/`super_admin` JWT. Edge gates on consent/phone/cap, writes `notification_log` with `created_by = auth.uid()`, returns per-row `sent/skipped/failed` — UI surfaces toast + inline row status. Batch >50 auto-chunks.

### 5.7 RBAC helper (new)

```ts
// src/lib/rbac/guards.ts — add
export function canViewPastoreo(role: AppRole): boolean {
  return role === 'super_admin' || role === 'leader';
}
// src/app/(dashboard)/pastoreo/page.tsx — Server Component guard
// if (!canViewPastoreo(role)) redirect('/dashboard?error=insufficient-permission')
```

### 5.8 RLS for Pastoreo

No new `SELECT` policies needed for `members`/`attendance`/`sessions` reads — existing `members_select` etc. already allow `leader`+`super_admin`. For any new view that exposes `birthday`/`sex` aggregations, add `WITH (security_invoker=true)` and ensure the underlying table policies already restrict `server` (or add a view-level predicate `public.user_role() IN ('super_admin','leader')`).

### 5.9 How it is tested (EXPLAIN expectations)

- `EXPLAIN ANALYZE` on birthday scan and Pastoreo aggregations MUST show `Index Scan` / `Index Only Scan` on `idx_members_birthday_month_day`, `idx_attendance_member_session`, `idx_sessions_session_date` — not `Seq Scan` at 1k members / 1k sessions. Test via Vitest `EXPLAIN` sanity (see §11).
- Playwright: `server` gets 403/insufficient-permission; `leader`/`super_admin` see Resumen, filters mutate URL, chronic table matches threshold, export downloads `.xlsx`.

---

## 6. WhatsApp Integration Design

### 6.1 Templates (3 — utility, `es_CO`)

| # | `template_name` | Language | Category | Recipient | Variables | Pastoral copy (ES — pending pastoral approval per proposal D5) |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | `absence_followup` | `es_CO` | Utility | Absent member | `{{1}}=member name`, `{{2}}=session name`, `{{3}}=session_date DD/MM/YYYY` | `Hola {{1}}, te extrañamos ayer en {{2}} ({{3}}). ¿Cómo estás? Oramos por ti. Si necesitas algo, responde a este mensaje. 🙏` |
| T2 | `birthday_staff_digest` | `es_CO` | Utility | Staff (group digest, one per staffer per day) | `{{1}}=comma-separated "Juan (35), María (40)"` | `🎂 Hoy cumplen años: {{1}}. ¡Oremos y celebremos con ellos!` |
| T3 | `shepherding_checkin` | `es_CO` | Utility | Chronic absentee (manual from Pastoreo) | `{{1}}=name`, `{{2}}=community name` | `Hola {{1}}, somos de {{2}}. Hace un tiempo no te vemos y queríamos saber cómo estás. ¿Podemos orar por algo?` |

All `utility` (not `marketing`) to stay in lowest billable tier. Submit T1+T2 before Phase 1, T3 before Phase 3. Meta review typically <1 hour for utility.

### 6.2 Placeholders & formatting

- T1 `{{3}}` is `session_date` formatted `DD/MM/YYYY` in Bogota locale (`toLocaleDateString('es-CO', { timeZone:'America/Bogota' })`).
- T2 `{{1}}` is built as `celebrants.map(c =>`${c.name} (${c.age_today})`).join(', ')` with `age_today = EXTRACT(YEAR FROM age(birthday))::int` on Bogota date.

### 6.3 Approval flow

1. Draft templates in Meta Business Manager > WhatsApp Manager > Message Templates.
2. Submit as `utility` with `es_CO` language and variable samples.
3. Dev uses Twilio sandbox or Meta test number with sandbox templates (no approval needed for test number).
4. Prod approval blocked until D2 Business number / WABA is delivered — not a design blocker.

### 6.4 How D2 pending affects prod

- **Dev:** `WHATSAPP_PHONE_NUMBER_ID` placeholder + Twilio sandbox / Meta test number — Edge `dry_run=true` succeeds without prod creds.
- **Prod:** If `WHATSAPP_TOKEN` or `WHATSAPP_PHONE_NUMBER_ID` is missing/empty and `whatsapp_enabled=true`, Edge returns `failed` with `error='missing whatsapp credentials — D2 pending'` and `notification_log` rows are `failed`; Pastoreo shows banner "WhatsApp not configured — D2 pending (contact client for Business number)". No provider calls are made (fail-closed). No migration is needed to inject — Vault + `app_settings.whatsapp_phone_number_id` update + `supabase secrets set` + Edge redeploy is sufficient.

---

## 7. Security & Compliance Design

### 7.1 Ley 1581 triple gate (every send)

```
Gate: members.whatsapp_opt_in = true
   AND whatsapp_opt_out_at IS NULL
   AND EXISTS (SELECT 1 FROM consent_records
               WHERE member_id = :id AND consent_type = 'whatsapp_messaging')
   -- Staff variant: profiles.whatsapp_opt_in + profiles.whatsapp_number IS NOT NULL + consent_records for profile member
```

No row → `skipped_no_consent` (auditable). `whatsapp_opt_out_at IS NOT NULL` blocks even if `opt_in=true` and consent row exists. Revocation: `UPDATE members SET whatsapp_opt_out_at = now()` (Pastoreo action or `/members` edit); re-opt-in clears `whatsapp_opt_out_at` and requires a new `consent_records` row.

### 7.2 Phone E.164 normalization

- **Library:** `libphonenumber-js` (already the spec's choice; add `npm:libphonenumber-js` to Edge + `libphonenumber-js` to Next.js — no native `pg_libphonenumber` extension needed).
- **On write:** Zod `z.string().transform(v => parsePhoneNumberFromString(v,'CO')?.format('E.164') ?? v).refine(isValidE164)` — store `+57…`.
- **Before send:** re-normalize in Edge (authoritative) — see §3.5. Invalid → `skipped_invalid_phone` with `error` describing failure.
- **DB guard:** `CHECK (whatsapp_number ~ '^\+[1-9]\d{7,14}$')` on `profiles.whatsapp_number` (members phone has no CHECK to avoid blocking existing data — validated at app layer).

### 7.3 Vault-only secrets

All `WHATSAPP_*` + `CRON_SECRET` + `SUPABASE_SERVICE_ROLE_KEY` (for cron header) live in Vault only, exposed to Edge via `supabase secrets` / `Deno.env.get`. Never `NEXT_PUBLIC_*` or client bundle. Rotation: Vault update + Edge redeploy, no code change. Verify via `SELECT name FROM vault.decrypted_secrets` (service_role only).

### 7.4 Audit log

- `notification_log` rows are the send audit (SIC evidence).
- `consent_records` rows are the consent audit.
- `audit_log` trigger `log_mutation()` already covers `members`/`profiles`/`attendance`/`consent_records`; add `notification_log` to coverage (§2.9).
- ARCO workflow (`arco_requests`) is unchanged — the channel for data-subject rights.

### 7.5 Data minimization

- `sex` allows `prefer_not_to_say` and is excluded from default Pastoreo export.
- Pastoreo UI masks `wa_number` to last 4 (`***1234`); full E.164 only in server-side Edge logs with `super_admin`-gated viewer.
- RLS denies `server` on any view exposing `birthday`/`sex` aggregations.

---

## 8. Observability & Ops

### 8.1 `notification_log` dashboard (Pastoreo monitoring strip for `super_admin`)

Queries (Server Component, RLS-aware):

```sql
-- Today's counts by status
SELECT status, COUNT(*) FROM public.notification_log
WHERE created_at::date = (CURRENT_DATE AT TIME ZONE 'America/Bogota')
GROUP BY status;

-- Monthly sent vs cap
SELECT COUNT(*) AS sent_this_month FROM public.notification_log
WHERE status='sent' AND date_trunc('month', sent_at)=date_trunc('month', now());

-- Last cron run (from pg_cron)
SELECT jobname, start_time, end_time, status FROM cron.job_run_details
WHERE jobname='daily-digest' ORDER BY start_time DESC LIMIT 5;
-- Fallback if cron.job_run_details unavailable: SELECT * FROM cron.job WHERE jobname='daily-digest'
```

UI: strip shows `today sent / skipped / failed / cap 900` + `last cron: 2026-08-24 07:00 Bo ✓` + banner at `800/900` ("cap approaching") and at `900/900` ("cap reached — sends paused"). Also banner when `whatsapp_enabled=false` or creds missing.

### 8.2 Cron health check

`cron.job_run_details` is the source of truth for `pg_cron` runs; `net._http_response` for `pg_net` outcomes (self-host). Edge structured logs are the per-message trail. A failed cron run (status `failed`) is surfaced as a Pastoreo error banner; next cron retries failed rows.

### 8.3 Monthly conversation counter

`app_settings.whatsapp_monthly_cap` (900) + `whatsapp_monthly_alert_at` (800) — Edge counts `sent` in current calendar month before sending; cap exceeded → `skipped_cap` for every candidate, Pastoreo banner. Counter is derived from `notification_log` (no separate counter table — avoids drift).

### 8.4 Alert at 800

When `sent_this_month >= 800`, Pastoreo shows `Banner variant="warning"` for `super_admin` (and optionally `leader`). At `900`, sends are hard-blocked (`skipped_cap`) and banner is `variant="destructive"`.

### 8.5 Edge cases

| Case | Handling |
| --- | --- |
| Phone invalid / `NULL` | `skipped_invalid_phone`, no provider call, `error` describes validation failure |
| `birthday IS NULL` | Excluded from birthday scan; counted in Cumpleaños completeness warning `"N members without birthday"` |
| Offline sync delay (Dexie not yet flushed at 07:00) | Known limitation (proposal R6) — 07:00 window gives overnight sync; over-inclusive absentee list is possible; future `session_attendance_finalized` flag is a non-blocking enhancement (no spec change) |
| Feb 29 in non-leap year | Matched on Feb 28 via `OR` clause (§4.2); leap year matched on Feb 29 only |
| Zero attendance rows for session | All active members considered absent (anti-join returns all) — intentional per spec US1; Edge logs warning when `attendance` count for session is 0 |
| Deleted session | Excluded via `sessions.deleted_at IS NULL` |
| `age_years` NULL (birthday null) | Bucket `NULL` → displayed as "Sin fecha de nacimiento" or excluded from age chart; not a filter error |

---

## 9. Alternatives & Tradeoffs

| Decision | Chosen | Alternative | Why chosen / why discarded |
| --- | --- | --- | --- |
| Scheduler: `pg_cron`+`pg_net`+Edge primary | `pg_cron`+`pg_net` → Edge | `Vercel Cron` primary; `AFTER INSERT ON attendance` trigger; GitHub Actions `schedule` | `pg_cron` already used for purge jobs (001), no new hosting, tz-aware, transactional, idempotent via `notification_log`. Vercel Hobby allows 2 crons (consolidation needed) and has cold start; kept as fallback. `AFTER INSERT` trigger fires N times for batch attendance, couples hot path to network, no retry — explicitly rejected (proposal §11). GitHub Actions is indirect and 5-min granularity. |
| Edge vs Vercel Route Handler for WhatsApp egress | Supabase Edge Function `send-whatsapp` | Vercel Route Handler `/api/send-whatsapp` | Edge lives next to Vault and `pg_net`; Vercel handler would need to duplicate Vault access and is already used only as the fallback's caller. Single egress keeps audit in one place. |
| Generated column `age_years` vs view vs app math | `GENERATED ALWAYS AS (...) STORED` | View `v_members_with_age`; app-side `age()` per query | Generated column is indexable for bucketing, computed once on write, works with `CASE` without repetitive `age()` math (explore §2.7). View adds a join/overhead and is not indexable for bucketing. App math duplicates logic. PG15 supports `STORED` generated columns. |
| `profiles.whatsapp_number` vs `auth.users.phone` | `profiles.whatsapp_number TEXT` | `auth.users.phone` join | See §2.2 justification — `auth.users` is not RLS-controllable and not reliably populated. |
| Materialized view for Pastoreo | Deferred (plain indexed queries) | `MATERIALIZED VIEW mv_pastoreo_stats` + `REFRESH CONCURRENTLY` via cron | At 100–1k members and <1k sessions, plain queries with the 5 indexes stay <100ms (`EXPLAIN ANALYZE` to verify). MV adds refresh complexity and staleness for no gain now (proposal N4, D11, spec Pastoreo Queries). Add only when `EXPLAIN ANALYZE` proves need at >10k members. |
| Group digest vs per-celebrant birthday messages | One group digest per staffer per day (`"Ana (40), Luis (22)"`) | One message per celebrant per staffer | Digest keeps cost at 1 conversation per staffer per day (G6 zero-cost), within 1,000 free conversations/month. Per-celebrant multiplies cost by celebrant count. |
| `libphonenumber-js` vs `pg_libphonenumber` | `libphonenumber-js` (app + Edge) | Postgres `pg_libphonenumber` extension | `libphonenumber-js` is pure JS, no DB extension, works in both Next.js and Deno Edge; `pg_libphonenumber` requires extension enablement and is not in the current Supabase extension surface. |

---

## 10. Dependencies & Sequencing

### 10.1 Migration order (012 — additive, safe to apply on prod with live traffic)

1. **012a — columns + table + app_settings + Vault enablement** (transactional):
   - `ALTER TABLE members` (`sex`, `age_years`, `whatsapp_opt_in`, `whatsapp_opt_out_at`)
   - `ALTER TABLE profiles` (`whatsapp_number`, `whatsapp_opt_in`)
   - `CREATE TABLE notification_log` + `audit_notification_log` trigger
   - `INSERT app_settings` keys
   - `CREATE EXTENSION IF NOT EXISTS supabase_vault`
   - Comments on columns/tables
2. **012b — indexes `CONCURRENTLY`** (non-transactional, separate migration file or manual `psql` step — must not be wrapped in the same transaction as 012a):
   - All 7 indexes from §2.7 with `CONCURRENTLY`
3. **012c — RLS** (transactional, after 012a):
   - `ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY` + `notification_log_select` policy + `REVOKE`/`GRANT`
   - Any `security_invoker` views for Pastoreo (if introduced)
4. **Infra — extensions** (Dashboard > Database > Extensions or `CREATE EXTENSION IF NOT EXISTS pg_cron; CREATE EXTENSION IF NOT EXISTS pg_net;` — idempotent):
   - Enable `pg_cron` + `pg_net` (verify via `SELECT * FROM pg_extension WHERE extname IN ('cron','pg_net')`)
5. **Vault secrets** (no migration — Vault UI or `SELECT vault.create_secret(...)`):
   - `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` (D2 placeholder), `CRON_SECRET`, `SERVICE_ROLE_KEY` reference
6. **Edge Function** (`supabase/functions/send-whatsapp`):
   - Deploy via `supabase functions deploy send-whatsapp --no-verify-jwt` (Edge verifies JWT itself) + `supabase secrets set WHATSAPP_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=... CRON_SECRET=...`
7. **Cron** (`pg_cron` daily-digest + Vercel fallback `vercel.json` + `/api/cron/daily-digest`):
   - After Edge is deployed and Vault secrets exist

### 10.2 What blocks D2 and what does not

- **Blocks prod template approval:** Meta Business verification + real `WHATSAPP_PHONE_NUMBER_ID` — only prod sends are blocked. Dev/staging use Twilio sandbox or Meta test number (no verification).
- **Does NOT block:** migrations, indexes, RLS, Pastoreo UI, Edge Function, `pg_cron` wiring, or dev E2E — all work with placeholder `WHATSAPP_PHONE_NUMBER_ID = ''` (Edge fails closed with banner).
- **How D2 is injected without migration:** Update Vault `WHATSAPP_PHONE_NUMBER_ID` + `app_settings.whatsapp_phone_number_id` (optional readable flag) + `supabase secrets set WHATSAPP_PHONE_NUMBER_ID=<real>` + redeploy Edge Function (picks up new env). No DDL.

### 10.3 Runtime ordering at 07:00 Bo

`daily-digest` fires → `absence` job first (scans `session_date = yesterday`) → `birthday` job second (scans `birthday MM-DD = today`). Order is fixed so a member who was absent yesterday and has birthday today gets both messages (two `notification_log` rows, different `kind`).

---

## 11. Testing Strategy (`strict_tdd: true` — `npx vitest` + `npx playwright test` green required)

### 11.1 Unit — Vitest (`src/**/__tests__/**/*.test.{ts,tsx}`, `jsdom`)

| Area | What to test | Spec trace |
| --- | --- | --- |
| E.164 normalization | `libphonenumber-js` wrapper: valid `+573001234567`, invalid `+57 300-abc`, `NULL`, landline, `CO` default region, `^\+[1-9]\d{7,14}$` regex | US1 Invalid phone, Non-Functional phone normalization |
| Consent gate | Triple gate helper: `whatsapp_opt_in=false` → block, `opt_out_at` set → block, no `consent_records` → `skipped_no_consent`, all pass → allow | US1 Consent gate, Ley 1581 |
| Idempotency | Re-run with existing `sent`/`queued` row → `skipped_duplicate`, no provider call; `failed` row → retryable | US1 Idempotency, US2 Duplicate suppression |
| Timezone | `session_date = (CURRENT_DATE AT TIME ZONE 'America/Bogota') - INTERVAL '1 day'` correctness at UTC boundary (Saturday 2026-08-23 → Sunday 2026-08-24 12:00 UTC) | US1 Timezone correctness, Cron Timezone invariant |
| Age buckets | `CASE` bucketing: `age_years` 5→`0-12`, 15→`13-17`, 22→`18-25`, 30→`26-35`, 40→`36-50`, 60→`51+`, `NULL`→`NULL` | US3 Filters, Pastoreo Queries |
| Birthday MM-DD scan | Month/day match + Feb 29 on Feb 28 non-leap + `birthday IS NULL` excluded + `is_leap_year` helper | US2 Feb 29, Birthday null |
| Digest grouping | `celebrants → "Ana (40), Luis (22)"` formatting with `age_today` on Bogota date | US2 Happy path group digest, Templates |
| Cap enforcement | Monthly `COUNT(*) WHERE status='sent' AND date_trunc('month', sent_at)=...` ≥ 900 → `skipped_cap`; 800 → alert | Non-Functional cap, Cron cap |
| Batch chunking | 120 `member_ids` → 3 chunks 50/50/20, aggregated counts | API Batching |
| Pastoreo RBAC helper | `canViewPastoreo('super_admin')=true`, `leader=true`, `server=false` | Actors matrix |

### 11.2 RLS — Vitest (Supabase RLS tests, `supabase-js` with `anon`/`authenticated` keys against local Supabase)

- `notification_log` SELECT: `super_admin`/`leader` get rows, `server` gets 0 rows, `anon` gets 0 rows / 401.
- `notification_log` INSERT/UPDATE: `authenticated` gets 0 rows (service_role only).
- `app_settings` UPDATE: `leader` gets 0 rows, `super_admin` succeeds.
- Pastoreo views (if any): `security_invoker=true` verified, `server` denied on `birthday`/`sex` aggregations.
- `members.sex` / `age_years` readable only via existing `members_select` (no new exposure).

### 11.3 Edge Function — contract tests (Vitest, mock `fetch` for Graph API)

- Happy path: valid phone + consent + cap ok → `POST` to `graph.facebook.com` with `absence_followup` template, `wamid` returned, `notification_log` row `sent`.
- Kill switch: `whatsapp_enabled=false` → 0 provider calls, `skipped_cap`.
- Missing creds (D2): `WHATSAPP_TOKEN` empty → `failed` + banner error, no provider call.
- Cap exceeded: `sent_this_month=900` → `skipped_cap`.
- Invalid phone: `+57 300-abc` → `skipped_invalid_phone`.
- No consent: no `consent_records` → `skipped_no_consent`.
- Duplicate: existing `sent` row for dedup key → `skipped_duplicate`, no provider call.
- Auth: missing `x-cron-secret` → 401; wrong role for `shepherding_checkin` → 403.

### 11.4 Pastoreo — Component + E2E

- **Component (Vitest + Testing Library):** filter chips update URL, tab switch, masked `wa_number`, export button triggers SheetJS, Notify button calls `supabase.functions.invoke` with correct payload.
- **E2E — Playwright (`e2e/`, `chromium`+`firefox`):**
  - `server` → `/(dashboard)/pastoreo` → 403 / redirect with insufficient-permission.
  - `leader` → Pastoreo renders, filters apply (counts match server queries), chronic table respects `pastoreo_chronic_threshold` (3 misses), export downloads `.xlsx`.
  - Birthday tab shows `"N members without birthday"` warning.
  - Monitoring strip shows `sent/skipped/failed/cap` + last cron timestamp (mocked via seeded `notification_log` + `cron.job_run_details` if available).
  - Timezone seam: seed session on Saturday, assert Sunday 07:00 Bo notification would be found (via `AT TIME ZONE` query against seeded data).

### 11.5 E2E — Cron simulation (no real `pg_cron` in CI)

- Vitest integration test that calls `supabase.functions.invoke('send-whatsapp', { body:{kind:'absence', dry_run:true} })` against a seeded session+member+attendance, asserts `notification_log` counts without hitting Graph API (mocked `fetch`).
- Playwright: manual "Notify" from Pastoreo with 2 chronic members, assert `notification_log` rows with `created_by = test leader id`.

### 11.6 `EXPLAIN ANALYZE` gate

Add a Vitest test that runs `EXPLAIN (FORMAT JSON) SELECT ...` for the birthday scan and chronic query and asserts the plan contains `Index Scan` / `Index Only Scan` (not `Seq Scan`) — fails if indexes are missing. Run against local Supabase (`supabase start`).

---

## 12. File Changes (for `sdd-tasks` to decompose — budget-aware)

| # | Path | Action | Notes |
| --- | --- | --- | --- |
| 1 | `supabase/migrations/012a_whatsapp_pastoreo_core.sql` | Create | Members/profile columns, `notification_log`, `app_settings` keys, Vault enablement, audit trigger, comments |
| 2 | `supabase/migrations/012b_whatsapp_pastoreo_indexes.sql` | Create | 7 indexes `CONCURRENTLY` (separate file/transaction) |
| 3 | `supabase/migrations/012c_whatsapp_pastoreo_rls.sql` | Create | `notification_log` RLS + grants, `security_invoker` views if any |
| 4 | `supabase/functions/send-whatsapp/index.ts` | Create | Edge Function (Deno, `libphonenumber-js`, Meta Graph API, gates, batching, idempotency, structured logs) |
| 5 | `supabase/functions/send-whatsapp/.env.example` | Create | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `CRON_SECRET` placeholders |
| 6 | `src/lib/phone/normalize.ts` | Create | E.164 helper (`libphonenumber-js`) — shared by capture form + Edge contract tests |
| 7 | `src/lib/rbac/guards.ts` | Edit | Add `canViewPastoreo` |
| 8 | `src/app/(dashboard)/pastoreo/page.tsx` | Create | Server Component shell + RLS-aware data fetches + monitoring strip + banner |
| 9 | `src/app/(dashboard)/pastoreo/_components/Filters.tsx` | Create | Client island (nuqs/useSearchParams, age/sex/date range, tab) |
| 10 | `src/app/(dashboard)/pastoreo/_components/ChronicTable.tsx` | Create | Server/Client table + masked phones + Notify bulk action |
| 11 | `src/app/(dashboard)/pastoreo/_components/ResumenTab.tsx` | Create | KPI cards + charts |
| 12 | `src/app/(dashboard)/pastoreo/_components/BirthdayTab.tsx` | Create | Upcoming 30 days + completeness warning |
| 13 | `src/app/api/cron/daily-digest/route.ts` | Create | Vercel fallback Route Handler (verifies `CRON_SECRET`, calls Edge) |
| 14 | `vercel.json` | Edit | Add `crons: [{ path:"/api/cron/daily-digest", schedule:"0 12 * * *" }]` (only if Hobby slot available) |
| 15 | `src/app/(dashboard)/layout.tsx` | Edit | Add Pastoreo nav item gated by `canViewPastoreo` |
| 16 | `supabase/config.toml` | No change | Extensions are Dashboard-enabled; no config file change needed |
| 17 | `package.json` | Edit | Add `libphonenumber-js` |

**Budget note:** 400-line budget is tight for Pastoreo UI — `sdd-tasks` SHOULD split into chained PRs (`stacked-to-main` or `feature-branch-chain` per `delivery_strategy=ask-on-risk`): PR1 = migrations + Edge Function + fallback + phone helper (012a–c, 4–7, 13, 17); PR2 = Pastoreo route + components + nav + vercel.json (8–12, 14–15). Verifier will run `npx vitest` + `npx playwright test` green.

---

## 13. Rollback & Safety

- **Kill switch:** `UPDATE app_settings SET value='false' WHERE key='whatsapp_enabled'` — Edge early-returns `skipped_cap`, Pastoreo banner, no code change.
- **Cron disable:** `SELECT cron.unschedule('daily-digest')` or `vercel.json` revert.
- **Migration rollback:** All new columns are additive + nullable/defaulted; `notification_log` is isolated — `DROP TABLE notification_log` + `ALTER TABLE members DROP COLUMN ...` is non-destructive to existing data. Indexes are `CONCURRENTLY` and droppable with `DROP INDEX CONCURRENTLY`.
- **Vault rotation:** Token rotation via `vault.update_secret` + `supabase secrets set` + Edge redeploy.

---

## 14. Open Items Carried Forward

- **D2 — WhatsApp Business number:** Owner consult pending. No design blocker — placeholder + fail-closed + Vault injection without migration. `sdd-tasks` must add a Pastoreo banner for the missing-creds state and document the injection runbook in the PR description.
- **Template copy:** Pastoral lead must approve T1–T3 wording before Meta submission — templates are draft in §6.1.

---

## Sources

- Spec (normative): `openspec/changes/whatsapp-pastoreo-notifications/specs/whatsapp-pastoreo-notifications/spec.md` + Engram `sdd/whatsapp-pastoreo-notifications/spec` — US1/US2/US3, Data Contracts, API contract, Cron & Scheduling, traceability, D2 handling.
- Proposal: `openspec/changes/whatsapp-pastoreo-notifications/proposal.md` + Engram `sdd/whatsapp-pastoreo-notifications/proposal` — G1–G6, matrices, flows §4b/4c, schema §6, RLS §6.7, templates §7.
- Explore: `openspec/changes/whatsapp-pastoreo-notifications/explore.md` + Engram `sdd/whatsapp-pastoreo-notifications/explore` — findings §§2–5, trigger analysis §4.1, query/index detail §5.2, provider matrix §3.
- Supabase skills: `supabase/SKILL.md` (RLS, Vault, `security_invoker`, `TO authenticated USING`, `pg_cron`/`pg_net`, Data API grants) + `supabase-postgres-best-practices/SKILL.md` (partial indexes, `CONCURRENTLY`, generated columns).
- Migrations: `supabase/migrations/001_initial_schema.sql` (DDL/RLS/audit/`pg_cron` pattern), `006_fix_rls_write_policies_and_user_role.sql` (RLS `WITH CHECK` + `user_role()`), `011_youth_retreat_preregistration.sql` (RLS/revocation pattern, `SECURITY DEFINER SET search_path=''`, `REVOKE`/`GRANT`).
- Vault pattern: `docs/vault-setup.md` (`vault.create_secret`, `vault.decrypted_secrets`, `get_decryption_key()` RPC).
- App Router: `src/app/(dashboard)/layout.tsx` (nav, guards), `src/lib/rbac/guards.ts`, `src/lib/supabase/server.ts`, `supabase/config.toml`, `package.json`, `openspec/config.yaml`.
