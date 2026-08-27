# Exploration: retreat-member-preinterest

> **Artifact store:** `openspec` — file `openspec/changes/retreat-member-preinterest/explore.md` + Engram `sdd/retreat-member-preinterest/explore`
> **Change:** `retreat-member-preinterest` (tentative — naming evaluated in §8)
> **Date:** 2026-08-27
> **Mode:** strict_tdd=true, artifact_store=openspec

---

## 1. Context & Current State (verified against repo)

### 1.1 Migrations & Schema (real code)

| Source | Finding |
|--------|---------|
| `supabase/migrations/001_initial_schema.sql` | `members` columns: `id, name, name_normalized, phone, email, birthday, is_minor, legal_rep_name, has_whatsapp, consent_recorded, sensitive_consent_recorded, denomination_encrypted BYTEA, community_name_encrypted BYTEA, duplicate_flag, created_by, created_at, updated_at, deleted_at`. RLS: `SELECT` for `super_admin/leader/server` where `deleted_at IS NULL`; `INSERT` for `super_admin/leader`; `UPDATE/DELETE` for `super_admin` only (later patched by `006`/`009` but `members_update USING super_admin` still restrictive). |
| `supabase/migrations/011_youth_retreat_preregistration.sql` | `retreat_registrations` (isolated domain, **no FK to members**): `id, event_key TEXT, name, phone, email, birthday, is_minor, legal_rep_name, status CHECK (preinscrito/pagos_parciales/inscrito), general_consent_accepted_at TIMESTAMPTZ, general_consent_policy_version TEXT, sensitive_consent_accepted_at, sensitive_consent_policy_version, denomination TEXT, community_name TEXT, created_at, updated_at`. Unique indexes: `(event_key, lower(btrim(email)))` and `(event_key, regexp_replace(phone,'[^0-9]',''))`. `retreat_payments` FK only to `retreat_registrations(id)`. `event_key` constant `'retiro-juvenil-octubre-2026'`. RLS: `REVOKE ALL` from anon/PUBLIC, `SELECT` for `authenticated` leader/super_admin; no anon policies. `register_retreat_preinscription` is `SECURITY DEFINER SET search_path=''` with `EXECUTE TO anon, authenticated`. Payment triggers: `retreat_payments_guard_total()` blocks if `app_settings.retreat.youth.total_cost` missing/empty/non-numeric/<=0 or amount <=0; `retreat_payments_apply_status()` derives status from SUM(payments). |
| `supabase/migrations/012a_whatsapp_pastoreo_core.sql` + `012b…` | Adds `members.sex, whatsapp_opt_in, whatsapp_opt_out_at, age_years GENERATED`, plus `notification_log` and indexes. No retreat link. Confirms `members` is the attendance/capture source of truth; retreat is additive. |
| `supabase/tests/retreat_rls.test.sql` | Owner-run tests: anon cannot SELECT/DML retreat tables; RPC inserts `preinscrito` with consent on row, does not touch `members`/`consent_records`; duplicates by email/phone rejected; payments blocked until `total_cost` positive; `server` cannot INSERT payments. Tests never link members ↔ retreat. |

**Key invariant:** `retreat_registrations` is deliberately **decoupled** from `members`. Spec `youth-retreat-preregistration` explicitly: "MUST NOT write attendance `members`". This change wants the opposite direction (`members → retreat_registrations`) but must not leak retreat rows into the members panel.

### 1.2 Application Code (real code)

