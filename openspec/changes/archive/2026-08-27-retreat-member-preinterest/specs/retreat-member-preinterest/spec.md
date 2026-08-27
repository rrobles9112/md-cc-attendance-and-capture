# Retreat Member Preinterest Specification

## Purpose

Enable a `leader` or `super_admin` to pre-register an existing `members` row for the youth retreat (`retiro-juvenil-octubre-2026`) without retyping identity as a stranger, by creating a `retreat_registrations` row linked via nullable FK `member_id` with fresh Ley 1581 consent. Reuse the existing `CaptureForm` `variant="retreat"` with prefill, keep `members` untouched, keep isolation between `/members` and `/retreat-registrations`, and preserve duplicate/consent/event-key invariants.

## ADDED Requirements

### Requirement: Member Interest Link

The system MUST link a member-originated pre-registration to its source member via a nullable foreign key on `retreat_registrations`. The column `member_id` MUST be `UUID NULL REFERENCES public.members(id) ON DELETE SET NULL`. The system MUST create a partial btree index `retreat_registrations_member_id_idx ON public.retreat_registrations(member_id) WHERE member_id IS NOT NULL`. All pre-existing rows MUST remain `member_id IS NULL` (no backfill, no `NOT NULL` constraint, no `UNIQUE` constraint on `member_id`). The system MUST NOT alter `public.members` columns, indexes, or RLS policies. The migration MUST `NOTIFY pgrst, 'reload schema'` and SHOULD set `COMMENT ON COLUMN public.retreat_registrations.member_id`.

#### Scenario: Migration creates nullable FK and partial index without backfill

- GIVEN no `member_id` column exists on `retreat_registrations`
- WHEN the `013_retreat_member_link` migration runs
- THEN `retreat_registrations.member_id` SHALL be `UUID NULL REFERENCES members(id) ON DELETE SET NULL`
- AND `retreat_registrations_member_id_idx` SHALL exist with predicate `WHERE member_id IS NOT NULL`
- AND every pre-existing row SHALL have `member_id IS NULL`

#### Scenario: ON DELETE SET NULL preserves audit after member deletion

- GIVEN a `retreat_registrations` row with `member_id = M` and `event_key = 'retiro-juvenil-octubre-2026'`
- WHEN `members` row `M` is hard-deleted (or soft-deleted future hard delete)
- THEN the retreat row SHALL persist with `member_id IS NULL`
- AND no FK violation SHALL occur

#### Scenario: Members table remains untouched

- GIVEN the migration has run
- WHEN `public.members` DDL and policies are inspected
- THEN `members` SHALL have no new columns, indexes, triggers, or RLS changes
- AND Dexie `AttendanceCaptureDB` version SHALL NOT bump for this change

#### Scenario: PostgREST schema cache is reloaded

- GIVEN the migration completes
- WHEN any PostgREST request hits `retreat_registrations`
- THEN the new `member_id` column SHALL be visible without manual reload (via `NOTIFY pgrst, 'reload schema'`)

---

### Requirement: Authenticated RPC Preinscription for Member

The system MUST provide `public.register_retreat_preinscription_for_member` that creates one `retreat_registrations` row with `status = 'preinscrito'` and `member_id` set.

Signature (normative):
`register_retreat_preinscription_for_member(p_member_id uuid, p_birthday date DEFAULT NULL, p_legal_rep_name text DEFAULT NULL, p_general_consent boolean DEFAULT false, p_sensitive_consent boolean DEFAULT false, p_denomination text DEFAULT NULL, p_community_name text DEFAULT NULL) RETURNS uuid`

Normative behavior:

