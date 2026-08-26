# Proposal — WhatsApp Pastoreo Notifications

> **Change:** `whatsapp-pastoreo-notifications`
> **Date:** 2026-02-14 (proposal)
> **Status:** proposed — pending product owner approval to advance to spec/design
> **Artifact store:** `both` — `openspec/changes/whatsapp-pastoreo-notifications/proposal.md` + Engram `sdd/whatsapp-pastoreo-notifications/proposal`
> **Source exploration:** `openspec/changes/whatsapp-pastoreo-notifications/explore.md` + Engram `sdd/whatsapp-pastoreo-notifications/explore` (authoritative)
> **Stack:** Next.js 15.5.22 + React 19 + TS 5.8 strict + Supabase Postgres 15 (RLS, pg_cron) + Dexie offline-first + Tailwind/Radix + Vercel hosting
> **SDD config:** `openspec/config.yaml` — `strict_tdd: true`, `persistence.mode: both`
> **Preflight:** `execution_mode=auto`, `artifact_store=both`, `delivery_strategy=ask-on-risk`, budget 400 lines (user declined questionnaire — defaults applied)
> **Language:** English (technical artifact, per Language Domain Contract)

---

## 1. Summary / Problem Statement

**Who hurts today:** Pastoral leaders (`leader`, `super_admin`) shepherd a 100–1,000-member prayer community that meets weekly (Saturdays). Three operational pains are unaddressed:

1. **Absent members go un-contacted.** Attendance is captured offline-first (Dexie → `sync_queue` → PostgREST) but no one is notified the next day. Pastoral follow-up is manual, inconsistent, and depends on a leader remembering who missed.
2. **Birthdays are invisible.** `members.birthday` exists but no daily scan notifies staff. Celebrations are missed or discovered late.
3. **No Pastoreo analytics.** There is no view of cohorts by age/sex/time or of chronically absent members (`>2 Saturdays` without attendance after a valid check-in). Leaders cannot prioritize shepherding visits.

**Why now:** The data model and offline capture already exist; the missing piece is server-side notification + analytics. Supabase already runs `pg_cron` purge jobs — the same primitive can drive WhatsApp without new hosting. Meta WhatsApp Cloud API offers 1,000 free service conversations/month, so a zero-cost pilot is feasible before any spend. Delay increases Ley 1581 consent debt (sending without opt-in) and pastoral data-quality drift.

**What this proposal unlocks:** Two daily automations (absence next-day, birthday day-of) via WhatsApp to members/staff, plus a new `/(dashboard)/pastoreo` module with age/sex/time filters and a chronic-absentee table. All audited, idempotent, consent-gated, and reversible.

**Explore citation:** Headline findings §1, Codebase Findings §2.5, Preliminary Recommendation §7.1 — no existing WhatsApp/cron/Edge Function infra; data-model gaps; zero-cost path validated.

---

## 2. Goals & Non-Goals

### Goals (this iteration — must ship to be considered done)

- G1 — **Absence automation:** Every member absent from a session receives a pastoral WhatsApp follow-up the next morning at 07:00 America/Bogota, exactly once per session, with duplicate suppression.
- G2 — **Birthday automation:** Every active staffer who opted in receives a birthday digest on the day of each member's birthday (group digest preferred: one message per staffer listing all celebrants).
- G3 — **Pastoreo MVP dashboard:** New route `/(dashboard)/pastoreo` visible to `leader` + `super_admin` (see §3) with filters (age bucket, sex, date range), summary stats, chronic-absentee table, birthday tab, and SheetJS export.
- G4 — **WhatsApp integration via official channel:** Supabase Edge Function `send-whatsapp` calling Meta WhatsApp Cloud API with secrets in Vault, templates approved, E.164 normalization, and consent gating per Ley 1581.
- G5 — **Audit & idempotency:** Every outbound attempt is recorded in `notification_log` with status/provider_message_id/error; re-running cron never double-sends.
- G6 — **Zero incremental infra cost at launch** (within 1,000 free service conversations/month).

### Non-Goals (explicitly deferred)

- N1 — Human inbox / multi-agent WhatsApp chat (WATI-style). Outbound notifications only.
- N2 — Two-way conversational flows, buttons/quick-replies, or AI replies.
- N3 — Migrating attendance to realtime push; offline-first Dexie flow stays unchanged.
- N4 — Materialized view for Pastoreo (deferred until `EXPLAIN ANALYZE` proves need at >10k members).
- N5 — Unofficial gateway (evolution-api/Ultramsg/Whapi) as production path — PoC fallback only.
- N6 — Bulk re-consent campaign tooling beyond an admin toggle + `consent_records` type.
- N7 — Porting existing phone number or buying a dedicated number (owner decision, §12).

---

## 3. Users & Roles

Source: `supabase/migrations/001_initial_schema.sql` RLS + `src/lib/rbac/types.ts` (explore §2.3).

| Role | Pastoreo visibility | Receives WhatsApp | Sends/Triggers WhatsApp | Notes |
| ------ | -------------------- | -------------------- | ------------------------- | ------- |
| `super_admin` | Full (all filters, export, config) | Birthday digest (if `whatsapp_opt_in`), monitoring alerts | Can trigger manual "Notify" from Pastoreo | Only role that can manage templates/conversation cap in `app_settings` |
| `leader` | Full (same as super_admin, read-only on settings) | Birthday digest (if opted in); optionally chronic digest weekly | Can trigger manual "Notify" (chronic list) | Primary Pastoreo consumer |
| `server` | **Not in MVP** (decision D4) — optionally read-only view | Birthday digest only if owner opts them in (default: no) | Cannot trigger | Frontend guards UX-only; RLS already allows `attendance` inserts for all roles |
| Member (not authenticated) | None | **Absence follow-up** (if `whatsapp_opt_in` and not opted-out) | — | Phone from `members.phone` ∪ `whatsapp_numbers.number` (E.164) |

**Who sees Pastoreo:** `super_admin` + `leader`. `server` excluded in MVP to limit sensitive `birthday`/`sex` exposure; owner can widen later via RLS policy change without migration.

**Who receives WhatsApp:**

- Absence: affected **members** (pastoral tone, template `absence_followup`).
- Birthday: **staff** (`profiles` with `whatsapp_number` + opt-in) — not the celebrant. Group digest keeps cost at 1 conversation per staffer per day.