| Path | Finding |
|------|---------|
| `src/components/forms/CaptureForm.tsx` | Single form with `CaptureFormVariant = 'member' \| 'retreat'` and optional `submitAdapter?: (payload: CaptureSubmitPayload) => Promise<void>`. `member` variant: writes Dexie `db.members.add()` + `enqueue()` + `logGeneralConsent/logSensitiveConsent` + duplicate detection. `retreat` variant: hides WhatsApp/social cards, uses `RETREAT_PRIVACY_NOTICE_ES`, delegates to `submitAdapter` (no Dexie). `CaptureSubmitPayload` already common: `name, phone, email, birthday, isMinor, legalRepName, generalConsent, sensitiveConsent, denomination, communityName`. Reuse is proven (`/retiro` already reuses it). |
| `src/app/retiro/page.tsx` | Public page outside `(dashboard)`, renders `<CaptureForm variant="retreat" submitAdapter={submitRetreatPreinscription} />`. |
| `src/lib/retreat/submit-adapter.ts` | Calls `supabase.rpc('register_retreat_preinscription', { p_name, p_phone, p_email, p_birthday:null\|string, p_legal_rep_name, p_general_consent, p_sensitive_consent, p_denomination, p_community_name })`. Anon-capable. |
| `src/app/(dashboard)/capture/page.tsx` | Authenticated capture page, guard `canCreate(role)` (leader/super_admin), renders `<CaptureForm />` with no adapter → default Dexie path. |
| `src/app/(dashboard)/members/page.tsx` | Reads from **Dexie** `db.members.filter(m => deleted_at===null)`, not from Supabase directly. Tabs: Directory + Highlights. Detail dialog shows phone/email/birthday/has_whatsapp/is_minor/consent flags, plus whatsapp_numbers/social_media from Dexie. Actions: view + delete (guard `canDelete` = super_admin only via `useRole`). No retreat UI today. No `retreat_registrations` query. Realtime on `members` table. |
| `src/lib/sync/db.ts` | Dexie `AttendanceCaptureDB` v1 stores: `members, sessions, attendance, social_media, whatsapp_numbers, sync_queue`. **No `retreat_registrations` store** — retreat is online-only. `members` Dexie index: `id, name_normalized, phone, email, deleted_at, duplicate_flag`. |
| `src/app/(dashboard)/retreat-registrations/page.tsx` | Staff page, guard `canManageRetreatRegistrations(role)` (= `canCreate`, i.e. leader/super_admin). Loads `supabase.from('retreat_registrations').select('id,name,email,phone,status').eq('event_key', RETREAT_EVENT_KEY)` + `retreat_payments` sum. Handles `retreat.youth.total_cost` via `getRetreatTotalCost/setRetreatTotalCost` (super_admin only editor). Payment insert: `supabase.from('retreat_payments').insert({ registration_id, amount, recorded_by })`. No members join. Badge status: preinscrito/pagos_parciales/inscrito. |
| `src/app/(dashboard)/layout.tsx` | Sidebar nav: `Capturar` (`canCreate`), `Retiro` (`canManageRetreatRegistrations`), `Pastoreo`, `Asistencia`, `Miembros` (always), `Exportar`, `Admin`. Retreat module is already isolated from members nav. |
| `src/lib/rbac/guards.ts` + `types.ts` | `canManageRetreatRegistrations = canCreate` (leader+super_admin). `canDelete/canModify` is super_admin only — explains why members `UPDATE` RLS is super_admin. Leader cannot edit members today. |
| `openspec/specs/youth-retreat-preregistration/spec.md` + `youth-retreat-payments/spec.md` | Public form must reuse capture fields, Spanish copy, Ley 1581 on row, no members write; status machine `preinscrito→pagos_parciales→inscrito` from payment sum; total_cost in `app_settings`; leader/super_admin list + payments; server blocked. Both specs silent on members→retreat linking. |
| `openspec/changes/archive/2026-08-18-youth-retreat-preregistration/exploration.md` | Chose dedicated tables + SECURITY DEFINER RPC + variant/adapter pattern. Noted that conversion `retreat→members` was deferred as future work; now we do the inverse `members→retreat`. |

### 1.3 Implicit constraints

- `members.denomination_encrypted` is BYTEA pgp_sym_encrypt vs `retreat_registrations.denomination` is plain TEXT (only stored if `sensitiveConsent`). Copying requires decrypt or re-collect.
- `members.birthday` is DATE nullable; `retreat_registrations.birthday` same. `is_minor` derived from birthday in both paths.
- `members_update` RLS being super_admin-only means a leader cannot `UPDATE members SET interested=…` via PostgREST without a SECURITY DEFINER bypass — another reason to avoid a boolean column that leaders must write.
- Offline: members panel is Dexie-first; adding retreat state to Dexie would require a new store/version migration and sync logic. Retreat payments are not offline.