- The function MUST be `LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''` with fully-qualified `public.*` references and `REVOKE ALL ON FUNCTION ... FROM PUBLIC; GRANT EXECUTE ON FUNCTION ... TO authenticated` only (no `anon`, no `service_role` via this grant).
- The function body MUST first check `IF (SELECT public.user_role()) NOT IN ('leader','super_admin') THEN RAISE EXCEPTION 'insufficient permissions: leader/super_admin required'`.
- The function MUST `SELECT btrim(name), regexp_replace(btrim(phone),'[^0-9]','g'), lower(btrim(email)), COALESCE(p_birthday, members.birthday)` from `public.members WHERE id = p_member_id AND deleted_at IS NULL`; if not found it MUST `RAISE EXCEPTION 'member not found or deleted'`.
- The function MUST validate `v_name <> ''`, `v_phone <> ''`, `v_email <> ''` else raise required-fields error.
- The function MUST require `p_general_consent IS TRUE` else `RAISE EXCEPTION 'general consent is required'` (fresh consent re-capture).
- The function MUST derive `v_is_minor` from `v_birthday` (`EXTRACT(YEAR FROM age(CURRENT_DATE, v_birthday)) < 18`) and, when `v_is_minor = true`, require `NULLIF(btrim(COALESCE(p_legal_rep_name,'')), '') IS NOT NULL` else `RAISE EXCEPTION 'legal representative is required for minors'`.
- The function MUST gate sensitive fields: only when `p_sensitive_consent IS TRUE` MAY it store `denomination`/`community_name` plus `sensitive_consent_accepted_at = now()` and `sensitive_consent_policy_version = 'pdtp-v1.0-2026-07-17'`; otherwise those four columns MUST be `NULL`.
- The function MUST insert with `event_key = 'retiro-juvenil-octubre-2026'`, `general_consent_accepted_at = now()`, `general_consent_policy_version = 'pdtp-v1.0-2026-07-17'`, normalized `name/phone/email`, `birthday = v_birthday`, `is_minor`, `legal_rep_name` (only if minor), `member_id = p_member_id`, and `RETURNING id`.
- The function MUST handle duplicates via friendly pre-check plus `EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'already_preinscribed: duplicate email/phone for this event'` (race mapping). The existing `public.register_retreat_preinscription` (anon) MUST remain unchanged.

#### Scenario: Leader creates linked preinscrito via authenticated RPC

- GIVEN an authenticated `leader` session and a `members` row `M` with `deleted_at IS NULL` and valid `name/phone/email`
- AND `p_general_consent = true` and birthday indicates an adult
- WHEN the leader calls `register_retreat_preinscription_for_member(p_member_id := M.id, ...)`
- THEN one `retreat_registrations` row SHALL be inserted with `status='preinscrito'`, `member_id=M.id`, `event_key='retiro-juvenil-octubre-2026'`, normalized `email`/`phone`, `general_consent_accepted_at` not null and `general_consent_policy_version='pdtp-v1.0-2026-07-17'`
- AND no `members` row SHALL be mutated and no `consent_records` row SHALL be created by this RPC

#### Scenario: Consent recapture is mandatory

- GIVEN a valid member `M` and `p_general_consent = false`
- WHEN the RPC is invoked
- THEN it SHALL `RAISE EXCEPTION 'general consent is required'`
- AND no `retreat_registrations` row SHALL be created

#### Scenario: Minor without legal representative is rejected

- GIVEN `M` with `birthday` making age `< 18` and `p_legal_rep_name IS NULL`
- AND `p_general_consent = true`
- WHEN the RPC is invoked
- THEN it SHALL `RAISE EXCEPTION 'legal representative is required for minors'`
- AND no row SHALL be created

#### Scenario: Anon and server cannot execute the new RPC

- GIVEN an `anon` key or an authenticated `server` role
- WHEN that principal calls `register_retreat_preinscription_for_member`
- THEN the call SHALL fail with `permission denied` / `insufficient permissions`
- AND no retreat row SHALL be created, while `anon` `register_retreat_preinscription` remains executable as before

---

### Requirement: CaptureForm Reuse with Prefill

The system MUST reuse `src/components/forms/CaptureForm.tsx` for the member-originated flow by adding an additive prop `initialValues?: Partial<CaptureSubmitPayload>`.

Normative prop and behavior:

- `CaptureForm` MUST accept `initialValues` containing optional `name`, `phone`, `email`, `birthday`, `isMinor`, `legalRepName`, `denomination`, `communityName` (subset of `CaptureSubmitPayload`). When present, the form's `useState`/`useEffect` initialization MUST prefill `name/phone/email/birthday/legalRepName` from `initialValues`; validation (`validateGeneralConsent`, `validateMinorFields`, `checkMinorStatus`) and privacy notices MUST remain unchanged.
- `generalConsent` and `sensitiveConsent` MUST initialize to `false` even when `initialValues` is provided, forcing fresh Ley 1581 acceptance; `sensitiveConsent` gating of `denomination`/`communityName` inputs MUST be preserved.
- The form MUST stay in `variant="retreat"` for this flow: `RETREAT_PRIVACY_NOTICE_ES` visible, `RETREAT_PERSONAL_DESCRIPTION` / retreat submit labels, and `showOptionalContactCards = false` (no WhatsApp/social cards).
- A new client adapter `submitRetreatPreinscriptionForMember(memberId: string, payload: CaptureSubmitPayload): Promise<void>` in `src/lib/retreat/submit-adapter.ts` MUST call `supabase.rpc('register_retreat_preinscription_for_member', { p_member_id: memberId, p_birthday: emptyToNull(payload.birthday), p_legal_rep_name: emptyToNull(payload.legalRepName), p_general_consent: payload.generalConsent, p_sensitive_consent: payload.sensitiveConsent, p_denomination: payload.denomination, p_community_name: payload.communityName })` and re-throw errors for UI mapping. The adapter MUST NOT write Dexie or enqueue.
- `src/app/(dashboard)/members/page.tsx` detail `Dialog` MUST render a primary `<Button>Preinscribir al retiro</Button>` when all gates hold: `canManageRetreatRegistrations(role) === true` (`leader`/`super_admin`), `selectedMember.deleted_at IS NULL`, and `navigator.onLine === true` with a Supabase session. Clicking the button MUST open a second `Dialog` rendering `<CaptureForm variant="retreat" submitAdapter={(payload) => submitRetreatPreinscriptionForMember(member.id, payload)} initialValues={derivedFromMember} />`. Every field MUST remain editable before submit.
- On success the UI MUST `toast.success('Preinscripción creada')` and SHOULD show a link/action `Ver en Retiro` that navigates to `/(dashboard)/retreat-registrations`. Encrypted `members` fields `denomination_encrypted`/`community_name_encrypted` MUST NOT be decrypted to prefill sensitive inputs; sensitive fields MUST start empty unless staff re-enters them with `sensitiveConsent = true`.

#### Scenario: Leader sees prefilled editable retreat form in members dialog

- GIVEN a `leader` viewing a member detail dialog for `M` with `name/phone/email/birthday` present and online
- WHEN the leader clicks `Preinscribir al retiro`
- THEN a dialog SHALL appear containing `CaptureForm variant="retreat"` with `RETREAT_PRIVACY_NOTICE_ES`
- AND `name/phone/email/birthday` SHALL be prefilled from `M` and editable
- AND both consent checkboxes SHALL be unchecked

#### Scenario: Prefilled form delegates to member RPC via submitAdapter

- GIVEN the prefilled form is open with valid edits and `generalConsent = true`
- WHEN the leader submits
- THEN the provided `submitAdapter` SHALL invoke `submitRetreatPreinscriptionForMember(M.id, payload)`
- AND `supabase.rpc('register_retreat_preinscription_for_member')` SHALL be called
- AND on success a toast `Preinscripción creada` and optional `Ver en Retiro` navigation SHALL be shown

#### Scenario: Staff edits stale PII before submit

- GIVEN `M.phone` is outdated
- WHEN staff corrects `phone` in the prefilled form before submit
- THEN the RPC SHALL persist the edited `phone` (normalized digit-only), not the stale `members.phone`

#### Scenario: Sensitive fields are not auto-prefilled from encrypted columns

- GIVEN `M` has `denomination_encrypted`/`community_name_encrypted` (if any)
- WHEN the member-originated dialog opens
- THEN `denomination` and `communityName` inputs SHALL be empty and hidden until `sensitiveConsent` is checked
- AND only checked-state values SHALL be stored on the retreat row

---

### Requirement: Isolation Invariant

The system MUST keep the member directory and retreat domains isolated.

