# Proposal: Retreat Member Pre-interest

> **Change:** `retreat-member-preinterest`
> **Artifact store:** `openspec` — `openspec/changes/retreat-member-preinterest/proposal.md` + Engram `sdd/retreat-member-preinterest/proposal`
> **Exploration:** `openspec/changes/retreat-member-preinterest/explore.md` + Engram `sdd/retreat-member-preinterest/explore` (#96)
> **Date:** 2026-08-27
> **Mode:** `strict_tdd=true`, `artifact_store=openspec`
> **Status:** Proposed — awaiting spec/design
> **Author:** SDD proposal executor (Muse Spark — Gentle AI)

---

## Executive Summary (ES — rioplatense)

Che, el problema es clarito: hoy un miembro que ya está en `members` y quiere ir al retiro juvenil de octubre tiene que cargar todo de nuevo en `/retiro` como si fuera un extraño. Eso genera fricción para líderes, duplica PII, y rompe la historia clínica del miembro (pagos del retiro quedan huérfanos del directorio). La propuesta no inventa un flag booleano en `members` ni toca RLS/Dexie. Agrega un `member_id UUID NULL REFERENCES members(id) ON DELETE SET NULL` en `retreat_registrations`, un RPC autenticado `register_retreat_preinscription_for_member` (`SECURITY DEFINER`, `search_path=''`, `GRANT TO authenticated`) que re-captura el consentimiento Ley 1581 en el mismo `CaptureForm` (variant `retreat`, prefill con `initialValues` editable), respeta las uniques `(event_key, email/phone normalizados)` y deja el estado inicial en `preinscrito`. En el panel de miembros solo aparece un badge opcional; el listado completo y los pagos siguen viviendo exclusivamente en el módulo Retiro. Es el cambio más chico que no ensucia `members` y reutiliza exactamente los mismos campos que `/retiro`.

---

## Proposal Question Round

Per the SDD Skill Resolution Contract, proposal-shaping questions should uncover business rules, implications, impact, edge cases and tradeoffs — not harness mechanics. The exploration phase already enumerated 10 product decisions with defaults; this proposal locks them (see § Decisions D1–D10). If interactive review is desired, the reviewer can correct any assumption or request a second round. No further blocking question round is emitted because defaults are explicit and reversible in spec/design.

**Assumptions needing reviewer confirmation:**

- Staff reuses EXACTLY the same `CaptureForm` fields as `/retiro` (no forked field set); prefill is convenience only and remains editable before submit.
- Duplicate `(event_key, email/phone)` in V1 fails with a friendly error + link to the retreat module; auto-linking the existing row to `member_id` is deferred.
- Sensitive religious data (`denomination`/`community_name`) is NOT prefilled from encrypted `members` columns; staff re-enters it only if sensitive consent is re-checked.
- Flow is online-only; Dexie is untouched.

---

## 1. Summary

A `members` row that already exists (attendance/capture domain) can be marked as interested and pre-registered for the youth retreat without retyping everything as a stranger.

- The flow reuses **exactly** the same fields as the public `/retiro` form by rendering `CaptureForm` with `variant="retreat"` + `submitAdapter` + new `initialValues` prefill derived from the selected member. Staff can edit every field before submit.
- On submit, one row is created in `retreat_registrations` with `member_id = members.id` (FK nullable), `event_key = 'retiro-juvenil-octubre-2026'`, `status = 'preinscrito'`, and fresh Ley 1581 consent timestamps/versions stored **on that row** (not in `consent_records`).
- The members panel (`/(dashboard)/members`) **does NOT list** `retreat_registrations` or payments. It may show an optional lightweight badge `Preinscrito` derived via a single `member_id` lookup — no full table, no payment sums.
- The canonical listing and installment recording remain exclusively in `/(dashboard)/retreat-registrations` (existing payments/status machine unchanged).
- Public `/retiro` behavior, anonymous RPC, payment guards, and total-cost config are untouched.

---

## 2. Intent

- **Business problem:** Leaders lose time and create duplicate PII when a known member wants to join the retreat; treasurers cannot trace that pre-registration back to the member without manual email/phone matching. The current deliberate decoupling (`retreat_registrations` has no FK to `members`) blocks the `members → retreat` direction.
- **Target users & moment:** `leader` and `super_admin` inside `/(dashboard)/members` detail view, at the moment they open a known member and the member expresses interest in the October youth retreat. Urgency is operational (capture week / retreat campaign), not emergency.
- **Product outcome:** One click `Preinscribir al retiro` in the member dialog → prefilled retreat CaptureForm → submit → `preinscrito` row linked to that member → visible and payable from the retreat module as if it came from `/retiro`. No `members` state mutation, no Dexie migration, no RLS widening.
- **Current-state gap:** No UI or RPC links `members.id` to `retreat_registrations`; any link today requires re-entering the same data on `/retiro` and later manually reconciling by normalized email/phone.

---

## 3. Scope

### 3.1 In Scope

- **Schema:** `ALTER TABLE retreat_registrations ADD COLUMN member_id UUID NULL REFERENCES members(id) ON DELETE SET NULL`; partial index `CREATE INDEX retreat_registrations_member_id_idx ON retreat_registrations(member_id) WHERE member_id IS NOT NULL`; `NOTIFY pgrst, 'reload schema'`.
- **RPC:** New authenticated function `register_retreat_preinscription_for_member(p_member_id UUID, p_birthday DATE DEFAULT NULL, p_legal_rep_name TEXT DEFAULT NULL, p_general_consent BOOL DEFAULT false, p_sensitive_consent BOOL DEFAULT false, p_denomination TEXT DEFAULT NULL, p_community_name TEXT DEFAULT NULL)` — `SECURITY DEFINER SET search_path = ''`, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO authenticated`, role check `user_role() IN ('leader','super_admin')` inside body, re-derives `name/phone/email` from `members` (never trusts client PII for identity), allows edits via optional overrides only for `birthday/legal_rep/denomination/community` that are supplied from the prefilled form payload, validates `general_consent`, `is_minor → legal_rep`, applies sensitive-consent gating, checks duplicates (member_id + unique indexes), inserts with `member_id` and fresh `general_consent_accepted_at/policy_version` + sensitive stamps, returns `UUID`. Existing anon RPC `register_retreat_preinscription` stays untouched.
- **RLS:** No change to `members` policies. `retreat_registrations` keeps existing `SELECT` for `authenticated leader/super_admin`; new column is readable under that policy. New RPC bypasses RLS intentionally via `SECURITY DEFINER` but enforces role check internally.
- **UI — CaptureForm reuse:** Add optional `initialValues?: Partial<CaptureSubmitPayload>` to `CaptureFormProps`; when present, prefill `name/phone/email/birthday/isMinor/legalRepName` (and consent checkboxes unchecked by default to force re-capture). Keep `variant="retreat"` chrome (`RETREAT_PRIVACY_NOTICE_ES`, hides WhatsApp/social cards). On submit via `submitAdapter`, delegate to new `submitRetreatPreinscriptionForMember`.
- **UI — Members:** In `src/app/(dashboard)/members/page.tsx` detail `Dialog`, add `<Button>Preinscribir al retiro</Button>` gated by `canManageRetreatRegistrations(role)` and `member.deleted_at === null` and `navigator.onLine`. Click opens a `Dialog` rendering `<CaptureForm variant="retreat" submitAdapter={...} initialValues={member} />`. On success: `toast.success('Preinscripción creada')` + optional link `Ver en Retiro` (navigate to `/retreat-registrations`). Optional per-row badge `Preinscrito` fetched via `supabase.from('retreat_registrations').select('id').eq('member_id', member.id).eq('event_key', RETREAT_EVENT_KEY).maybeSingle()` — single-row lookup, not a full list.
- **Client adapter:** `src/lib/retreat/submit-adapter.ts` new `submitRetreatPreinscriptionForMember(memberId, payload)` calling the new RPC; error mapping for `already_preinscribed` / `unique_violation` → friendly toast.
- **No Dexie change:** `src/lib/sync/db.ts` stays without a `retreat_registrations` store; sync queue not used.

### 3.2 Out of Scope (Non-Goals)

- Listing `retreat_registrations` or `retreat_payments` inside `/(dashboard)/members` (beyond the optional single badge).
- Showing members directory inside `/(dashboard)/retreat-registrations` beyond a future back-link `member_id → members` (deferred).
- Dexie offline support for the interest flow; the button is disabled offline with tooltip `Requiere conexión`.
- Modifying `retreat_payments` table, triggers, or `app_settings.retreat.youth.total_cost` logic.
- Changing `members` table (no boolean, no `retreat_*` columns, no trigger).
- Multi-event junction table, CAPTCHA, rate-limit, payment collection on members panel, or event_key configurability — all deferred.
- Decrypting `members.denomination_encrypted` / `community_name_encrypted`.

---

## 4. Provider / Approach

### 4.1 Architecture Choice: Alternative B (FK on retreat)

Single source of truth remains `retreat_registrations.status` + `retreat_payments` sum. Interest is derived (`EXISTS ... WHERE member_id = members.id`) not stored as a boolean. This avoids dual-state drift, avoids widening `members_update` RLS to `leader`, keeps duplicate enforcement on the existing expression indexes, and keeps Ley 1581 consent on the registration row.

### 4.2 Security Model (Postgres 15 + Supabase)

- `SECURITY DEFINER` new RPC in `public` with `SET search_path = ''` and `REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO authenticated` only.
- Body starts with `IF (SELECT public.user_role()) NOT IN ('leader','super_admin') THEN RAISE EXCEPTION 'insufficient permissions'`.
- No new RLS policy on `members`; no `UPDATE` on `members` via PostgREST.
- `retreat_registrations_select` and `retreat_payments_*` policies remain as in `011` (leader/super_admin SELECT, leader/super_admin INSERT on payments). Column `member_id` inherits that SELECT visibility.
- `member_id` FK `ON DELETE SET NULL` ensures soft-delete (`deleted_at`) or hard delete does not orphan or block; retreat row persists for audit.

### 4.3 Data Flow

```
members/page.tsx Dialog
  → user clicks "Preinscribir al retiro" (leader/super_admin, online)
  → Dialog with CaptureForm variant="retreat" initialValues={member}
     (name/phone/email/birthday/isMinor/legalRep prefilled,
      generalConsent=false, sensitiveConsent=false,
      RETREAT_PRIVACY_NOTICE_ES, validation via validateGeneralConsent/validateMinorFields)
  → submitAdapter payload → submitRetreatPreinscriptionForMember(memberId, payload)
  → supabase.rpc('register_retreat_preinscription_for_member', {...})
     → SECURITY DEFINER:
        SELECT name, phone, email, birthday FROM members WHERE id = p_member_id AND deleted_at IS NULL
        → normalize (lower/btrim(email), regexp_replace(phone,'[^0-9]',''))
        → validate p_general_consent, is_minor/legal_rep, sensitive gating
        → duplicate pre-check: member_id OR (event_key, email) OR (event_key, phone)
           → if hit RAISE 'already_preinscribed'
        → INSERT INTO retreat_registrations (..., member_id, event_key, status='preinscrito',
             general_consent_accepted_at=now(), policy_version='pdtp-v1.0-2026-07-17', ...)
           RETURNING id
  → toast success + optional navigate to /retreat-registrations
  → retreat-registrations/page.tsx already lists the new row; payments work unchanged
```

### 4.4 Normalization & Duplicate Handling

- Uniqueness stays enforced by existing indexes: `(event_key, lower(btrim(email)))` and `(event_key, regexp_replace(btrim(phone),'[^0-9]',''))`.
- RPC pre-check gives a friendly `already_preinscribed` error before hitting `23505`; `EXCEPTION WHEN unique_violation` maps any race to the same handled error.
- V1 does **not** auto-link (`UPDATE retreat_registrations SET member_id = ...`) when duplicate is on email/phone but different `member_id`. That would require an `UPDATE` path + RLS. Instead UI shows `Ya existe una preinscripción con ese email/teléfono para este retiro. Ver en Retiro.`

### 4.5 Consent (Ley 1581)

- General consent is re-captured: the prefilled CaptureForm checkbox starts unchecked; `payload.generalConsent` must be true or RPC raises `general consent is required`. Timestamp + `pdtp-v1.0-2026-07-17` stored on the new row.
- Sensitive consent: if `payload.sensitiveConsent` is true, `denomination`/`community_name` + `sensitive_consent_accepted_at/policy_version` are stored; otherwise they are `NULL` (no copy from `members` encrypted columns).

---

## 5. Automations

- No new cron, queue, trigger, or realtime publication is introduced.
- Existing triggers `audit_retreat_registrations`, `set_updated_at`, `retreat_payments_guard_total` / `retreat_payments_apply_status` remain; they already handle status derivation and audit. No trigger is added for the member→retreat path (write is via RPC only).
- `supabase_realtime` publication is not extended to `retreat_*` (per comment in `011`).

---

## 6. Pastoreo

No direct impact. `members` remains the source of truth for attendance/pastoreo (`whatsapp_opt_in/out`, `age_years`, `notification_log`). Retreat data is not synced to Dexie, not included in `pasture` notifications, and not shown in highlights. A future pastoreo campaign that targets `preinscrito` members can join `members.id = retreat_registrations.member_id` in Supabase (server-side), but that is out of scope for this slice.

---

## 7. Schema

### 7.1 DDL (migration `013_retreat_member_link.sql` — name provisional)

```sql
-- 013_retreat_member_link.sql
-- Link retreat_registrations to members without touching members RLS/Dexie.

ALTER TABLE public.retreat_registrations
  ADD COLUMN member_id UUID NULL
  REFERENCES public.members(id) ON DELETE SET NULL;

CREATE INDEX retreat_registrations_member_id_idx
  ON public.retreat_registrations(member_id)
  WHERE member_id IS NOT NULL;

COMMENT ON COLUMN public.retreat_registrations.member_id IS
  'Nullable FK to members.id; set for member-originated pre-registrations, NULL for public /retiro rows. ON DELETE SET NULL preserves audit.';

NOTIFY pgrst, 'reload schema';
```

- All pre-existing rows keep `member_id = NULL` (no backfill). No `NOT NULL` or `UNIQUE` constraint.
- No change to `members` columns, indexes, or policies.
- No Dexie schema version bump.

### 7.2 RPC Signature (one of two equivalent options — spec locks one)

**Preferred:** new authenticated RPC to keep anon surface minimal:

```sql
CREATE OR REPLACE FUNCTION public.register_retreat_preinscription_for_member(
  p_member_id uuid,
  p_birthday date DEFAULT NULL,
  p_legal_rep_name text DEFAULT NULL,
  p_general_consent boolean DEFAULT false,
  p_sensitive_consent boolean DEFAULT false,
  p_denomination text DEFAULT NULL,
  p_community_name text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_event_key constant text := 'retiro-juvenil-octubre-2026';
  c_policy_version constant text := 'pdtp-v1.0-2026-07-17';
  v_name text;
  v_phone text;
  v_email text;
  v_birthday date;
  v_legal_rep text;
  v_is_minor boolean := false;
  v_denomination text := NULL;
  v_community text := NULL;
  v_sensitive_at timestamptz := NULL;
  v_sensitive_policy text := NULL;
  v_id uuid;
BEGIN
  IF (SELECT public.user_role()) NOT IN ('leader','super_admin') THEN
    RAISE EXCEPTION 'insufficient permissions: leader/super_admin required';
  END IF;

  SELECT btrim(m.name),
         regexp_replace(btrim(m.phone), '[^0-9]', '', 'g'),
         lower(btrim(m.email)),
         COALESCE(p_birthday, m.birthday)
    INTO v_name, v_phone, v_email, v_birthday
  FROM public.members m
  WHERE m.id = p_member_id AND m.deleted_at IS NULL;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'member not found or deleted';
  END IF;
  IF v_name = '' OR v_phone = '' OR v_email = '' THEN
    RAISE EXCEPTION 'member is missing required identity fields (name/phone/email)';
  END IF;
  IF p_general_consent IS NOT TRUE THEN
    RAISE EXCEPTION 'general consent is required';
  END IF;

  IF v_birthday IS NOT NULL
     AND EXTRACT(YEAR FROM age(CURRENT_DATE, v_birthday)) < 18 THEN
    v_is_minor := true;
  END IF;

  v_legal_rep := NULLIF(btrim(COALESCE(p_legal_rep_name, '')), '');

  IF v_is_minor AND v_legal_rep IS NULL THEN
    RAISE EXCEPTION 'legal representative is required for minors';
  END IF;

  -- Friendly duplicate pre-check (member_id OR unique email/phone)
  IF EXISTS (
    SELECT 1 FROM public.retreat_registrations r
    WHERE r.event_key = c_event_key
      AND (r.member_id = p_member_id
           OR lower(btrim(r.email)) = v_email
           OR regexp_replace(btrim(r.phone), '[^0-9]', '', 'g') = v_phone)
  ) THEN
    RAISE EXCEPTION 'already_preinscribed: a pre-registration with this member/email/phone already exists for this event';
  END IF;

  IF p_sensitive_consent IS TRUE THEN
    v_denomination := NULLIF(btrim(COALESCE(p_denomination, '')), '');
    v_community := NULLIF(btrim(COALESCE(p_community_name, '')), '');
    v_sensitive_at := now();
    v_sensitive_policy := c_policy_version;
  END IF;

  INSERT INTO public.retreat_registrations (
    event_key, name, phone, email, birthday, is_minor, legal_rep_name, status,
    general_consent_accepted_at, general_consent_policy_version,
    sensitive_consent_accepted_at, sensitive_consent_policy_version,
    denomination, community_name, member_id
  ) VALUES (
    c_event_key, v_name, v_phone, v_email, v_birthday, v_is_minor,
    CASE WHEN v_is_minor THEN v_legal_rep ELSE NULL END,
    'preinscrito', now(), c_policy_version,
    v_sensitive_at, v_sensitive_policy,
    v_denomination, v_community, p_member_id
  )
  RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'already_preinscribed: duplicate email/phone for this event';
END;
$$;

REVOKE ALL ON FUNCTION public.register_retreat_preinscription_for_member(uuid, date, text, boolean, boolean, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_retreat_preinscription_for_member(uuid, date, text, boolean, boolean, text, text) TO authenticated;
```

- Uses `SET search_path = ''` and fully qualified `public.*` references (supabase-postgres-best-practices).
- `user_role()` is the existing `SECURITY DEFINER` helper that reads `auth.jwt()` / `profiles`; no new helper needed.
- `p_birthday` override allows staff to correct birthday before submit; when NULL, falls back to `members.birthday`.

**Alternative wrapper considered but discarded for V1:** adding `p_member_id` to the existing anon RPC. Discarded because it would expose `member_id` on an anon-callable surface and complicate the anon vs authenticated role check.

---

## 8. Templates / Consent

- **CaptureForm template:** No new form component. `CaptureForm` gains `initialValues?: Partial<CaptureSubmitPayload>` (additive prop). Default construction pre-fills `name/phone/email/birthday/legalRepName` from the member; `generalConsent` and `sensitiveConsent` start `false` to force fresh Ley 1581 acceptance. Validation (`validateGeneralConsent`, `validateMinorFields`, `checkMinorStatus`) and privacy notices (`RETREAT_PRIVACY_NOTICE_ES`, `SENSITIVE_DATA_NOTICE_ES`) are reused unchanged.
- **Privacy notice:** The retreat dialog shows `RETREAT_PRIVACY_NOTICE_ES` (purpose = retreat pre-registration, not attendance-only capture), identical to `/retiro`.
- **Policy version:** `pdtp-v1.0-2026-07-17` (constant shared with anon RPC) stored as `general_consent_policy_version` and `sensitive_consent_policy_version` on the new row.
- **No email/SMS template** in this slice.

---

## 9. Risks / Assumptions / Questions

### 9.1 Risks

| Risk | Likelihood | Impact | Mitigation in proposal |
|------|------------|--------|------------------------|
| Duplicate `(event_key,email/phone)` from member vs public row → `23505` leak | Medium | Medium | RPC pre-check + `unique_violation` handler → `already_preinscribed` friendly error + link to `/retreat-registrations` |
| Temptation to widen `members_update` RLS for a boolean flag → accidental leader edit rights | Low (avoided) | High | No `members` column; no RLS change; leader writes only `retreat_registrations` via RPC |
| Stale PII in `members` (phone/email changed since capture) copied verbatim | Medium | Low | CaptureForm prefill is editable; staff can correct before submit; RPC re-validates `name/phone/email` non-empty |
| Ley 1581 purpose misuse (reusing attendance consent for retreat) | Low | High | Require fresh `generalConsent` checkbox in retreat variant; consent stored anew on `retreat_registrations` row |
| Offline click on `Preinscribir` → no Supabase | Medium | Low | Button disabled when `!navigator.onLine` or no session; explicit online-only contract; no Dexie queue |
| `member_id` orphan after `members` soft-delete | Low | Low | `ON DELETE SET NULL` + `deleted_at IS NULL` check in RPC; retreat row persists (audit) |
| Decrypting `denomination_encrypted` to prefill sensitive fields | Low (avoided) | High | Do not decrypt; sensitive fields left empty unless staff re-checks sensitive consent |
| Regression of anon RPC `/retiro` | Low | High | Keep `register_retreat_preinscription` untouched; new RPC additive; `REVOKE/GRANT` scoped; existing tests must still pass |

### 9.2 Assumptions

- `user_role()` helper exists and is `SECURITY DEFINER SET search_path=''` (verified in `001`/`009`).
- `RETREAT_EVENT_KEY = 'retiro-juvenil-octubre-2026'` remains constant for this slice (single event).
- `leader` and `super_admin` are the only roles that may create retreat pre-registrations from members (mirrors `canManageRetreatRegistrations`).
- Members Dexie cache is not the source of truth for retreat linkage; badge fetch is Supabase-only.

### 9.3 Open Questions (none blocking)

- Should the retreat module show a back-link `member_id → members` detail? Deferred to design (simple `SELECT * FROM members WHERE id = $1` behind same guard).
- Should the badge query be batched (e.g., `IN (memberIds)` for the filtered directory page) vs per-dialog? Spec will decide; both satisfy isolation.

---

## 10. Deliverables & Acceptance

### Deliverables

- Migration `supabase/migrations/013_retreat_member_link.sql` (FK + partial index).
- RPC `register_retreat_preinscription_for_member` + `REVOKE/GRANT`.
- `src/components/forms/CaptureForm.tsx` additive `initialValues` prop.
- `src/lib/retreat/submit-adapter.ts` additive `submitRetreatPreinscriptionForMember`.
- `src/app/(dashboard)/members/page.tsx` button + dialog + optional badge (Dexie load path unchanged).
- Extended `supabase/tests/retreat_rls.test.sql` with member-linked cases (authenticated RPC success, duplicate rejection, anon denied, server denied, consent on row).
- Vitest for `CaptureForm initialValues` prefill + `submitAdapter` wiring.
- Playwright for `leader: members → dialog → prefilled retreat form → submit → retreat-registrations row appears → payment succeeds`.

### Acceptance Criteria

- [ ] A `leader`/`super_admin` can open a member detail, click `Preinscribir al retiro`, see a prefilled retreat CaptureForm (same fields as `/retiro`, privacy notice `RETREAT_PRIVACY_NOTICE_ES`), edit fields, accept general consent, and submit successfully.
- [ ] Submit creates exactly one `retreat_registrations` row with `event_key='retiro-juvenil-octubre-2026'`, `status='preinscrito'`, `member_id=members.id`, normalized `email/phone`, `general_consent_accepted_at/policy_version` on the row, and `sensitive_*` only when sensitive consent checked. No row is written to `members` or `consent_records`.
- [ ] Duplicate `(event_key, email)` or `(event_key, phone)` is rejected with a friendly `Ya existe una preinscripción…` message and a link to `/retreat-registrations`; no second row is created; race on unique index maps to same message.
- [ ] The members directory load still reads Dexie only; no full `SELECT * FROM retreat_registrations` in the directory path; at most a single `member_id` lookup for the badge when the dialog is open. No payment columns are shown in members.
- [ ] New row appears in `/(dashboard)/retreat-registrations` as `preinscrito`; consecutive payments (`retreat_payments`) work unchanged (`preinscrito → pagos_parciales → inscrito`).
- [ ] `anon` cannot `EXECUTE` the new RPC (permission denied) and still cannot `SELECT/INSERT/UPDATE/DELETE retreat_*` via PostgREST; `server` cannot execute the new RPC; `leader`/`super_admin` can.
- [ ] `register_retreat_preinscription` (anon) still creates `preinscrito` with `member_id IS NULL` as before; no regression.
- [ ] Offline: button is disabled with tooltip when offline; no Dexie store or sync queue change.

---

## 11. Phases

| Phase | Scope | Depends on |
|-------|-------|------------|
| **0 — Prep** | Exploration locked (this proposal); confirm naming `retreat-member-preinterest` and defaults D1–D10 | — |
| **1 — Schema / RPC** | `013` migration (FK + index) + new authenticated RPC + `REVOKE/GRANT` + `supabase/tests/retreat_rls.test.sql` extensions + Vitest for RPC error mapping | Proposal |
| **2 — UI Reuse** | `CaptureForm initialValues` + `submitRetreatPreinscriptionForMember` + members dialog button + badge + success toast/link; offline disabled state; no Dexie change | Phase 1 |
| **3 — Hardening** | View helper `v_member_retreat_link` if adopted, batch badge fetch, e2e Playwright (leader flow + duplicate + offline), docs | Phase 2 |

`delivery_strategy` = `stacked-to-main` (small, isolated slices; fix on the go). No chained `feature-branch-chain` needed for this size.

---

## 12. Alternatives Discarded

| Alternative | Why discarded |
|-------------|---------------|
| **A — Boolean/link column on `members` + trigger** (`interested_in_retreat BOOL` or `retreat_registration_id FK`, trigger `AFTER UPDATE` creates retreat row) | Dual source of truth (drift), requires reopening `members_update` RLS to `leader` (high-risk widening), trigger error surfacing is opaque, no Ley 1581 re-consent columns on `members`, needs Dexie version bump + sync mapping, violates "reuse same CaptureForm fields" (checkbox bypasses form). |
| **C — Materialized view / view union on normalized email/phone** | Cannot be the write path; join on `lower(btrim(email))` / digit-only phone is expensive and fragile; no FK safety; cannot be the payment target; at most a read helper alongside B. Deferred as optional badge view. |
| **D — Junction table `member_retreat_interests`** (`member_id, event_key, status, ...`) | Over-engineering for single-event requirement; duplicates the `retreat_registrations.status` machine; requires syncing interest → registration to enable payments; more RLS/policies/UI for no current multi-event need. Defer until multi-event is real (YAGNI). |

Matrix and detailed pros/cons live in `explore.md` §3 (preserved verbatim).

---

## 13. Decisions D1–D10 (Locked)

| Decision | Question | Locked Answer (default) |
|----------|----------|--------------------------|
| **D1** | **Q1 — FK vs boolean:** where does interest live? | `retreat_registrations.member_id UUID NULL REFERENCES members(id) ON DELETE SET NULL` + partial index. No boolean on `members`. Interest is derived via `EXISTS`. Nullable so public `/retiro` rows stay `NULL` without backfill. |
| **D2** | **Q2 — Duplicate handling:** link or reject? | **Reject with friendly error + link to retreat** in V1. RPC pre-check + `unique_violation` → `already_preinscribed: email/phone exists for this event → Ver en Retiro`. No auto `UPDATE retreat_registrations SET member_id = …`. Linking is a follow-up. |
| **D3** | **Q3 — RPC vs trigger:** how is the row created? | **New authenticated RPC** `register_retreat_preinscription_for_member` (`SECURITY DEFINER SET search_path=''`, `GRANT TO authenticated`, internal `user_role()` check). No trigger. Keep anon RPC untouched. |
| **D4** | **Q4 — Permissions:** who can mark interest? | `leader` + `super_admin` via `canManageRetreatRegistrations(role)` (i.e., `canCreate`). `server` and `anon` cannot execute the new RPC. UI gate mirrors RPC gate. |
| **D5** | **Q5 — UX entry point:** where is the button? | **Primary button `Preinscribir al retiro` in the member detail `Dialog`** (requires `member.deleted_at IS NULL`). Optional row action icon with tooltip deferred. Keeps directory table uncluttered. |
| **D6** | **Q6 — Consent:** reuse or recapture? | **Recaptured.** Prefilled form checkboxes start unchecked; submit requires `generalConsent = true` anew; `general_consent_accepted_at/policy_version` stored on the new retreat row; `sensitiveConsent` gates `denomination/community_name`. No copy from `consent_records` or encrypted members columns. |
| **D7** | **Q7 — Isolation:** what does members show? | **Members does NOT list retreat pre-registrations or payments.** At most a lightweight single-row badge `Preinscrito` via `member_id` lookup. Full table + payment recording stay exclusively in `/retreat-registrations`. |
| **D8** | **Q8 — Offline:** is marking interest offline? | **Online-only.** Dexie is not extended; `retreat_registrations` has no Dexie store; sync queue not used. Button disabled when `!navigator.onLine` / no Supabase session, with tooltip `Requiere conexión`. Documented limitation. |
| **D9** | **Q9 — Event key:** configurable? | **Constant.** RPC hardcodes `c_event_key = 'retiro-juvenil-octubre-2026'` via `RETREAT_EVENT_KEY` constant. No UI to change it; multi-event = future migration (junction) if ever needed. |
| **D10** | **Q10 — Blocking / naming:** does D2 block proposal? Name lock? | **D2 does not block.** Proposal ships the reject path; auto-linking is non-blocking follow-up. Change name stays `retreat-member-preinterest` (as requested); prefix `retreat-` preserved; no directory rename. |

---

## 14. Affected Areas

| Area | File / Object | Change |
|------|---------------|--------|
| `members` (read) | `src/app/(dashboard)/members/page.tsx` | Modified: add retreat pre-inscription button/dialog, optional badge, online gate, `useRole`/`canManageRetreatRegistrations` import |
| `CaptureForm` | `src/components/forms/CaptureForm.tsx` | Modified: add `initialValues?: Partial<CaptureSubmitPayload>` prop, prefill `useState`/`useEffect`, keep variant/adapter contract |
| `retreat adapter` | `src/lib/retreat/submit-adapter.ts` | Modified: add `submitRetreatPreinscriptionForMember(memberId, payload)` |
| `retreat constants` | `src/lib/retreat/constants.ts` | Unchanged (reuse `RETREAT_EVENT_KEY`) |
| `rbac` | `src/lib/rbac/guards.ts` | Unchanged (reuse `canManageRetreatRegistrations`) |
| `retreat list` | `src/app/(dashboard)/retreat-registrations/page.tsx` | Unchanged for this slice (future: optional back-link via `member_id`) |
| `public form` | `src/app/retiro/page.tsx` | Unchanged |
| `Dexie` | `src/lib/sync/db.ts` | Unchanged |
| `DB — migration` | `supabase/migrations/013_retreat_member_link.sql` | New: `member_id` FK + partial index + `NOTIFY pgrst` |
| `DB — RPC` | `public.register_retreat_preinscription_for_member` | New: `SECURITY DEFINER`, `search_path=''`, `GRANT TO authenticated` |
| `DB — tests` | `supabase/tests/retreat_rls.test.sql` | Extended: member-linked RPC cases |
| `specs` | `openspec/specs/youth-retreat-preregistration` / `youth-retreat-payments` | Extended via spec delta in next phase (addendum: staff may create pre-registration from existing member) |

---

## 15. Risks (Summary)

See §9 for full matrix. Top residual risk is duplicate email/phone collision between public and member-originated rows; mitigated by pre-check + `unique_violation` mapping + friendly UX. No new PII exposure: `member_id` is readable only under existing leader/super_admin `SELECT` on `retreat_registrations`; anon path unchanged.

---

## 16. Rollback Plan

- **Code:** Revert deploy (feature is additive; members panel falls back to no button; retreat module unaffected).
- **DB — soft:** `DROP FUNCTION public.register_retreat_preinscription_for_member(...)` and `REVOKE` cleanup; `NOTIFY pgrst, 'reload schema'`.
- **DB — hard:** `ALTER TABLE retreat_registrations DROP COLUMN member_id` and `DROP INDEX retreat_registrations_member_id_idx` (index drop is implicit with column). Non-prod `supabase db reset` also works.
- **Data:** No data migration to undo (existing rows stay `NULL` for `member_id`). If rows with `member_id` were created, they remain valid retreat registrations after column drop — or drop is deferred until they are manually cleared. No `members` data is mutated by this change.
- **Public path:** Revoke `EXECUTE` from `authenticated` on the new RPC if needed; anon RPC `register_retreat_preinscription` remains.

---

## 17. Dependencies

- `public.user_role()` helper (exists).
- `app_settings.retreat.youth.total_cost` + payment triggers (exist; payments continue to work unchanged).
- `CaptureForm` variant/adapter contract (exists; `validateGeneralConsent`/`validateMinorFields`/`SENSITIVE_DATA_NOTICE_ES`/`RETREAT_PRIVACY_NOTICE_ES` exist).
- `canManageRetreatRegistrations` (`leader`/`super_admin`) — already gates retreat module.

---

## 18. Success Criteria

Same as Deliverables acceptance in §10. In short:

1. Leader/super_admin can pre-inscribe an existing member via prefilled retreat CaptureForm; one `preinscrito` row with `member_id` is created with correct normalization and fresh consent.
2. Duplicate email/phone for same `event_key` is rejected with a friendly error and no second row.
3. Members panel remains Dexie-first and does not list retreat tables/payments (badge only, if adopted).
4. New row is fully functional in retreat module (list + payments → status machine).
5. RLS/GRANT matrix holds: anon/server cannot execute new RPC; leader/super_admin can; anon RPC regression free.
6. No `members` RLS or Dexie mutation; no public-form regression.

---

## 19. Alternatives & Tradeoffs (Pointer)

Full comparison matrix (A vs B vs C vs D) and costs are preserved in `explore.md` §3 — not duplicated here. This proposal selects **B** and explicitly discards A/C/D per §12.

---

## 20. References

- `openspec/changes/retreat-member-preinterest/explore.md` §§1–11 (verified repo state, alternatives matrix, 10 questions).
- `openspec/specs/youth-retreat-preregistration/spec.md` + `openspec/specs/youth-retreat-payments/spec.md` (post-archive current specs).
- `supabase/migrations/011_youth_retreat_preregistration.sql` (existing tables, unique indexes, RLS, RPC, payment triggers).
- `src/components/forms/CaptureForm.tsx` (variant/submitAdapter pattern to reuse).
- `src/app/(dashboard)/members/page.tsx` (detail Dialog where the button lives).
- `src/app/(dashboard)/retreat-registrations/page.tsx` (canonical listing/payments).
- `src/lib/retreat/constants.ts` / `src/lib/retreat/submit-adapter.ts` / `src/lib/rbac/guards.ts` (constants, adapters, role checks).
- `supabase/tests/retreat_rls.test.sql` (owner-run test style to extend).

---

## 21. Next Phase Handoff

- **Spec:** Add delta to `youth-retreat-preregistration` (or new `retreat-member-preinterest` spec) formalizing D1–D10, isolation invariant, duplicate handling, and online-only contract.
- **Design:** Lock `013` migration filename, RPC signature (preferred vs wrapper), `CaptureForm initialValues` prop shape, dialog/badge error mapping, and `v_member_retreat_link` helper decision.
- **Tasks:** Slice per §11 phases with `stacked-to-main`.

> No `spec/design/tasks` are created in this phase — proposal only, per delegated task.