---

## 2. Requirements Inferred (to be validated in proposal)

- **Goal:** From the members directory, staff can mark an existing member as "interested in pre-inscribing" to the retreat, then track that member's installment payments exactly as if they had submitted `/retiro` (status machine + `retreat_payments`).
- **Reuse same capture fields:** The flow that creates the pre-inscription must reuse `CaptureForm` fields (name, phone, email, birthday, isMinor/legalRep, both consents, denomination/community). Not a duplicate form.
- **UI isolation:** `/(dashboard)/members` must NOT list `retreat_registrations`/payments. Only `/(dashboard)/retreat-registrations` (or retiro admin) lists them.
- **Non-goals (assumed):** No collection of money on the members panel; no change to `/retiro` public behavior; no automatic `members` creation from retreat; no change to `event_key` handling (single event `retiro-juvenil-octubre-2026` for now).

---

## 3. Alternatives Compared

### Alternative A — Boolean/link column on `members` + trigger

`ALTER TABLE members ADD COLUMN interested_in_retreat BOOLEAN DEFAULT false` (or `retreat_registration_id UUID FK`). Trigger `AFTER UPDATE WHEN NEW.interested_in_retreat = true` creates/loads `retreat_registrations`.

**Pros:** Simple to query "interested members"; one click; FK navigable both ways.
**Cons:**
- Dual source of truth: status lives in `retreat_registrations.status` but interest flag lives in `members`. Drift (flag true but registration deleted/failed unique violation).
- Requires `members` UPDATE permission for leader — current RLS blocks leader (`members_update` = super_admin only). Fixing RLS to allow leader to flip a single boolean widens UPDATE scope beyond intent.
- Trigger must handle normalization + unique violation on `(event_key,email/phone)` and consent column mapping; error surfacing via trigger is opaque to UI.
- Stores no Ley 1581 re-consent timestamp for retreat purpose; would need additional columns `retreat_consent_*` on members anyway.
- Offline Dexie: adding column requires Dexie version bump + sync mapping; still not the payments source of truth.
- Encrypted denomination column stays encrypted; trigger would need to decrypt or leave null.

**Risk:** Medium-high. Touches `members` RLS (sensitive), introduces trigger complexity, creates inconsistency window.

### Alternative B — Direct `retreat_registrations` creation linked to `members.id` (RECOMMENDED base)

`ALTER TABLE retreat_registrations ADD COLUMN member_id UUID NULL REFERENCES members(id) ON DELETE SET NULL` (nullable, not unique). Flow "mark interest" inserts a `retreat_registrations` row (with `member_id` = that member) using the same fields copied from `members` + re-collected consents via `CaptureForm` pre-filled.

No boolean on `members`. Interest is derived: `EXISTS (SELECT 1 FROM retreat_registrations WHERE member_id = members.id AND event_key = …)`.

**Pros:**
- **Single source of truth:** Payments still only join `retreat_registrations`. Reporting queries remain unchanged; members panel can left-join via view or RPC to show badge without storing state.
- **Least invasive to `members`:** No RLS change on `members`; leader's write is INSERT on `retreat_registrations` (already allowed via RLS for leader). Bypass via new `SECURITY DEFINER` RPC that does INSERT with `auth.uid()` checks.
- **Duplicate-safe:** Unique indexes on `(event_key, email/phone)` stay enforcement; RPC can check `member_id` first, then email/phone, and either link, reject, or surface "already pre-inscribed" error with handled UX.
- **Ley 1581 clean:** General/sensitive consent timestamps stored on the registration row as today already requires; re-capturing via CaptureForm pre-filled ensures valid retreat-purpose consent (not reusing old attendance consent).
- **Reuse CaptureForm:** Pre-fill `CaptureForm` with `member` data, keep `variant="retreat"` + authenticated adapter → staff sees same fields as `/retiro` but pre-completed; submit path reuses existing RPC shape (or new authenticated RPC).

**Cons:**
- Slightly more plumbing in UI (dialog/button → pre-filled form → submit) vs one checkbox.
- Need new migration: `member_id` FK + index `ON retreat_registrations(member_id) WHERE member_id IS NOT NULL` + backfill handling (existing rows stay NULL).
- Need new authenticated RPC (e.g., `register_retreat_preinscription_for_member`) that copies from members, validates age/consent, and handles unique violation gracefully.