**Consent gate (all sends):** `members.whatsapp_opt_in = true` AND `whatsapp_opt_out_at IS NULL` AND `consent_records` has `consent_type='whatsapp_messaging'` for the recipient. No row → no send (logged as `skipped_no_consent`).

---

## 4. Proposed Solution — Three Fronts

### 4a. WhatsApp Provider — Recommendation with Justification

Full matrix in explore §3.1–§3.3 (9 providers evaluated). Ordered recommendation unchanged:

#### #1 — Meta WhatsApp Cloud API (direct) — Production path ✅

- **How:** `POST https://graph.facebook.com/v20.0/{phone_number_id}/messages` with `{ messaging_product:"whatsapp", to, type:"template", template:{name, language, components} }`. Auth via system-user `access_token` stored in Vault, injected into Edge Function env.
- **Free tier (verify before committing — pricing changes frequently):** 1,000 free *service* conversations/month per WABA (2024–2025 converged pricing). Conversations inside the 24h service window are effectively free; utility/marketing outside window are billable per category (Marketing ~$0.04–0.07, Utility ~$0.01–0.02, varies by country — Colombia slightly above US). At ~200 notifications/month this project stays at **$0 for 5+ months**.
- **Requirements:** Meta Business Manager + WABA + Business verification (Colombia: NIT + display-name approval, 1–3 days) + template pre-approval (minutes–hours for simple pastoral templates). Test number works instantly without verification.
- **Why #1:** Only truly zero-cost official path at this scale, no vendor markup, lowest latency (<2s), fully auditable for Ley 1581, scales to millions.

#### #2 — Twilio API for WhatsApp — Sandbox / Fastest PoC

- **How:** `POST https://api.twilio.com/2010-01/Accounts/{SID}/Messages.json` with `From=whatsapp:+1415…`.
- **Free tier:** Sandbox free forever (join via `join <code>` to sandbox number, unlimited testing). Production trial ~$15 credit, then **$0.005/msg Twilio fee + Meta conversation fee passthrough** — cheap (~$5–10/mo for 500 msgs) but not $0.
- **Why #2 not #1:** Adds vendor markup and still needs template approval; no free production tier. Use only to validate flows for days before cutting over to direct Cloud API.

#### Fallback — evolution-api self-hosted (or Ultramsg/Whapi hosted interim)

- **How:** Self-hosted Node.js gateway (Baileys/WebSocket) on a $6–12/mo VPS; or hosted Ultramsg/Whapi (~$10–29/mo) wrapping a real WhatsApp Web session via QR scan.
- **Why fallback only:** Violates WhatsApp ToS (unofficial client) → ban risk; phone must stay online; not auditable for Ley 1581. Acceptable **only if Meta Business verification is blocked for weeks**, with a disposable number and explicit owner acknowledgment.

#### Discarded for production

| Provider | Reason discarded |
| ---------- | ------------------ |
| 360dialog | No free tier; €49/mo + Meta fees — enterprise BSP, overkill at 100–1k members |
| WATI | $49/mo SaaS inbox — out of scope (outbound only) |
| CallMeBot | Free but toy: GET with plaintext API key, recipient must pre-add bot, no delivery guarantees, rate-limited |

**Official doc URLs for re-verification (explore §8 — fetch as `.md` or via MCP `search_docs`):**

- Cloud API: `https://developers.facebook.com/docs/whatsapp/cloud-api`
- Pricing & categories: `https://developers.facebook.com/docs/whatsapp/pricing`
- Changelog: `https://developers.facebook.com/docs/whatsapp/changelog`
- Twilio: `https://www.twilio.com/docs/whatsapp` + `https://www.twilio.com/docs/whatsapp/api` + `https://www.twilio.com/en-us/whatsapp/pricing`
- evolution-api: `https://doc.evolution-api.com/v2/en/get-started/introduction` + `https://github.com/EvolutionAPI/evolution-api`

---

### 4b. Automations — Triggers, Idempotency, Timezone, Anti-Spam

#### Trigger choice (explore §4.1 evaluated 5 options)

- **Primary:** `pg_cron` + `pg_net` (Supabase Postgres) → `SELECT net.http_post('https://<project>.supabase.co/functions/v1/send-whatsapp', …)` — already used for purge jobs (`0 3 * * *`), no new hosting, tz-aware, transactional. Cost $0. Requires enabling `pg_cron` + `pg_net` extensions via Dashboard > Database > Extensions.
- **Fallback:** Vercel Cron (`vercel.json: { crons: [{ path:"/api/cron/daily-digest", schedule:"0 12 * * *" }] }` → Next.js Route Handler). Chosen if Supabase extensions are restricted. Hobby allows 2 crons, so consolidate both automations into one `daily-digest` job if needed.
- **Not chosen:** `AFTER INSERT ON attendance` trigger (fires N times for batch attendance, couples hot path to network, no retry — explicitly rejected).

#### Schedule

- **Cron expression:** `0 12 * * *` UTC = **07:00 America/Bogota (UTC-5, no DST)**. Single daily job `daily-digest` handles both automations sequentially (absence first, then birthday). If sessions are strictly Saturdays, an alternative is `0 12 * * 0` (Sunday only) for absence — **decision D9**.
- **Timezone rule:** Every date comparison uses `(CURRENT_DATE AT TIME ZONE 'America/Bogota')` or `now() AT TIME ZONE 'America/Bogota'`. `sessions.session_date` is `DATE` (tz-naive) so the cron must anchor to Bogota, not UTC. Document in migration comments.
- **Grace window:** Run at 07:00 to allow overnight Dexie → PostgREST sync. Optional `session_attendance_finalized` flag deferred to design if over-inclusive absentee lists are observed (explore R6).

#### Automation 1 — Absence (day after session)

