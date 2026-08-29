# Exploration: retreat-valientes-transfer

> **Artifact store:** `openspec` — file `openspec/changes/retreat-valientes-transfer/explore.md` + Engram `sdd/retreat-valientes-transfer/explore`
> **Change:** `retreat-valientes-transfer` (tentative — naming evaluated in §8, alternatives: `retreat-to-valientes`, `youth-retreat-valientes-transfer`)
> **Date:** 2026-08-27
> **Mode:** strict_tdd=true, artifact_store=openspec, RDD ON (global on)
> **Workspace:** `/Users/richard.robles/PycharmProjects/MD_CC_ATTENDANCE_AND_CAPTURE`
> **Upstream:** `youth-retreat-preregistration` (011), `youth-retreat-payments` (011), `retreat-member-preinterest` (013, archived 2026-08-27) + `whatsapp-pastoreo-notifications` (012a-d)

---

## 1. Context & Current State (verified against repo)

### 1.1 Schema — retreat domain (real DDL)

| Source | Finding |
|--------|---------|
| `supabase/migrations/011_youth_retreat_preregistration.sql` | `retreat_registrations` isolated domain: `id UUID PK`, `event_key TEXT NOT NULL` (constant `retiro-juvenil-octubre-2026`), `name TEXT NOT NULL`, `phone TEXT NOT NULL`, `email TEXT NOT NULL`, `birthday DATE`, `is_minor BOOLEAN`, `legal_rep_name TEXT`, `status TEXT CHECK (preinscrito \| pagos_parciales \| inscrito) DEFAULT preinscrito`, `general_consent_accepted_at TIMESTAMPTZ NOT NULL`, `general_consent_policy_version TEXT NOT NULL`, `sensitive_consent_accepted_at`, `sensitive_consent_policy_version`, `denomination TEXT`, `community_name TEXT`, `created_at`, `updated_at`. Unique indexes expression-based: `(event_key, lower(btrim(email)))` and `(event_key, regexp_replace(btrim(phone),'[^0-9]',''))`. `retreat_payments`: `id PK`, `registration_id UUID FK retreat_registrations`, `amount NUMERIC(12,2) CHECK >0`, `recorded_by UUID FK profiles`, `created_at`. Indexes: `retreat_payments_registration_id_idx`. RLS: `REVOKE ALL` anon/PUBLIC, `SELECT` for `authenticated` leader/super_admin, `INSERT` on payments for same. Triggers: `retreat_payments_guard_total()` validates `app_settings.retreat.youth.total_cost` is present, numeric >0 and `amount>0`; `retreat_payments_apply_status()` computes `SUM(amount)` per `registration_id` and sets `status` (`0 => preinscrito`, `0<sum<total => pagos_parciales`, `sum>=total => inscrito`). RPC `register_retreat_preinscription` `SECURITY DEFINER SET search_path=''` with `GRANT TO anon, authenticated`, normalizes name/btrim, email lower/btrim, phone digits-only, derives `is_minor` via `age(CURRENT_DATE, birthday)`, requires general consent, gates sensitive fields on `p_sensitive_consent`. `app_settings.retreat.youth.total_cost` seeded as empty `''` — no numeric default (intentional). |
| `supabase/migrations/013_retreat_member_link.sql` | Additive nullable `member_id UUID REFERENCES members(id) ON DELETE SET NULL`, partial index `retreat_registrations_member_id_idx WHERE member_id IS NOT NULL`, idempotent `DO $$` guard, `COMMENT`, `NOTIFY pgrst`. RPC `register_retreat_preinscription_for_member(p_member_id uuid, p_birthday date, p_legal_rep_name text, p_general_consent boolean, p_sensitive_consent boolean, p_denomination text, p_community_name text)` `SECURITY DEFINER SET search_path=''` with `GRANT TO authenticated` only, internal `user_role() IN ('leader','super_admin')` gate else `42501`, `SELECT ... FROM members WHERE id=p_member_id AND deleted_at IS NULL`, pre-check `EXISTS (member_id = p_member_id OR lower(btrim(email))=v_email OR regexp_replace(phone)=v_phone)` same `event_key` → `already_preinscribed` `23505`, sensitive gating, `EXCEPTION WHEN unique_violation → already_preinscribed`. Preserves `members` untouched, no backfill (`member_id IS NULL` for public rows). |
| `supabase/migrations/001_initial_schema.sql` | `members`: `id, name, name_normalized, phone, email, birthday, is_minor, legal_rep_name, has_whatsapp, consent_recorded, sensitive_consent_recorded, denomination_encrypted BYTEA, community_name_encrypted BYTEA, duplicate_flag, created_by FK profiles, created_at, updated_at, deleted_at`. No `group`, no `pastoral_group`, no `valientes` column, no `groups` table. RLS: `SELECT` for `super_admin/leader/server` where `deleted_at IS NULL`; `INSERT` for `super_admin/leader`; `UPDATE/DELETE` for `super_admin` only. `app_role` enum `super_admin, leader, server`. `profiles`: `id FK auth.users, full_name, role app_role DEFAULT server, is_active, created_at, updated_at`. `attendance`, `sessions`, `social_media`, `whatsapp_numbers`, `consent_records`, `arco_requests`, `audit_log`, `app_settings`. `user_role()` `SECURITY DEFINER` reading `auth.jwt()`. `log_mutation()` audit. `handle_new_user()` creates `profiles` as `server`. |
| `supabase/migrations/012a-d` | `members` additive: `sex`, `whatsapp_opt_in`, `whatsapp_opt_out_at`, `age_years GENERATED`, `whatsapp_number` on profiles, `notification_log`, vault helpers. Retreat untouched. Confirms retreat is additive, not attendance. |
| `supabase/tests/retreat_rls.test.sql` | 52+ `PASS` blocks: anon SELECT/DML denied on retreat tables, anon RPC inserts `preinscrito` with consent on row and does not touch `members/consent_records`, validation (missing name/phone/email/consent/minor), duplicate email/phone rejected via `unique_violation`, sensitive gating, payment refused when `total_cost` missing/empty/0/negative/non-numeric or amount <=0, `status` machine `0 → preinscrito`, `40/100 → pagos_parciales`, `100/100 → inscrito` without members insert, overpay `80+50 → inscrito`, server denied INSERT payments, super_admin sets total, leader cannot, plus compact 013 block: `member_id` idx exists, leader creates linked preinscrito, missing consent `23514`, minor gates, dup member/email/phone `23505`, deleted member `P0002`, anon/server denied `42501`, sensitive false/true, pagos_parciales/inscrito via payments. |
| Grep `valientes/Valientes/groups` across repo | **Zero hits in `supabase/migrations`, `src/lib`, `src/app`** (only `facebook.com/groups` and `public/manifest.json` prayer groups). Means **no `groups` table, no `members.group` column, no `valientes` enum/value exists**. Must be designed in this change. |
| Grep `members.group`, `community` in src | Only `CaptureForm` `communityName` (retreat-sensitive) and `members` encrypted `community_name_encrypted` — semantically **religious community (denominación)**, not pastoral attendance group "Valientes". Unrelated to transfer target. |
| File `src/lib/settings/app-settings.ts` | Helpers `getSetting(key)`, `setSetting(key,value)` via `app_settings` `upsert` with `updated_by = auth.uid()`. `RETREAT_TOTAL_COST_KEY='retreat.youth.total_cost'`, `getRetreatTotalCost()`, `setRetreatTotalCost(v)` — used by retreat page. RLS on `app_settings`: `SELECT` for all roles, `UPDATE` for `super_admin` only (leader blocked). |
| `src/lib/rbac/guards.ts` + `types.ts` | `canManageRetreatRegistrations = canCreate` → `leader, super_admin` (`super_admin` all true, `leader` canCreate+canMarkAttendance+canExport, `server` only canMarkAttendance). `canDelete/canModify/canHardDelete/canManageUsers/canViewAudit` only `super_admin`. `canViewPastoreo` leader/super_admin. No `canTransferRetreatToMembers` — must add. |
| `src/lib/export/generate.ts` | Client-side SheetJS `xlsx` (`import * as XLSX from 'xlsx'`, `cdn.sheetjs.com/xlsx-0.20.3`). `generateMemberExport(includeSensitive?: boolean)` loads Dexie `db.members` + `social_media` + `whatsapp_numbers`, groups by `member_id`, builds `MemberExportRow` placeholder for encrypted fields, `exportToCSV(rows,filename)` via `XLSX.utils.json_to_sheet → sheet_to_csv`, `exportToXLSX(rows,filename)` via `XLSX.utils.book_new → book_append_sheet → XLSX.write({bookType:'xlsx',type:'array'}) → Blob → downloadBlob`. Not server-side; no pagination; no retreat export. Reusable pattern for retreat Excel. |
| `src/lib/sync/db.ts` | Dexie `AttendanceCaptureDB` v1: stores `members, sessions, attendance, social_media, whatsapp_numbers, sync_queue` — **no `retreat_registrations` store**, no `groups` store. `members` index: `id, name_normalized, phone, email, deleted_at, duplicate_flag`. Adding retreat transfer as Dexie would require v2 — explicitly avoided per 011/013 ("Do not add retreat_* to supabase_realtime", "no Dexie store"). Retreat stays online-only. |
| `src/app/(dashboard)/retreat-registrations/page.tsx` | Client `'use client'`, guard `canManageRetreatRegistrations(role)` else denied, `useRole()` + `useState` registrations/payments/total. `loadData` does `Promise.all([ supabase.from('retreat_registrations').select('id,name,email,phone,status').eq('event_key', RETREAT_EVENT_KEY).order('name'), supabase.from('retreat_payments').select('registration_id,amount'), getRetreatTotalCost() ])`. Filters `isRetreatStatus`, computes `sumPaidByRegistration` via `src/lib/retreat/payments.ts` (`Map<string,number>`), `remainingBalance`, `paymentsBlocked`, badge variant, table with columns `Nombre, Email, Teléfono, Estado, Pagado, Saldo, Registrar pago` (amount input + button). **No pagination, no search, no tabulation beyond a single `<Table>`**, no `member_id` fetch, no `birthday/is_minor/legal_rep` columns, no transfer button, no Excel/print, no aggregated abono report. Loads **all rows at once** — not "eficiente e indexado". |
| `src/lib/retreat/payments.ts` | `RetreatStatus`, `parsePositiveTotal(str|null)=>number|null`, `remainingBalance(total,sum)=>total-sum| null`, `isRetreatPaymentBlocked(total)=>parsePositiveTotal===null`, `sumPaidByRegistration(payments: {registration_id,amount}[])=>Map`, `retreatStatusLabel`. Used by page. |
| `src/app/(dashboard)/members/page.tsx` | Dexie-first `db.members.filter(m=>deleted_at===null).toArray()` sorted locale, `filteredMembers` client filter on name/phone/email `includes`, tabs Directory+Highlights, detail `Dialog` with phone/email/birthday/has_whatsapp/is_minor/consent, `canManageRetreatRegistrations` gates `Preinscribir al retiro` → second dialog `CaptureForm variant="retreat"` with `submitRetreatPreinscriptionForMember`. Badge `Preinscrito` via `supabase.from('retreat_registrations').select('id').eq('member_id', member.id).eq('event_key', RETREAT_EVENT_KEY).maybeSingle()`. No groups UI. |
| `openspec/specs/youth-retreat-preregistration` + `youth-retreat-payments` + `retreat-member-preinterest` | Prereg RPC with consent-on-row, anon isolation, duplicate via expression indexes, required fields/minor/sensitive; payments positive total required, super_admin sets total, status machine, server denied; member→retreat link via nullable FK + authenticated RPC + `initialValues` prefill + isolation badge + online-only. None covers **retreat→members transfer (post-retiro → Valientes)**, pagination/search, or Excel reports. |
| `openspec/config.yaml` | `project: md-cc-attendance-and-capture, framework next.js 15.5.22, language typescript 5.8.3 strict`, `backend supabase @supabase/ssr 0.6.1, supabase-js 2.112.0`, `persistence supabase postgres 15 + dexie 4.0.11`, `data xlsx sheetjs`, `testing strict_tdd true vitest 3.2.1 jsdom, playwright 1.62.1, next lint, tsc strict`. `persistence.mode: both`, `sdd_legacy_dir sdd/attendance-and-capture-platform`. Migrations 001→013 applied via `supabase db reset`. |

