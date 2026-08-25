# Whatsapp Pastoreo Notifications Specification

## Purpose

Enable pastoral shepherding at scale for a 100–1,000 member community by automating two daily WhatsApp notifications (absence follow-up day+1, birthday digest day-of) and delivering a `/(dashboard)/pastoreo` analytics module with cohort filters, chronic-absentee detection, and audited exports. All sends MUST be consent-gated (Ley 1581), idempotent, timezone-correct (America/Bogota), and operable at zero incremental cost within Meta's 1,000 free service conversations/month (per proposal §§1–5, explore §§1–5).

## Scope

### In Scope (this change)

- Schema additions to `members`, `profiles`, new table `notification_log`, `app_settings` keys, Vault secrets, indexes, and RLS policies.
- Edge Function `supabase/functions/send-whatsapp` (contract only — no implementation code in this spec) and its auth/batching/retry/idempotency contract.
- Scheduling via `pg_cron` + `pg_net` → Edge Function (primary) with Vercel Cron fallback.
- Pastoreo route `/(dashboard)/pastoreo` as specified: filters (age bucket, sex, date range), tabs (Resumen / Ausentes crónicos / Cumpleaños), chronic table, SheetJS export, manual "Notify via WhatsApp" action.
- Three WhatsApp templates (`absence_followup`, `birthday_staff_digest`, `shepherding_checkin`) and consent/Ley 1581 handling.
- Observability via `notification_log` and `cron.job_run_details` / Edge structured logs.

### Out of Scope (explicitly deferred — per proposal §2 Non-Goals N1–N7)

- Human inbox / multi-agent chat, two-way conversational flows, buttons/quick-replies, AI replies.
- Migrating attendance capture away from offline-first Dexie → `sync_queue` → PostgREST (unchanged).
- Materialized view `mv_pastoreo_stats` (deferred until `EXPLAIN ANALYZE` proves need at >10k members — proposal D11).
- Unofficial gateway (evolution-api/Ultramsg/Whapi) as production path — PoC fallback only (D12).
- Bulk re-consent campaign tooling beyond admin toggle + `consent_records` type.
- Porting/buying a dedicated WhatsApp number as part of this change (D2 — open item).

---

## Requirements

### Requirement: Actors and Permissions Matrix

The system MUST enforce the actor/permission matrix below. Pastoreo visibility, notification receipt, and manual trigger capability MUST be gated by both Next.js route guards (UX) and Postgres RLS (enforcement). `server` MUST NOT access Pastoreo in MVP (proposal D4).

| Role | Pastoreo visibility (`/(dashboard)/pastoreo`) | Receives WhatsApp | May trigger manual "Notify via WhatsApp" | May manage `app_settings` WhatsApp keys |
| ------ | ----------------------------------------------- | ------------------- | ------------------------------------------ | ------------------------------------------ |
| `super_admin` | Full: all filters, export, config, monitoring banner | Birthday digest if `profiles.whatsapp_opt_in=true` AND `whatsapp_number` valid AND `consent_records` `whatsapp_messaging` exists | Yes (chronic list + any manual) | Yes |
| `leader` | Full (read-only on `app_settings`) | Birthday digest under same gates (primary consumer) | Yes (chronic list) | No |
| `server` | **Denied in MVP** — redirect to dashboard with insufficient-permission notice | Birthday digest only if owner explicitly opts them in (default: no) | No | No |
| Member (unauthenticated) | None | Absence follow-up if `members.whatsapp_opt_in=true` AND `whatsapp_opt_out_at IS NULL` AND `consent_records` `whatsapp_messaging` exists AND E.164 valid | — | — |

RLS enforcement (see Data Contracts) MUST deny `server` SELECT on any Pastoreo view that exposes `birthday`/`sex` aggregations; the denial MAY be implemented as a `SELECT` policy predicate `public.user_role() IN ('super_admin','leader')` on views/tables backing Pastoreo, consistent with `supabase-postgres-best-practices` `security_invoker` guidance for Postgres 15.

#### Scenario: Leader accesses Pastoreo

- GIVEN an authenticated user with `role='leader'` and `is_active=true`
- WHEN they navigate to `/(dashboard)/pastoreo`
- THEN the page MUST render (200) with Resumen tab and filters visible

#### Scenario: Server denied Pastoreo in MVP

- GIVEN an authenticated user with `role='server'`
- WHEN they request `/(dashboard)/pastoreo`
- THEN the system MUST return 403 or redirect with an insufficient-permission notice and MUST NOT expose member `birthday` or `sex` data

#### Scenario: Super admin alone manages WhatsApp settings

- GIVEN a `leader` requests `UPDATE app_settings WHERE key LIKE 'whatsapp_%'`
- WHEN RLS evaluates `app_settings_update`
- THEN the update MUST be denied (0 rows) — only `super_admin` satisfies `USING`

---

### Requirement: US1 — Absence Notification Day+1

The system MUST notify every member absent from a session exactly once, on the calendar day after `sessions.session_date`, at 07:00 America/Bogota (12:00 UTC), via WhatsApp template `absence_followup`, exactly once per `(session_id, member_id)` regardless of how many times the job re-runs. Sends MUST be gated by consent, E.164 validation, timezone correctness, and idempotency (proposal §4b Automation 1, explore §4.2).

#### Scenario: Happy path — absentee notified once

- GIVEN a session `S` with `session_date = (CURRENT_DATE AT TIME ZONE 'America/Bogota') - 1` and `deleted_at IS NULL`
- AND member `M` is active (`deleted_at IS NULL`), has valid E.164 phone, `whatsapp_opt_in=true`, `whatsapp_opt_out_at IS NULL`, and a `consent_records` row `consent_type='whatsapp_messaging'`
- AND no `attendance` row exists for `(M, S)` with `deleted_at IS NULL`
- AND no `notification_log` row exists for `(S, M, kind='absence', status IN ('sent','queued'))`
- WHEN the daily-digest job runs with `{ kind:"absence" }`
- THEN one `notification_log` row MUST be inserted with `status='sent'` (or `'queued'` if provider async), `template_name='absence_followup'`, `provider_message_id` populated, and one Meta Cloud API call MUST have been made to `POST /{phone_number_id}/messages` with template `absence_followup` and variables `[M.name, S.name, S.session_date]`