```
pg_cron 12:00 UTC ──pg_net.http_post──► Edge Function send-whatsapp { kind:"absence" }
  1. SELECT sessions WHERE session_date = (CURRENT_DATE AT TIME ZONE 'America/Bogota') - 1
     AND deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM notification_log
                     WHERE session_id=s.id AND kind='absence' AND status IN ('sent','queued'))
  2. For each session:
     SELECT absentees via anti-join (explore §4.2):
       members m LEFT JOIN attendance a ON a.member_id=m.id AND a.session_id=:sid AND a.deleted_at IS NULL
       LEFT JOIN whatsapp_numbers wn ON wn.member_id=m.id AND wn.is_primary_phone AND wn.deleted_at IS NULL
       WHERE m.deleted_at IS NULL AND a.id IS NULL
  3. For each absentee:
     - gate: whatsapp_opt_in AND whatsapp_opt_out_at IS NULL AND consent_records whatsapp_messaging exists
     - number = COALESCE(wn.number, m.phone) → normalize E.164 (libphonenumber-js), validate +57 prefix
     - POST Cloud API template absence_followup
     - INSERT notification_log (status sent|failed|skipped_no_consent|skipped_invalid_phone, provider_message_id, error)
  4. Return summary { sessions_processed, attempted, sent, skipped, failed }
```

- **Idempotency:** `UNIQUE(session_id, member_id, kind) WHERE status IN ('sent','queued')` (partial index). Re-running cron is a no-op for already-sent rows. Failed rows may be retried.
- **Edge cases:** session with zero attendance rows → notifies all active members (intentional — review in spec). Deleted session → excluded. Offline not-yet-synced → over-inclusive; mitigated by 07:00 window + optional finalized flag.

#### Automation 2 — Birthday (day-of)

```
Same cron (second step) ──► Edge Function send-whatsapp { kind:"birthday" }
  1. SELECT members WHERE deleted_at IS NULL AND birthday IS NOT NULL
     AND EXTRACT(MONTH FROM birthday)=EXTRACT(MONTH FROM CURRENT_DATE AT TIME ZONE 'America/Bogota')
     AND EXTRACT(DAY FROM birthday)=EXTRACT(DAY FROM CURRENT_DATE AT TIME ZONE 'America/Bogota')
     -- Feb 29 handling: optionally also match Feb 28 in non-leap years (decision D9)
  2. Resolve staff recipients: SELECT p.id, p.whatsapp_number FROM profiles p
     WHERE p.is_active AND p.role IN ('super_admin','leader' /* + server if D4 widens */)
     AND p.whatsapp_opt_in AND p.whatsapp_number IS NOT NULL
     AND consent_records whatsapp_messaging exists for profile
  3. Build group digest: "Hoy cumplen: Juan Pérez (35), María Gómez (40) — ¡oremos por ellos!"
  4. For each staffer: POST birthday_staff_digest template with list param
     INSERT notification_log (kind='birthday', member_id=celebrant, recipient_profile_id=staffer, …)
```

- **Idempotency:** `UNIQUE(member_id, kind, notification_date)` where `notification_date = CURRENT_DATE AT TIME ZONE 'America/Bogota'` (so a member is celebrated once per year per staffer).
- **Empty state:** If no birthdays today or no staff opted in → log `skipped_no_birthdays` / `skipped_no_recipients`, no API call.
- **Feb 29:** Spec will lock whether Feb 29 celebrants are also pinged on Feb 28 in non-leap years.

#### Anti-spam / Consent Gate (applies to both)

- Every send checks `whatsapp_opt_in` + `whatsapp_opt_out_at IS NULL` + `consent_records` (`whatsapp_messaging`) before calling the provider.
- `notification_log.status` enum includes `skipped_no_consent`, `skipped_invalid_phone`, `skipped_duplicate`.
- Monthly conversation cap read from `app_settings` (`whatsapp_monthly_cap` default 900, alert at 800) — Edge Function counts `sent` in current calendar month before sending; cap exceeded → log `skipped_cap` and surface banner in Pastoreo.
- Unsubscribe: Pastoreo action + member edit sets `whatsapp_opt_out_at = now()`; re-opt-in clears it and requires new `consent_records` row.

---

### 4c. Pastoreo Module — Route, Filters, Chronic Table, Queries, Indexes

#### Route & Access

- **Path:** `/(dashboard)/pastoreo` (Spanish, matches domain language; alternative `/shepherding` alias is non-goal).
- **Access:** `super_admin` + `leader` (RLS: `SELECT` on `members`/`attendance`/`sessions` already allows these roles; no new policies for reads). `server` excluded in MVP (decision D4).
- **Layout:** Server Components for data (RLS-aware via `createServerClient`), client filters via `useSearchParams` + `nuqs` or local state. Follows existing `(dashboard)` group conventions (`openspec/config.yaml`).

#### Filters & Tabs

| Filter | Control | Source | Default |
| -------- | --------- | -------- | --------- |
| `age_bucket` | Multi-select chips | Derived `EXTRACT(YEAR FROM age(birthday))` → buckets (decision D7) | All |
| `sex` | Multi-select | `members.sex` (new, decision D8) | All |
| `date range` | Preset + custom | `sessions.session_date BETWEEN :from AND :to` | Last 12 weeks |
| Tab | `Resumen` \| `Ausentes crónicos` \| `Cumpleaños` | — | Resumen |

- **Resumen tab:** KPI cards (total active members, attendance rate, avg per session) + bar chart by age bucket + by sex + by week.
- **Ausentes crónicos tab:** Table defined below, with "Notify via WhatsApp" bulk action (calls Edge Function with `template=shepherding_checkin`).
- **Cumpleaños tab:** Upcoming birthdays (next 30 days) + completeness warning ("N members without birthday").

#### Chronic Absentee — Exact Criterion (to be locked in spec)

> **Definition (proposed):** A member is *chronic-absent* if they had **≥1 attendance in the last 90 days**, and then **missed >2 consecutive sessions** (i.e., 3 in a row) with no `attendance` row, ordered by `sessions.session_date`. Lookback window = last 90 days; threshold = 3 missed; "consecutive" = session order, not calendar Saturdays. Calendar-Saturday variant via `generate_series` is heavier and only needed if sessions have gaps — deferred.

**Threshold parametrization:** `app_settings` keys `pastoreo_chronic_threshold` (default 3) and `pastoreo_chronic_lookback_days` (default 90) so pastoral team can tune without migration.

#### Queries & Indexes (explore §5.2 — all `CONCURRENTLY` in prod)

Core queries cited verbatim from explore (anti-join for absentees, MM-DD for birthdays, window-function for chronic). **Indexes to add:**