**Cost:** One small migration + one RPC + one UI dialog. No Dexie schema change required if retreat stays online-only.

### Alternative C — Materialized view / view that unions `members` + `retreat_registrations`

`CREATE VIEW members_with_retreat_interest AS SELECT m.*, rr.id AS retreat_registration_id, rr.status … FROM members LEFT JOIN retreat_registrations ON lower(btrim(m.email))=lower(btrim(rr.email)) OR phone match`.

**Pros:** No schema write; computed interest; no RLS mutation.
**Cons:** Join on normalized email/phone is expensive and fragile (no FK, no index on view predicate); cannot distinguish same-person-different-email case; view cannot be the target for payment inserts; `security_invoker` needed to avoid RLS bypass (PG15). Adds query complexity without solving creation.
**Verdict:** Useful as **read helper** alongside B (e.g., `v_member_retreat_interest`), but not as primary write mechanism.

### Alternative D — Junction table `member_retreat_interests`

`CREATE TABLE member_retreat_interests (member_id FK, event_key, status, created_at, ...)` or `member_retreat_interest` with `retreat_registration_id FK`.

**Pros:** Decouples interest from registration; could model "interested but not yet pre-inscribed" state; supports many-to-many if multi-event future.
**Cons:** Over-engineering for single-event current need; introduces another state machine (interest → preinscrito → …) that duplicates `retreat_registrations.status`; requires syncing `member_retreat_interests` → `retreat_registrations` anyway to enable payments; more RLS/policies and UI to maintain.
**Verdict:** Defer unless multi-event becomes real requirement. YAGNI now.

### Comparison Matrix

| Criterion | A (bool on members) | **B (FK on retreat)** | C (view) | D (junction) |
|-----------|---------------------|-----------------------|----------|--------------|
| Source of truth for payments | Retreat (exposed to drift) | **Retreat only** — clean | Retreat | Split |
| RLS impact | Reopen `members_update` to leader (high risk) | **No members RLS change**; INSERT on retreat (leader already allowed) | None | New table RLS |
| Duplicate enforcement | Trigger must handle unique error | **Unique indexes + RPC handles** | View cannot enforce | Requires extra constraints |
| Ley 1581 (retreat consent on row) | Needs extra columns on members | **Already on retreat row** | Read-only | Needs columns on junction |
| Offline Dexie impact | Version bump + sync column | **None if online-only** (optional flag via view) | None | Version bump |
| CaptureForm reuse | Checkbox bypasses form (violates "reuse same fields") | **Pre-filled CaptureForm retreat variant** — satisfies requirement | View is read-only | Could use CaptureForm but extra step |
| Complexity | Trigger + RLS + dual state | **Migration + RPC + UI dialog** (small) | View only, creation unsolved | New table + sync logic |
| Future multi-event | Weak | Add `event_key` already on retreat; if needed, extend with junction later | Weak | Best for multi-event |
| Recommendation | **No** | **Yes** | Helper only | **Defer** |

**Decision for proposal:** Proceed with **B** (nullable `member_id` on `retreat_registrations` + authenticated RPC + pre-filled CaptureForm), optionally with a read view `v_member_retreat_interest` if proposal wants a cheap "is interested?" badge without polling retreat table from Dexie.

---

## 4. Recommended Approach (for proposal to lock)