#### Scenario: Idempotency — re-run does not double-send

- GIVEN a prior successful `notification_log` row for `(S, M, kind='absence', status='sent')`
- WHEN the job re-runs for the same `S`
- THEN zero additional API calls MUST be made for `(S, M)` and zero new `notification_log` rows with `status IN ('sent','queued')` MUST be inserted; the job MAY log `skipped_duplicate`

#### Scenario: Consent gate — opt-out blocks send

- GIVEN member `M` has `whatsapp_opt_in=false` OR `whatsapp_opt_out_at IS NOT NULL` OR no `consent_records` row for `whatsapp_messaging`
- WHEN the job evaluates `M` for session `S`
- THEN no API call MUST be made and a `notification_log` row with `status='skipped_no_consent'` MUST be inserted (auditable per Ley 1581)

#### Scenario: Invalid phone — skipped

- GIVEN member `M` has phone `+57 300-abc` or landline or `NULL` that fails `CHECK whatsapp_number ~ '^\+[1-9]\d{7,14}$'` / `libphonenumber-js` validation or `COALESCE(wn.number, m.phone)` is null
- WHEN evaluated
- THEN no API call MUST be made and `status='skipped_invalid_phone'` with `error` describing validation failure MUST be recorded

#### Scenario: Session with zero attendance rows

- GIVEN session `S` has zero `attendance` rows with `deleted_at IS NULL`
- WHEN absence job runs
- THEN every active member satisfying consent/phone gates MUST be considered absent (anti-join returns all) and notified — per proposal §4b edge case; design MUST log a warning when session has zero rows

#### Scenario: Deleted session excluded

- GIVEN session `S` has `deleted_at IS NOT NULL`
- WHEN job scans `sessions WHERE session_date = yesterday`
- THEN `S` MUST be excluded from processing

#### Scenario: Offline sync delay — grace window

- GIVEN `attendance` for `M` was captured in Dexie but not yet flushed via `sync_queue` at 07:00 Bo
- WHEN job runs
- THEN `M` MAY be over-inclusively notified (known limitation per proposal R6); the system MUST document a 07:00 window gives overnight sync and MAY expose `app_settings.pastoreo_absence_grace_hours` for future `session_attendance_finalized` flag without blocking this spec

#### Scenario: Timezone correctness

- GIVEN `sessions.session_date = '2026-08-23'::DATE` (Saturday) in Bogota
- WHEN the job runs at `2026-08-24 12:00 UTC` (= `2026-08-24 07:00 America/Bogota`)
- THEN `S` MUST be found via `session_date = (CURRENT_DATE AT TIME ZONE 'America/Bogota') - INTERVAL '1 day'` and notified on Sunday Bo regardless of UTC date boundary (proposal R7)

---

### Requirement: US2 — Birthday Notification Day-Of (Staff Digest)

The system MUST deliver a birthday digest to opted-in staff on the calendar day of each member's birthday (Bogota date), as one grouped message per staffer per day listing all celebrants. The digest MUST use template `birthday_staff_digest` and MUST NOT notify the celebrant directly (proposal §4b Automation 2, D4/D9).

#### Scenario: Happy path — group digest

- GIVEN members `A` (birthday `1990-08-25`), `B` (birthday `1985-08-25`) active and `birthday IS NOT NULL`
- AND staff profiles `P1` (`super_admin`, `whatsapp_number='+573001111111'`, `whatsapp_opt_in=true`, consent `whatsapp_messaging` exists) and `P2` (`leader`, same gates)
- AND `CURRENT_DATE AT TIME ZONE 'America/Bogota' = '2026-08-25'`
- WHEN birthday job runs
- THEN for each staffer one API call with template `birthday_staff_digest` and param `"A (35), B (40) — ¡oremos por ellos!"` MUST be made, plus `notification_log` rows per `(celebrant, recipient_profile_id, kind='birthday', notification_date='2026-08-25', status='sent')` for audit

#### Scenario: Duplicate suppression — same day re-run

- GIVEN a `notification_log` row already exists for `(member_id=A, kind='birthday', notification_date='2026-08-25', status IN ('sent','queued'))` per staffer
- WHEN job re-runs same Bogota date
- THEN zero additional API calls for `A` to that staffer MUST be made; `skipped_duplicate` MAY be logged

#### Scenario: Feb 29 leap-year handling (D9 default accepted)

- GIVEN member `C` with `birthday='2000-02-29'`
- WHEN current Bogota date is `2027-02-28` (non-leap year) and `2027` is not leap
- THEN `C` MUST be included in the Feb 28 digest (in addition to normal Feb 29 match in leap years) — query MUST implement `OR (birthday MM-DD=02-29 AND NOT is_leap_year AND CURRENT_DATE MM-DD=02-28)` per explore §4.3

#### Scenario: Birthday null — excluded

- GIVEN member `M` has `birthday IS NULL`
- WHEN birthday scan runs
- THEN `M` MUST be excluded and the Pastoreo Cumpleaños tab MUST count `M` toward "N members without birthday" completeness warning

#### Scenario: Staff phone invalid or not opted in — skipped

- GIVEN staffer `P` has `whatsapp_number IS NULL` or fails E.164 or `whatsapp_opt_in=false` or no `consent_records` `whatsapp_messaging`
- WHEN digest fans out
- THEN `P` MUST be excluded from fan-out and a `notification_log` row `skipped_no_consent` or `skipped_invalid_phone` per celebrant or a single `skipped_no_recipients` summary row MUST be recorded

