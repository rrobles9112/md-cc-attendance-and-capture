# Exploration — WhatsApp Pastoreo Notifications

> **Change:** `whatsapp-pastoreo-notifications`
> **Date:** 2026-02-14
> **Status:** exploration (no code)
> **Artifact store:** `both` — file `openspec/changes/whatsapp-pastoreo-notifications/explore.md` + Engram `sdd/whatsapp-pastoreo-notifications/explore`
> **Authors:** SDD explore executor (Muse Spark)

---

## 1. Executive Summary

**What was investigated:**

- Full codebase mapping of `md-cc-attendance-and-capture` (Next.js 15.5 + Supabase Postgres 15 + Dexie offline-first). Read `src/`, `supabase/migrations/*`, `supabase/config.toml`, `supabase/seed.sql`, `openspec/specs/*`, `openspec/config.yaml`, `package.json`, `README.md`, `src/lib/sync/db.ts`, `src/lib/rbac/*`, `src/lib/supabase/*`, `src/app/(dashboard)/attendance/*`, `src/workers/sw.ts`.
- Web research on free/low-cost WhatsApp APIs usable from Colombia/LatAm (Meta Cloud API, Twilio, 360dialog, Ultramsg, Whapi.cloud, WATI, Wassenger, CallMeBot, evolution-api self-hosted). **Note:** no live `webfetch` tool was available in the execution sandbox; research is synthesized from knowledge cutoff 2026-01-04 plus the project's prior hosting research artifacts, with canonical doc URLs cited for verification.
- Feasibility of three automations: (1) absence follow-up the day after a session, (2) birthday notifications to staff, (3) Pastoreo analytics module (age/sex/time cohorts + chronic absentee >2 Saturdays).

**Headline findings:**

1. **No existing WhatsApp integration, cron, or Edge Function** — the only scheduled jobs are three `pg_cron` purge jobs (`members`/`sessions`/`attendance`, `0 3 * * *`). Vercel Cron is not configured. `supabase/functions/` does not exist. The app has **zero server-side notification infrastructure** today.
2. **Data model gaps for Pastoreo:** `members` has `birthday DATE` and `is_minor BOOLEAN` but **no `sex`/`gender` column**; age must be derived from `birthday` (nullable, sparse). Phones live in `members.phone` + `whatsapp_numbers.number`; no consent flag specific to WhatsApp messaging; no `notification_log` / `message_templates` / `opt_out` tables.
3. **Best zero-cost path for WhatsApp is Meta WhatsApp Cloud API** (1,000 free service conversations/month, no per-message cost inside the 24h window) behind a Supabase Edge Function + `pg_cron`/`pg_net` trigger. Twilio is best DX for sandbox/testing but not free at scale. For a truly zero-friction fallback without Meta Business verification, **Ultramsg or Whapi.cloud** (unofficial) and **CallMeBot** (free but unreliable) are options — not recommended for production due to ToS risk.
4. **All three automations are feasible with Postgres + pg_cron + Edge Functions** — no new hosting needed. Vercel Cron is a viable alternative if the team prefers Next.js Route Handlers over Edge Functions.

---

## 2. Codebase Findings

### 2.1 Stack & Repo Layout (verified)