1. **Schema:** `ALTER TABLE retreat_registrations ADD COLUMN member_id UUID REFERENCES members(id) ON DELETE SET NULL; CREATE INDEX retreat_registrations_member_id_idx ON retreat_registrations(member_id) WHERE member_id IS NOT NULL;` Existing rows stay `NULL`. If `user_role()` checks needed, keep `member_id` nullable so anon RPC can insert `NULL`.
2. **RPC (authenticated):** `register_retreat_preinscription_for_member(p_member_id uuid, p_birthday date, p_legal_rep_name text, p_general_consent bool, p_sensitive_consent bool, p_denomination text, p_community_name text)` — `SECURITY DEFINER SET search_path=''`, checks `auth.uid()` role leader/super_admin, loads `members` row, derives `v_name/v_phone/v_email` from members (btrim/lower/digit-only), computes `is_minor`, validates `p_general_consent` + legal rep if minor, applies same sensitive-consent logic as existing RPC, checks `EXISTS (SELECT 1 FROM retreat_registrations WHERE (member_id = p_member_id OR lower(btrim(email))=v_email OR regexp_replace(phone...)=v_phone) AND event_key = 'retiro-juvenil-octubre-2026')` → if match on `member_id` or unique constraint, raise handled exception `already_preinscribed`, otherwise INSERT with `member_id` and return id.
   - Empty alternative simpler: reuse `register_retreat_preinscription` but allow authenticated caller to pass `member_id` as extra param via a wrapper `register_retreat_preinscription_from_member`. Either is fine; propose one signature and keep anon RPC untouched (no regression).
3. **UI:**
   - In `members/page.tsx` detail `Dialog` (or new member row action), add `<Button>Preinscribir al retiro</Button>` visible only if `canManageRetreatRegistrations(role)` and member `deleted_at IS NULL`. On click, open a `Dialog` that renders `<CaptureForm variant="retreat" submitAdapter={submitMemberRetreatAdapter} initialValues={member} />` pre-filled (requires `CaptureForm` to accept `initialValues` prop — small additive change) or a thin wrapper form that reuses the same validation (`validateGeneralConsent`, `validateMinorFields`) and privacy notice.
   - On success, show `toast.success('Preinscripción creada')`, refresh retreat cache if present, and optionally show link "Ver en Retiro".
   - `members/page.tsx` can show a non-authoritative badge "Preinscrito" via `supabase.from('retreat_registrations').select('member_id').eq('member_id', member.id)` or via view; but **no full retreat table** in members panel (title-only badge satisfies isolation).
4. **No members panel listing of retreat registrations/payments:** Keep `retreat-registrations/page.tsx` as canonical list. Add optional back-link `member_id` → member detail from retreat row (future).
5. **RLS:** No `members` policy change. New RPC is `SECURITY DEFINER` and checks `user_role()` in body; `retreat_registrations` already has `SELECT` for authenticated leader/super_admin. `member_id` column is readable under that same policy.
6. **Offline/Dexie:** No store for `retreat_registrations`. The "mark interest" flow is online-only (requires Supabase). If offline, disable button with tooltip. Do not add retreat to `sync_queue`.
7. **Deduplication:** Same email/phone unique indexes remain source of truth. RPC pre-check gives friendly error; `ON CONFLICT` not used (indexes are expression-based, not simple unique constraint). On unique_violation, map to UI toast "Ya existe una preinscripción con ese email/teléfono para este retiro".

---

## 5. Integration Mapping

| Concern | Where it lives | How |
|---------|---------------|-----|
| **Flag / interest** | Nowhere on `members`; derived via `retreat_registrations.member_id = members.id` (or via matching email/phone for legacy rows where `member_id IS NULL`). If a cheap badge is needed, `CREATE VIEW v_member_retreat_link AS SELECT m.id AS member_id, rr.id AS registration_id, rr.status FROM members m JOIN retreat_registrations rr ON rr.member_id = m.id` (add `security_invoker = true` on PG15). | No dual state. Query from Supabase, not Dexie. |
| **Create preinscription from member** | New authenticated RPC `register_retreat_preinscription_for_member` (or wrapper). Called from `src/lib/retreat/submit-adapter.ts` new function `submitRetreatPreinscriptionForMember(memberId, payload)`. | Copies normalized fields from `members`, stores consent on registration row, returns uuid. |
| **Reuse same capture fields** | `CaptureForm` with new optional `initialValues?: Partial<CaptureSubmitPayload>` + existing `variant="retreat"` + `submitAdapter`. | Member data pre-fills name/phone/email/birthday/isMinor/legalRep; sensitive fields not pre-filled (decrypt avoidance) but checkbox+inputs remain. Validation unchanged. |
| **Isolation** | `members/page.tsx` stays Dexie-first + optional Supabase badge fetch (single member_id lookup). `retreat-registrations/page.tsx` stays Supabase-first. No `SELECT * FROM retreat_registrations` in members directory load. | Members panel never lists child retreat payments; retreat panel never lists full members directory. |
| **Permissions** | Gate button with `canManageRetreatRegistrations(role)` (leader/super_admin). `server` sees no button. RPC internals `IF user_role() NOT IN ('leader','super_admin') THEN RAISE`. | Leader can create retreat rows without gaining `members UPDATE`. |
| **Encrypted fields** | Do not auto-copy `denomination_encrypted` → `denomination`. Staff re-captures via CaptureForm sensitive section if `sensitiveConsent` checked. | Avoids key management in trigger/RPC. |
| **Event key** | Constant `RETREAT_EVENT_KEY = 'retiro-juvenil-octubre-2026'` from `src/lib/retreat/constants.ts` reused as `c_event_key` in RPC. | Multi-event = future junction change, not now. |