#### Scenario: No birthdays today — no API call

- GIVEN zero members match `EXTRACT(MONTH/DAY FROM birthday) = EXTRACT(MONTH/DAY FROM CURRENT_DATE AT TIME ZONE 'America/Bogota')` (including Feb 29 rule)
- WHEN job runs
- THEN zero API calls MUST be made and a `notification_log` row `status='skipped_no_birthdays'` with `notification_date = CURRENT_DATE AT TIME ZONE 'America/Bogota'` MUST be recorded

#### Scenario: Staff recipient set respects D4

- GIVEN `server` profile `P` is active and opted in
- WHEN birthday job resolves recipients with default D4 (`super_admin`+`leader` only)
- THEN `P` MUST NOT receive a digest; widening to include `server` MUST require a one-line RLS/query change without migration

---

### Requirement: US3 — Pastoreo Dashboard (Filters, Chronic, Export, Notify)

The system MUST provide route `/(dashboard)/pastoreo` (Spanish, matching domain language) with tabs `Resumen | Ausentes crónicos | Cumpleaños`, filters by age bucket, sex, and date range, a chronic-absentee table, SheetJS export, and a "Notify via WhatsApp" manual trigger that reuses the `send-whatsapp` Edge Function (proposal §4c, explore §5).

#### Scenario: Filters apply correctly

- GIVEN Pastoreo data with members across buckets `0-12/13-17/18-25/26-35/36-50/51+`, sexes `M/F/other/prefer_not_to_say`, and sessions over last 12 weeks
- WHEN user selects `age_bucket=18-25`, `sex=F`, `date range=last 8 weeks`
- THEN Resumen KPIs, bar charts, and table MUST reflect `WHERE age_years bucket='18-25' AND sex='F' AND session_date BETWEEN :from AND :to` and counts MUST match server-computed queries (not client-filtered subsets)

#### Scenario: Chronic-absentee table matches definition D6

- GIVEN `app_settings.pastoreo_chronic_threshold=3` and `pastoreo_chronic_lookback_days=90` (D6 defaults) and a member `M` with ≥1 attendance in last 90 days then 3 consecutive misses by `session_date` order (session-order, not calendar Saturdays)
- WHEN user opens Ausentes crónicos tab
- THEN `M` MUST appear with `last_attended_date`, `missed_streak=3`, `wa_number` masked (last 4), and actions `Notify` + `View history`
- AND a member with only 2 misses MUST NOT appear

#### Scenario: Export

- GIVEN filtered Pastoreo view shows N chronic rows
- WHEN user clicks Export
- THEN an `.xlsx` file via SheetJS MUST download containing the same N rows with columns `name, age, sex, last_attended_date, missed_streak, wa_number(masked)`, and `birthday`/`sex` raw values MUST be excluded from default export unless `super_admin` explicitly opts in (Ley 1581 purpose limitation)

#### Scenario: Manual Notify via WhatsApp

- GIVEN a `leader` selects 5 chronic members and clicks "Notify via WhatsApp"
- WHEN the action fires
- THEN the system MUST call `send-whatsapp` with `{ kind:"shepherding_checkin", member_ids:[...], template:"shepherding_checkin" }` under authenticated `leader` JWT, gate each send on consent/phone/cap, write `notification_log` rows with `created_by = auth.uid()`, and surface per-row `sent/skipped/failed` feedback

#### Scenario: Birthday tab completeness

- GIVEN N members have `birthday IS NULL`
- WHEN Cumpleaños tab loads
- THEN it MUST list upcoming birthdays (next 30 days) and display a warning "N members without birthday" with link to data-quality view

---

### Requirement: Data Contracts & Schema

All schema changes MUST follow `supabase-postgres-best-practices`: RLS enabled on every table in `public`, partial indexes with `WHERE deleted_at IS NULL`, `security_invoker` views (Postgres 15), `GENERATED ALWAYS AS ... STORED` for derived columns, Vault for secrets, `CONCURRENTLY` for index builds, no `SECURITY DEFINER` without explicit `auth.uid()` guard.

#### 6.1 Members — new columns

| Column | Type | Constraints / Default | Notes |
| -------- | ------ | ------------------------ | ------- |
| `sex` | `TEXT` | `CHECK (sex IN ('M','F','other','prefer_not_to_say'))`, `NULL` allowed, no default | Sensitive per Ley 1581; nullable for backfill; excluded from default export (proposal §6.1, D8) |
| `age_years` | `INT` | `GENERATED ALWAYS AS (EXTRACT(YEAR FROM age(birthday))::int) STORED`, `NULL` when `birthday IS NULL` | Generated column for bucketing/indexing; avoids repetitive `age()` math (explore §2.7) |
| `whatsapp_opt_in` | `BOOLEAN` | `NOT NULL DEFAULT false` | Gate for all absence sends; defaults false until re-consent (D3) |
| `whatsapp_opt_out_at` | `TIMESTAMPTZ` | `NULL` | Set on unsubscribe; blocks sends even if `opt_in=true` |

#### 6.2 Profiles — new columns

| Column | Type | Constraints / Default | Notes |
| -------- | ------ | ------------------------ | ------- |
| `whatsapp_number` | `TEXT` | `CHECK (whatsapp_number ~ '^\+[1-9]\d{7,14}$')`, `NULL` | E.164; `auth.users.phone` is not reliably populated (explore §2.2) |
| `whatsapp_opt_in` | `BOOLEAN` | `NOT NULL DEFAULT false` | Staff must opt in to birthday digests (D4) |

#### 6.3 New table — `notification_log`