**Implicit constraints that bear on the new feature:**

- `members.denomination_encrypted` is `BYTEA pgp_sym_encrypt` vs `retreat_registrations.denomination TEXT` plain (only when `sensitiveConsent`). Transfer must handle encryption (`pgp_sym_encrypt`) or re-capture via form; not auto-decrypt → re-encrypt.
- `members_update` RLS is `super_admin`-only — `leader` cannot `UPDATE members` via PostgREST without a `SECURITY DEFINER` bypass. Transfer-to-Valientes that "updates existing member's group" needs the same RPC bypass pattern, not a direct PostgREST UPDATE.
- `retreat_registrations.member_id` nullable: for anon rows `NULL`, for member-originated rows points to source `members.id`. Using the same column as "transferred member" would conflate origin vs destination semantics — need explicit `transferred_*` columns.
- Offline: retreat-registrations page is online-only (no Dexie). Transfer must also be online-only; disabling when offline is acceptable per 013 precedent.

---

## 2. Requirements Inferred (to be validated in proposal)

**Core user story (literal from pedido):**

> "Aunque los datos de preinscripción al retiro son similares a los de captura de miembros existentes, estas son personas que apenas serán miembros en un futuro. Por ende, necesito un mecanismo para cuando las personas ya hayan vivido el retiro (es decir, cuando después de preinscritas, mediante abonos parciales o totales del valor del retiro que se deben ir consignando en el módulo correspondiente, se considere que la persona participó y será un futuro asistente). Debe haber una opción que me permita transferir a los preinscritos e inscritos del retiro como asistentes al grupo 'Valientes' en calidad de miembros, ya que los datos que se capturan son similares."

**Interpretation:**

- **Preinscrito vs Inscrito:** Preinscrito = row exists with `status=preinscrito` (or `pagos_parciales`); Inscrito = `status=inscrito` i.e. `SUM(retreat_payments) >= retreat.youth.total_cost` (trigger `retreat_payments_apply_status`). User explicitly says "abonos parciales de $200k o pago total $400k" — matches trigger logic `pagos_parciales` vs `inscrito`.
- **"Cuando ya hayan vivido el retiro"** → Not a DB predicate today. There is no `attended_retreat BOOLEAN` or `retreat_attendance` table. Payment-full (`inscrito`) is a necessary but not sufficient guard for "participó". Proposal must decide: **transfer allowed only when `status=inscrito` (Q2) vs also when `pagos_parciales`?** User says "transferir a los preinscritos e inscritos" — verbatim includes both. But "cuando después de preinscritas, mediante abonos ... se considere que la persona participó" suggests inscritos are the canonical transfer. Proposal must lock one.
- **Transfer semantics:** "transferir ... como asistentes al grupo 'Valientes' en calidad de miembros" = create a `members` row in pastoral group **Valientes**. Data captured on retreat (`name, phone, email, birthday, is_minor, legal_rep_name, denomination, community_name`) maps to `members` columns (with encryption/handling). Source `retreat_registrations` remains audit.
- **Table requirements:** "Módulo de retiro, donde están los preinscritos e inscritos en una tabla que debe ser tabulada, paginada, debe tener un buscador eficiente e indexado." Current page is a single unpaginated table with no search (see §1). Must become: tabbed (Preinscritos vs Inscritos vs Todos), server-side pagination (`.range()` + `count`), search indexed (pg_trgm + btree), maybe sorting.
- **Excel on demand:** "Debe haber una forma de imprimir o generar un reporte de Excel bajo demanda del estado de pago de cada preinscrito y el listado de inscritos, que es cuando se cumple la condición de que ha cancelado la totalidad del valor del retiro." Two reports: (a) Estado de pago por preinscrito (all rows with `sum_paid, remaining, %, last_payment_at, status, total_cost`), (b) Listado de inscritos (only `status=inscrito`).
- **Abonos report in sección retiros:** "Debe haber un reporte en la sección de retiros con el estado actual de los abonos que se van consignando a cada preinscrito hasta completar la totalidad." Aggregated per-person payment ledger: `retreat_registrations` joined to `retreat_payments` sum + count + remaining + % + last payment. Real-time (trigger-derived) not materialized view; must be query, not static export.

**Non-goals (assumed until proposal says otherwise):**

- No auto-transfer via trigger when `status` flips to `inscrito` (user wants "opción que me permita transferir" — manual button). Auto violates idempotency/audit.
- No collection of money on `/retiro` public page, no change to anon RPC, no new `event_key` — stays `retiro-juvenil-octubre-2026`.
- No offline transfer (consistent with retreat online-only).
- No mass import of retreat rows without consent re-capture — transfer reuses retreat-row consent already on row (`general_consent_accepted_at/policy_version`), but Ley 1581 purpose for transfer is **attendance membership** — proposal must decide if fresh capture is needed or retreat consent suffices.
- No change to `sdd/attendance-and-capture-platform` legacy SDD.

**Out-of-scope follow-ups deferred:**

- Multi-event catalog (`app_settings` event catalog) — still single constant.
- Auto-linking duplicate `email/phone` retreat rows to existing `members` instead of rejecting.
- Valientes group attendance tracking integration (sessions) beyond membership creation.

---

## 3. Alternatives Compared

### Preliminary: Is "Valientes" a column, a `groups` table, or a `member_groups` junction?

Verified: no `groups` table, no `members.group` column (§1). Decision matrix for where "Valientes" lives:

| Option | Schema | Pros | Cons | Verdict |
|--------|--------|------|------|---------|
| **G1 — New column `members.pastoral_group TEXT`** (`CHECK IN ('Valientes')` or open `TEXT`) | `ALTER TABLE members ADD COLUMN pastoral_group TEXT CHECK ...` + btree index | Simplest: one column, one index, one filter `WHERE pastoral_group='Valientes'`, fits `members` single-group-per-person current reality; no new RLS table; KISS for RDD | One group per member only; if multi-group future needed, needs migration `pastoral_group TEXT[]` or junction; `CHECK` hard-coded | **KISS for this slice** — proposal default |
| **G2 — New `groups` table + `member_groups` junction** | `CREATE TABLE groups (id PK, slug UNIQUE, name)`, `CREATE TABLE member_groups (member_id FK, group_id FK, joined_at, UNIQUE(member_id,group_id))` | Normalized, multi-group, extensible, audit per join, group metadata (description, color) | More tables, more RLS policies, more UI (group selector), `members` list now needs `JOIN`; heavier than single group need | **Deferred** — folio if Valientes is first of many |
| **G3 — Reuse `community_name_encrypted` / `denomination` semantic** | Map Valientes to `community_name_encrypted` or `denomination` text | Zero schema | Wrong semantics: religious denomination ≠ pastoral attendance group; encrypted vs plain mismatch; grep proves they're separate | **Rejected** |

Recommendation in §4: adopt **G1** (`pastoral_group TEXT` nullable, `CHECK` open, partial index), with explicit comment that G2 is the evolution path. Proposal will lock one.

---

### Alternative A — RPC `transfer_retreat_to_valientes(registration_id)` que inserta en `members` + marca `transferred_*` + audit, idempotente

**Shape:** `CREATE OR REPLACE FUNCTION public.transfer_retreat_to_valientes(p_registration_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''`. Body: `user_role() IN ('leader','super_admin')` else `42501`; `SELECT rr.*` + `SELECT SUM(amount) FROM retreat_payments WHERE registration_id = p_registration_id` + `SELECT value FROM app_settings WHERE key='retreat.youth.total_cost'`; enforce `rr.status='inscrito'` (or `pagos_parciales` per Q2 decision) and `rr.transferred_at IS NULL`; pre-check `members` duplicate `EXISTS (SELECT 1 FROM members WHERE lower(btrim(email))=lower(btrim(rr.email)) OR regexp_replace(phone)=digit_normalized OR name_normalized=lower(btrim(rr.name)))` → `already_member 23505` vs link-existing path per decision; sensitive handling: `rr.denomination IS NOT NULL` implies `sensitive_consent` was given — encrypt via `pgp_sym_encrypt` using vault/demo key pattern (see 001 seed `demo-local-pgcrypto-key-not-for-prod`); insert `members` (`name, name_normalized=lower(btrim(name)), phone=digit_only? vs E164? existing members use E164 +573… but retreat normalizes to digits-only — must decide normalization alignment`, `email lower/btrim, birthday, is_minor, legal_rep_name, has_whatsapp false, consent_recorded=true, sensitive_consent_recorded=(sensitive_at IS NOT NULL), denomination_encrypted, community_name_encrypted, pastoral_group='Valientes', created_by=auth.uid()`); `UPDATE retreat_registrations SET transferred_at=now(), transferred_member_id=new_id, transferred_by=auth.uid() WHERE id=p_registration_id`; return `new_members.id`; `EXCEPTION WHEN unique_violation THEN RAISE` mapping.

**Pros:**
- Single atomic transaction: payment-sum check + duplicate check + insert + flag in one `SECURITY DEFINER` (no RLS gap; leader can write `members` via definer without widening `members_insert` RLS).
- Idempotent via `transferred_at IS NOT NULL` guard → second call raises `already_transferred` `23505` instead of double-inserting members.
- Audit via `log_mutation` trigger on both tables + explicit `transferred_by/at` columns.
- Keeps `retreat_registrations` as source of truth; `members` gets Valientes tag.

**Cons:**
- Must handle encryption key management for sensitive fields (`pgp_sym_encrypt`). 001 uses a demo key `pgp_sym_encrypt('Pentecostal', demo_encrypt_key)` — prod should use `vault.decrypted_secrets` (012a adds `vault` + `supabase_vault` + `get_whatsapp_secret` pattern). Not trivial.
- Phone normalization mismatch: retreat stores digit-only `3009000001`, members seeds store E164 `+573001234567`. Direct copy of digit-only into `members.phone` may break `libphonenumber-js` validation downstream. Need normalization decision (`normalizeE164` vs retreat digit).
- Widening question: should `leader` be allowed to create members via RPC when `members_update` is super_admin-only? Already `members_insert` is `leader+super_admin` so creation is allowed; RPC still needs definer for `transferred_*` write on retreat (no UPDATE policy on retreat). Acceptable.

**Cost:** One migration adding `transferred_*` columns + index + RPC, one adapter, one UI button. <150 LOC.

### Alternative B — Trigger automático al llegar a `inscrito` → auto-crea `member` (sin botón)

**Shape:** `CREATE OR REPLACE FUNCTION auto_transfer_on_inscrito() RETURNS trigger SECURITY DEFINER` + `AFTER UPDATE OF status ON retreat_registrations WHEN NEW.status='inscrito' AND OLD.status<>'inscrito' AND NEW.transferred_at IS NULL`. Calls same insert logic as A inline.

**Pros:** Zero-click; every inscrito becomes Valientes member automatically.

**Cons:**
- **High-risk RDD:** Trigger firing under `postgres` owner bypasses `user_role()` checks; needs service-role context. Error surfacing opaque (`unique_violation` inside trigger rolls back the payments transaction, making the successful `retreat_payments` insert fail unexpectedly). Violates "opción que me permita transferir" (user explicitly wants a manual option, not auto). No human audit of "vivió el retiro" beyond payment — auto conflates payment with attendance.
- Breaks idempotency expectations: trigger cannot prompt for "Valientes" confirmation; re-entrancy on payment inserts (the trigger that sets status runs in same txn as payment — cascading trigger order sensitive).
- Harder to test (needs `supabase db reset` with trigger recursion) and to disable per-environment.
- **Ley 1581 concern:** Auto-converting PII purpose from retreat to attendance membership without explicit staff action is weaker consent evidence.

**Verdict:** **Rejected** — proposal must keep manual button; B may be offered as follow-up feature-flagged opt-in, not default.

### Alternative C — Job batch que lista inscritos y permite bulk transfer

**Shape:** Same RPC as A but UI adds checkboxes + `Select all` + `Transferir seleccionados (N)` → loop `for (id of selected) await supabase.rpc('transfer_retreat_to_valientes', {p_registration_id:id})` with progress toast + partial failure handling. Optionally a server-side `transfer_retreat_batch(p_registration_ids uuid[])` that loops inside one transaction and returns `jsonb` of successes/failures.

**Pros:**
- Ergonomic for large cohorts (10–50 inscritos per retiro); one click vs N modals.
- Batch RPC could be more efficient (single round-trip, one `SUM` per registration via lateral join).
- Partial failure handling (skip already_transferred/already_member, continue).

**Cons:**
- More UI state (selection, indeterminate, "transfer all filtered" semantics vs "transfer page").
- Transaction sizing: batch of 50 inserts in one transaction holds locks longer; if one duplicate fails, whole batch may roll back unless `SAVEPOINT` per iteration is added.
- Audit granularity: per-row `transferred_by/at` still needed; batch adds complexity without changing per-row semantics.

**Verdict:** **Complement to A, not replacement.** Recommend shipping **A (single)** in V1, adding **C (bulk)** as `T-BULK` task gated on "single works and >20 rows in production" — incremental, not blocking.

### Alternative D — Vista + export client-side vs server-side Excel

**Shape D1 (client-side):** Reuse `src/lib/export/generate.ts` SheetJS pattern: `fetch RetreatReportRows` via `supabase.from('retreat_registrations').select('*, retreat_payments(amount,created_at)').eq('event_key', RETREAT_EVENT_KEY)` client-side, aggregate in JS (`sumPaidByRegistration` already exists), build `RetreatPaymentReportRow[]`, call `XLSX.utils.json_to_sheet → book_new → write → Blob → downloadBlob`. Print via `window.print()` with `@media print` CSS.

**Shape D2 (server-side):** Next.js Route Handler `POST /api/retreat/report` with `createServerClient` (RLS-aware), `service_role` not needed, builds workbook server-side with `xlsx` Node, streams `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` with `Content-Disposition: attachment`. Advantage: no client memory for large datasets, consistent formatting, no exposure of all rows via client PostgREST pagination before export.

**Pros D1:** Zero new infra; pattern already in codebase; RLS naturally enforced via `createClient`; <40 LOC new lib file.