```sql
-- Birthday daily scan
CREATE INDEX CONCURRENTLY idx_members_birthday_month_day
  ON members ((EXTRACT(MONTH FROM birthday)), (EXTRACT(DAY FROM birthday)))
  WHERE deleted_at IS NULL AND birthday IS NOT NULL;

-- Attendance lookups (core)
CREATE INDEX CONCURRENTLY idx_attendance_member_session
  ON attendance (member_id, session_id) WHERE deleted_at IS NULL;
CREATE INDEX CONCURRENTLY idx_attendance_session
  ON attendance (session_id) WHERE deleted_at IS NULL;

-- Sessions by date
CREATE INDEX CONCURRENTLY idx_sessions_session_date
  ON sessions (session_date) WHERE deleted_at IS NULL;

-- Sex filter (after column added)
CREATE INDEX CONCURRENTLY idx_members_sex
  ON members (sex) WHERE deleted_at IS NULL;

-- Notification dedup (idempotency)
CREATE UNIQUE INDEX CONCURRENTLY uq_notification_log_dedup
  ON notification_log (session_id, member_id, kind)
  WHERE status IN ('sent','queued');
CREATE UNIQUE INDEX CONCURRENTLY uq_notification_log_birthday
  ON notification_log (member_id, kind, notification_date)
  WHERE kind='birthday' AND status IN ('sent','queued');
```

**Why materialized view is deferred:** At 100–1k members and <1k sessions, plain queries with these indexes stay <100ms (`EXPLAIN ANALYZE` to verify in design). `MATERIALIZED VIEW mv_pastoreo_stats` + `REFRESH CONCURRENTLY` via cron adds refresh complexity for no gain now (explore §5.5, assumption A2). Add only when sequential scans exceed threshold.

#### Pastoreo Table Columns

`members.name`, `age` (derived), `sex`, `last_attended_date`, `missed_streak`, `wa_number` (masked last 4), `actions` (Notify, View history). Export via SheetJS reusing `src/lib/export` pattern.

---

## 5. Architecture & Diagram

```
                    ┌─────────────────────────────────────────────────┐
                    │           Supabase Postgres 15                  │
                    │                                                 │
                    │  pg_cron (0 12 * * * UTC = 07:00 Bo)           │
                    │    │                                            │
                    │    ├── pg_net.http_post ──────────────────┐    │
                    │    │                                     │    │
                    │    ├── notification_log (audit+idempotency)    │
                    │    ├── members (+ sex, whatsapp_opt_in,        │
                    │    │           whatsapp_opt_out_at, age_years) │
                    │    ├── profiles (+ whatsapp_number,            │
                    │    │             whatsapp_opt_in)              │
                    │    ├── whatsapp_numbers + members.phone        │
                    │    ├── consent_records (whatsapp_messaging)    │
                    │    └── Vault: WHATSAPP_TOKEN,                  │
                    │              WHATSAPP_PHONE_NUMBER_ID          │
                    └──────────────────────┬──────────────────────────┘
                                           │ https://<project>.supabase.co/functions/v1/send-whatsapp
                                           ▼
                    ┌─────────────────────────────────────────────────┐
                    │     Supabase Edge Function: send-whatsapp       │
                    │  (Deno, verifies JWT, checks consent/cap,       │
                    │   normalizes E.164 via libphonenumber-js,       │
                    │   POST to Graph API, writes notification_log)   │
                    └──────────────────────┬──────────────────────────┘
                                           │ POST https://graph.facebook.com/v20.0/{phone_number_id}/messages
                                           │ Authorization: Bearer <Vault token>
                                           ▼
                    ┌─────────────────────────────────────────────────┐
                    │        Meta WhatsApp Cloud API (official)       │
                    │   Template approval, 24h window, delivery       │
                    │   receipts via webhook (optional, Phase 4)      │
                    └──────────────────────┬──────────────────────────┘
                                           │ WhatsApp message
                                           ▼
                                      Recipient phone

                    ┌─────────────────────────────────────────────────┐
                    │   Next.js 15 (Vercel) — /(dashboard)/pastoreo  │
                    │  Server Components (RLS-aware) + client filters │
                    │  Reads members/attendance/sessions/notification_log│
                    │  Actions: "Notify" → Edge Function (same)       │
                    │  Export: SheetJS                                │
                    └─────────────────────────────────────────────────┘

  Fallback path: Vercel Cron (vercel.json) → /api/cron/daily-digest (Route Handler)
                 → same Edge Function or direct WA call (if pg_net unavailable)
```

**Where secrets live:** `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` in **Supabase Vault** (pattern per `docs/vault-setup.md`), exposed to Edge Function via `supabase secrets` — never in `NEXT_PUBLIC_*` or client bundle. Rotation via Vault update + Edge Function redeploy, no code change.

**Data flow summary:**

1. `pg_cron` fires 07:00 Bo → `pg_net.http_post` invokes Edge Function with `{ kind }`.
2. Edge Function queries Postgres (service role, RLS bypass for log writes; user JWT for Pastoreo manual triggers), gates on consent/cap, normalizes phones, calls Cloud API, writes `notification_log`.
3. Pastoreo reads aggregated stats directly from Postgres via RLS-aware server client; manual "Notify" reuses same Edge Function.

---

## 6. Schema Changes (Proposed — Not Yet Migrated)

All changes follow `supabase-postgres-best-practices` (RLS on every table, `security_invoker` views, partial indexes, Vault for secrets, no `SECURITY DEFINER` without `auth.uid()` guard).

### 6.1 New columns — `members`

| Column | Type | Constraints | Default | Notes |
| -------- | ------ | ------------- | --------- | ------- |
| `sex` | `TEXT` | `CHECK (sex IN ('M','F','other','prefer_not_to_say'))` | `NULL` | Sensitive per Ley 1581; allow null for existing rows; backfill via capture form |
| `age_years` | `INT` | `GENERATED ALWAYS AS (EXTRACT(YEAR FROM age(birthday))::int) STORED` | — | Generated column for bucketing + indexing; null when birthday null |
| `whatsapp_opt_in` | `BOOLEAN` | `NOT NULL DEFAULT false` | `false` | Gate for all sends; existing members default false until re-consent |
| `whatsapp_opt_out_at` | `TIMESTAMPTZ` | `NULL` | `NULL` | Set on unsubscribe; blocks sends even if opt_in true |