```sql
-- Reference DDL (spec, not migration) — types/constraints are normative
CREATE TABLE notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES members(id) ON DELETE SET NULL,
  recipient_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('absence','birthday','shepherding_checkin')),
  channel TEXT NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp')),
  template_name TEXT NOT NULL, -- 'absence_followup' | 'birthday_staff_digest' | 'shepherding_checkin'
  status TEXT NOT NULL CHECK (status IN (
    'queued','sent','failed',
    'skipped_no_consent','skipped_invalid_phone','skipped_duplicate',
    'skipped_no_birthdays','skipped_no_recipients','skipped_cap'
  )),
  notification_date DATE, -- Bogota date for birthday idempotency; NULL for absence
  provider_message_id TEXT, -- returned wamid
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  created_by UUID REFERENCES profiles(id) -- NULL for cron, set for manual Pastoreo triggers
);
```

Additional `app_settings` keys (proposal §6.5, D6/D9):

| Key | Value / Type | Notes |
| ----- | -------------- | ------- |
| `whatsapp_monthly_cap` | `900` (TEXT) | Blocks sends when exceeded; alert at 800 |
| `whatsapp_enabled` | `true` | Kill switch — Edge Function early-return + Pastoreo banner |
| `pastoreo_chronic_threshold` | `3` | Tunable without migration |
| `pastoreo_chronic_lookback_days` | `90` | Tunable |
| `whatsapp_phone_number_id` | `NULL` placeholder | Configurable via Vault/`app_settings`; see Vault section for D2 plan |
| `dpo_contact_email` | existing | Already seeded |

`consent_records` — no DDL; new `consent_type='whatsapp_messaging'` is application-level (proposal §6.4) with `policy_version`, `accepted_at`, `ip_address`.

Dexie (`src/lib/sync/db.ts`) — no schema change required for v1; Pastoreo reads are server-side only. If offline Pastoreo cache is added later it MUST bump Dexie version.

Indexes — MUST be created `CONCURRENTLY` in production (per best practices `lock-` category):

```sql
CREATE INDEX CONCURRENTLY idx_members_birthday_month_day
  ON members ((EXTRACT(MONTH FROM birthday)), (EXTRACT(DAY FROM birthday)))
  WHERE deleted_at IS NULL AND birthday IS NOT NULL;

CREATE INDEX CONCURRENTLY idx_attendance_member_session
  ON attendance (member_id, session_id) WHERE deleted_at IS NULL;
CREATE INDEX CONCURRENTLY idx_attendance_session
  ON attendance (session_id) WHERE deleted_at IS NULL;
CREATE INDEX CONCURRENTLY idx_sessions_session_date
  ON sessions (session_date) WHERE deleted_at IS NULL;
CREATE INDEX CONCURRENTLY idx_members_sex
  ON members (sex) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX CONCURRENTLY uq_notification_log_dedup
  ON notification_log (session_id, member_id, kind) WHERE status IN ('sent','queued');
CREATE UNIQUE INDEX CONCURRENTLY uq_notification_log_birthday
  ON notification_log (member_id, kind, notification_date) WHERE kind='birthday' AND status IN ('sent','queued');
-- Per-recipient birthday dedup (needed because digest is per staffer):
CREATE UNIQUE INDEX CONCURRENTLY uq_notification_log_birthday_recipient
  ON notification_log (member_id, recipient_profile_id, kind, notification_date)
  WHERE kind='birthday' AND status IN ('sent','queued');
```

RLS policies — MUST follow `TO authenticated` + `USING` predicate pattern (never bare `TO authenticated` alone — BOLA/IDOR per best practices). No `anon` access. `service_role` bypasses RLS for Edge Function writes; policies below are for `authenticated`:

```sql
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_log_select ON notification_log FOR SELECT
  TO authenticated USING (public.user_role() IN ('super_admin','leader'));
-- No INSERT/UPDATE policies for authenticated — writes are service_role only (Edge Function)
-- Views for Pastoreo if any: CREATE VIEW ... WITH (security_invoker = true);
```

Existing tables (`members`, `profiles`, `whatsapp_numbers`, etc.) keep current RLS; new columns inherit table policies. No `SECURITY DEFINER` functions for reads; if a helper is needed it MUST live in non-exposed schema and check `auth.uid()`.

Vault secrets (D2 pending — configurable/placeholder):

- `WHATSAPP_TOKEN` (system-user access token)
- `WHATSAPP_PHONE_NUMBER_ID`

For D2 pending (no Business number yet): `WHATSAPP_PHONE_NUMBER_ID` MUST be configurable via `app_settings.whatsapp_phone_number_id` / Vault without requiring a migration to inject. In `dev` the Edge Function MUST accept a Twilio sandbox number or Meta test number injected via Vault; in `prod` the value is injected when the client delivers the Business number. The system MUST NOT hardcode the phone number ID and MUST fail closed with `skipped_cap` or `failed` + banner if the secret is missing and `whatsapp_enabled=true`.

#### Scenario: Schema defaults enforce consent gate

- GIVEN a new `members` row inserted without explicit `whatsapp_opt_in`
- WHEN evaluated for absence send
- THEN gate MUST block send because `whatsapp_opt_in=false` by default

#### Scenario: RLS denies server reading notification_log

- GIVEN an authenticated `server` queries `notification_log`
- WHEN `notification_log_select` evaluates
- THEN zero rows MUST be returned

---

### Requirement: API / Edge Function Contract — `supabase/functions/send-whatsapp`

The Edge Function is the single egress point for WhatsApp. It MUST be invoked by `pg_cron`/`pg_net` (service_role) and by Pastoreo manual actions (authenticated JWT). It MUST NOT be callable by `anon`. All sends MUST go through this function (no direct Graph API calls from client or cron SQL).

**Auth modes:**

- Cron: `Authorization: Bearer <service_role_jwt>` + `x-cron-secret` header (shared secret in Vault) — service_role bypasses RLS for log writes.
- Manual: `Authorization: Bearer <user_jwt>` — Edge verifies JWT via `supabase.auth.getUser()` / `getClaims()`, enforces `public.user_role() IN ('super_admin','leader')` for `shepherding_checkin`, and sets `notification_log.created_by = auth.uid()`.