**Pros D2:** Better for large datasets (1000+ registrations), avoids pulling all payments into browser, can add `Content-Security-Policy`, can be called from server component without client bundle `xlsx` (smaller client JS). Matches `app_settings` sensitive defaults if needed.

**Cons D1:** For large pago ledger (N registrations × M payments), client does N+1 fetch or one large join that may hit PostgREST row limits (`max_rows` default 1000). Existing page fetches payments without pagination — same risk.

**Cons D2:** Requires `export` permission check server-side (`user_role()`), error handling for `xlsx` Node `type:'buffer'`, and route handler tests.

**Recommendation:** **Hybrid:** `src/lib/retreat/export.ts` pure helpers (`buildReportRows`, `toXLSXBuffer`, `toCSV`) shared by both paths, primary UI calls **client-side D1** via those helpers (KISS, leverages existing `xlsx` + `generateMemberExport` pattern and existing RLS `canExport`). Add **D2 Route Handler** as `follow-up` if datasets exceed browser memory or if auditor wants server-side log of exports.

### Comparison Matrix (A vs B vs C vs D)

| Criterion | A RPC single transfer | B Trigger auto | C Bulk batch | D Export client vs server |
|-----------|----------------------|----------------|--------------|----------------------------|
| Manual control ("opción que me permita") | **Yes — explicit button, super_admin/leader** | **No — auto** | **Yes — bulk explicit** | N/A |
| Idempotent / audit `transferred_*` | Yes (`transferred_at IS NOT NULL` guard, `transferred_member_id/by`) | Risk: re-entrancy, hidden failures | Same as A per-row | No |
| RLS gap | **No** — definer + `user_role()` gate | Trigger runs as owner, bypasses role | Same as A | D1: RLS via anon key; D2: server client RLS |
| Ley 1581 purpose | Staff action logs purpose on transfer | Auto weakens evidence | Same as A | Export needs `canExport` gate |
| Payments sum gate | `SUM(amount) >= total` inside RPC | Same but coupled to `status` trigger | Same | N/A (report reads sum) |
| Offline | Online-only (disabled) | Online-only | Same | Same |
| Complexity / RDD risk | **Low (1 RPC, 1 col, 1 index)** | **High** (trigger cascade) | **Medium** (bulk loop + SAVEPOINT) | Low (D1) vs Medium (D2) |
| Verdict | **Recommended V1** | **Rejected** | **V1 single + C as follow-up** | **D1 primary + D2 follow-up** |

---

## 4. Recommended Approach (for proposal to lock)

**End-to-end shape (A + G1 + D1, C deferred):**

```
retreat_registrations (online Supabase)
  ├─ status via 011 triggers (preinscrito / pagos_parciales / inscrito)
  ├─ member_id (013) = origin member if member-originated else NULL
  ├─ NEW transferred_at TIMESTAMPTZ, transferred_member_id UUID FK members(id) ON DELETE SET NULL, transferred_by UUID FK profiles(id)
  └─ NEW pastoral signal via members.pastoral_group='Valientes' (G1)

Flow:
  (dashboard)/retreat-registrations — paginated, indexed, searchable, tabbed (Todos/Preinscritos/Inscritos)
     ├─ columns: Nombre, Email, Teléfono, Birthday, Es menor, Estado, Pagado, Saldo, % Pagado, Último abono, Acciones
     ├─ filters: status tab + search input (debounced) + sort
     ├─ rows: server-side pagination `.range(from,to)` + `count:'exact'` + `order('name')` + `ilike/name|email|phone` (pg_trgm)
     ├─ per-row: "Registrar pago" (existing) + "Transferir a Valientes" (NEW, gated, idempotent)
     │        └─ enabled IFF status='inscrito' AND transferred_at IS NULL (Q2 default; see gate)
     │           click → confirm dialog (Ley 1581 note: "Se creará un miembro en Valientes con los datos del retiro. Esta acción es irreversible. ¿Continuar?")
     │           → supabase.rpc('transfer_retreat_to_valientes', {p_registration_id:id})
     │              └─ SECURITY DEFINER SET search_path='' : role gate → sum>=total gate → duplicate guard → INSERT members (Valientes) → UPDATE rr.transferred_* → audit
     │                 success → toast "Transferido a Valientes" + link "Ver miembro" → row badge "Transferido ✓"
     │                 failure already_member → toast "Ya existe un miembro con ese email/teléfono" + link to members
     │                 failure already_transferred → toast "Ya fue transferido"
     ├─ toolbar: "Exportar Excel — Estado de pago (todos)" + "Exportar Excel — Inscritos" + "Imprimir" (window.print + @media print hide actions)
     └─ report section below table: "Reporte de abonos" aggregate per registration (PII + sum + count + remaining + % + last_payment_at) — same data as table but exportable

Excel generation: src/lib/retreat/export.ts
  export type RetreatReportRow = { Nombre, Teléfono, Email, FechaNacimiento, EsMenor, RepresentanteLegal, Estado, Pagado, Saldo, PorcentajePagado, TotalRetiro, CantidadAbonos, UltimoAbono, TransferidoAValientes, FechaTransferencia }
  export function buildReportRows(registrations: RetreatRegistration[], payments: RetreatPayment[], total:number|null): RetreatReportRow[]
  export function exportRetreatToXLSX(rows:RetreatReportRow[], filename:string): void  // SheetJS book_new → write → Blob → download
  export function exportRetreatToCSV(...) // sheet_to_csv
  Called client-side from retreat page with on-demand data (see pagination vs export scope below).

Pagination vs export scope: table is paginated server-side; **export fetches filtered set (not just page)** via separate query with same filters but without `.range()` (PostgREST pagination disabled, or batched chunks of 1000 to avoid max_rows). Export blocked offline.

Member creation mapping (retreat → members):
  rr.name                → members.name + name_normalized = lower(btrim(name))
  rr.phone (digit-only)  → members.phone = normalized E164 (decision: convert digit-only to E164 with +57 prefix when length 10 Colombian mobile; store as retreat stored plus fallback to rr.phone if already E164) — must align with members phone validation `isValidE164` / `normalizeE164`.
  rr.email lower/btrim   → members.email = lower(btrim(email))
  rr.birthday            → members.birthday
  rr.is_minor            → members.is_minor
  rr.legal_rep_name      → members.legal_rep_name
  rr.denomination        → members.denomination_encrypted = pgp_sym_encrypt(v_denomination, key) IFF sensitive_consent else NULL (via RPC)
  rr.community_name      → members.community_name_encrypted = pgp_sym_encrypt(v_community, key) IFF sensitive_consent else NULL
  fixed Valientes        → members.pastoral_group = 'Valientes'
  fixed consents         → members.consent_recorded = true, sensitive_consent_recorded = (rr.sensitive_consent_accepted_at IS NOT NULL)
  rr.has_whatsapp?       → members.has_whatsapp = false (unknown until re-contact; or derive from rr.phone? keep false)
  auth context           → members.created_by = auth.uid(), created_at=now(), deleted_at NULL
  duplicate              → duplicate_flag = false initial (existing duplicate detection runs post-insert via app job? leave false)
```

**Detailed sub-steps (for proposal → design → tasks mapping):**

1. **Schema (`014_retreat_valientes_transfer.sql`):**
   - `ALTER TABLE public.members ADD COLUMN IF NOT EXISTS pastoral_group TEXT CHECK (pastoral_group IS NULL OR char_length(btrim(pastoral_group))>0); COMMENT ON COLUMN public.members.pastoral_group IS 'Pastoral attendance group; Valientes for retreat graduates. NULL until transferred. G1; evolution to groups/junction in follow-up.'; CREATE INDEX IF NOT EXISTS members_pastoral_group_idx ON public.members(pastoral_group) WHERE pastoral_group IS NOT NULL;`
   - `ALTER TABLE public.retreat_registrations ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMPTZ; ADD COLUMN IF NOT EXISTS transferred_member_id UUID REFERENCES public.members(id) ON DELETE SET NULL; ADD COLUMN IF NOT EXISTS transferred_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL; CREATE INDEX IF NOT EXISTS retreat_registrations_transferred_member_id_idx ON public.retreat_registrations(transferred_member_id) WHERE transferred_member_id IS NOT NULL; COMMENT ON COLUMN ...;` plus `COMMENT ON COLUMN retreat_registrations.transferred_at IS 'When the retreat row was transferred to members pastoral_group Valientes; idempotency guard; NULL until transfer.'`
   - `CREATE INDEX IF NOT EXISTS` for search: `CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE INDEX IF NOT EXISTS retreat_registrations_search_trgm_idx ON public.retreat_registrations USING gin ((lower(name) || ' ' || lower(email) || ' ' || phone) gin_trgm_ops);` plus btree `retreat_registrations_status_idx`, `retreat_registrations_created_at_idx`. Payments: `retreat_payments_created_at_idx`. Members duplicate-transfer index: `CREATE INDEX IF NOT EXISTS members_email_lower_uidx ON public.members (lower(btrim(email)))`? Check if exists — grep shows none; but retreat already has expression uniques. For members, duplicate detection currently via `members.duplicate_flag` + app logic, not DB unique — proposal must decide if `members` gets `UNIQUE lower(btrim(email)) WHERE deleted_at IS NULL` as guard. Defer to Q-doubt.
   - `NOTIFY pgrst, 'reload schema';`