---

## 6. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Duplicate email/phone (unique index) — member shares email with existing retreat row | User sees cryptic `23505` | RPC pre-check + `EXCEPTION WHEN unique_violation` → raise `already_preinscribed: email/phone exists` + UI toast mapping; propose "Link" action later. |
| `members_update` RLS currently super_admin-only — temptation to widen for boolean flag | Accidental broader edit rights for leader | **Avoid boolean flag entirely** (choose B). No RLS change. |
| Leader's `members` row may be stale (phone/email changed since capture) | Retreat row copies stale PII | Pre-filled CaptureForm allows staff to edit before submit; RPC re-validates required fields. |
| Ley 1581: reusing old attendance consent for retreat purpose | Invalid purpose | Require fresh `generalConsent` checkbox in the pre-filled retreat CaptureForm; store `general_consent_accepted_at/policy_version` on retreat row anew (not copy `consent_records`). |
| Offline path — members panel is Dexie-first; staff offline clicks "Preinscribir" | Failure | Disable button when `navigator.onLine === false` or `supabase` unreachable; online-only flow is explicit in spec. |
| `member_id` orphan if member soft-deleted | Dangling FK | `ON DELETE SET NULL` + `deleted_at` check; retreat row persists (audit). Optionally add `CHECK (member_id IS NULL OR EXISTS (SELECT 1 FROM members WHERE id=member_id AND deleted_at IS NULL))` via trigger if needed. |
| Exposure of `denomination_encrypted` | Plaintext leak | Do not decrypt; leave null unless staff re-consents in retreat form. |
| Existing anon RPC compatibility | Regression | Keep `register_retreat_preinscription` untouched; new RPC is additive with `RETREAT_EVENT_KEY` constant shared. |

---

## 7. Open Questions for Proposal (with defaults)

1. **Is non-null `member_id` required for new interest flow, or optional?** Default: **NULLABLE, filled for member-originated rows, NULL for public `/retiro` rows.** Allows both channels without backfill.
2. **Should duplicate email/phone for same event LINK to existing `retreat_registrations` (by updating its `member_id`) instead of rejecting?** Default: **Reject with friendly message in V1; linking is a follow-up.** Linking would need `UPDATE retreat_registrations SET member_id = …` plus RLS for update (none exists today).
3. **Does the sensitive-religious data (denomination/community) require pre-fill from `members`?** Default: **No pre-fill; staff re-enters if sensitive consent checked.** Avoids decryption and aligns with "same fields, not same values".
4. **Who exactly can mark interest?** Default: **`leader` + `super_admin`** via `canManageRetreatRegistrations`. `server` cannot. Mirrors retreat payment permissions.
5. **UI entry point: primary button in member detail dialog vs inline row action vs both?** Default: **Button in `Dialog` (member detail) + optional row action icon with tooltip "Preinscribir al retiro".** Avoids cluttering directory table.
6. **Should `members` panel show any retreat status (e.g., badge "Preinscrito")?** Default: **Yes, a lightweight badge derived via single `member_id` lookup (not a full table) — acceptable under "do not list preinscriptions". Full table stays in `/retreat-registrations`.** If strict isolation, badge is opt-in.
7. **Needs a new RPC `register_retreat_preinscription_for_member` or can we reuse existing RPC with an extra `p_member_id` param?** Default: **New authenticated RPC** to keep anon RPC surface minimal and role checks explicit; allow reuse discussion in design.
8. **Multi-event future: should `member_retreat_interests` junction be introduced now?** Default: **No — YAGNI; single `member_id` FK + `event_key` covers `retiro-juvenil-octubre-2026`. Junction is a later migration if multi-event is real.**
9. **Offline support for marking interest?** Default: **No — online-only.** Members panel stays Dexie for directory but interest flow requires Supabase. Document as known limitation.
10. **Naming: `retreat-member-preinterest` vs clearer `retreat-member-interest`?** Default: **Keep `retreat-member-preinterest` as requested, but note proposal may adopt `retreat-member-interest-flag` or `retreat-registration-from-member` if clearer.** Do not move directory without notice.