**Request (cron):**

```json
{ "kind": "absence" | "birthday" | "shepherding_checkin",
  "session_id"?: "uuid",          // optional — if omitted, scans yesterday's sessions
  "dry_run"?: false,
  "triggered_by"?: "cron" | "manual" }
```

**Request (manual Pastoreo):**

```json
{ "kind": "shepherding_checkin",
  "member_ids": ["uuid", ...],    // 1..50 per call (batch limit)
  "template_name": "shepherding_checkin",
  "custom_params"?: { "community_name": "Iglesia ..." } }
```

**Response (always 200 for cron to avoid pg_net retry storms; errors in body):**

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
  "errors": [{ "member_id":"...", "error":"..." }],
  "provider": "meta_cloud_api",
  "dry_run": false }
```

**Error cases (body, not HTTP 5xx unless auth failure):**

| Condition | HTTP | Body `status` | Handling |
| ----------- | ------ | --------------- | ---------- |
| Missing/invalid JWT / `x-cron-secret` | 401 | — | Reject, no DB writes |
| `whatsapp_enabled=false` (kill switch) | 200 | `skipped_cap` with `error='whatsapp disabled'` | Early return, no provider calls |
| Missing `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` (D2 not yet injected) | 200 | `failed` with `error='missing whatsapp credentials — D2 pending'` | No provider calls; Pastoreo shows banner "WhatsApp not configured" |
| Monthly cap exceeded (`sent` in current calendar month >= `whatsapp_monthly_cap`) | 200 | `skipped_cap` | No provider calls; banner |
| Provider 400 (invalid template params / phone) | 200 | `failed` with provider error | Recorded in `notification_log.error` |
| Provider rate limit (429) | 200 | `failed` with retry hint | Caller MAY retry next cron; failed rows are retryable (not covered by unique partial index) |

**Batching:** inputs >50 MUST be chunked into batches of 50 (Meta + Edge 10s timeout — proposal R10). Each chunk is sequential; the function MUST complete within <5s per chunk.

**Idempotency:** Before each provider call the function MUST check `notification_log` unique partial indexes; if a `sent`/`queued` row already exists for the dedup key, it MUST skip with `skipped_duplicate` and MUST NOT call the provider.

**Retries:** `failed` rows are retryable on next cron run (unique index excludes `failed`). `sent`/`queued` are not. No automatic retry loop inside the function — next cron invocation retries.

**Rate limits & phone normalization:** Every phone MUST be normalized via `libphonenumber-js` (or equivalent) to E.164, validated against `^\+[1-9]\d{7,14}$`, and checked for `+57` prefix (Colombia); invalid phones MUST NOT reach the provider.

#### Scenario: Kill switch blocks all sends

- GIVEN `app_settings.whatsapp_enabled='false'`
- WHEN any caller invokes `send-whatsapp`
- THEN zero provider calls MUST be made and response MUST report `skipped_cap` with kill-switch error

#### Scenario: Cap enforcement

- GIVEN `whatsapp_monthly_cap=900` and `COUNT(*) FROM notification_log WHERE status='sent' AND date_trunc('month', sent_at)=date_trunc('month', now()) = 900`
- WHEN job runs
- THEN every candidate MUST be `skipped_cap` and no provider calls made

#### Scenario: Batch chunking

- GIVEN 120 chronic members selected for manual notify
- WHEN Pastoreo calls `send-whatsapp` with 120 `member_ids`
- THEN the function MUST process in 3 chunks (50/50/20) and return aggregated counts

---

### Requirement: Cron & Scheduling

The system MUST schedule notifications via `pg_cron` + `pg_net` as primary (proposal D10) with a Vercel Cron fallback route that reuses the same Edge Function contract.

**Primary jobs:**

```sql
-- Enable extensions (once, via Dashboard > Database > Extensions or migration)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Daily digest — 12:00 UTC = 07:00 America/Bogota (UTC-5, no DST)
SELECT cron.schedule(
  'daily-digest',
  '0 12 * * *',
  $$SELECT net.http_post(
       url:='https://<project>.supabase.co/functions/v1/send-whatsapp',
       headers:='{"Content-Type":"application/json","Authorization":"Bearer '|| current_setting('app.settings.service_role_key') ||'"}'::jsonb,
       body:='{"kind":"absence"}'::jsonb
     );
     SELECT net.http_post(
       url:='https://<project>.supabase.co/functions/v1/send-whatsapp',
       headers:='{"Content-Type":"application/json","Authorization":"Bearer '|| current_setting('app.settings.service_role_key') ||'"}'::jsonb,
       body:='{"kind":"birthday"}'::jsonb
     );$$
);
```

Sequential: absence first, then birthday, in the same cron tick — two `net.http_post` calls. `pg_net` is async fire-and-forget; the Edge Function is authoritative for results. `cron.job_run_details` MUST be monitored.

**Fallback (if extensions blocked):**

`vercel.json`:

```json
{ "crons": [{ "path": "/api/cron/daily-digest", "schedule": "0 12 * * *" }] }
```

Route handler `POST /api/cron/daily-digest` MUST verify `Authorization: Bearer <CRON_SECRET>`, then call the same Edge Function with `service_role` key; contract and idempotency identical.

**Timezone invariant:** Every date comparison MUST use `(CURRENT_DATE AT TIME ZONE 'America/Bogota')` or `now() AT TIME ZONE 'America/Bogota'`. `sessions.session_date` is `DATE` (tz-naive). Migration comments MUST document `AT TIME ZONE 'America/Bogota'` anchoring (proposal R7).

**Reference queries:**

Absentees per session (anti-join, per explore §4.2 / proposal §4b):

```sql
SELECT m.id, m.name, COALESCE(wn.number, m.phone) AS wa_number
FROM members m
LEFT JOIN attendance a ON a.member_id=m.id AND a.session_id=:sid AND a.deleted_at IS NULL
LEFT JOIN whatsapp_numbers wn ON wn.member_id=m.id AND wn.is_primary_phone AND wn.deleted_at IS NULL
WHERE m.deleted_at IS NULL AND a.id IS NULL;
```

Sessions needing notification:

```sql
SELECT s.id FROM sessions s
WHERE s.deleted_at IS NULL
  AND s.session_date = (CURRENT_DATE AT TIME ZONE 'America/Bogota') - INTERVAL '1 day'
  AND NOT EXISTS (SELECT 1 FROM notification_log nl
                  WHERE nl.session_id=s.id AND nl.kind='absence' AND nl.status IN ('sent','queued'));