2. **RPC (`transfer_retreat_to_valientes`):**
   - Signature `transfer_retreat_to_valientes(p_registration_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''`. Grants `REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO authenticated;`. Comment. Body as A shape above, with `ERRCODE 42501 not_authorized`, `P0002 not found`, `23514 missing total / not inscrito`, `23505 already_transferred / already_member`. Must handle `is_minor` already on rr; sensitive encrypt path via `pgp_sym_encrypt` + `vault`. Use `try WHEN unique_violation` mapping per 013 precedent.

3. **RBAC + guards:**
   - `src/lib/rbac/guards.ts` new `canTransferRetreatToValientes(role) = canCreate(role) && (role==='super_admin' || role==='leader')` — or `super_admin` only per Q. Proposal will lock.
   - Existing `retreat_registrations_select` already `leader/super_admin`, `members_select` same. `members_insert` already `leader/super_admin` — insertion via RPC bypasses RLS anyway. Retreat `UPDATE` policy missing — RPC needs `SECURITY DEFINER` to set `transferred_*` (definer is owner, bypasses RLS).

4. **Retreat page refactor (`src/app/(dashboard)/retreat-registrations/page.tsx`):**
   - Keep `'use client'`, guard, but rewrite `loadData` to support server-side pagination/search/tab.
   - State: `tab: 'todos'|'preinscrito'|'pagos_parciales'|'inscrito'`, `search: string` (debounced 300ms), `page: number`, `pageSize: 20|50`, `totalCount: number`, `sort: 'name_asc'|...`, `range` query `supabase.from('retreat_registrations').select('id,name,email,phone,birthday,is_minor,legal_rep_name,status,created_at,transferred_at,transferred_member_id,member_id', {count:'exact'}) .eq('event_key', RETREAT_EVENT_KEY) [.eq('status',tab) if tab!='todos'] [.or('name.ilike.%search%,email.ilike.%search%,phone.ilike.%search%') if search]` + `.order('name') .range(from,to)`. Parallel payments fetch limited to visible `registration_ids` via `.in('registration_id', ids)` plus aggregate view `retreat_registration_payments_summary`? For efficient abono report, create `VIEW retreat_registration_with_payments AS SELECT rr.*, COALESCE(SUM(p.amount),0) AS total_paid, COUNT(p.id) AS payment_count, MAX(p.created_at) AS last_payment_at FROM retreat_registrations rr LEFT JOIN retreat_payments p ON p.registration_id=rr.id GROUP BY rr.id` with `security_invoker=true` (PG15). Use it for report/Excel or do client `sumPaidByRegistration` over batched payments.
   - UI: Tabs component (`@/components/ui/tabs`), search Input with icon, pagination footer (`Prev/Next`, `Page X of Y`), badge per row, `Registrar pago` unchanged, new `Transferir a Valientes` Button (variant secondary, icon `UserPlus`), disabled when `paymentsBlocked` or `status!=='inscrito'` or `transferred_at` not null. Dialog confirm + toast + link.

5. **Export (`src/lib/retreat/export.ts` + button handlers):**
   - Pure helpers, SheetJS, file naming `retiro-estado-pago-${date}.xlsx` and `retiro-inscritos-${date}.xlsx`. Column order per §2. Include `TotalRetiro` from `app_settings` stored total. Print: CSS `@media print { nav, button.transfer, input {display:none} }` + `window.print()`.

6. **Report de abonos (within retreat section):**
   - Either inline under table or separate tab "Reporte de abonos". Same data as table but with expanded columns: `Pagado, Saldo, % Pagado, Cant. Abonos, Último abono, Total`. Real-time via same paginated query + `total_paid` aggregate. Not materialized.

7. **Tests (strict_tdd):**
   - Vitest: `src/lib/retreat/payments.test.ts` extended with `transferGating`, `src/lib/retreat/__tests__/export.test.ts` for `buildReportRows`, `src/lib/rbac/__tests__/guards-transfer.test.ts`.
   - Supabase `retreat_rls.test.sql` extension: anon/server denied `transfer_retreat_to_valientes`, leader denied when `status!='inscrito'`, leader succeeds when `inscrito` and `transferred_at IS NULL`, second transfer same id fails `already_transferred`, duplicate member email/phone fails `already_member`, `super_admin` override, `transferred_*` columns set, `pastoral_group='Valientes'` on new member, encryption sensitive copy.
   - Playwright: leader flow `retreat page tab inscrito → transfer → toast → members page has Valientes filter row → Excel download contains row + payment state`.

**Changed-line budget:** `014` migration ~150 SQL incl. comments/indexes, RPC ~120, `export.ts` + `guards.ts` ~80, page refactor ~250 TSX, tests ~200, e2e ~120 → total ~920 but net review lines ~500 after factoring test files not counted as "authored lines" under compact counting; still high-tier. Forecast **single PR `feat/retreat-valientes-transfer → main`** unless batch + server export pushes >400 authored lines → then PR1 migration+RPC, PR2 pagination/search, PR3 transfer+export. Proposal will decide with `delivery_strategy`.

---

## 5. Integration Mapping

| Concern | Where it lives | How |
|---------|----------------|-----|
| **Flag Valientes** | `public.members.pastoral_group TEXT` (G1) on `members`; btree partial index `WHERE pastoral_group IS NOT NULL`; `members` directory can filter `WHERE pastoral_group='Valientes'` if needed | One member per pastoral group for now; `NULL` until transfer. G2 junction is evolution path. No `groups` table in V1. |
| **Transfer audit** | `public.retreat_registrations.transferred_at TIMESTAMPTZ`, `transferred_member_id UUID FK members(id) ON DELETE SET NULL`, `transferred_by UUID FK profiles(id)` + `members.created_by` + existing `log_mutation` triggers on both tables | Audit persists even if member hard-deleted (`SET NULL` retains timestamp). `audit_log` captures old/new via existing trigger. |
| **Payments sum gate** | `app_settings.retreat.youth.total_cost` (existing) + `COALESCE(SUM(retreat_payments.amount),0)` per registration inside RPC; `retreat_payments_apply_status` trigger already ensures `status` reflects sum | RPC re-derives sum fresh (not trusting `rr.status` alone) to prevent race where page shows stale status. Check `sum >= total` else raise. |
| **Pagination + search** | `src/app/(dashboard)/retreat-registrations/page.tsx` rewrite: `supabase.from('retreat_registrations').select(..., {count:'exact'}).eq('event_key', RETREAT_EVENT_KEY).or('name.ilike.%...%,email.ilike.%...%,phone.ilike.%...%').range(from,to).order('created_at' or 'name')` + debounced Input | Requires DB indexes: `pg_trgm` GIN `((lower(name)||' '||lower(email)||' '||phone) gin_trgm_ops)` + `status` btree. PostgREST benefits from `count:'exact'`. Frontend keeps `totalCount` for pagination controls. |
| **Excel reports** | `src/lib/retreat/export.ts` helpers reusing `src/lib/export/generate.ts` SheetJS pattern (`XLSX.utils.json_to_sheet`, `book_new`, `book_append_sheet`, `write({bookType:'xlsx',type:'array'})`, `Blob`, `downloadBlob`) but with retreat columns; toolbar buttons `Exportar estado de pago (todos)` and `Exportar inscritos` | On-demand `filtered` scope: button handler fetches with same filters as table but without `range` (chunked 1000). Server-side D2 route is follow-up. |
| **Abonos report** | Same page, either tab "Reporte de abonos" or expanded columns in main table plus footer aggregates | Data from same paginated query + `LEFT JOIN retreat_payments` aggregation (view or client `sumPaidByRegistration`). Real-time, not materialized. Columns `Pagado, Saldo, %, Cantidad, Último`. |
| **Reuse of existing invariants** | `RETREAT_EVENT_KEY='retiro-juvenil-octubre-2026'` constant, `retreat_payments_guard_total` + `apply_status` triggers, unique email/phone indexes, `user_role()` `SECURITY DEFINER` helper, `canManageRetreatRegistrations` guard | No new event_key, no new total_cost key, no touch to `retreat_registrations` RLS beyond new column visibility, no Dexie bump. |
| **Permissions** | Gate via `canTransferRetreatToValientes(role)` in page + RPC internal `user_role() IN ('leader','super_admin')` (or super_admin-only per proposal) | Mirrors `retreat-member-preinterest` double gate (UI + RPC). `server` denied even if it obtains JWT. `anon` denied via `REVOKE EXECUTE`. |
| **Offline/Dexie** | No store for `retreat_registrations`; transfer button `disabled title="Requiere conexión"` when `!navigator.onLine` or no session | Same as 013 online-only contract. No `sync_queue` entry. |
| **Print** | `window.print()` + `@media print` overrides hiding nav/actions, keeping table | Zero new dependency. |
| **Performance** | Indexes + `range` + `count` + `maybeSingle` badge for transfer already done (013 badge) — no N+1 on bulk load | `retreat_payments` fetch `WHERE registration_id IN (visibleIds)` not full table. |