Indexes: `idx_members_sex` (partial `WHERE deleted_at IS NULL`), `idx_members_birthday_month_day` (expression), `idx_members_active` (if not exists).

### 6.2 New columns — `profiles`

| Column | Type | Constraints | Default | Notes |
|--------|------|-------------|---------|-------|
| `whatsapp_number` | `TEXT` | `CHECK (whatsapp_number ~ '^\+[1-9]\d{7,14}$')` | `NULL` | E.164; needed because `auth.users.phone` is not reliably populated |
| `whatsapp_opt_in` | `BOOLEAN` | `NOT NULL DEFAULT false` | `false` | Staff must opt in to birthday digests |

### 6.3 New table — `notification_log`

```sql
CREATE TABLE notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES members(id) ON DELETE SET NULL,
  recipient_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('absence','birthday','shepherding_checkin')),
  channel TEXT NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp')),
  template_name TEXT NOT NULL, -- e.g. 'absence_followup'
  status TEXT NOT NULL CHECK (status IN ('queued','sent','failed','skipped_no_consent','skipped_invalid_phone','skipped_duplicate','skipped_no_birthdays','skipped_no_recipients','skipped_cap')),
  notification_date DATE, -- Bogota date for birthday idempotency; NULL for absence
  provider_message_id TEXT, -- returned wamid
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  created_by UUID REFERENCES profiles(id) -- NULL for cron, set for manual Pastoreo triggers
);
-- RLS: enable; policies: super_admin/leader can SELECT; service_role can INSERT/UPDATE (Edge Function)
-- No anon access.
```

Partial unique indexes (see §4c) enforce idempotency without blocking retries on `failed`.

### 6.4 New `consent_records` type

Add `consent_type = 'whatsapp_messaging'` alongside existing `personal_data` / `sensitive_religious`. No DDL — just application-level insertion with `policy_version`, `accepted_at`, `ip_address` for Ley 1581 evidence.

### 6.5 New `app_settings` keys

| Key | Value | Notes |
| ----- | ------- | ------- |
| `whatsapp_monthly_cap` | `900` | Alert at 800; blocks sends when exceeded |
| `pastoreo_chronic_threshold` | `3` | Tunable without migration |
| `pastoreo_chronic_lookback_days` | `90` | Tunable |
| `whatsapp_enabled` | `true` | Kill switch |

### 6.6 Vault secrets

- `WHATSAPP_TOKEN` (system-user access token)
- `WHATSAPP_PHONE_NUMBER_ID`

### 6.7 RLS summary (per best practices)

- `notification_log`: `ENABLE ROW LEVEL SECURITY`; `FOR SELECT TO authenticated USING (public.user_role() IN ('super_admin','leader'))`; `FOR INSERT/UPDATE` via service_role only (Edge Function). No `anon`.
- Views for Pastoreo (if any) use `WITH (security_invoker = true)` (Postgres 15).
- No `SECURITY DEFINER` functions without `auth.uid()` check and non-`public` schema.

---

## 7. WhatsApp Integration — Templates & Consent

### Templates (3 proposed — wording approved by pastoral team before submission)

| # | Template name | Language | Category | Recipient | Body (proposed, pending pastoral approval) | Variables |
| --- | --------------- | ---------- | ---------- | ----------- | --------------------------------------------- | ----------- |
| T1 | `absence_followup` | `es_CO` | Utility | Absent member | `Hola {{1}}, te extrañamos ayer en {{2}} ({{3}}). ¿Cómo estás? Oramos por ti. Si necesitas algo, responde a este mensaje. 🙏` | `{{1}}=member name`, `{{2}}=session name`, `{{3}}=session_date` |
| T2 | `birthday_staff_digest` | `es_CO` | Utility | Staff | `🎂 Hoy cumplen años: {{1}}. ¡Oremos y celebremos con ellos!` | `{{1}}=comma-separated "Juan (35), María (40)"` (or single) |
| T3 | `shepherding_checkin` | `es_CO` | Utility | Chronic absentee (manual from Pastoreo) | `Hola {{1}}, somos de {{2}}. Hace un tiempo no te vemos y queríamos saber cómo estás. ¿Podemos orar por algo?` | `{{1}}=name`, `{{2}}=community name` |

- **Category:** All `utility` (not marketing) to stay in lowest billable tier; pastoral tone, no promotion.
- **Approval:** Submit T1+T2 before Phase 1; T3 before Phase 3. Meta review is typically <1 hour for utility templates.
- **Fallback:** If a template is rejected, revise wording and resubmit; meanwhile service-window free-form is available only after a member replies (not relied upon).

### Consent — Ley 1581 (Colombia)

- **Collection:** At next capture (`/capture` form) add `whatsapp_opt_in` checkbox with explicit purpose: "Autorizo recibir mensajes pastorales vía WhatsApp (seguimiento de asistencia, cumpleaños). Puedo revocar en cualquier momento." Existing members: bulk admin toggle in `/members` edit + Pastoreo, each toggle inserts `consent_records` (`whatsapp_messaging`, `policy_version`, `accepted_at`, `ip_address` if available).
- **Sensitive data:** `sex` + `birthday` + `denomination_encrypted` are sensitive per Ley 1581 — purpose limitation, explicit consent, and RLS. `sex` column allows `prefer_not_to_say` and is excluded from default exports.
- **Evidence:** Every `whatsapp_messaging` consent row + `notification_log` row serves as audit trail for SIC. `audit_log` trigger already captures mutations; add `notification_log` to `log_mutation()` coverage.
- **Revocation:** Setting `whatsapp_opt_out_at` blocks all future sends; ARCO workflow (`arco_requests`) already exists for data-subject rights.
- **Reference:** `sdd/attendance-and-capture-platform/compliance-colombia-ley1581.md` + `https://www.sic.gov.co`.

---

## 8. Risks, Assumptions & Open Questions

### 8.1 Risks (10 — from explore §6.1, with spec/design disposition)