```

Birthdays today (including Feb 28/29 rule):

```sql
SELECT m.id, m.name, m.birthday FROM members m
WHERE m.deleted_at IS NULL AND m.birthday IS NOT NULL
  AND (
    (EXTRACT(MONTH FROM m.birthday)=EXTRACT(MONTH FROM CURRENT_DATE AT TIME ZONE 'America/Bogota')
     AND EXTRACT(DAY FROM m.birthday)=EXTRACT(DAY FROM CURRENT_DATE AT TIME ZONE 'America/Bogota'))
    OR (EXTRACT(MONTH FROM m.birthday)=2 AND EXTRACT(DAY FROM m.birthday)=29
        AND NOT is_leap_year(EXTRACT(YEAR FROM CURRENT_DATE AT TIME ZONE 'America/Bogota')::int)
        AND EXTRACT(MONTH FROM CURRENT_DATE AT TIME ZONE 'America/Bogota')=2
        AND EXTRACT(DAY FROM CURRENT_DATE AT TIME ZONE 'America/Bogota')=28)
  );
```

**Monitoring:** `notification_log` counts per day + `cron.job_run_details` (or `cron.job` + `net._http_response` on self-host) MUST be surfaced in Pastoreo for `super_admin` (proposal R5). Structured Edge logs MUST include `kind, session_id, member_id, status, provider_message_id, latency_ms`.

#### Scenario: Cron fires at correct wall time

- GIVEN `pg_cron` job `daily-digest` with `schedule='0 12 * * *'`
- WHEN evaluated in UTC
- THEN it MUST invoke at 12:00 UTC which MUST correspond to 07:00 America/Bogota (UTC-5)

#### Scenario: Sessions by session_date not created_at

- GIVEN a session created at `2026-08-20T03:00Z` but with `session_date='2026-08-23'`
- WHEN absence job scans
- THEN it MUST match on `session_date`, not `created_at`

---

### Requirement: Pastoreo Queries

Queries MUST be indexed plain SQL (no materialized view in this change — D11 deferred). All queries MUST include `WHERE deleted_at IS NULL` and MUST be verified with `EXPLAIN ANALYZE` to stay <100ms at 1k members / 1k sessions (per proposal §4c index plan, explore §5.2).

**Age buckets (D7 default):** `0-12, 13-17, 18-25, 26-35, 36-50, 51+` derived from `age_years` generated column (which is `EXTRACT(YEAR FROM age(birthday))::int`). Bucket via `CASE`:

```sql
CASE WHEN age_years IS NULL THEN NULL
     WHEN age_years < 13 THEN '0-12'
     WHEN age_years < 18 THEN '13-17'
     WHEN age_years < 26 THEN '18-25'
     WHEN age_years < 36 THEN '26-35'
     WHEN age_years < 51 THEN '36-50'
     ELSE '51+' END
```

**Sex breakdown:** `GROUP BY sex` with `sex` partial index; `NULL` sex is a separate bucket "No especificado".

**Time range:** `WHERE session_date BETWEEN :from AND :to` (default last 12 weeks), parametrized via `useSearchParams`/`nuqs`.

**Chronic absentees (D6 default — tunable without migration):** Member is chronic-absent if they had **≥1 attendance in last `pastoreo_chronic_lookback_days` (default 90)** and then **missed ≥ `pastoreo_chronic_threshold` (default 3) consecutive sessions** by `session_date` order (`ROW_NUMBER() OVER (ORDER BY session_date)`), not calendar Saturdays. Threshold and lookback MUST be read from `app_settings` at query time.

Reference window-function query per explore §5.2 (session-order variant) with parametrized `:threshold` and `:lookback_days`.

**Indexes and EXPLAIN expectations:** `idx_members_birthday_month_day`, `idx_attendance_member_session`, `idx_attendance_session`, `idx_sessions_session_date`, `idx_members_sex` (all partial `WHERE deleted_at IS NULL`) MUST produce `Index Scan` / `Index Only Scan` not `Seq Scan` on `EXPLAIN ANALYZE` for the birthday daily scan and Pastoreo aggregations.

#### Scenario: Chronic query tunable without migration

- GIVEN `app_settings` updated to `pastoreo_chronic_threshold='2'`
- WHEN chronic query re-runs
- THEN members with 2 consecutive misses MUST now appear without any DDL

---

### Requirement: WhatsApp Templates

Three templates MUST be submitted for Meta approval; all `utility` category (not marketing) to stay in lowest billable tier (proposal §7). D2 pending blocks production approval but not spec/design.

| # | `template_name` | Language | Category | Recipient | Variables | Pastoral copy (ES, proposal §7 — pending pastoral approval) | EN reference |
| --- | ----------------- | ---------- | ---------- | ----------- | ----------- | --------------------------------------------------------------- | -------------- |
| T1 | `absence_followup` | `es_CO` | Utility | Absent member | `{{1}}=member name`, `{{2}}=session name`, `{{3}}=session_date (DD/MM/YYYY)` | `Hola {{1}}, te extrañamos ayer en {{2}} ({{3}}). ¿Cómo estás? Oramos por ti. Si necesitas algo, responde a este mensaje. 🙏` | `Hi {{1}}, we missed you yesterday at {{2}} ({{3}}). How are you? We're praying for you.` |
| T2 | `birthday_staff_digest` | `es_CO` | Utility | Staff (digest) | `{{1}}=comma-separated "Juan (35), María (40)"` | `🎂 Hoy cumplen años: {{1}}. ¡Oremos y celebremos con ellos!` | `🎂 Birthdays today: {{1}}. Let's pray and celebrate!` |
| T3 | `shepherding_checkin` | `es_CO` | Utility | Chronic absentee (manual) | `{{1}}=name`, `{{2}}=community name` | `Hola {{1}}, somos de {{2}}. Hace un tiempo no te vemos y queríamos saber cómo estás. ¿Podemos orar por algo?` | `Hi {{1}}, we're from {{2}}. We haven't seen you in a while — how are you? Can we pray for something?` |