---

## 6. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **No `groups` table — Valientes semantics implicit** | Future groups (`Jóvenes`, `Servidores`) would need schema migration | Choose G1 `pastoral_group TEXT` with generic name, comment as evolution to G2 `groups`+`member_groups` junction. Keep `CHECK` open (`char_length>0`) not `IN ('Valientes')` to allow extension without migration. Seed `COMMENT`. |
| **Phone normalization mismatch (retreat digit-only vs members E164 `+57…`)** | `members.phone` may fail downstream `isValidE164`/`libphonenumber-js` or display inconsistent | RPC normalizes via `normalizeE164`: if digit-only 10 digits Colombian, prefix `+57`; else if already `+` keep; else fallback to `rr.phone`. Mirror `src/lib/phone/normalize.ts` logic. Tests cover `+57300…` case. |
| **Sensitive denomination encryption key management** | Direct `pgp_sym_encrypt` with hard-coded demo key leaks; prod expects `vault.decrypted_secrets` | Reuse `vault` extension (already installed 012a) + `supabase_vault` schema: `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='members_encryption_key'` inside definer; fallback to `demo-local-pgcrypto-key-not-for-prod` only for local/ci when vault empty (guarded by `IF EXISTS`). Document in migration comments. Do not expose key to client. |
| **Duplicate members email/phone (`members` has no DB unique on email/phone, only `duplicate_flag` logic)** | Transfer may create shadow duplicate (`members` with same email as existing) | RPC pre-check `EXISTS (SELECT 1 FROM members WHERE lower(btrim(email))=lower(btrim(rr.email)) OR regexp_replace(phone,'[^0-9]','')=digit(rr.phone) AND deleted_at IS NULL)` → `RAISE already_member 23505`. Decision: reject vs link-existing. Default reject with friendly toast + link "Ver miembro existente". Follow-up: offer `link_existing_member` param. No `ON CONFLICT DO NOTHING` silent. |
| **Transfer allowed on `preinscrito`/`pagos_parciales` before `inscrito`** | Premature Valientes membership before retiro paid/attended | Gate `SUM(amount) >= total` inside RPC + `status='inscrito'` on UI. Proposal Q2 default: **only `inscrito`**. If user insists "preinscritos e inscritos", add flag `allow_transfer_of_preinscritos` in `app_settings` for operator override — but default strict. |
| **"Vivió el retiro" not modeled (attendance vs payment)** | Someone pays total but never attends; transfer grants Valientes incorrectly | Add non-blocking `attended_retreat` confirmation: dialog checkbox "Confirmo que esta persona vivió el retiro" required for transfer; store confirmation implicitly via `transferred_at` existence + optional `notes` column. Future: add `retreat_attendance` junction. Docs note payment is necessary not sufficient. |
| **Retreat `UPDATE` RLS missing — `transferred_*` column update needs bypass** | Direct PostgREST `UPDATE retreat_registrations SET transferred_at=now()` would be blocked for leader | Intended: only RPC (definer) writes `transferred_*`; no `CREATE POLICY ... FOR UPDATE` added — keeps surface minimal. RLS stays as 011 (only `SELECT` for retreat). |
| **Pagination performance at scale (PostgREST `count:'exact'` + `range` without indexes)** | Slow `ILIKE %search%` on thousands of rows | Add `pg_trgm` GIN as above, `status` btree, `created_at` btree. Use `ilike` via PostgREST which translates to `ILIKE`; GIN trigram accelerates `%substr%`. For large ledgers, consider `retreat_registration_with_payments` materialized view refreshed via `NOTIFY` — deferred. |
| **Export large dataset hitting PostgREST `max_rows` (default 1000)** | Excel incomplete | Export handler chunks: loop `range(from, to)` of 1000 until `data.length < 1000`, aggregate, then `XLSX.write`. Tests mock chunking. |
| **Ley 1581 — purpose creep retreat → Valientes membership** | Reusing retreat consent for attendance membership may exceed declared purpose (`RETIRO` privacy notice `RETREAT_PRIVACY_NOTICE_ES` purpose = retreat pre-registration) | Dialog requires fresh checkbox: `Acepto que mis datos se traten para mi incorporación al grupo Valientes como miembro asistente (Ley 1581)` with link to updated policy `pdtp-v1.0-2026-07-17`. RPC copies `general_consent_accepted_at=now()` semantics? Decision Q: treat retreat consent as sufficient (since same holder and pastoral purpose) vs require explicit transfer consent. Default: **explicit transfer consent checkbox** (logged via `transferred_at` + audit note). Proposal will lock. |
| **Rabbit RLS: `leader` cannot `INSERT members` via direct PostgREST? Actually `members_insert WITH CHECK (user_role IN super_admin,leader)` allows; so why need definer?** | Confusion on whether RPC definer needed for members insert | Definer still needed for `transferred_*` update (no policy) and to keep single transaction. Direct `INSERT members` via POST would also require leader JWT — allowed, but transfer needs atomicity. Keep definer. |
| **Concurrency: two leaders transfer same `registration_id` simultaneously** | Double `members` insert race, duplicate Valientes row | Guard `transferred_at IS NOT NULL` check inside RPC with `SELECT ... FOR UPDATE` row lock (`PERFORM ... FROM retreat_registrations WHERE id=p_registration_id FOR UPDATE`). Second waiter blocks, then sees `transferred_at` set and raises `already_transferred`. Handles race. |
| **RDD risk high — PII move + money + report** | Review finds severe issues | Expect **4-lens review (high)** (`review-risk`, `review-resilience`, `review-readability`, `review-reliability`) because of PII handling, money sum gate, `SECURITY DEFINER`, and export. Budget `min(200, ceil(changed_lines/2))`. Must follow `supabase-postgres-best-practices` (search_path, RLS, `WITH (security_invoker=true)` for any view) and `supabase` skill (revoke public, least privilege). Forecast before PR. |
| **Offline click → lost transfer** | User offline taps transfer, no feedback | Disable button `disabled title="Requiere conexión"` when `!navigator.onLine` or no session (same as 013). No queue. |
| **Printing leaks PII in paper** | Physical print of payment report taken out | Print CSS keeps same RLS gate: only `leader/super_admin` can print; add header `Confidencial — Ley 1581 — Uso interno MD CC` on printed sheet via `@media print`. |

---

## 7. Open Questions for Proposal (with defaults)

**1. ¿Transferir = crear row en `members` a partir de `retreat_registrations` ya `inscrito` (`SUM >= total`)? ¿Qué campos mapear?**

Default: **Sí — crear en `members` solo cuando `status='inscrito'` y `transferred_at IS NULL`, idempotente.** Mapeo: `name → members.name + name_normalized=lower(btrim(name))`, `phone → normalizeE164(rr.phone)` (+57), `email → lower(btrim(email))`, `birthday → birthday`, `is_minor/legal_rep_name` directo, `denomination/community_name → pgp_sym_encrypt` si `sensitive_consent`, `pastoral_group='Valientes'`, `consent_recorded=true`, `sensitive_consent_recorded=(sensitive_at IS NOT NULL)`, `has_whatsapp=false`, `created_by=auth.uid()`. Si `member_id` ya apunta a origen (013), esa transferencia es **no-op creation** — en su lugar `UPDATE members SET pastoral_group='Valientes' WHERE id=member_id` (super_admin definer). Propuesta debe decidir: **always create vs branch on `member_id`**. Default: branch.

**2. ¿Cuándo habilitar el botón "Transferir a Valientes"? ¿Idempotente?**

Default: **Solo si `status='inscrito'` (`SUM >= total`) y `transferred_at IS NULL` y `transferred_member_id IS NULL` y `canTransferRetreatToValientes(role)=true` y online.** Idempotente: segundo clic / concurrente → `already_transferred` `23505` toast "Ya fue transferido a Valientes el DD/MM/YYYY — Ver miembro". No habilitar para `preinscrito` ni `pagos_parciales`.

**3. ¿Tabla de retiro actual ya es tabulada/paginada/buscador? ¿Qué falta para "eficiente e indexado"?**

Default: **No.** Hoy es un único `<Table>` que hace `select(...).order('name')` sin `range` sin `count` sin `ilike` (verified `retreat-registrations/page.tsx:60-70`). Falta: server-side `range(count:'exact')`, tabs por estado, debounce `search` con `or(name.ilike,email.ilike,phone.ilike)`, GIN trigram `gin_trgm_ops` + btree `status, created_at`, paginación 20/50, sort. Propuesta adopta ese plan; no inventar paginación client-side.