- `src/app/(dashboard)/members/page.tsx` MUST NOT perform a bulk `SELECT * FROM retreat_registrations` or list `retreat_payments` or payment sums during directory load. Directory load MUST remain Dexie `db.members.filter(m => m.deleted_at === null)`.
- Members MAY show an optional lightweight badge `Preinscrito` derived via a single-row lookup only when detail is open (or per-visible-row single fetch): `supabase.from('retreat_registrations').select('id').eq('member_id', member.id).eq('event_key', RETREAT_EVENT_KEY).maybeSingle()` or `IN (ids)` batch for the filtered page. A full table listing and any payment-status derivation MUST NOT appear in members.
- Canonical listing, status derivation, and installment recording MUST remain exclusively in `src/app/(dashboard)/retreat-registrations/page.tsx` (`eq('event_key', RETREAT_EVENT_KEY)` + `retreat_payments` sum).
- `public.retreat_registrations` RLS MUST remain `retreat_registrations_select: TO authenticated USING (user_role() IN ('super_admin','leader'))` and `public.retreat_payments` `SELECT/INSERT` for `leader`/`super_admin` as in `011`; no new policy SHALL widen `anon`/`server`. `public.members` RLS MUST stay as before (including `members_update` super_admin-only nature).
- The new column `member_id` MUST be readable under the existing `retreat_registrations_select` policy (no separate column policy).

#### Scenario: Members directory load remains Dexie-only

- GIVEN a `leader` opens `/(dashboard)/members`
- WHEN the directory loads
- THEN the members query SHALL be Dexie `db.members.filter(m => deleted_at===null)`
- AND no `SELECT FROM retreat_registrations` returning multiple rows SHALL occur in that load

#### Scenario: Badge uses single-row lookup only when detail is open

- GIVEN a member detail dialog is open for `M`
- WHEN the UI decides badge visibility
- THEN it MAY issue `SELECT id FROM retreat_registrations WHERE member_id=M.id AND event_key='retiro-juvenil-octubre-2026' LIMIT 1`
- AND it SHALL NOT list payments or totals

#### Scenario: Member-originated row appears in retreat module with payments

- GIVEN a row created via `register_retreat_preinscription_for_member` with `member_id = M.id`
- WHEN a `leader` opens `/(dashboard)/retreat-registrations`
- THEN that row SHALL appear in the `preinscrito` list
- AND consecutive `retreat_payments` inserts SHALL update its status through the existing `retreat_payments_guard_total` / `retreat_payments_apply_status` triggers (`preinscrito → pagos_parciales → inscrito`)

#### Scenario: Manual PostgREST reads still gated by RLS

- GIVEN `anon` or `server` key
- WHEN selecting `retreat_registrations` via PostgREST (including `member_id`)
- THEN the operation SHALL fail or return no rows under RLS, as before

---

### Requirement: Duplicate Handling

For the same `event_key = 'retiro-juvenil-octubre-2026'`, the system MUST reject a second pre-registration whose normalized `email` or digit-normalized `phone` already exists, including the `member_id` itself.

- The RPC MUST perform a friendly pre-check: `EXISTS (SELECT 1 FROM public.retreat_registrations r WHERE r.event_key = c_event_key AND (r.member_id = p_member_id OR lower(btrim(r.email)) = v_email OR regexp_replace(btrim(r.phone),'[^0-9]','g') = v_phone))` and `RAISE EXCEPTION 'already_preinscribed: a pre-registration with this member/email/phone already exists for this event'` when hit.
- The RPC MUST also `EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'already_preinscribed: duplicate email/phone for this event'` to map races on the expression unique indexes `retreat_registrations_event_email_uidx` and `retreat_registrations_event_phone_uidx` to the same handled error.
- The system MUST NOT use `ON CONFLICT DO NOTHING` / `ON CONFLICT DO UPDATE` silently.
- The system MUST NOT auto-link/update an existing `retreat_registrations` row's `member_id` when duplicate is on `email`/`phone` but different `member_id` (deferred to a follow-up).
- The client adapter and UI MUST map `already_preinscribed`/`23505` to a friendly Spanish message `Ya existe una preinscripción con ese email/teléfono para este retiro. Ver en Retiro.` and a link/button navigating to `/(dashboard)/retreat-registrations`; no second row SHALL be created on that event.

#### Scenario: Duplicate email for same event is rejected with friendly error