| # | Risk | Severity | Blocks spec? | Mitigation | Resolved in |
| --- | ------ | ---------- | -------------- | ------------ | ------------- |
| R1 | WhatsApp number ban (unofficial gateway) | High | **No** — prod uses official Cloud API | Official Cloud API only; unofficial is PoC disposable number | Proposal (decided) |
| R2 | Missing/toxic phone data (no E.164, landlines) | High | **Yes** — spec must define normalization | Normalize on write (Zod + `libphonenumber-js`), validate `+57`, admin data-quality dashboard | Spec + Design |
| R3 | Spam / Ley 1581 consent gap | High | **Yes** — consent gate is spec-blocking | `whatsapp_opt_in` + `consent_records` type + gate every send + audit | Spec |
| R4 | Message cost surprise beyond free tier | Medium | No | Cap at 900, alert at 800, `app_settings` counter, Pastoreo banner | Design |
| R5 | Cron silent failure (pg_cron/pg_net down) | Medium | No | `notification_log` + `cron.job_run_details` monitoring + Edge structured logs + Vercel fallback | Design |
| R6 | Offline attendance not yet synced at cron time | Medium | **Yes** — affects absentee correctness | 07:00 window gives overnight sync; optional `session_attendance_finalized` flag | Spec (define) / Design (implement) |
| R7 | Timezone bug (UTC vs America/Bogota) | Medium | **Yes** — must be in spec | `AT TIME ZONE 'America/Bogota'` everywhere; cron 12:00 UTC | Spec |
| R8 | `sex` column sensitivity (Ley 1581) | Medium | **Yes** — values + consent | Explicit consent, minimal values, RLS, excluded from default export | Spec |
| R9 | Template approval delay blocks launch | Low | No | Submit 3 templates early; service-window fallback | Plan (Phase 1) |
| R10 | Edge Function cold start / timeout (10s) | Low | No | Keep <5s, batch 50, `pg_net` async + queue table if needed | Design |

### 8.2 Assumptions (8 — from explore §6.2)

| # | Assumption | If wrong, impact | Validated in |
| --- | ------------ | ------------------ | -------------- |
| A1 | Group meets **Saturdays** ("siguiente día"=Sunday, "2 sábados"=2 weeks) | Absence schedule must be generic `session_date+1` | **Spec — owner confirms** (D1) |
| A2 | Member count 100–1,000 (not 10k+) → no materialized view | Pastoreo queries stay fast with indexes | Design (`EXPLAIN ANALYZE`) |
| A3 | `birthday` completeness >60% | Birthday feature shows warning if sparse | Spec (completeness report) |
| A4 | Supabase can enable `pg_cron` + `pg_net` | Fallback to Vercel Cron | **Spec — infra check** (D10) |
| A5 | Team can complete Meta Business verification in 1–2 weeks | Start on Twilio sandbox | **Owner — D1** |
| A6 | WhatsApp opt-in collectable at next capture + bulk admin | Need re-consent campaign if not | Spec (UX) |
| A7 | Pastoreo visible to `leader`+`super_admin` (not `server`) | RLS policy change if widened | **Owner — D4** |
| A8 | Vercel Hobby suffices (2 crons → consolidate) | Need Pro or single digest job | Design |

### 8.3 Open Questions (12 — from explore §6.3, prioritized)

| # | Question | Blocks spec? | Proposed default (for fast approval) |
| --- | ---------- | -------------- | -------------------------------------- |
| Q1 | Meta Business verification — does church have Business Manager + NIT + display name? Who owns WABA? | **Yes** | Assume not yet; start Twilio sandbox Day 1, submit verification in parallel |
| Q2 | Phone ownership — new dedicated number or port existing? Who pays after free tier? | **Yes** | New Meta-hosted test number for pilot; production number deferred to Phase 1 exit |
| Q3 | Opt-in collection for existing members | **Yes** | Bulk admin toggle + `consent_records` insert; capture form checkbox going forward |
| Q4 | Birthday recipients — all staff or only leader/super_admin? One digest or per-celebrant? | **Yes** | `leader`+`super_admin` only; one group digest per day (cost-efficient) |
| Q5 | Absence message tone — who approves wording? | **Yes** | Pastoral lead approves T1–T3 before submission; templates in §7 are draft |
| Q6 | Chronic threshold — >2 vs ≥3, Saturdays vs sessions, lookback | **Yes** | 3 missed in a row after ≥1 attendance in last 90 days (session-order) — tunable via `app_settings` |
| Q7 | Age buckets | No | `0-12, 13-17, 18-25, 26-35, 36-50, 51+` (explore §5.2) — confirm in spec review |
| Q8 | Sex field values | **Yes** | `M, F, other, prefer_not_to_say` — minimal + Ley 1581 safe |
| Q9 | Scheduling time — 07:00 Bo or afternoon? | No | 07:00 Bo (12:00 UTC) — gives overnight sync window; afternoon is opt-in later |
| Q10 | Edge Functions vs Vercel Cron preference | **Yes** | `pg_cron`+`pg_net`+Edge primary; Vercel Cron fallback only if extensions blocked |
| Q11 | Materialized view — defer? | No | Defer; add only if `EXPLAIN ANALYZE` >100ms at scale |
| Q12 | evolution-api self-host if Meta blocked — allowed? | No | Allowed as temporary PoC only with disposable number and explicit owner sign-off |

**Spec-blocking subset (must answer before spec):** Q1, Q2, Q3, Q4, Q5, Q6, Q8, Q10 (8 of 12). Q7, Q9, Q11, Q12 can be resolved in design without blocking spec.

---

## 9. Deliverables & Acceptance Criteria

### What "proposal approved" means

- Product owner has answered the 8 spec-blocking decisions in §12 (or accepted proposed defaults).
- This proposal is merged to `openspec/changes/whatsapp-pastoreo-notifications/proposal.md` and Engram.
- `spec` phase is unblocked and can define user stories, API contracts, and RLS tests.

### What triggers spec/design

- Owner approval (explicit comment or approval label) on this proposal.
- If owner accepts defaults, spec can start immediately with those defaults recorded as assumptions.

### Success criteria (measurable, verified in `sdd-verify`)