**4. ¿Reportes Excel: uno "estado de pago por preinscrito" (incluye parciales) y otro "listado de inscritos" (solo `sum>=total`)? ¿Columnas, filtros, demanda?**

Default: **Dos botones on-demand:** (a) Estado de pago (todos, con filtros aplicados de tab+search): columnas `Nombre, Teléfono, Email, FechaNacimiento, EsMenor, RepLegal, Estado, Pagado, Saldo, %Pagado, TotalRetiro, CantAbonos, ÚltimoAbono, Transferido (Sí/No), FechaTransferencia`. (b) Listado de inscritos (filtro `status=inscrito` forzado). Ambos usan `src/lib/retreat/export.ts` con SheetJS `json_to_sheet → book_new → write`. Nombre `retiro-estado-pago-YYYY-MM-DD.xlsx`, `retiro-inscritos-YYYY-MM-DD.xlsx`. Impresión via `window.print()` misma tabla con `@media print`. Bloquear offline.

**5. ¿Reporte de abonos en sección retiros: vista agregada por persona (`sum, remaining, %`)? ¿Tiempo real o materialized?**

Default: **Tiempo real.** No materialized view en V1. Datos derivados de mismo query que tabla: `total_paid=COALESCE(SUM(amount),0)`, `remaining=total-total_paid`, `%=total_paid/total*100`, `last_payment_at=MAX(created_at)`. Puede ser misma tabla con columnas extra + footer aggregates o tab "Reporte de abonos" separado. View `retreat_registration_with_payments` `WITH (security_invoker=true)` opcional para reutilizar; no `MATERIALIZED` hasta que N>5000.

**6. ¿Grupo "Valientes": es un valor en `members.pastoral_group` / `members.community` o tabla `groups`?**

Default: **G1 — columna `members.pastoral_group TEXT` nullable, `pastoral_group='Valientes'` al transferir, índice parcial `WHERE pastoral_group IS NOT NULL`, `COMMENT`.** No existe hoy (grep 0 hits); no se reuse `community_name_encrypted`. G2 `groups`+`member_groups` junction se deja como evolución documentada. Propuesta bloquea G1.

**7. ¿RBAC: quién puede transferir (super_admin vs leader)? ¿Auditoría?**

Default: **`leader` + `super_admin` vía `canTransferRetreatToValientes = canManageRetreatRegistrations` (mismo que pagos), idempotencia y audit `transferred_at/transferred_member_id/transferred_by` + `audit_log` trigger (`log_mutation`) en ambas tablas.** Si parroquia exige solo sacerdote, restringir a `super_admin` only es un line change. Default laxo (leader puede) para no frenar operativo; propuesta puede endurecer a super_admin con razón.

**8. ¿RDD: riesgo high por mover PII + crear members + pagos + reportes → 4-lens review esperado?**

Default: **Sí — high.** 4-lens `risk, resilience, readability, reliability` con presupuesto `min(200, ceil(changed_lines/2))`. Razones: `SECURITY DEFINER`, PII `pgp_sym_encrypt`, money gate `SUM>=total`, RLS, export de PII. Forecast antes de `sdd-apply`. Si slice se parte en PRs <300 líneas net, cada PR puede ser `one-lens` pero lineage padre sigue high.

**9. ¿Qué hacer con duplicados si email/phone ya existe en `members`?**

Default: **Rechazar transferencia con error amigable `Ya existe un miembro con ese email/teléfono — Ver miembro` y link a `/members`.** No `ON CONFLICT DO NOTHING`, no auto-link, no merge. RPC hace `EXISTS` sobre `members WHERE deleted_at IS NULL AND (lower(btrim(email))=v_email OR regexp_replace(phone,'[^0-9]','')=v_phone)` antes de insertar. Follow-up: param `p_link_existing BOOLEAN` para fusionar — diferido.

**10. ¿Naming del change y spec?**

Default: **Mantener `retreat-valientes-transfer` como pidió el usuario (tentative).** Alternativas `retreat-to-valientes`, `youth-retreat-valientes-transfer`, `retreat-transfer-valientes`. No renombrar sin aviso. Specs: `openspec/specs/youth-retreat-valientes-transfer/spec.md` (new) o deltas sobre `youth-retreat-payments` + `members`. Propuesta elige y deja alias en README.

---

## 8. Naming Recommendation

- **Requested:** `retreat-valientes-transfer` — acceptable, sigue prefijo `retreat-`, claramente distinto de `retreat-member-preinterest` y `youth-retreat-preregistration`.
- **Alternatives considered:** `retreat-to-valientes` (más corto, pierde sufijo `transfer`), `youth-retreat-valientes-transfer` (alinea con `youth-retreat-*` specs pero más largo), `valientes-transfer` (pierde dominio `retreat` context).
- **Spec impact:** Si el spec canónico se crea como `openspec/specs/retreat-valientes-transfer/spec.md`, mantiene dominio `retreat-*` agrupado. Si se prefiere `youth-retreat-valientes-transfer`, requiere rename de `openspec/specs`.
- **Recommendation:** **Conservar `retreat-valientes-transfer` tal como delegó el orchestrator.** Si la propuesta quiere normalizar a `youth-retreat-valientes-transfer`, debe dejar un `README.md` alias en `openspec/changes/retreat-valientes-transfer/README.md` → "canonical spec is youth-retreat-valientes-transfer". No mover directorio sin registro.

---

## 9. Next Steps (proposal inputs)

- Lock Q1–Q10 defaults above in `proposal.md` §§1–21 (G1 vs G2, gate `inscrito`-only, idempotency `transferred_*`, mapping + encryption, pagination/search indexes, export columns, RBAC, 4-lens RDD).
- Draft spec deltas:
  - New spec `retreat-valientes-transfer` (or `youth-retreat-valientes-transfer`): 6–8 normative requirements — *Transfer Gate*, *RPC Idempotent Transfer*, *Members Valientes Field*, *Paginated Indexed Table*, *Excel Exports*, *Abonos Report*, *RBAC + Audit Ley 1581* — each with `GIVEN/WHEN/THEN` scenarios.
  - Delta `youth-retreat-payments` add-on: reference transfer gate depends on `status=inscrito` (payment sum) no inventing new total.
- Design: migration `014_retreat_valientes_transfer.sql` (G1 column + transferred_* cols + indexes + `pg_trgm` + RPC + grants + `NOTIFY`), `src/lib/retreat/export.ts`, `src/app/(dashboard)/retreat-registrations/page.tsx` refactor plan (tabs, search, pagination, transfer dialog), `src/lib/rbac/guards.ts` new guard, view `retreat_registration_with_payments` optional, tests extension.
- Tasks: PR1 schema+RPC+RLS tests (high-risk core), PR2 pagination/search/export helpers + page refactor (UI), PR3 transfer dialog+bulk polish+playwright (integration). Deliver `stacked-to-main` unless `exception-ok` for >400 authored lines.
- Verify: extend `supabase/tests/retreat_rls.test.sql` with valientes cases; Vitest for `payments.test.ts` + `export.test.ts` + `guards-transfer.test.ts`; Playwright for leader flow `retreat tab inscrito → transfer → members Valientes row → Excel download → print` + isolation check `no bulk retreat SELECT on members directory`.
- Gate: TDD RED→GREEN, `npx tsc --noEmit`, `npx next lint`, `npx vitest`, `supabase db reset` (001→014) + `retreat_rls.test.sql` 52+ new PASS, `playwright --list` list new spec.

---

## 10. Sources Checked (evidence)