---

## 8. Naming Recommendation

- **Requested:** `retreat-member-preinterest` — acceptable, keeps `retreat-` prefix, clearly distinct from `youth-retreat-preregistration` and `youth-retreat-payments`.
- **Alternatives considered:** `retreat-member-interest-flag` (implies boolean, misleading), `members-retreat-link` (swaps prefix), `retreat-registration-from-member` (more accurate but longer).
- **Recommendation:** Keep `retreat-member-preinterest`. If proposal wants shorter, `retreat-member-interest` is semantic equivalent and prefix-intact. No directory change now; proposal will record final name choice.

---

## 9. Next Steps (proposal inputs)

- Lock Q1–Q10 defaults above in proposal.
- Draft spec deltas:
  - `youth-retreat-preregistration` add-on: "staff may create pre-registration from existing member via authenticated RPC, reusing CaptureForm retreat variant".
  - `retreat-member-preinterest` (new spec or addendum): member→retreat creation, no members-list leak, leader/super_admin permission, duplicate handling, online-only.
- Design: migration `013_retreat_member_link.sql`, RPC signature, `CaptureForm` `initialValues` prop, members dialog button, badge strategy, RLS/role checks, tests.
- Tasks: PR1 schema+RPC+RLS tests, PR2 CaptureForm pre-fill + members UI, PR3 view/badge polish (if adopted). Deliver `stacked-to-main` .
- Verify: extend `retreat_rls.test.sql` with member-linked cases; Vitest for `CaptureForm` `initialValues` + adapter; Playwright for leader flow `members → dialog → retreat form → retreat-registrations row + payment`.

---

## 10. Sources Checked (evidence)

- `supabase/migrations/001_initial_schema.sql` — members DDL + initial RLS.
- `supabase/migrations/011_youth_retreat_preregistration.sql` — full retreat DDL + RPC + triggers + indexes.
- `supabase/migrations/012a_whatsapp_pastoreo_core.sql`, `012b_…indexes.sql` — incremental members columns.
- `supabase/tests/retreat_rls.test.sql` — owner-run RLS/RPC/payment tests (38 PASS notices).
- `src/components/forms/CaptureForm.tsx` — variant + submitAdapter pattern.
- `src/lib/retreat/submit-adapter.ts` + `constants.ts` — RPC call shape, RETREAT_EVENT_KEY.
- `src/app/retiro/page.tsx` — public variant reuse.
- `src/app/(dashboard)/capture/page.tsx` — authenticated default path.
- `src/app/(dashboard)/members/page.tsx` — Dexie-first members panel, dialog, highlights.
- `src/app/(dashboard)/retreat-registrations/page.tsx` — staff payments/status page.
- `src/app/(dashboard)/layout.tsx` — nav isolation.
- `src/lib/rbac/guards.ts`, `types.ts` — role mapping.
- `src/lib/sync/db.ts` — Dexie stores (no retreat).
- `openspec/specs/youth-retreat-preregistration/spec.md`, `youth-retreat-payments/spec.md` — normative retreat specs.
- `openspec/changes/archive/2026-08-18-youth-retreat-preregistration/exploration.md` — prior decision rationale.

---

## 11. Skill Resolution

- `skill_resolution: paths-injected` — `gentle-ai`, `supabase`, `supabase-postgres-best-practices` injected.