Status: **pending Meta approval — D2 blocker for prod** (proposal R9). Dev MUST use Twilio sandbox or Meta test number with sandbox templates; prod templates are approved after D2 Business number is injected. Fallback for rejected template is revision and resubmit — no service-window free-form reliance.

#### Scenario: Template language matches recipient locale

- GIVEN a member with locale `es-CO`
- WHEN `absence_followup` is sent
- THEN `language.code='es_CO'` MUST be used in the Graph API payload

#### Scenario: Digest list formatting

- GIVEN 3 celebrants `["Ana (40)", "Luis (22)", "Marta (35)"]`
- WHEN `birthday_staff_digest` is sent
- THEN `{{1}}` MUST be `"Ana (40), Luis (22), Marta (35)"` with age computed as `EXTRACT(YEAR FROM age(birthday))::int` on the Bogota date

---

### Requirement: Ley 1581 / Consent

All WhatsApp sends MUST be gated by Ley 1581 consent and auditable (proposal §7, explore §2.7, `consent_records` / `audit_log` / `arco_requests` existing infra). No WhatsApp call MUST be made without passing the gate.

**Gate (every send):** `members.whatsapp_opt_in=true` (or `profiles.whatsapp_opt_in` for staff) AND `whatsapp_opt_out_at IS NULL` AND `EXISTS (SELECT 1 FROM consent_records WHERE member_id=:id AND consent_type='whatsapp_messaging')`. No row → no send, logged `skipped_no_consent`.

**Collection:**

- Forward: `/capture` form adds `whatsapp_opt_in` checkbox with explicit purpose text: "Autorizo recibir mensajes pastorales vía WhatsApp (seguimiento de asistencia, cumpleaños). Puedo revocar en cualquier momento." On check, insert `consent_records (whatsapp_messaging, policy_version, accepted_at, ip_address)`.
- Existing members: bulk admin toggle in `/(dashboard)/members` edit + Pastoreo; each toggle MUST insert a `consent_records` row for evidence.

**Revocation / opt-out:** Pastoreo action or member edit sets `members.whatsapp_opt_out_at = now()` (or `profiles.whatsapp_opt_out_at` if added). Re-opt-in MUST clear `whatsapp_opt_out_at` and require a new `consent_records` row.

**Sensitive data:** `sex`, `birthday`, `denomination_encrypted` are sensitive per Ley 1581 — purpose limitation, explicit consent, RLS, excluded from default exports. `sex` allows `prefer_not_to_say`.

**Audit:**

- `notification_log` rows serve as send evidence.
- `audit_log` trigger `log_mutation()` MUST also cover `notification_log` (add trigger).
- `consent_records` rows serve as consent evidence for SIC.
- ARCO workflow (`arco_requests`) remains the channel for data-subject rights; no new table.

**Export:** Pastoreo export MUST NOT include `birthday`/`sex` raw values in default; `super_admin` MAY include them via explicit opt-in checkbox with audit note.

#### Scenario: Consent audit trail

- GIVEN member `M` opted in via `/capture` at `2026-08-20` with IP `192.0.2.10` and `policy_version='v1.0'`
- WHEN queried
- THEN one `consent_records` row `consent_type='whatsapp_messaging', policy_version='v1.0', ip_address='192.0.2.10'` MUST exist for `M`

#### Scenario: Opt-out revocation blocks future sends

- GIVEN `M` sets `whatsapp_opt_out_at = now()`
- WHEN absence job evaluates `M` next day
- THEN send MUST be blocked with `skipped_no_consent` even if `whatsapp_opt_in` remains true and consent row exists

---

### Requirement: Non-Functional

**Performance:** Pastoreo queries with indexes MUST complete <100ms p95 at 1k members / 1k sessions (`EXPLAIN ANALYZE` verified). Edge Function per-chunk latency MUST be <5s (proposal R10); total digest job <30s.

**Reliability:**

- Idempotency via partial unique indexes (see Data Contracts) MUST guarantee zero duplicates on re-run.
- Monthly conversation cap read from `app_settings.whatsapp_monthly_cap` (default 900, alert at 800) — Edge Function MUST count `sent` in current calendar month before sending; cap exceeded → `skipped_cap` + Pastoreo banner.
- No `SECURITY DEFINER` without guard; no client-side provider calls.

**Observability:**

- Every outbound attempt MUST be recorded in `notification_log` with `status/provider_message_id/error/sent_at`.
- `cron.job_run_details` / `net._http_response` and Edge structured logs MUST be queryable by `super_admin`.
- Pastoreo MUST surface a monitoring strip for `super_admin`: today's `sent/skipped/failed/cap` counts and last cron run timestamp.

**Security:**