- `supabase/migrations/001_initial_schema.sql` — `members` DDL + RLS + `user_role()` + `log_mutation` + seed.
- `supabase/migrations/003_grant_authenticated_table_access.sql` — default grants.
- `supabase/migrations/011_youth_retreat_preregistration.sql` — full retreat DDL + RPC + triggers + indexes + seed `retreat.youth.total_cost=''`.
- `supabase/migrations/012a_whatsapp_pastoreo_core.sql` … `012d` — whatsapp/pastoreo idempotent migrations, vault, notification_log (retreat untouched).
- `supabase/migrations/013_retreat_member_link.sql` — `member_id` nullable FK + partial index + authenticated RPC member→retreat.
- `supabase/tests/retreat_rls.test.sql` — owner-run RLS/RPC/payment/status/member-link tests (long file, 52 PASS).
- `src/app/(dashboard)/retreat-registrations/page.tsx` — staff page without pagination/search/transfer (verified single `Table` + `loadData` with `Promise.all` of full selects).
- `src/app/(dashboard)/members/page.tsx` — Dexie-first directory + `Preinscribir al retiro` dialog + `maybeSingle` badge (pattern to reuse for Valientes).
- `src/components/forms/CaptureForm.tsx` — variant `member|retreat` + `submitAdapter` pattern + `initialValues` (013).
- `src/lib/retreat/submit-adapter.ts` + `constants.ts` — `RETREAT_EVENT_KEY='retiro-juvenil-octubre-2026'`, `register_retreat_preinscription` anon vs `register_retreat_preinscription_for_member` auth.
- `src/lib/retreat/payments.ts` + `__tests__/payments.test.ts` — `sumPaidByRegistration`, `remainingBalance`, `retreatStatusLabel`.
- `src/lib/rbac/guards.ts` + `types.ts` — `canManageRetreatRegistrations = canCreate` (leader+super_admin).
- `src/lib/sync/db.ts` — Dexie `AttendanceCaptureDB` v1 (no retreat stores).
- `src/lib/export/generate.ts` — SheetJS client export precedent (to copy for retreat).
- `src/lib/settings/app-settings.ts` — `RETREAT_TOTAL_COST_KEY`.
- `src/lib/phone/normalize.ts` — `isValidE164`, `normalizeE164` (target for phone mapping consensus).
- `openspec/specs/youth-retreat-preregistration/spec.md` + `youth-retreat-payments/spec.md` + `retreat-member-preinterest/spec.md` — normative retreat specs.
- `openspec/changes/archive/2026-08-27-retreat-member-preinterest/proposal.md|design.md|explore.md` — prior B decision (FK nullable, RPC definer, prefill).
- `openspec/config.yaml` — `strict_tdd:true`, `persistence.mode:both`, `openspec_dir:openspec`.
- `package.json` — `xlsx` via CDN `0.20.3`, `next 15.5.22`, `supabase-js 2.112.0`, `dexie 4.0.11`, `vitest 3.2.1`, `playwright 1.62.1`.
- `grep -r Valientes` — 0 hits in `supabase/migrations` + `src` (evidence Valientes does not exist).
- `grep -r "members\.group|groups"` — 0 hits (no groups table or column).

---

## 11. Skill Resolution

- `skill_resolution: paths-injected` — `gentle-ai`, `supabase`, `supabase-postgres-best-practices` injected via `## Skills to load before work` (exact `SKILL.md` paths). Registry not needed; fallback-path not used.

---

## Appendix — Field Mapping Detail (para diseño/verify)

| Retreat `retreat_registrations` | `members` target | Transform | Ley 1581 note |
|----------------------------------|------------------|-----------|---------------|
| `name` | `name`, `name_normalized` | `btrim(name)`, `lower(btrim(name))` | Identidad — same purpose pastoral |
| `phone` (digit-only, `regexp_replace(btrim(phone),'[^0-9]','')`) | `phone` | `normalizeE164('+57'+digit)` if 10 digits, else keep E164; tests ensure `libphonenumber-js` pass | Consent on retreat row already `general_consent_accepted_at`; transfer dialog adds explicit Valientes consent checkbox (default explicit) |
| `email` (`lower(btrim(email))`) | `email` | same | same |
| `birthday` | `birthday` | direct `DATE` | minor derivation reused |
| `is_minor`, `legal_rep_name` | `is_minor`, `legal_rep_name` | direct | from birthday + input |
| `denomination` (`TEXT` plain, only if `sensitiveConsent`) | `denomination_encrypted` (`BYTEA`) | `pgp_sym_encrypt(v_denomination, vault_key)` inside definer | sensitive — must match members encryption pattern; null if no consent |
| `community_name` (`TEXT` plain) | `community_name_encrypted` (`BYTEA`) | same | same |
| `general_consent_accepted_at/policy_version` | `consent_recorded=true` + `consent_records`? | No `consent_records` row per 011 spec ("consent on row"); for transfer, same — audit on `transferred_at` suffices | purpose limited to Valientes membership |
| — | `pastoral_group='Valientes'` | fixed literal G1 | auditable via `members_pastoral_group_idx` |
| — | `has_whatsapp=false`, `duplicate_flag=false` | defaults | |
| — | `created_by=auth.uid()`, `created_at=now()` | from JWT | |
| `member_id` (013 origin) | `transferred_member_id` | FK to new `members.id` | origin `member_id` stays as origin link; `transferred_member_id` is destination |
| — | `transferred_at=now()`, `transferred_by=auth.uid()` | on `retreat_registrations` | idempotency guard |

> **Nota:** Si `retreat_registrations.member_id IS NOT NULL` (i.e., este retiro nació desde `members` vía 013), el transfer no debe crear un nuevo `members` sino `UPDATE members SET pastoral_group='Valientes' WHERE id=member_id` (definer). Evita duplicar a la misma persona que ya es miembro. Si ese `members.pastoral_group` ya es `Valientes`, la transferencia es `already_transferred`.

---

## Appendix — Pagination & Index DDL Sketch (para design)

```sql
-- Additive in 014
CREATE EXTENSION IF NOT EXISTS pg_trgm; -- already available on Supabase PG15

CREATE INDEX IF NOT EXISTS retreat_registrations_status_idx
  ON public.retreat_registrations(status);

CREATE INDEX IF NOT EXISTS retreat_registrations_event_status_idx
  ON public.retreat_registrations(event_key, status);

CREATE INDEX IF NOT EXISTS retreat_registrations_search_trgm_idx
  ON public.retreat_registrations
  USING gin ((lower(name) || ' ' || lower(email) || ' ' || phone) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS retreat_payments_registration_id_created_at_idx
  ON public.retreat_payments(registration_id, created_at DESC);

-- Members Valientes
CREATE INDEX IF NOT EXISTS members_pastoral_group_idx
  ON public.members(pastoral_group) WHERE pastoral_group IS NOT NULL;

-- Transferred guard
CREATE INDEX IF NOT EXISTS retreat_registrations_transferred_at_idx
  ON public.retreat_registrations(transferred_at) WHERE transferred_at IS NOT NULL;
```

Query for paginated tab:

```ts
supabase.from('retreat_registrations')
  .select('id,name,email,phone,birthday,is_minor,legal_rep_name,status,created_at,transferred_at,transferred_member_id,member_id', { count: 'exact' })
  .eq('event_key', RETREAT_EVENT_KEY)
  .eq('status', tab) // when tab!='todos'
  .or(`name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`) // escaped
  .order('name', { ascending: true })
  .range((page-1)*pageSize, page*pageSize -1)
```

Payments for visible ids: `supabase.from('retreat_payments').select('registration_id,amount,created_at').in('registration_id', ids).order('created_at')` then `sumPaidByRegistration(payments)` (existing helper).

---

## Appendix — Export Column Contract (para verify)

**Estado de pago (todos, filtrado):**

| Col | Fuente | Ejemplo |
|-----|--------|---------|
| Nombre | `rr.name` | Juan Pérez |
| Teléfono | `rr.phone` | 3009000001 |
| Email | `rr.email` | juan@example.com |
| Fecha Nacimiento | `rr.birthday` | 2000-01-15 |
| Es Menor | `rr.is_minor` | No |
| Representante Legal | `rr.legal_rep_name` | — |
| Estado | `rr.status` | Inscrito |
| Pagado (COP) | `SUM(p.amount)` | 400000.00 |
| Saldo (COP) | `total - pagado` | 0.00 |
| % Pagado | `pagado/total*100` | 100.00% |
| Total Retiro (COP) | `app_settings.retreat.youth.total_cost` | 400000 |
| Cant. Abonos | `COUNT(p)` | 2 |
| Último Abono | `MAX(p.created_at)` | 2026-08-26 |
| Transferido a Valientes | `transferred_at IS NOT NULL` | Sí |
| Fecha Transferencia | `transferred_at` | 2026-08-27 |

**Listado de inscritos** = same but `WHERE status='inscrito'` forced + same columns (filtrado en query, no post-filter).

Both include header `Evento: retiro-juvenil-octubre-2026` + `Generado: now es-CO`.

---

## Appendix — RDD Workload Forecast

- **Risk read per skill:** `supabase` (RLS, vault, `SECURITY DEFINER` search_path), `supabase-postgres-best-practices` (indexes, pg_trgm, partial indexes, `security_invoker`), `gentle-ai` (TDD, 4-lens).
- **Tier:** **High** — PII move (`pgp_sym_encrypt`), money gate (`SUM>=total`), `SECURITY DEFINER` bypass, PII export.
- **Lenses:** Canonical 4R (`review-risk`, `review-resilience`, `review-readability`, `review-reliability`) — trigger on high-tier regardless of line count; also `>400 authored changed lines` auto-high but high already.
- **Budget:** `min(200, ceil(original_changed_lines/2))` — expect ~500 reviewed lines → budget ~200 (capped).
- **Mitigation:** Keep PRs stacked-to-main: PR1 RPC+schema (<200 lines), PR2 pagination/export, PR3 transfer dialog+E2E — each still high but isolated; orchestrator must forecast before each.
- **Artifacts for review:** migration SQL, RPC body with search_path, RLS policies, `export.ts` SheetJS, paginated query `range+count+ilike`, `transferred_*` idempotency `FOR UPDATE`.