| # | Criterion | How measured |
| --- | ----------- | -------------- |
| C1 | 100% of absent members (opted-in, valid E.164) are notified exactly once the next day, with zero duplicates on re-run | `notification_log` counts vs anti-join; re-run cron and assert no new `sent` rows |
| C2 | Birthday coverage: every member with `birthday` today generates one digest per opted-in staffer, zero on days with no birthdays | `notification_log` where `kind='birthday'` grouped by date |
| C3 | Idempotency: re-running `daily-digest` for same date inserts zero new `sent`/`queued` rows | Unique partial indexes + integration test |
| C4 | Pastoreo renders for `leader`/`super_admin`, denies `server` (MVP), all filters work, chronic table matches definition | Playwright E2E + RLS tests (vitest) |
| C5 | Consent gate: no WhatsApp call is made when `whatsapp_opt_in=false` or `whatsapp_opt_out_at` set or no `consent_records` | Unit test on Edge Function gate |
| C6 | Timezone correctness: session on Saturday notifies Sunday 07:00 Bo (12:00 UTC) regardless of UTC date boundary | Integration test with `AT TIME ZONE` |
| C7 | Cost at launch $0 (within 1,000 free conversations/month); cap enforcement at 900 | `app_settings` counter + Edge Function check |
| C8 | `strict_tdd` compliance: RLS policies have dedicated tests, Edge Function has unit tests, Pastoreo has E2E | `npx vitest` + `npx playwright test` green |

---

## 10. Phased Plan & Estimation

| Phase | Scope | Key outputs | Effort | Infra cost |
| ------- | ------- | ------------- | -------- | ------------ |
| **Phase 0 — Prep** | Migrations: `sex`, `age_years` (generated), `whatsapp_opt_in/out`, `profiles.whatsapp_number`, `notification_log`, `app_settings` keys, indexes (`CONCURRENTLY`), Vault secrets, enable `pg_cron`+`pg_net` | Migration 012, Vault setup, extension enablement | 1–2 days | $0 |
| **Phase 1 — Edge + Cloud API** | `supabase/functions/send-whatsapp` (Deno, `libphonenumber-js`, Vault token), 3 Meta templates submitted, Twilio sandbox PoC for local validation | Edge Function deployed, templates in review, sandbox E2E | 2–3 days | $0 |
| **Phase 2 — Automations** | `pg_cron` daily-digest (12:00 UTC), idempotency indexes, consent/cap gates, phone normalization, `cron.job_run_details` logging | Cron jobs + `notification_log` populated, no duplicates | 1–2 days | $0 |
| **Phase 3 — Pastoreo MVP** | Route `/(dashboard)/pastoreo` (Resumen / Ausentes crónicos / Cumpleaños), age/sex/time filters, chronic query, SheetJS export, manual "Notify" (shepherding_checkin) | Dashboard live, RLS-correct, export works | 3–5 days | $0 |
| **Phase 4 — Hardening** | Phone normalization on write, consent UX (`/capture` checkbox, `/members` toggle), conversation-cap banner, monitoring (Edge logs + `job_run_details`), ARCO/1581 review, Feb 29 & timezone edge tests | Hardened, auditable, monitored | 1–2 days | $0 |

**Total:** 8–14 days incremental, **$0/mo** until >1,000 service conversations; then ~$8–15/mo at ~500 members / ~200 msgs/mo (explore §3.3). No new hosting beyond existing Supabase + Vercel.

**Delivery strategy (ask-on-risk):** Budget is 400 lines — Phases 0–2 fit one PR slice; Phase 3 (Pastoreo UI) is the natural second slice; Phase 4 hardening a third. If the estimator flags chained PRs, apply `auto-chain` with `stacked-to-main`.

---

## 11. Alternatives Considered & Discarded

| Alternative | Why considered | Why discarded |
| ------------- | ---------------- | --------------- |
| `AFTER INSERT ON attendance` trigger for fan-out | Real-time, seemingly simple | Fires N times for batch attendance, couples hot write path to network, no retry, blocks insert latency. Cron + Edge is decoupled and retryable. |
| Unofficial gateway (evolution-api/Ultramsg/Whapi) as production | No Business verification, instant start, low cost | Violates WhatsApp ToS → ban risk, not auditable for Ley 1581, phone must stay online. Reserved as PoC fallback only. |
| Materialized view `mv_pastoreo_stats` now | Faster aggregations | Premature at <10k members; adds `REFRESH CONCURRENTLY` complexity and staleness. Start with indexed plain queries; add when `EXPLAIN ANALYZE` proves need. |
| Vercel Cron as primary (instead of pg_cron) | No DB extension, lives with Next.js | Hobby allows 2 crons (consolidation needed), cold start, needs `CRON_SECRET` auth. Kept as fallback, not primary. |
| `SECURITY DEFINER` helper for notification reads | Bypass RLS for Edge Function | Bypasses RLS silently; violates best practices. Use service_role + Vault-scoped Edge Function, or `security_invoker` views. |
| 360dialog / WATI as provider | Official BSP with inbox | €49–$49/mo subscription + Meta fees — no free tier, overkill for outbound-only at this scale. |

---

## 12. Decisions Needed from Product Owner

Answering the 8 spec-blocking items unlocks `spec`; the rest can be decided in design. **Proposed defaults are pre-filled so the owner can approve by saying "accept defaults" — only deviations need explicit answers.**