- Secrets `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `CRON_SECRET` MUST live in Supabase Vault only, exposed to Edge Function via `supabase secrets` — never in `NEXT_PUBLIC_*` or client bundle (proposal §5).
- Rotation via Vault update + Edge redeploy without code change.
- Phone numbers are PII — only masked (last 4) in UI tables; full E.164 only in server-side logs with access control.

#### Scenario: Alert at 800 conversations

- GIVEN monthly `sent` count = 800
- WHEN `super_admin` loads Pastoreo
- THEN a banner "WhatsApp usage 800/900 — cap approaching" MUST be visible

---

### Requirement: Dependencies & Open Items

**D2 — WhatsApp Business number (PENDING, product owner must consult client).** This spec treats `WHATSAPP_PHONE_NUMBER_ID` as **configurable/placeholder**, not blocking:

- Dev: use Twilio sandbox or Meta test number (instant, no verification) injected via Vault.
- Prod: blocked until client delivers Business number / WABA. Injection requires only Vault + `app_settings` update — **no migration**. Edge Function fails closed with banner if missing.
- Spec records D2 as `Open Item` with owner action: confirm whether a WhatsApp Business number exists or must be created (Business Manager + NIT verification 1–3 days, proposal D1/D2).

Other decisions D1, D3–D12 are approved per defaults in the approval state (D1 verification with NIT, D3 bulk opt-in, D4 `leader`/`super_admin` only, D5 friendly pastoral tone, D6 3 misses / 90 days, D7 buckets `0-12/13-17/18-25/26-35/36-50/51+`, D8 `M/F/other/prefer_not_to_say`, D9 07:00 America/Bogota with Feb 29→Feb 28 rule, D10 `pg_cron`+`pg_net` primary / Vercel fallback, D11 deferred materialized view, D12 evolution-api fallback only with disposable number).

**Infra dependencies:** `pg_cron` + `pg_net` extensions enabled via Dashboard > Database > Extensions; Vault enabled; Edge Functions deployed; Meta templates submitted.

#### Scenario: D2 missing does not block dev

- GIVEN `app_settings.whatsapp_phone_number_id IS NULL` and `WHATSAPP_PHONE_NUMBER_ID` Vault secret is placeholder
- WHEN running `send-whatsapp` with `dry_run=true` in dev against Twilio sandbox
- THEN the call MUST succeed using the sandbox number without requiring prod Business number

---

### Requirement: Traceability

Every US MUST be traceable to data, API, cron, and tests (strict_tdd — `npx vitest` + `npx playwright test` green required, per `openspec/config.yaml`).

| US | Tables / Columns | API (Edge) | Cron | Tests (strict_tdd) |
| ---- | ------------------ | ------------ | ------ | --------------------- |
| US1 Absence | `members.{whatsapp_opt_in,whatsapp_opt_out_at,phone}`, `whatsapp_numbers.number`, `sessions.session_date`, `attendance.(member_id,session_id)`, `notification_log` (dedup index), `consent_records{whatsapp_messaging}`, `app_settings.{whatsapp_enabled,whatsapp_monthly_cap}` | `POST /functions/v1/send-whatsapp {kind:"absence"}` — consent/phone/cap gates, E.164, chunk 50, `absence_followup` | `daily-digest` 0 12 ** * UTC → `absence` then `birthday` | Vitest: consent gate, E.164, idempotency (re-run zero new `sent`), timezone `AT TIME ZONE`, batch chunk, cap. Playwright: Pastoreo does not trigger absence automatically |
| US2 Birthday | `members.birthday`, `members.age_years` (generated), `profiles.{whatsapp_number,whatsapp_opt_in}`, `notification_log` (birthday dedup), `consent_records`, `app_settings` | `POST /functions/v1/send-whatsapp {kind:"birthday"}` — group digest fan-out, `birthday_staff_digest` | Same `daily-digest` second step | Vitest: MM-DD scan, Feb 29 on Feb 28 non-leap, digest grouping, no-birthdays skip, staff opt-in gate. Playwright: Cumpleaños tab warning |
| US3 Pastoreo | `members.{sex,age_years,birthday}`, `profiles.role`, `sessions.session_date`, `attendance`, `notification_log`, `app_settings.{pastoreo_chronic_threshold,pastoreo_chronic_lookback_days}` | `POST /functions/v1/send-whatsapp {kind:"shepherding_checkin", member_ids}` (manual, auth gated) + Pastoreo Server Components (RLS-aware reads) | Weekly digest optional (future) — out of scope for this slice | Vitest: RLS policies (`security_invoker`, `TO authenticated` + `USING`), Pastoreo query `EXPLAIN` sanity, chronic window-function threshold. Playwright: route 403 for `server`, filters, chronic table, export, Notify button |

#### Scenario: Traceability coverage

- GIVEN US1, US2, US3
- WHEN `sdd-verify` evaluates `C1–C8` (proposal §9)
- THEN every criterion MUST have at least one Vitest or Playwright test mapped above

---

## Risks to This Spec

- D2 delay blocks prod Meta approval — mitigated by dev sandbox.
- Sparse `birthday` reduces birthday coverage — mitigated by completeness warning.
- Over-inclusive absentee list if offline sync hasn't flushed — mitigated by 07:00 window; future `session_attendance_finalized` flag.
- Timezone regression if `session_date` ever becomes `TIMESTAMPTZ` without `AT TIME ZONE` guard — documented as invariant.

## References

- Proposal: `openspec/changes/whatsapp-pastoreo-notifications/proposal.md` + Engram `sdd/whatsapp-pastoreo-notifications/proposal` — Goals G1–G6, Non-Goals N1–N7, matrices §3, flows §4b/4c, schema §6, RLS §6.7, templates §7, risks §8.
- Explore: `openspec/changes/whatsapp-pastoreo-notifications/explore.md` + Engram `sdd/whatsapp-pastoreo-notifications/explore` — findings §§2–5, trigger analysis §4.1, query/index detail §5.2, Well.