| Dimension | Value |
| --- | --- |
| Framework | Next.js 15.5.22 (App Router, `src/app/(dashboard)/*`), React 19, TS 5.8 `strict: true` |
| Styling | Tailwind 4.1.8 + Radix UI + `shadcn/ui` + `lucide-react` |
| Backend | Supabase Cloud (Postgres 15, PostgREST, Realtime `postgres_changes`, Auth, `pgcrypto`, `pg_cron` guarded) |
| Offline | Dexie 4.0.11 (`AttendanceCaptureDB` — `members`, `sessions`, `attendance`, `social_media`, `whatsapp_numbers`, `sync_queue`) + service worker `src/workers/sw.ts` (BackgroundSync + iOS `setInterval` 30s fallback) |
| Export | SheetJS (`xlsx`) client-side |
| Hosting | Vercel (`vercel --prod` in `deploy-production.yml`); no `vercel.json` cron config |
| Config | `supabase/config.toml` (`port 54321/54322/54323`, `major_version = 15`, `seed.sql` via `[db.seed]`); `openspec/config.yaml` (`strict_tdd: true`, `persistence.mode: both`) |
| Env | `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (browser) + `SUPABASE_SERVICE_ROLE_KEY` (server-only) — exact vars verified via `src/lib/supabase/{client,server}.ts` |

### 2.2 Domain Model (source: `supabase/migrations/001_initial_schema.sql`, `src/lib/sync/db.ts`, `supabase/seed.sql`)

**`profiles`** — `id UUID PK → auth.users`, `full_name TEXT`, `role app_role ENUM ('super_admin','leader','server')`, `is_active BOOL`, `created_at/updated_at TIMESTAMPTZ`. Auto-created by `handle_new_user()` trigger (default `server`). RBAC enforced via `public.user_role()` helper (now COALESCE `profiles.role` + `auth.jwt()->'app_metadata'->>'role'`, see `006_fix_rls_*`).

**`members`** — `id UUID PK`, `name / name_normalized TEXT`, `phone TEXT NOT NULL`, `email TEXT NOT NULL`, `birthday DATE NULLABLE`, `is_minor BOOL DEFAULT false`, `legal_rep_name TEXT`, `has_whatsapp BOOL`, `consent_recorded / sensitive_consent_recorded BOOL`, `denomination_encrypted / community_name_encrypted BYTEA` (`pgcrypto` `pgp_sym_encrypt`), `duplicate_flag BOOL`, `created_by UUID→profiles`, `created_at/updated_at TIMESTAMPTZ`, `deleted_at TIMESTAMPTZ` (soft delete). No `sex`/`gender`, no `age` column, no `whatsapp_opt_in` / `blocked` flag.

**`whatsapp_numbers`** — `id UUID`, `member_id UUID→members CASCADE`, `number TEXT` (E.164 like `+57300…` in seed), `is_primary_phone BOOL`, `created_at`, `deleted_at`. Separate from `members.phone` — integration must union both.

**`social_media`** — `id`, `member_id`, `platform`, `handle`, `created_at`, `deleted_at`.

**`sessions`** — `id UUID`, `name TEXT` (e.g. `"Grupo de Oración — Mañana"`), `session_date DATE NOT NULL` ← **the session date field** (not `created_at`), `created_by UUID→profiles`, `created_at`, `deleted_at`. Seed uses `CURRENT_DATE - 1` / `CURRENT_DATE`.

**`attendance`** — `id UUID`, `member_id→members`, `session_id→sessions`, `marked_by→profiles`, `marked_at TIMESTAMPTZ DEFAULT now()`, `deleted_at TIMESTAMPTZ`, `UNIQUE(member_id, session_id)`. How attendance is taken: UI in `src/app/(dashboard)/attendance/page.tsx` → `AttendanceGrid` component, hydrated from Dexie, flushed via `sync_queue` → PostgREST upsert; realtime via `useRealtime` on `attendance`/`sessions`. Any role can `INSERT` attendance; only `super_admin` can update/delete (RLS).

**`consent_records`** — `member_id`, `consent_type TEXT` (`personal_data` / `sensitive_religious`), `policy_version TEXT`, `accepted_at TIMESTAMPTZ`, `ip_address INET`. Ley 1581 evidence — one row per consent type per member.

**`arco_requests`** / **`audit_log`** / **`app_settings`** — ARCO workflow table, append-only audit (trigger `log_mutation()` `SECURITY DEFINER` on all mutable tables), KV settings (seed: `dpo_contact_email`).

**Dexie mirror** (`src/lib/sync/db.ts:1-60`): `members` indexed on `name_normalized, phone, email, deleted_at, duplicate_flag`; `sessions` on `session_date, deleted_at`; `attendance` on `member_id, session_id, [member_id+session_id]`; `sync_queue` on `status, table_name, created_at`. Version 1 only.

### 2.3 Roles & Permissions (source: `src/lib/rbac/types.ts`, `001_initial_schema.sql` RLS, `README.md`)

| Role | Create member/session | Modify/Delete | Mark attendance | Admin panel | Export | ARCO |
| --- | --- | --- | --- | --- | --- | --- |
| `super_admin` | ✅ | ✅ (soft+hard) | ✅ | ✅ (users/audit/arco/settings/sync/purge) | ✅ | ✅ |
| `leader` | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ (can insert) |
| `server` | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |

Enforced in Postgres RLS; frontend guards (`src/lib/rbac/guards.ts`) are UX-only. `attendance_insert` allows all three roles.

### 2.4 Session Date & Attendance Flow (where to hook WhatsApp)

- **Session date field:** `sessions.session_date :: DATE` (not `sessions.created_at`). Groups appear to meet on **Saturdays** (per the Pastoreo spec: `>2 sábados sin asistir`). Need to confirm weekday invariant — if sessions are always Saturday, scheduling simplifies to `session_date + 1 day = Sunday`.
- **Attendance taken:** per-session grid (`AttendanceGrid`), persisted to Dexie → `sync_queue` (`pending → syncing → done/failed`) → PostgREST. Realtime channel `postgres_changes` on `attendance` broadcasts presence.
- **Phones:** `members.phone` (canonical) + `whatsapp_numbers.number` (multi-number). Seed stores `+573…` E.164. Real data quality unknown — must normalize before WhatsApp (strip spaces, ensure `+57` prefix, validate via `libphonenumber-js` or similar).
- **Birthdays:** `members.birthday DATE` nullable. Seed covers `1990-03-15`, `1985-07-22`, `1995-11-02`, `1988-01-09`, `2012` (minor). No `birthday` index today.
- **Age/sex for Pastoreo:** `is_minor` exists but `sex`/`gender` does not. Age must be derived: `EXTRACT(YEAR FROM age(birthday))` or `date_part`. Cohort queries will need a new column or consistent derivation.

### 2.5 Existing Jobs / Cron / Notification Infra

| Infra | Present? | Evidence |
| --- | --- | --- |
| `pg_cron` | ✅ (guarded) | `001_initial_schema.sql:417-428` — three `cron.schedule('purge-old-deletes*', '0 3 * * *', ...)` inside `IF EXISTS (pg_extension WHERE extname='cron')`. No notification jobs. |
| `pg_net` / `http` extension | ❌ | Not referenced anywhere in migrations or `config.toml`; needed for Edge Function invocation from DB. |
| Supabase Edge Functions | ❌ | `supabase/functions/` does not exist; `docs/vault-setup.md:42` shows an *example* `supabase/functions/decrypt-sensitive/index.ts` but no deployed function. |
| Supabase Cron (newer) | ❌ | Not used; project still on legacy `pg_cron` path. |
| Vercel Cron | ❌ | No `vercel.json` with `crons` key; workflows in `.github/workflows/*` only handle CI/CD + nightly Lighthouse. |
| Queues (`pgmq`/`pgboss`) | ❌ | No extension enabled. |
| Notification tables | ❌ | No `notification_log`, `message_templates`, `opt_outs`, `wa_conversations` table. |
| Supabase Vault | ⚠️ planned | `docs/vault-setup.md` documents Vault for `pgcrypto` key; pattern reusable for WhatsApp API tokens. |

**Extension surface in DB:** only `pgcrypto` confirmed. `supabase/config.toml` does not declare `pg_cron` or `pg_net` — enable via Dashboard > Database > Extensions (or `CREATE EXTENSION` if self-hosted).

### 2.6 Integration Points for WhatsApp

1. **After `attendance` flush** — optimistic hook: a DB trigger `AFTER INSERT ON attendance` or a `pg_cron` job that runs `session_date + 1 day` and calls an Edge Function via `pg_net.http_post`. Preferred: **cron + Edge Function** (decoupled, retryable, no trigger latency on hot path).
2. **Birthday daily scan** — `pg_cron` `0 7 * * *` (America/Bogota) → Edge Function that queries `members WHERE EXTRACT(MONTH FROM birthday)=... AND EXTRACT(DAY FROM birthday)=...` and fans out to `super_admin`/`leader`/`server` who have opted in.
3. **Pastoreo module** — new Next.js route `/(dashboard)/pastoreo` (or `/shepherding`) with server components querying Supabase (RLS-aware) + client filters (age/sex/time). Data layer: new Postgres views/materialized views + indexes (see §5). Notification action from Pastoreo (e.g., "notify chronic absentees") reuses the same Edge Function.

### 2.7 Gaps & Required Schema Additions

| Gap | Impact | Fix |
| --- | --- | --- |
| No `members.sex` / `members.gender` | Pastoreo breakdown by sex impossible | Add `sex TEXT CHECK IN ('M','F','other','prefer_not_to_say')` or `gender` column; backfill + UI in `/members` + `/capture` |
| No computed `age` or `age_bucket` | Repetitive `age(birthday)` math; no index | Add generated column `age_years INT GENERATED ALWAYS AS (EXTRACT(YEAR FROM age(birthday))::int) STORED` or view; or compute in query + index on `birthday` |
| `birthday` nullable + sparse | Birthday automation misses members | Enforce at capture time; add `WHERE birthday IS NOT NULL` guard + admin completeness report |
| No WhatsApp consent / opt-out | Ley 1581 / WhatsApp ToS violation risk | Add `members.whatsapp_opt_in BOOL`, `whatsapp_opt_out_at TIMESTAMPTZ`, `consent_records` type `whatsapp_messaging` |
| No `notification_log` | No audit, no idempotency, no retry visibility | New table `notification_log (id, member_id, session_id, kind, channel, template_name, status, provider_message_id, error, created_at, sent_at)` |
| No `cron_job_runs` | Silent cron failures | Log table + Edge Function structured logs |
| Phone normalization | Invalid E.164 causes API 400s | Normalize on write (DB trigger or Zod), validate with `libphonenumber-js` |
| No Edge Function / `pg_net` | No way to call WhatsApp from DB | Create `supabase/functions/send-whatsapp`, enable `pg_net`, store token in Vault |
| `whatsapp_numbers.deleted_at` but no purge job | Orphaned numbers accumulate | Add to existing purge or new cron |
| Timezone handling | `session_date DATE` is tz-naive; cron at `0 3 * * *` is UTC | Standardize on `America/Bogota` (UTC-5); use `AT TIME ZONE 'America/Bogota'` in queries |

---

## 3. WhatsApp API Comparative Matrix

> Prices in USD unless noted. Free tiers as of knowledge cutoff 2026-01-04; verify before committing (provider pricing changes frequently).
> Official docs URLs provided for re-verification.

### 3.1 Summary Table

| # | Provider | Category | Official Cloud / Unofficial | Free Tier | Paid Model (after free) | Requires Own Number? | Template Approval? | Needs Own Server? | Session vs Template | Latency | Best For |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **1** | **Meta WhatsApp Cloud API** (via Meta) | Official | Official (Meta-hosted) | **1,000 free *service* conversations / month** + free utility conversations within 24h window (2024+ converged pricing); no monthly fee. Each conversation = 24h window per user. | Per-conversation fee by category (Marketing ~$0.04-0.07, Utility ~$0.01-0.02, Service free inside window, varies by country). Colombia rates slightly above US. | No — uses Meta-hosted number (can also bring own). Business verification required for scale; sandbox works instantly. | **Yes** for outbound *marketing/utility outside 24h window* (template must be pre-approved, ~minutes-hours). Inside 24h *service* window — free-form allowed. | No | Template (outbound, >24h) vs Session (free-form, ≤24h after user reply) | Low (Meta infra) | **Recommended #1** — true zero cost at small scale, official, scalable |
| **2** | **Twilio API for WhatsApp** | Official (via Meta) | Official (Twilio as BSP) | Sandbox free (unlimited for testing, but pre-approved sandbox number + join code); **no production free tier** — trial credit ~$15 then pay-as-you-go. | Base: Twilio fee + Meta conversation fee passthrough. ~$0.005/msg Twilio + Meta per-conversation fee on top. | No (Twilio provisions) | Yes (Twilio review + Meta template approval) | No | Same template/session split (enforced by Meta) | Low | **Recommended #2** — best DX/sandbox, good for PoC before switching to direct Meta |
| **3** | **360dialog** | Official BSP | Official | No free tier; 30-day trial possible. **Starts ~€49/mo** (starter) + Meta fees. | Subscription + Meta fees | No (360dialog business number) | Yes | No | Template/session | Low | Enterprise BSP — not zero-cost; skip for this project |
| **4** | **WATI** | Official BSP (UI + API) | Official | 14-day trial; **starts ~$49/mo** | Subscription (inbox + automation) + Meta fees | No | Yes | No | Template/session | Low | Omnichannel inbox — overkill; not free |
| **5** | **Ultramsg** | Unofficial (REST wrapper over web session) | Unofficial | Free trial ~30 days / limited messages (varies, ~100 msgs). **Starts ~$10-29/mo** | Subscription per instance | **Yes** — your own phone + QR scan | No (free-form) | No (hosted) | Free-form only | Medium | Low-friction fallback; ToS risk (unofficial) |
| **6** | **Whapi.cloud** | Unofficial (REST wrapper) | Unofficial | Free tier **~100 msgs** or 3-day trial; then **from ~$5-20/mo** | Subscription per channel | Yes — own phone | No | No | Free-form | Medium | Similar to Ultramsg; good free quick test |
| **7** | **Wassenger** | Unofficial | Unofficial | Free trial; **from ~$19/mo** | Subscription per number | Yes — own phone | No | No | Free-form | Medium | Similar to Ultramsg |
| **8** | **CallMeBot** | Unofficial (free gateway) | Unofficial | **Free, no API key needed** (rate-limited, requires user to add bot contact) | Free (donation) | No (bot number) | No | No | Free-form | High / unreliable | Last-resort free ping; **not production** |
| **9** | **evolution-api** (self-hosted) | Unofficial (open-source) | Unofficial | **Free (self-host)** — you pay VPS only (~$6-12/mo) | VPS cost + your number | **Yes** — own phone + QR | No | **Yes** — you host (Node.js + Redis/Postgres + WebSocket) | Free-form | Medium (your infra) | Free-forever if you can host; highest ops burden |

**Doc URLs to verify (fetch as `.md` or via MCP `search_docs`):**

- Cloud API overview & pricing: `https://developers.facebook.com/docs/whatsapp/cloud-api` + `https://developers.facebook.com/docs/whatsapp/pricing` (or `business.facebook.com/wa/manage/phone` pricing tab)
- Cloud API free tier / conversation categories: `https://business.facebook.com/help/…` and Meta changelog `https://developers.facebook.com/docs/whatsapp/changelog`
- Twilio WhatsApp: `https://www.twilio.com/docs/whatsapp` + `https://www.twilio.com/docs/whatsapp/api` + `https://www.twilio.com/en-us/whatsapp/pricing`
- 360dialog: `https://www.360dialog.com/pricing` + `https://docs.360dialog.com`
- WATI: `https://www.wati.io/pricing`
- Ultramsg: `https://ultramsg.com/pricing` + `https://docs.ultramsg.com`
- Whapi.cloud: `https://whapi.cloud/pricing` + `https://whapi.cloud/docs`
- Wassenger: `https://wassenger.com/pricing`
- CallMeBot: `https://www.callmebot.com/blog/free-api-whatsapp-messages/`
- evolution-api: `https://doc.evolution-api.com/v2/en/get-started/introduction` + `https://github.com/EvolutionAPI/evolution-api`

### 3.2 Detailed Notes per Provider

#### A. Meta WhatsApp Cloud API — Recommended #1 (zero-cost, official)

- **How it works:** You create a Meta Business + WhatsApp Business Account, verify, get a `phone_number_id` + `access_token` (system user or temporary). Send via `POST https://graph.facebook.com/v20.0/{phone_number_id}/messages` with `{ messaging_product:"whatsapp", to, type:"template"|"text" }`.
- **Free tier (as of 2024-2025 converged pricing):** 1,000 free *service* conversations per month per WABA (reset monthly). Utility conversations inside the 24h service window are also effectively free. Marketing outside window is billable. For a church prayer group of ~100-500 members with weekly sessions, **1,000 service conversations covers all absence + birthday pings** without cost for months.
- **Template requirement:** Any outbound message *outside* the 24h window must use a pre-approved template (Meta review, typically <1 hour for simple templates). Inside 24h after a user replies, free-form allowed. Strategy: register 3 templates upfront — `absence_followup`, `birthday_staff_digest`, `shepherding_checkin`.
- **Number:** Meta provides a test number instantly; production number requires business verification (Colombia: NIT + business docs + display name approval). Can also port existing number via BSP.
- **Pros:** Official, lowest cost, no vendor markup, scales to millions, compliant, webhooks for delivery/read receipts.
- **Cons:** Business verification friction (1-3 days Colombia), template approval step, need to manage token rotation (Vault + Edge Function), conversation window mental model.
- **Latency:** <2s typical.
- **Colombia compliance:** Official channel satisfies SIC expectations for auditable, consent-based messaging.

#### B. Twilio API for WhatsApp — Recommended #2 (best DX for PoC)

- **How it works:** Same Meta infra behind Twilio abstraction. `POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json` with `From=whatsapp:+1415…&To=whatsapp:+57300…&Body`. Twilio handles token + webhook plumbing.
- **Free tier:** Sandbox is free forever for testing (user joins via `join <code>` to sandbox number). Production trial gives ~$15 credit. After that, **Twilio per-message fee (~$0.005) + Meta conversation fee** — so not free, but cheap for low volume (~$5-10/mo for 500 msgs).
- **Pros:** Best docs/DX, sandbox no verification, queues/retries built-in, easy to swap to direct Meta later.
- **Cons:** Not zero-cost in production; adds vendor markup over direct Meta; still needs template approval for outbound.
- **Use:** Start PoC on Twilio sandbox → validate flows → migrate to direct Meta Cloud API for prod to eliminate markup.

#### C. 360dialog / WATI — BSPs (skip for zero-cost goal)

- Both are official BSPs with inboxes, automation, multi-agent. Pricing is SaaS subscription + Meta fees. No meaningful free tier. Only relevant if the church wants a human inbox alongside automation — out of scope for minimal PoC.

#### D. Ultramsg / Whapi.cloud / Wassenger — Unofficial gateways (fallback)

- Wrap a real WhatsApp Web session via QR scan. No Meta business verification, instant start, low cost. **Risk:** violates WhatsApp ToS (§ "no unofficial clients"), number can be banned; no template system; reliability depends on phone staying online. Acceptable for internal PoC if Meta verification is blocked, but **must not be the production path** for a Ley 1581-sensitive app.

#### E. CallMeBot — Free but toy

- Free GET `https://api.callmebot.com/whatsapp.php?phone=…&text=…&apikey=…` — requires each recipient to first message the bot to opt in. Rate-limited, no delivery guarantees, plaintext API key. Useful for a personal alert, not for 500-member pastoral notifications.

#### F. evolution-api — Self-hosted (free-forever, high ops)

- Open-source Node.js gateway that drives WhatsApp Web via Baileys/WebSocket. You host on a VPS (Railway/Fly/Render/Supabase self-host). Truly free (VPS cost only), supports webhooks, multi-instance. **Cost:** $6-12/mo VPS + ops time (QR re-auth, updates, monitoring). **Risk:** unofficial → ban risk; you own uptime. Good fit if the church already runs infra and wants zero vendor dependency.

### 3.3 Preliminary Recommendation (ordered)

| Priority | Option | When to choose | Monthly cost at ~500 members / ~200 msgs/mo |
| --- | --- | --- | --- |
| **1** | **Meta WhatsApp Cloud API (direct)** via Supabase Edge Function | Default production path. Zero cost for months, official, auditable. | **$0** until >1,000 service conversations/mo; then ~$8-15 |
| **2** | **Twilio sandbox → Cloud API** | If you want fastest PoC (no business verification). Validate flows in days, then cut over to #1. | $0 sandbox → then migrate |
| **3** | **evolution-api self-hosted** (or Ultramsg/Whapi as hosted interim) | If Meta business verification is blocked for weeks or you need a non-template free-form fallback without waiting. | ~$8 VPS or ~$10/mo hosted |

**Not recommended for prod:** CallMeBot, 360dialog/WATI at this scale (cost).

---

## 4. Automation Feasibility — Triggers & Scheduling

### 4.1 Common Trigger Options (evaluated)

| Trigger | How | Pros | Cons | Cost | Fits this stack? |
| --- | --- | --- | --- | --- | --- |
| **`pg_cron` + `pg_net`** (Supabase Postgres) | `cron.schedule('job', '0 7 * * *', $$ SELECT net.http_post(...) $$)` calls Edge Function | Runs inside DB, no extra hosting, already used for purge, tz-aware, transactional | Requires enabling `pg_cron` + `pg_net` extensions; `pg_net` is async (fire-and-forget, need log table); debugging via `cron.job_run_details` | $0 (included in Supabase) | **Yes — recommended** (native to Supabase) |
| **Supabase Cron (new)** | Dashboard > Cron > Schedule Edge Function | Simpler UI than `pg_cron`, directly invokes Edge Function | Newer feature, less docs; still backed by `pg_cron` underneath | $0 | Viable alternative |
| **Vercel Cron** | `vercel.json: { "crons": [{ "path":"/api/cron/…", "schedule":"0 7 * * *" }] }` → Next.js Route Handler | No DB extension needed; lives with Next.js code; easy local test | Requires Vercel Pro for >2 crons? Hobby allows 2; needs `CRON_SECRET` auth; cold start | $0-20 | **Viable alternative** if team prefers Next.js over Edge Functions |
| **Supabase Edge Function + external scheduler** (GitHub Actions `schedule: cron`) | `on: schedule` workflow `curl` the function | Zero DB changes | GitHub Actions minute cost, less reliable, 5-min granularity | $0 | Workable but indirect |
| **DB trigger `AFTER INSERT ON attendance`** | `CREATE TRIGGER … EXECUTE FUNCTION notify_absentees()` | Real-time | Bad idea for batch attendance (would fire N times), couples hot path to network, no retry, blocks write | $0 | **Not recommended** |

**Recommendation:** **`pg_cron` + Edge Function via `pg_net`** as primary; **Vercel Cron** as fallback if Supabase extensions are restricted. Both are zero-cost and already partially adopted.

### 4.2 Automation 1 — Absence Notification (day after session)

**Spec:** "Al día siguiente de tomar asistencia, notificar a ausentes del día de sesión."

**Trigger choice:** `pg_cron` daily at `07:00 America/Bogota` ( = `12:00 UTC` ). For strict "session_date + 1 day" semantics, two designs:

- **Option A (simple):** One daily job that finds all `sessions` with `session_date = CURRENT_DATE - 1` (in Bogota tz) and fans out to absentees. Works if sessions are not all on Saturday.
- **Option B (Saturday-aware):** If sessions are exclusively Saturdays, schedule `0 7 * * 0` (Sunday 07:00 Bogota) and query `session_date = CURRENT_DATE - 1`. Fewer irrelevant runs.

**Efficient Postgres — find absentees for a session:**

```sql
-- Absentees for a given session (anti-join; uses UNIQUE(member_id, session_id) index)
SELECT m.id, m.name, m.phone, m.birthday,
       COALESCE(wn.number, m.phone) AS wa_number
FROM members m
LEFT JOIN attendance a
  ON a.member_id = m.id
 AND a.session_id = :session_id
 AND a.deleted_at IS NULL
LEFT JOIN whatsapp_numbers wn
  ON wn.member_id = m.id AND wn.is_primary_phone AND wn.deleted_at IS NULL
WHERE m.deleted_at IS NULL
  AND a.id IS NULL;  -- no attendance row = absent

-- All sessions needing notification (yesterday's sessions not yet notified)
SELECT s.id, s.name, s.session_date
FROM sessions s
WHERE s.deleted_at IS NULL
  AND s.session_date = (CURRENT_DATE AT TIME ZONE 'America/Bogota') - INTERVAL '1 day'
  AND NOT EXISTS (
    SELECT 1 FROM notification_log nl
    WHERE nl.session_id = s.id AND nl.kind = 'absence' AND nl.status IN ('sent','queued')
  );
```

**Idempotency:** gate on `notification_log` (`UNIQUE(session_id, member_id, kind)` partial index where `status != 'failed'`) so re-running the cron does not double-send.

**Flow:**

```
pg_cron (07:00 Bo) → pg_net.http_post → Edge Function /send-whatsapp
  → SELECT absentees (query above)
  → for each absentee:
      - check whatsapp_opt_in / not opted-out
      - pick number (whatsapp_numbers.is_primary_phone ?? members.phone)
      - normalize E.164
      - POST to WhatsApp API (template: absence_followup)
      - INSERT notification_log (status='sent' | 'failed', provider_message_id, error)
  → return summary
```

**Edge cases:** session with zero attendance rows (all absent) — still notifies all active members (intentional?). Session deleted after — excluded via `deleted_at`. Offline attendance that hasn't synced yet — absentee list may be over-inclusive; mitigate by running at 07:00 (gives overnight sync window) or adding a "grace period" flag.

### 4.3 Automation 2 — Birthday Notification (day-of)

**Spec:** "Notificar a servidores/líder/superadmin el día del cumpleaños."

**Trigger choice:** Same `pg_cron` daily at `07:00 America/Bogota`, before or combined with absence job. Could be a single `daily-digest` job that handles both.

**Query — members whose birthday is today (MM-DD match, leap-year aware):**

```sql
-- Members with birthday today (Bogota tz)
SELECT m.id, m.name, m.birthday,
       EXTRACT(YEAR FROM age(m.birthday))::int AS age_today
FROM members m
WHERE m.deleted_at IS NULL
  AND m.birthday IS NOT NULL
  AND EXTRACT(MONTH FROM m.birthday) = EXTRACT(MONTH FROM (CURRENT_DATE AT TIME ZONE 'America/Bogota'))
  AND EXTRACT(DAY   FROM m.birthday) = EXTRACT(DAY   FROM (CURRENT_DATE AT TIME ZONE 'America/Bogota'));

-- For Feb 29 birthdays in non-leap years, optionally also match Feb 28:
  AND (
    (EXTRACT(MONTH FROM m.birthday)=2 AND EXTRACT(DAY FROM m.birthday)=29
     AND NOT is_leap_year(EXTRACT(YEAR FROM CURRENT_DATE)::int)
     AND EXTRACT(MONTH FROM CURRENT_DATE)=2 AND EXTRACT(DAY FROM CURRENT_DATE)=28)
    OR (normal match)
  )
```

**Recipients — staff to notify:** `profiles WHERE role IN ('server','leader','super_admin') AND is_active = true`. Need a mapping from profile to WhatsApp number — **gap:** `profiles` has no phone column; join via `auth.users.phone` or add `profiles.phone` / `profiles.whatsapp_number`. Alternative: notify via app inbox + email first; WhatsApp to staff requires storing their WA numbers.

**Fan-out:** for each `birthday_member`, send one digest per staff member (or group digest: "Hoy cumplen: Juan (35), María (40)"). Group digest is cheaper (1 msg per staff vs N msgs). Template: `birthday_staff_digest` with list param.

**Idempotency:** `notification_log` with `kind='birthday'` + `member_id` + `CURRENT_DATE`.

### 4.4 Automation 3 — Pastoreo Triggers (manual + scheduled digests)

Pastoreo is **not** a push notification per se but a **dashboard + optional scheduled digest**. Two triggers:

- **On-demand:** user opens `/(dashboard)/pastoreo`, applies filters (age bucket, sex, time range, tab "Ausentes crónicos"), sees table + export.
- **Scheduled digest (optional):** weekly `pg_cron` `0 7 * * 1` (Monday 07:00) that computes chronic absentees and sends digest to `leader`/`super_admin` via WhatsApp.

No new infra beyond the two jobs above.

---

## 5. Pastoreo Module — Deep Analysis

### 5.1 Required Slices

| Slice | Dimension | Current Data | Gap | Query Pattern |
| --- | --- | --- | --- | --- |
| By age range | Buckets e.g. 0-12, 13-17, 18-25, 26-35, 36-50, 51+ | `birthday` (nullable), `is_minor` | No `sex`/`gender`, `birthday` sparse | `EXTRACT(YEAR FROM age(birthday))` bucketed via `CASE` |
| By sex | M/F/other | **No column** | Need `sex` column | `GROUP BY sex` |
| By time range | Weekly / monthly | `sessions.session_date` + `attendance.marked_at` | None | `WHERE session_date BETWEEN :from AND :to` |
| Chronic absentees | >2 consecutive Saturdays (or >2 sessions) without attendance after a valid attendance | `attendance` + `sessions` | Need definition of "consecutive" + "valid" | Anti-join + window function (see §5.2) |

### 5.2 Efficient Postgres Queries & Indexes

**Indexes to add (all `CONCURRENTLY` in prod):**

```sql
-- Birthday scan (daily)
CREATE INDEX CONCURRENTLY idx_members_birthday_month_day
  ON members (EXTRACT(MONTH FROM birthday), EXTRACT(DAY FROM birthday))
  WHERE deleted_at IS NULL AND birthday IS NOT NULL;

-- Attendance lookups (core)
CREATE INDEX CONCURRENTLY idx_attendance_member_session
  ON attendance (member_id, session_id) WHERE deleted_at IS NULL;
CREATE INDEX CONCURRENTLY idx_attendance_session
  ON attendance (session_id) WHERE deleted_at IS NULL;

-- Sessions by date
CREATE INDEX CONCURRENTLY idx_sessions_session_date
  ON sessions (session_date) WHERE deleted_at IS NULL;

-- Soft-delete filtered index (already implied by RLS but helps queries)
CREATE INDEX CONCURRENTLY idx_members_active
  ON members (id) WHERE deleted_at IS NULL;

-- Future: sex filter
CREATE INDEX CONCURRENTLY idx_members_sex
  ON members (sex) WHERE deleted_at IS NULL;

-- Notification dedup
CREATE UNIQUE INDEX CONCURRENTLY uq_notification_log_dedup
  ON notification_log (session_id, member_id, kind) WHERE status IN ('sent','queued');
```

**Query — attendance stats by age bucket (for a time range):**

```sql
WITH member_age AS (
  SELECT id, name, sex, birthday,
         CASE
           WHEN birthday IS NULL THEN NULL
           WHEN EXTRACT(YEAR FROM age(birthday)) < 13 THEN '0-12'
           WHEN EXTRACT(YEAR FROM age(birthday)) < 18 THEN '13-17'
           WHEN EXTRACT(YEAR FROM age(birthday)) < 26 THEN '18-25'
           WHEN EXTRACT(YEAR FROM age(birthday)) < 36 THEN '26-35'
           WHEN EXTRACT(YEAR FROM age(birthday)) < 51 THEN '36-50'
           ELSE '51+'
         END AS age_bucket
  FROM members WHERE deleted_at IS NULL
),
session_range AS (
  SELECT id, session_date FROM sessions
  WHERE deleted_at IS NULL
    AND session_date BETWEEN :from AND :to
),
attendance_in_range AS (
  SELECT a.member_id, a.session_id
  FROM attendance a
  JOIN session_range s ON s.id = a.session_id
  WHERE a.deleted_at IS NULL
)
SELECT ma.age_bucket,
       COUNT(DISTINCT ma.id) AS total_members,
       COUNT(DISTINCT air.member_id) AS members_with_attendance,
       COUNT(air.*) AS total_checkins
FROM member_age ma
LEFT JOIN attendance_in_range air ON air.member_id = ma.id
GROUP BY ma.age_bucket
ORDER BY ma.age_bucket;
```

**Query — chronic absentees (>2 consecutive Saturdays without attendance after a valid attendance):**

Definition to lock in proposal: "A member is chronic-absent if they had at least one attendance in the last 90 days, and then missed the next 3 consecutive sessions (or >2 Saturdays) with no attendance row."

```sql
WITH ordered_sessions AS (
  SELECT id, session_date,
         ROW_NUMBER() OVER (ORDER BY session_date) AS rn
  FROM sessions
  WHERE deleted_at IS NULL
    AND session_date BETWEEN :from AND :to  -- e.g. last 90 days
),
member_last_attendance AS (
  SELECT a.member_id, MAX(s.session_date) AS last_attended_date,
         MAX(s.rn) AS last_attended_rn
  FROM attendance a
  JOIN ordered_sessions s ON s.id = a.session_id
  WHERE a.deleted_at IS NULL
  GROUP BY a.member_id
),
missed_streak AS (
  SELECT mla.member_id,
         COUNT(os.id) AS missed_count
  FROM member_last_attendance mla
  JOIN ordered_sessions os
    ON os.rn > mla.last_attended_rn
  LEFT JOIN attendance a
    ON a.member_id = mla.member_id
   AND a.session_id = os.id
   AND a.deleted_at IS NULL
  WHERE a.id IS NULL
  GROUP BY mla.member_id
)
SELECT m.id, m.name, m.phone, m.birthday,
       mla.last_attended_date,
       ms.missed_count
FROM missed_streak ms
JOIN member_last_attendance mla ON mla.member_id = ms.member_id
JOIN members m ON m.id = ms.member_id
WHERE m.deleted_at IS NULL
  AND ms.missed_count > 2
ORDER BY ms.missed_count DESC, mla.last_attended_date ASC;
```

**Alternative simpler definition** (if "consecutive" is not strictly session-order but calendar Saturdays): generate Saturdays via `generate_series` and check attendance per Saturday. More expensive but handles gaps where no session was created.

**Materialized view?** For <10k members and <1k sessions, plain queries with indexes are sufficient. Consider `MATERIALIZED VIEW mv_pastoreo_stats` + `REFRESH MATERIALIZED VIEW CONCURRENTLY` via cron only if the dashboard feels slow at 50k+ rows or if multiple filters hit the same aggregation. Start without; add when `EXPLAIN ANALYZE` shows sequential scans >100ms.

### 5.3 Pastoreo UI Sketch (no code, for proposal)

- Route `/(dashboard)/pastoreo` — accessible to `super_admin` + `leader` (maybe `server` read-only; decide in proposal).
- Filters: `age_bucket` (multi-select), `sex` (multi-select), `date range` (preset: last 4/8/12 weeks + custom), `tab` (Resumen | Ausentes crónicos | Cumpleaños).
- Table: member, age, sex, last attendance, missed streak, WA number, action (Notify via WhatsApp).
- Export: reuse `SheetJS` pattern from `/export`.
- RLS: Pastoreo queries run as authenticated user; RLS already allows `leader`/`super_admin` to read members/attendance/sessions. No new policies needed for reads.

### 5.4 Data Needed for Pastoreo (checklist for proposal)

- [ ] Add `members.sex` (and maybe `gender_identity` if needed) — migration + backfill + capture form
- [ ] Add `members.whatsapp_opt_in` / `opt_out` + `whatsapp_messaging` consent type
- [ ] Normalize `birthday` completeness — admin report of members without birthday
- [ ] Add `notification_log` table (also serves WhatsApp audit)
- [ ] Add `profiles.whatsapp_number` or join to `auth.users` phone
- [ ] Decide age buckets (confirm with pastoral team)
- [ ] Decide chronic threshold ( >2 vs ≥3, Saturdays vs sessions, lookback window)

### 5.5 Risks Specific to Pastoreo

- `sex`/`gender` is sensitive under Ley 1581 if linked to other attributes — requires explicit consent and purpose limitation. Store minimal, allow `prefer_not_to_say`.
- Age derived from `birthday` is PII — ensure RLS + no export of raw birthday to unauthorized roles.
- Chronic absentee logic has off-by-one risks (missed 2 vs 3 Saturdays) — needs pastoral sign-off and tests.

---

## 6. Risks, Assumptions, Open Questions

### 6.1 Risks

| # | Risk | Severity | Mitigation |
| --- | --- | --- | --- |
| R1 | WhatsApp number ban (if using unofficial gateway) | High | Use official Cloud API for prod; unofficial only for PoC with disposable number |
| R2 | Missing/toxic phone data (no E.164, landlines, typos) | High | Normalize on write + validation + admin data-quality dashboard |
| R3 | Spam / Ley 1581 consent gap (sending WA without opt-in) | High | Add `whatsapp_opt_in` + new `consent_records` type; gate every send; log consent evidence |
| R4 | Message cost surprise beyond free tier | Medium | Cap `notification_log` per month; alert at 800 conversations; dashboard counter |
| R5 | Cron silent failure (pg_cron down, pg_net timeout) | Medium | `notification_log` + `cron.job_run_details` monitoring; Edge Function structured logs; Vercel Cron fallback |
| R6 | Offline attendance not yet synced at cron time | Medium | Run cron at 07:00 (overnight sync window); add `session_attendance_finalized` flag if needed |
| R7 | Timezone bug (UTC vs America/Bogota) | Medium | Use `AT TIME ZONE 'America/Bogota'` everywhere; store cron as UTC 12:00 for 07:00 Bo |
| R8 | `sex` column sensitivity (Ley 1581) | Medium | Explicit consent, minimal values, RLS, no export by default |
| R9 | Template approval delay blocks launch | Low | Submit templates early (3 templates); use service-window free-form as fallback |
| R10 | Edge Function cold start / timeout (Supabase free tier 10s) | Low | Keep function <5s; batch in chunks of 50; use `pg_net` async + queue table if needed |

### 6.2 Assumptions (to confirm in proposal)

- A1: Prayer group meets on **Saturdays** (so "siguiente día" = Sunday, "2 sábados" = 2 weeks). If schedule varies, absence logic must be `session_date + 1 day` generically.
- A2: Member count ~100-1,000 (not 10k+), so no materialized view needed initially.
- A3: `members.birthday` completeness is moderate (>60% has value); otherwise birthday feature shows "N members without birthday" warning.
- A4: Supabase project can enable `pg_cron` + `pg_net` (on Supabase Cloud these are available via Dashboard > Extensions; no self-host needed).
- A5: Team can complete Meta Business verification (NIT, display name) within 1-2 weeks; otherwise start on Twilio sandbox.
- A6: WhatsApp opt-in can be collected at next capture + via bulk admin action (existing members).
- A7: Pastoreo visible to `leader` + `super_admin` (not `server`) — confirm.
- A8: Vercel Hobby plan suffices (2 crons); if 3+ crons needed, consolidate into one `daily-digest` job.

### 6.3 Open Questions for Proposal

1. **Business verification:** Does the church have a Meta Business Manager + verified business (NIT) + approved display name? Who owns the WABA?
2. **Phone ownership:** Will the church use a new dedicated WhatsApp number or port an existing one? Who pays Meta conversation fees after free tier?
3. **Opt-in collection:** How to collect WhatsApp opt-in for existing ~N members — bulk import, in-person re-consent, or admin toggle?
4. **Recipient for birthday pings:** All `server`+`leader`+`super_admin` or only `leader`/`super_admin`? One digest per staff or one group message?
5. **Absence message tone:** Pastoral template wording — who approves? Needs to be friendly, not shaming.
6. **Chronic threshold:** Is ">2 sábados sin asistir tras asistencia válida" = 3 missed in a row after at least 1 attendance? Confirm lookback (last 30/60/90 days?).
7. **Age buckets:** Confirm pastoral buckets (suggest 0-12, 13-17, 18-25, 26-35, 36-50, 51+ but let team decide).
8. **Sex field values:** Which values to offer? `M/F` only or include `other/prefer_not_to_say`? Any pastoral sensitivity?
9. **Scheduling time:** Is 07:00 America/Bogota the right time for notifications, or should it be afternoon?
10. **Materialized view:** Defer until perf issue proven — agree?
11. **Edge Functions vs Vercel Cron:** Preference? Supabase-native (`pg_cron`+Edge) or Vercel-native (`vercel.json` crons + Route Handlers)?
12. **Evolution-api self-host:** Is self-hosting an option if Meta verification stalls, or must prod be official?

---

## 7. Preliminary Recommendation

### 7.1 Recommended Architecture (zero-cost start)

```
Supabase Postgres 15
  ├── pg_cron (07:00 Bo daily) ──pg_net.http_post──► Supabase Edge Function: send-whatsapp
  │         │                                          ├── verifies whatsapp_opt_in + normalizes E.164
  │         │                                          ├── POST https://graph.facebook.com/v20.0/{id}/messages
  │         │                                          │     (token from Vault)
  │         │                                          └── INSERT notification_log + return summary
  │         │
  │         └── queries: absentees (anti-join), birthdays (MM-DD), chronic absentees (window)
  │
  ├── NEW TABLE notification_log (audit + idempotency)
  ├── NEW COLUMNS members.sex, members.whatsapp_opt_in, profiles.whatsapp_number
  ├── NEW INDEXES (birthday, attendance, sessions, notification dedup)
  └── Vault secret: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID

Next.js 15 (Vercel)
  └── NEW ROUTE /(dashboard)/pastoreo
        ├── filters: age_bucket, sex, date range, tab
        ├── tables: stats by bucket + chronic list + birthday list
        ├── actions: "Notify via WhatsApp" (calls Edge Function)
        └── export: SheetJS (reuse pattern)

WhatsApp provider: Meta Cloud API (direct) — 1,000 free service conversations/mo
  └── fallback PoC: Twilio sandbox (no verification)
  └── fallback if blocked: evolution-api self-host or Ultramsg/Whapi (unofficial)
```

### 7.2 Phased Rollout

| Phase | Scope | Cost | Effort |
| --- | --- | --- | --- |
| **Phase 0 — Prep** | Migrations: `sex`, `whatsapp_opt_in`, `notification_log`, indexes; Vault secret; enable `pg_cron`+`pg_net` | $0 | 1-2 days |
| **Phase 1 — Edge Function + Cloud API** | `supabase/functions/send-whatsapp` + 3 Meta templates (`absence_followup`, `birthday_staff_digest`, `shepherding_checkin`) + Twilio sandbox PoC | $0 | 2-3 days |
| **Phase 2 — Automations** | `pg_cron` jobs for absence (daily) + birthday (daily) + idempotency via `notification_log` | $0 | 1-2 days |
| **Phase 3 — Pastoreo MVP** | Dashboard `/(dashboard)/pastoreo` with age/sex/time filters + chronic query + export + manual "Notify" button | $0 | 3-5 days |
| **Phase 4 — Hardening** | Phone normalization, consent gate, `cron.job_run_details` monitoring, monthly conversation cap, ARCO/1581 review | $0 | 1-2 days |

**Total incremental infra cost at launch:** **$0/mo** (within 1,000 free Cloud API conversations). At scale (~500 members, ~200 notifications/mo), still $0 for 5+ months. After free tier: ~$8-15/mo.

### 7.3 What Not to Do

- Do not use `AFTER INSERT` triggers for fan-out (hot path coupling, no retry).
- Do not start with unofficial gateway for prod (ban risk + Ley 1581 audit risk).
- Do not add materialized view prematurely (adds refresh complexity for no gain at <10k members).
- Do not store WhatsApp tokens in `NEXT_PUBLIC_*` or client code (Vault only).

---

## 8. Sources & Verification URLs

> All URLs to be re-fetched as `.md` or via MCP `search_docs` before proposal — pricing changes frequently.

- Meta WhatsApp Cloud API — `https://developers.facebook.com/docs/whatsapp/cloud-api` (and `.md` variant)
- Meta pricing & conversation categories — `https://developers.facebook.com/docs/whatsapp/pricing`
- Meta changelog (pricing convergence 2024-2025) — `https://developers.facebook.com/docs/whatsapp/changelog`
- Twilio WhatsApp docs — `https://www.twilio.com/docs/whatsapp` + `https://www.twilio.com/en-us/whatsapp/pricing`
- Twilio WhatsApp API reference — `https://www.twilio.com/docs/whatsapp/api`
- 360dialog docs & pricing — `https://docs.360dialog.com` + `https://www.360dialog.com/pricing`
- WATI pricing — `https://www.wati.io/pricing`
- Ultramsg docs & pricing — `https://docs.ultramsg.com` + `https://ultramsg.com/pricing`
- Whapi.cloud docs & pricing — `https://whapi.cloud/docs` + `https://whapi.cloud/pricing`
- Wassenger pricing — `https://wassenger.com/pricing`
- CallMeBot free API — `https://www.callmebot.com/blog/free-api-whatsapp-messages/`
- evolution-api docs — `https://doc.evolution-api.com/v2/en/get-started/introduction` + `https://github.com/EvolutionAPI/evolution-api`
- Supabase pg_cron — `https://supabase.com/docs/guides/database/extensions/pg_cron`
- Supabase pg_net — `https://supabase.com/docs/guides/database/extensions/pg_net`
- Supabase Edge Functions — `https://supabase.com/docs/guides/functions`
- Supabase Vault — `https://supabase.com/docs/guides/database/vault`
- Supabase Cron (new) — `https://supabase.com/docs/guides/cron`
- Vercel Cron Jobs — `https://vercel.com/docs/cron-jobs`
- Colombian Ley 1581 compliance — `https://www.sic.gov.co` (Superintendencia de Industria y Comercio) + project `sdd/attendance-and-capture-platform/compliance-colombia-ley1581.md`

---

## 9. Appendix — Key File References

| File | Why it matters |
| --- | --- |
| `supabase/migrations/001_initial_schema.sql` | Full DDL, RLS, `pg_cron` purge, seed |
| `supabase/migrations/006_fix_rls_write_policies_and_user_role.sql` | Current `user_role()` impl |
| `supabase/migrations/011_youth_retreat_preregistration.sql` | Latest migration (retreat tables) — pattern for new migrations |
| `supabase/config.toml` | Ports, PG 15, `db.seed` |
| `supabase/seed.sql` | Demo data shape (phones `+573…`, birthdays, sessions `CURRENT_DATE`) |
| `src/lib/sync/db.ts` | Dexie schema, indexes |
| `src/lib/rbac/types.ts` | Role permissions |
| `src/lib/supabase/{client,server}.ts` | Supabase client factories (env vars) |
| `src/app/(dashboard)/attendance/page.tsx` | Attendance flow entry point |
| `src/workers/sw.ts` | Offline sync (BackgroundSync + iOS fallback) |
| `openspec/config.yaml` | `strict_tdd: true`, `persistence.mode: both` |
| `docs/vault-setup.md` | Vault pattern for secrets |
| `sdd/attendance-and-capture-platform/compliance-colombia-ley1581.md` | Ley 1581 analysis |

---

*End of exploration. Next phase: `sdd-propose` will turn the recommendation (§7) + open questions (§6.3) into a scoped proposal with delivery strategy.*