- GIVEN an existing `retreat_registrations` row for `event_key='retiro-juvenil-octubre-2026'` with `email = a@e.com` (normalized)
- AND a member `M2` whose `email` normalizes to `a@e.com`
- WHEN the RPC is called for `M2`
- THEN it SHALL `RAISE already_preinscribed`
- AND no second row SHALL exist for that `(event_key, email)` pair
- AND the UI SHALL show the friendly Spanish duplicate toast with `Ver en Retiro` link

#### Scenario: Duplicate phone for same event is rejected

- GIVEN an existing row with `phone` digit-normalized `3001234567`
- WHEN a member `M3` with `phone` that normalizes to `3001234567` is submitted for same event
- THEN the RPC SHALL reject with `already_preinscribed`
- AND no second row SHALL exist for that `(event_key, phone)` pair

#### Scenario: Same member submitted twice is rejected

- GIVEN a prior successful call for `M` (`member_id = M.id`)
- WHEN the same `M` is submitted again for the same event
- THEN the pre-check on `member_id = p_member_id` SHALL raise `already_preinscribed` before insert

#### Scenario: Race on unique index maps to already_preinscribed

- GIVEN two concurrent submissions for different members sharing the same normalized email for same event
- WHEN both pass pre-check and the second INSERT hits `unique_violation` on `retreat_registrations_event_email_uidx`
- THEN it SHALL be caught and re-raised as `already_preinscribed`
- AND the client SHALL show the same friendly message

---

### Requirement: Online-only and Permissions

The member→retreat pre-registration flow MUST be online-only and MUST enforce role gates at both UI and RPC layers.

- The flow MUST NOT create a Dexie object store for `retreat_registrations`, MUST NOT write `db.members`, `db.sync_queue`, or any Dexie table, and MUST NOT enqueue through the offline queue.
- The `Preinscribir al retiro` button MUST be disabled with tooltip `Requiere conexión` when `navigator.onLine === false` or `supabase.auth.getSession()` has no session; no Dexie queue retry SHALL be attempted.
- Both UI gate and RPC MUST enforce `leader` and `super_admin` allowlist via `canManageRetreatRegistrations(role)` and `user_role() IN ('leader','super_admin')` respectively. `anon` MUST fail due to `REVOKE EXECUTE` (no grant) and `server` MUST fail due to the internal `user_role()` check (even if it obtains a JWT).
- The existing anon path `register_retreat_preinscription` MUST remain callable by `anon` and `authenticated` and MUST continue to insert `member_id IS NULL` rows unaffected.

#### Scenario: Offline leaves button disabled and performs no write

- GIVEN `navigator.onLine === false`
- WHEN the member detail dialog is open
- THEN the `Preinscribir al retiro` button SHALL be disabled with tooltip `Requiere conexión`
- AND clicking SHALL NOT call the RPC and SHALL NOT add any Dexie row

#### Scenario: leader online can execute the member RPC

- GIVEN an authenticated `leader` with `navigator.onLine === true`
- WHEN the leader opens the dialog and submits with valid fresh consent
- THEN `supabase.rpc('register_retreat_preinscription_for_member')` SHALL succeed
- AND a `preinscrito` row with `member_id` SHALL be created

#### Scenario: server role is denied even when online

- GIVEN an authenticated `server` session (or service-role misused as authenticated)
- WHEN it calls `register_retreat_preinscription_for_member`
- THEN the RPC SHALL `RAISE insufficient permissions`
- AND no row SHALL be written

#### Scenario: Anon RPC still creates NULL-member rows as before

- GIVEN an unauthenticated visitor on `/retiro`
- WHEN `register_retreat_preinscription` is called with valid general consent
- THEN one `retreat_registrations` row SHALL be created with `member_id IS NULL` and `status='preinscrito'`
- AND the new RPC SHALL NOT have been involved

---

### Requirement: Event Key Invariant

The retreat event identity MUST be the single constant `RETREAT_EVENT_KEY = 'retiro-juvenil-octubre-2026'` shared by public and member-originated flows.