| # | Decision | Why it blocks | Proposed default (approve to proceed) | Explicit choices |
| --- | ---------- | --------------- | ---------------------------------------- | ------------------ |
| **D1** | Meta Business verification owner & timeline | Determines provider path | Start Twilio sandbox immediately; submit Meta verification in parallel (1–2 weeks, NIT required) | (a) Accept default (b) Church already has WABA (provide ID) (c) Skip Meta, stay on Twilio |
| **D2** | WhatsApp number — new vs port, who pays after free tier | Affects Vault setup + cost | New Meta-hosted test number for pilot; production number deferred | (a) Accept (b) Port existing number (provide number) (c) Dedicated new number now |
| **D3** | Opt-in collection for existing members | Consent gate is spec-blocking | Bulk admin toggle + `consent_records` insert; capture form checkbox going forward | (a) Accept (b) Require in-person re-consent campaign (c) Other |
| **D4** | Who sees Pastoreo / who gets birthday digests | RLS + template fan-out | Pastoreo: `leader`+`super_admin`; birthday: same set, one group digest per day | (a) Accept (b) Include `server` (c) Different set (specify) |
| **D5** | Pastoral wording for 3 templates | Template approval is on critical path | Drafts in §7 (friendly, non-shaming) — pastoral lead approves/revises | (a) Accept drafts (b) Revised wording (attach) |
| **D6** | Chronic absentee definition | Core Pastoreo query | 3 missed in a row after ≥1 attendance in last 90 days (session-order), tunable | (a) Accept (b) 2 missed / different lookback / calendar Saturdays |
| **D7** | Age buckets | Filter UX | `0-12, 13-17, 18-25, 26-35, 36-50, 51+` | (a) Accept (b) Custom buckets (list) |
| **D8** | `sex` field values & sensitivity handling | Ley 1581, column CHECK | `M, F, other, prefer_not_to_say` (nullable, RLS, excluded from default export) | (a) Accept (b) M/F only (c) Different set |
| **D9** | Scheduling time + Feb 29 handling | Cron + query correctness | 07:00 Bo (12:00 UTC) daily-digest; Feb 29 also matched on Feb 28 in non-leap years | (a) Accept (b) Different time (specify) (c) Feb 29 only on actual date |
| **D10** | `pg_cron`+`pg_net`+Edge vs Vercel Cron | Architecture choice | `pg_cron`+`pg_net`+Edge primary; Vercel fallback if extensions blocked | (a) Accept (b) Vercel Cron primary (c) Other |
| **D11** | Materialized view now or defer | Performance vs complexity | Defer until proven by `EXPLAIN ANALYZE` | (a) Accept (b) Build now |
| **D12** | evolution-api self-host allowed as PoC fallback if Meta blocked | Risk posture | Allowed temporarily with disposable number + explicit sign-off | (a) Accept (b) Never, even for PoC |

**Fastest path to spec:** Reply **"Accept defaults for D1–D12"** (or list exceptions by number). Spec will record the chosen values as assumptions and proceed.

---

## 13. Proposal Question Round

> **Context:** Preflight noted the user declined the questionnaire (defaults applied, `execution_mode=auto`). Per the SDD contract this section preserves the question envelope that would have improved the PRD — product owner can answer, skip, correct framing, or request a second round. Answering the 8 spec-blocking decisions in §12 is sufficient to unblock `spec`.

**Proposed product questions (had the round run):**

1. **Business problem:** Is the primary pain "leaders forget to follow up" or "leaders lack data to prioritize visits" — which justifies Pastoreo vs automations first?
2. **Target users:** Should a `server` ever see Pastoreo, or is shepherding strictly a `leader`/`super_admin` responsibility?
3. **Business rules:** Does Ley 1581 re-consent require a fresh signature for existing members, or is an admin toggle with audit log sufficient?
4. **Edge cases:** When a session has zero attendance rows (no one marked), should every active member be considered absent or should the session be ignored?
5. **Tradeoffs:** If you must cut one of the three fronts for a 1-week slice, which stays: absence, birthdays, or Pastoreo?

**Assumptions needing owner review (from §8):** A1 (Saturday invariant), A3 (birthday completeness), A5 (verification timeline), A7 (Pastoreo visibility). If any is wrong, spec must adapt before design.

---

## 14. Risks to This Proposal Itself

- **Verification latency:** If Meta Business verification stalls, Phase 1 is gated — mitigated by Twilio sandbox PoC.
- **Data quality:** Sparse `birthday`/`phone` reduces automation coverage — mitigated by completeness dashboard and normalization.
- **Scope creep:** Adding inbox/conversational flows would multiply effort — explicitly non-goal (N1/N2).
- **Timezone regression:** Any future migration that stores `session_date` as TIMESTAMPTZ without `AT TIME ZONE` guard reintroduces bug — documented as invariant.

---

## 15. Rollback & Safety

- **Kill switch:** `app_settings.whatsapp_enabled = false` disables all sends without code change (Edge Function early-return + Pastoreo banner).
- **Cron disable:** `SELECT cron.unschedule('daily-digest')` reverts scheduling.
- **Migration rollback:** New columns are additive + nullable/defaulted; new table `notification_log` is isolated — dropping them is non-destructive to existing data. Indexes are `CONCURRENTLY` and droppable.
- **Vault rotation:** Token rotation requires only Vault update + Edge redeploy.

---

## 16. Success Criteria for This Proposal Phase

- [ ] Product owner has reviewed §§1–12 and either accepted defaults or provided explicit choices for D1–D12.
- [ ] 8 spec-blocking decisions are recorded (or defaults affirmed).
- [ ] Architecture (§5) and schema (§6) are agreed as the basis for spec.
- [ ] Next phase `sdd-spec` is authorized to define user stories, API contracts, RLS tests, and template copy.

---

## Sources

Explore artifact (authoritative): `openspec/changes/whatsapp-pastoreo-notifications/explore.md` §1–§9 + Engram `sdd/whatsapp-pastoreo-notifications/explore`.

Verification URLs (re-fetch as `.md` / `search_docs` before spec — pricing changes frequently), from explore §8:
`https://developers.facebook.com/docs/whatsapp/cloud-api`, `https://developers.facebook.com/docs/whatsapp/pricing`, `https://developers.facebook.com/docs/whatsapp/changelog`, `https://www.twilio.com/docs/whatsapp`, `https://www.twilio.com/docs/whatsapp/api`, `https://www.twilio.com/en-us/whatsapp/pricing`, `https://doc.evolution-api.com/v2/en/get-started/introduction`, `https://github.com/EvolutionAPI/evolution-api`, `https://supabase.com/docs/guides/database/extensions/pg_cron`, `https://supabase.com/docs/guides/database/extensions/pg_net`, `https://supabase.com/docs/guides/functions`, `https://supabase.com/docs/guides/database/vault`, `https://vercel.com/docs/cron-jobs`, `https://www.sic.gov.co`.

---

## Key Learnings

1. Meta WhatsApp Cloud API is the only zero-cost official path for 100-1000 member pastoral notifications and must be gated by Vault secrets and Ley 1581 consent records.
2. Pastoreo chronic absentee definition requires explicit product sign-off on threshold and lookback to avoid off-by-one query errors in window-function logic.
3. Supabase pg_cron plus pg_net to Edge Function is preferred over Vercel Cron for daily digest scheduling due to existing purge job precedent and transactional audit via notification_log.
4. WhatsApp provider ToS and Colombian data protection constraints make unofficial gateways unsuitable for production despite lower verification friction.
5. Deferring materialized views for Pastoreo analytics is justified below ten thousand members when partial indexes on birthday and attendance cover the query patterns.