- Both `src/lib/retreat/constants.ts` (`RETREAT_EVENT_KEY`) and the RPC constant `c_event_key` MUST be exactly `'retiro-juvenil-octubre-2026'`.
- The RPC MUST use that constant for the inserted `event_key`, for the duplicate `EXISTS` scope, and for the pre-check predicate; callers MUST NOT supply `event_key` as a parameter.
- The existing public page `/retiro` and its adapter `submitRetreatPreinscription` MUST continue to delegate to the RPC that hardcodes the same `c_event_key`; multi-event configurability (`app_settings` event catalog, UI selector, junction table) is explicitly out of scope for this change.
- `/(dashboard)/retreat-registrations` MUST query `eq('event_key', RETREAT_EVENT_KEY)` as today.

#### Scenario: Member-originated row shares the same event key as public rows

- GIVEN a successful member RPC call and a prior public `/retiro` row
- WHEN their `event_key` values are read
- THEN both SHALL be `'retiro-juvenil-octubre-2026'`

#### Scenario: Duplicate scope is limited to that single event key

- GIVEN an existing row with `event_key='retiro-juvenil-octubre-2026'` and `email=a@e.com`
- WHEN a speculative second event `retiro-juvenil-2027-03` existed (not in this slice)
- THEN the second event duplicate rule WOULD be separate — but for this slice every check SHALL use `event_key='retiro-juvenil-octubre-2026'`

---

## Traceability

| Decision | Proposal D | Spec Requirement |
|----------|------------|------------------|
| D1 FK vs boolean | Q1 | Member Interest Link |
| D2 Duplicate reject vs link | Q2 | Duplicate Handling + Authenticated RPC (pre-check + unique_violation) |
| D3 RPC vs trigger | Q3 | Authenticated RPC Preinscription for Member |
| D4 Permissions | Q4 | Online-only and Permissions + Authenticated RPC (GRANT/REVOKE) |
| D5 UX entry point | Q5 | CaptureForm Reuse with Prefill (dialog button) |
| D6 Consent recapture | Q6 | Authenticated RPC + CaptureForm Reuse (consent starts false, stored on row) |
| D7 Isolation | Q7 | Isolation Invariant |
| D8 Online-only | Q8 | Online-only and Permissions |
| D9 Event key constant | Q9 | Event Key Invariant |
| D10 Naming non-blocking | Q10 | Member Interest Link / whole domain (`retreat-member-preinterest`) |

- Extends canonical `youth-retreat-preregistration` (public form, RPC, consent on row, anon isolation, duplicate indexes) and `youth-retreat-payments` (total cost, status machine, payment guards) — no delta to those domains; this spec is additive.
- Reuses `src/components/forms/CaptureForm.tsx` contract (`CaptureFormVariant`, `submitAdapter`, `RETREAT_PRIVACY_NOTICE_ES`, validation helpers) and `src/lib/rbac/guards.ts` `canManageRetreatRegistrations`.

## Dependencies

- `public.members` exists with `deleted_at` and `birthday`; domain read path is Dexie `db.members` but RPC reads `public.members` directly.
- `public.retreat_registrations` and `public.retreat_payments` exist via `011_youth_retreat_preregistration.sql` with expression unique indexes `(event_key, lower(btrim(email)))` and `(event_key, regexp_replace(btrim(phone),'[^0-9]',''))`, RLS policies `retreat_registrations_select` / `retreat_payments_*`, triggers `audit_retreat_registrations`, `set_updated_at`, `retreat_payments_guard_total`, `retreat_payments_apply_status`, and `app_settings.retreat.youth.total_cost`.
- Helper `public.user_role()` (`SECURITY DEFINER SET search_path=''`) reading `auth.jwt()` / `profiles` exists.
- Client constants `RETREAT_EVENT_KEY`, `RETREAT_PRIVACY_NOTICE_ES`, `SENSITIVE_DATA_NOTICE_ES`, policy version `pdtp-v1.0-2026-07-17`, and `POLICY_VERSION` from `src/lib/consent/privacy-notice.ts`.
- `canManageRetreatRegistrations = canCreate` (`leader`, `super_admin`) from `src/lib/rbac/guards.ts`.

## Open Items

- None. D1–D10 are locked in `openspec/changes/retreat-member-preinterest/proposal.md`. Follow-ups deferred beyond this slice: back-link `retreat_registrations.member_id → members` detail in `/retreat-registrations`, batched badge lookup (`IN (ids)` for filtered directory), and auto-linking duplicate `email/phone` rows instead of rejecting.
