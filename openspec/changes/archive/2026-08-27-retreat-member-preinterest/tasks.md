# Tasks — retreat-member-preinterest

> **Change:** `retreat-member-preinterest` · **Branch:** `feat/retreat-member-link` → `main` (1 PR) · **Date:** 2026-08-27
> **Upstream:** `explore.md` · `proposal.md` (D1–D10 locked) · `specs/retreat-member-preinterest/spec.md` (7 requirements) · `design.md` (AD-001..007)
> **Stack:** Next.js 15.5 / React 19 / TS 5.8 strict / Supabase PG15 / Dexie 4.0 / Vitest jsdom / Playwright chromium+firefox
> **Mode:** `strict_tdd=true` · `artifact_store=both` · `language: artifact EN, summaries rioplatense`

---

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 310–360 (additions + deletions, incl. tests + SQL comments) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR `feat/retreat-member-link` → `main` (scope is one additive migration + 3 file mods + 3 new test files + 1 e2e). No `feature-branch-chain` needed. |
| Delivery strategy | ask-on-risk (default) — ask only if estimate exceeds 400 during apply; current forecast stays single-PR |
| Chain strategy | stacked-to-main |

```text
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low
```

**Sizing signal:** 1 new migration file (~90 SQL + comments), 1 SQL test extension (~90 lines), `CaptureForm.tsx` +25, `submit-adapter.ts` +35, `members/page.tsx` +90–110, optional `useRetreatBadge.ts` +35, Vitest 2 files ~110, Playwright ~110. No Dexie version bump, no RLS rewrite, no realtime publication, no `members` DDL — additive only, so tooling overhead is minimal and review is one focus lens (RLS + `SECURITY DEFINER` + duplicate safety).

---

## Overview & Sequencing

### What ships

Additive member→retreat pre-registration flow without touching `public.members` or Dexie: nullable FK `retreat_registrations.member_id UUID REFERENCES members(id) ON DELETE SET NULL` + partial index `WHERE member_id IS NOT NULL`, authenticated RPC `register_retreat_preinscription_for_member` (`SECURITY DEFINER SET search_path=''`, `GRANT TO authenticated`, `user_role()` gate), `CaptureForm` `initialValues` prefill (editable, fresh consent), `submitRetreatPreinscriptionForMember` adapter, `members/page.tsx` dialog button + second dialog + `Preinscrito` badge, and extended `retreat_rls.test.sql` + Vitest + Playwright coverage.

### Execution order (strict TDD — RED must precede GREEN)

| Phase | Label | Scope | Gate to next |
|-------|-------|-------|--------------|
| **0** | **RED** | Write failing tests only: SQL/RLS harness extension, Vitest `CaptureForm.initialValues` + `submit-adapter.member`, Playwright skeleton — all RED because production code does not yet exist | All RED tests fail for the right reason (missing column / missing function / missing prop / RPC `permission denied`) |
| **1** | **013 DDL** | `supabase/migrations/013_retreat_member_link.sql` — additive column + partial index + `COMMENT` + `NOTIFY pgrst` | `supabase db reset` replays 001→013 clean; `psql \d retreat_registrations` shows `member_id UUID NULL` + FK `ON DELETE SET NULL` |
| **2** | **RPC** | `register_retreat_preinscription_for_member` body (AD-002) + `REVOKE ALL FROM PUBLIC` / `GRANT TO authenticated` + `COMMENT` + `NOTIFY` within same transactional file | `retreat_rls.test.sql` member-linked blocks turn GREEN (leader success, duplicate/consent/minor/anon/server/sensitive) |
| **3** | **CaptureForm reuse** | `src/components/forms/CaptureForm.tsx` additive `initialValues` + `src/lib/retreat/submit-adapter.ts` additive `submitRetreatPreinscriptionForMember` | Vitest `CaptureForm.initialValues` + `submit-adapter.member` turn GREEN |
| **4** | **Members UI** | `src/app/(dashboard)/members/page.tsx` button + second dialog + badge + gating/toast mapping (+ optional `src/hooks/useRetreatBadge.ts`) | Playwright happy-path + duplicate + isolation + offline turn GREEN; `members` directory load stays Dexie-only |
| **5** | **Verification** | `tsc --noEmit` · `next lint` · `vitest` · `supabase db reset` replay · Playwright full run · manual isolation/RLS spot-check | All gates pass; no regression on anon `register_retreat_preinscription` (`member_id IS NULL` path) |

### Sequencing invariants (MUST hold — design AD-001..007)

- **Additive only:** `ALTER TABLE ... ADD COLUMN IF NOT EXISTS member_id UUID NULL REFERENCES members(id) ON DELETE SET NULL` — no backfill, no `NOT NULL`, no `UNIQUE(member_id)`, no `DEFAULT`, no `UPDATE retreat_registrations SET …`. No `ALTER TABLE public.members` at all.
- **No `CONCURRENTLY`:** `CREATE INDEX IF NOT EXISTS retreat_registrations_member_id_idx ON retreat_registrations(member_id) WHERE member_id IS NOT NULL` is plain (not `CONCURRENTLY`) inside the single-transaction migration — `CONCURRENTLY` cannot run transactionally and is unnecessary at current table size (see AD-001).
- **Idempotent DDL:** every DDL is `IF NOT EXISTS` / `CREATE OR REPLACE` / conditional `DO $$` FK guard so `supabase db reset` can be rerun safely.
- **`search_path=''` + qualified refs:** RPC is `LANGUAGE plpgsql SECURITY DEFINER SET search_path=''` with every table/function qualified as `public.*` (no search_path hijack).
- **`REVOKE`/`GRANT` scope:** `REVOKE ALL ON FUNCTION ... FROM PUBLIC; GRANT EXECUTE ... TO authenticated` only — no `anon`, no `service_role` via this grant (`server` is denied inside body via `user_role()` check → `42501`).
- **`SECURITY DEFINER` is intentional:** `retreat_registrations` has no `INSERT` policy; the function is the only write path (same pattern as anon `011` RPC). RLS bypass is gated by `user_role() IN ('leader','super_admin')` as first statement. `REVOKE` ensures `anon` never reaches the body.
- **RLS/Dexie/Realtime untouched:** `public.members` policies (`members_select/update/delete`), `retreat_registrations_select` / `retreat_payments_*` policies, `public.app_settings` `retreat.youth.total_cost` triggers, `src/lib/sync/db.ts` `AttendanceCaptureDB` stores/version, and `supabase_realtime` publication are NOT mutated.
- **`NOTIFY pgrst, 'reload schema'`** at end of `013` so PostgREST exposes `member_id` without restart.
- **`CaptureForm` invariants:** `initialValues?: Partial<CaptureSubmitPayload>` additive only, prefill via `useEffect` for `name/phone/email/birthday/legalRepName` only, `generalConsent` + `sensitiveConsent` forced `false` (fresh Ley 1581), `denomination`/`communityName` remain empty until `sensitiveConsent===true`, never decrypt `members.denomination_encrypted`. `variant="retreat"` locks `RETREAT_PRIVACY_NOTICE_ES` + `showOptionalContactCards=false` + same validators (`validateGeneralConsent`/`validateMinorFields`/`checkMinorStatus`).
- **Adapter invariants:** `submitRetreatPreinscriptionForMember(memberId, payload)` calls `supabase.rpc('register_retreat_preinscription_for_member', { p_member_id, p_birthday: emptyToNull(payload.birthday), p_legal_rep_name, p_general_consent, p_sensitive_consent, p_denomination, p_community_name })`, re-throws, does NOT write Dexie/queue.
- **Isolation invariants:** `members/page.tsx` directory load stays `db.members.filter(m => m.deleted_at===null).toArray()` — never `supabase.from('retreat_registrations')` bulk, never `retreat_payments` sum in members. Badge is at most `select('id').eq('member_id', id).eq('event_key', RETREAT_EVENT_KEY).maybeSingle()` or batched `IN (ids)` for visible page; non-blocking, online-only.
- **Duplicate contract:** RPC does `EXISTS` pre-check on `(member_id = p_member_id OR lower(btrim(email)) = v_email OR regexp_replace(phone,'[^0-9]','g') = v_phone) WHERE event_key = c_event_key` → `RAISE already_preinscribed USING ERRCODE 23505`; plus `EXCEPTION WHEN unique_violation THEN RAISE already_preinscribed USING ERRCODE 23505` (race on `retreat_registrations_event_email_uidx`/`_phone_uidx`). No `ON CONFLICT DO NOTHING/UPDATE`, no silent auto-link.
- **Event key constant:** `c_event_key = 'retiro-juvenil-octubre-2026'` (RPC) and `RETREAT_EVENT_KEY` (`src/lib/retreat/constants.ts`) must match exactly; not a parameter.
- **Unchanged file budget:** `src/lib/retreat/constants.ts`, `src/lib/rbac/guards.ts`, `src/app/(dashboard)/retreat-registrations/page.tsx` (canonical list + payments), `src/app/retiro/page.tsx` (anon flow) remain as-is in V1.

### Failure policy

If any phase's gate fails after a bounded fix attempt, stop and surface the failing artifact/log without advancing. Rollback is `DROP FUNCTION / DROP INDEX / DROP COLUMN` + revert deploy as documented in Design §9.2 — but GREEN phases are additive so a revert deploy alone hides the feature without needing a DB drop (see Change Boundaries).

---

## Change Boundaries

| Property | Value |
|----------|-------|
| **PR** | `feat/retreat-member-link` → `main` — **1 PR only** (no chain) |
| **Approx. changed lines** | ~330 net (SQL ~120 + TS/TSX ~150 + tests ~140 minus comments): well under 400 |
| **Files touched** | 1 created migration + 3 modified sources + 1 optional hook created + 3 created/1 extended test file (see § File Changes below) |
| **Verification** | `npx tsc --noEmit` · `npx next lint` · `npx vitest` (jsdom) · `supabase db reset` + `psql -f supabase/tests/retreat_rls.test.sql` (`BEGIN … ROLLBACK` harness, expect all `PASS` incl. new member blocks) · `npx playwright test` (`e2e/retreat-member-preinterest.spec.ts`) · manual isolation spot-check (members directory emits no bulk `rest/v1/retreat_registrations?select=*`) |
| **Rollback** | Code revert (hide button/dialog — instant, no DB touch) is sufficient. Soft DB rollback: `DROP FUNCTION register_retreat_preinscription_for_member` + `REVOKE`. Hard DB rollback: also `DROP INDEX retreat_registrations_member_id_idx` + `ALTER TABLE retreat_registrations DROP COLUMN member_id` + `NOTIFY pgrst, 'reload schema'`. Existing rows with `member_id` remain valid retreat rows (or defer drop until manually cleared). Anon `register_retreat_preinscription` (`member_id IS NULL`) unaffected either way. |

**File inventory (normative — do not invent extra paths):**

- `supabase/migrations/013_retreat_member_link.sql` — CREATE (additive)
- `supabase/tests/retreat_rls.test.sql` — MODIFY (extend, owner harness)
- `src/components/forms/CaptureForm.tsx` — MODIFY (`initialValues` additive)
- `src/lib/retreat/submit-adapter.ts` — MODIFY (add `submitRetreatPreinscriptionForMember`)
- `src/app/(dashboard)/members/page.tsx` — MODIFY (dialog button + second dialog + badge)
- `src/hooks/useRetreatBadge.ts` — CREATE (optional) or inline helper
- `src/components/forms/__tests__/CaptureForm.initialValues.test.tsx` — CREATE
- `src/lib/retreat/__tests__/submit-adapter.member.test.ts` — CREATE
- `e2e/retreat-member-preinterest.spec.ts` (canonical per `playwright.config.ts` `testDir: ./e2e`; alt `tests/e2e/…` accepted) — CREATE

Unchanged: `src/lib/retreat/constants.ts` (`RETREAT_EVENT_KEY`), `src/lib/rbac/guards.ts` (`canManageRetreatRegistrations`), `src/lib/sync/db.ts` (no version bump), `src/app/(dashboard)/retreat-registrations/page.tsx`, `src/app/retiro/page.tsx`, `supabase/migrations/011_youth_retreat_preregistration.sql` (frozen source of truth).

---

## Tasks — Phase 0 RED (failing tests first, strict TDD)

> RED rule: each task MUST be committed/demonstrated failing for the intended reason (missing column / missing function / missing prop / `permission denied`) before its GREEN counterpart lands. Vitest files use `src/**/__tests__/**/*.test.{ts,tsx}` include; run via `npx vitest --run`. SQL tests are the owner `BEGIN … ROLLBACK` harness in `supabase/tests/retreat_rls.test.sql` executed via `psql`.

- [x] **T-001 RED — SQL/RLS harness: member-linked RPC cases (failing because 013 + RPC do not exist)** <!-- sdd-owner: implementation -->
  - **Description:** Extend `supabase/tests/retreat_rls.test.sql` with a new `DO $$ … END $$;` block (or additive section before the final `ROLLBACK`) covering, per Design §7.2, at least: (a) leader `register_retreat_preinscription_for_member` success with `member_id` + `RETREAT_EVENT_KEY` + consent stamps, (b) `p_general_consent=false` → `missing_consent`, (c) minor without `p_legal_rep_name` → `legal representative is required` then with rep → success, (d) duplicate `member_id` / normalized `email` / digit-only `phone` → `already_preinscribed 23505` with `count(*)` unchanged, (e) `deleted_at IS NOT NULL` → `member not found or deleted`, (f) `sensitive gating` false→`NULL` / true→persisted, (g) `anon` cannot `EXECUTE` new RPC (`permission denied for function`, no `GRANT`), (h) `server` role (`app_metadata.role='server'` JWT) → `42501 not_authorized`, (i) payments after member-linked `preinscrito` still drive `pagos_parciales → inscrito`. Keep existing 38 `PASS` cases green; new cases must `RAISE NOTICE 'FAIL: …'` or hit `undefined_function` / `undefined_column` before GREEN.
  - **Acceptance (RED):** Running `psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/retreat_rls.test.sql` fails on the new block because `relation "retreat_registrations" column member_id does not exist` **or** `function register_retreat_preinscription_for_member(uuid, ...) does not exist` **or** `permission denied` handling is absent, while the pre-existing `PASS:` lines still emit. Commit the failing test before T-005/T-006.
  - **Concrete targets:** `supabase/tests/retreat_rls.test.sql` (modify, additive block); depends on `supabase/migrations/011_youth_retreat_preregistration.sql` (read for indexes/RLS patterns) + `design.md` §7.2 table.
  - **Dependencies:** none (first RED).
  - **Estimate:** M (3–4 h, many cases but harness already exists).
  - **Trace:** Spec `Authenticated RPC` + `Duplicate Handling` + `Isolation Invariant` + `Online-only and Permissions` + `Member Interest Link` → Design AD-002 + AD-006 + §7.2.

- [x] **T-002 RED — Vitest: `CaptureForm` `initialValues` prefill is missing** <!-- sdd-owner: implementation -->
  - **Description:** Create `src/components/forms/__tests__/CaptureForm.initialValues.test.tsx` (jsdom, Vitest). Cases per Design §7.1: render `<CaptureForm variant="retreat" initialValues={{ name:'Ana', phone:'3001234567', email:'ana@example.com', birthday:'2000-05-10', legalRepName:'' }} submitAdapter={mock} />` → inputs have those values and remain editable (`fireEvent.change` updates); `generalConsent` checkbox is `not.checked` even when `initialValues` contains `generalConsent:true` (forced recapture); `sensitiveConsent` forced `false`; toggling `sensitiveConsent` shows `denomination/communityName` inputs (otherwise hidden); `RETREAT_PRIVACY_NOTICE_ES` visible; WhatsApp/social cards hidden (`showOptionalContactCards=false`). Also: no `initialValues` → form mounts empty (existing behavior).
  - **Acceptance (RED):** `npx vitest --run src/components/forms/__tests__/CaptureForm.initialValues.test.tsx` fails because `CaptureForm` has no `initialValues` prop / `CaptureFormInitialValues` type / `useEffect` hydration — TS error `Property 'initialValues' does not exist` or rendered inputs are empty when they should be prefilled. Do not implement `CaptureForm.tsx` yet.
  - **Concrete targets:** `src/components/forms/__tests__/CaptureForm.initialValues.test.tsx` (create, discovery: `src/components/forms/CaptureForm.tsx` current props/state).
  - **Dependencies:** none (parallelizable with T-001/T-003).
  - **Estimate:** S (1–2 h).
  - **Trace:** Spec `CaptureForm Reuse with Prefill` → Design AD-003.

- [x] **T-003 RED — Vitest: `submitRetreatPreinscriptionForMember` adapter is missing** <!-- sdd-owner: implementation -->
  - **Description:** Create `src/lib/retreat/__tests__/submit-adapter.member.test.ts` mocking `src/lib/supabase/client` `createClient().rpc`. Cases: (a) success calls `supabase.rpc('register_retreat_preinscription_for_member', { p_member_id, p_birthday: emptyToNull(...), p_legal_rep_name: emptyToNull(...), p_general_consent, p_sensitive_consent, p_denomination, p_community_name })` once with correct mapping; `''`/`'  '` for `birthday` → `null`, valid date → same string; (b) when `rpc` returns `{ error: { message:'already_preinscribed: …', code:'23505' } }` the promise rejects with that error (not swallowed) so UI can map to Spanish toast. Assert `emptyToNull` behavior.
  - **Acceptance (RED):** `npx vitest --run src/lib/retreat/__tests__/submit-adapter.member.test.ts` fails with `Cannot find module '@/lib/retreat/submit-adapter'` export `submitRetreatPreinscriptionForMember` or `emptyToNull is not a function`. No modification to `src/lib/retreat/submit-adapter.ts` yet.
  - **Concrete targets:** `src/lib/retreat/__tests__/submit-adapter.member.test.ts` (create); discovery `src/lib/retreat/submit-adapter.ts`, `src/lib/retreat/constants.ts`, `src/components/forms/CaptureForm.tsx` (`CaptureSubmitPayload`).
  - **Dependencies:** none.
  - **Estimate:** S (1–2 h).
  - **Trace:** Spec `CaptureForm Reuse with Prefill` + `Duplicate Handling` → Design AD-003 + AD-004 error mapping + §6.2 RPC contract.

- [x] **T-004 RED — Playwright: member→retreat E2E skeleton is missing** <!-- sdd-owner: implementation -->
  - **Description:** Create `e2e/retreat-member-preinterest.spec.ts` (canonical per `playwright.config.ts` `testDir: ./e2e`) with at least 5 `test.skip`-to-be scenarios stubbed as failing `expect` blocks (or placeholder selectors that do not yet exist): (1) leader `members → detail Dialog → prefilled retreat form editable → submit → toast 'Preinscripción creada' + badge → retreat list shows `preinscrito` → payments `pagos_parciales → inscrito`; (2) isolation: intercept `**/rest/v1/retreat_registrations*` during `/(dashboard)/members` load → no bulk `select=*` before detail click; (3) duplicate friendly error toast `Ya existe una preinscripción…` + `Ver en Retiro` link; (4) offline `context.setOffline(true)` → button `Preinscribir al retiro` `disabled` + `title="Requiere conexión"` and no `rpc` request; (5) `server` role cannot see button and `page.evaluate(() => supabase.rpc(...))` fails `not_authorized`. Leave them as **failing** (no implementation wired yet).
  - **Acceptance (RED):** `npx playwright test e2e/retreat-member-preinterest.spec.ts --project=chromium` fails because `Preinscribir al retiro` button / `CaptureForm` dialog / badge `Preinscrito` selectors are not found (or tests intentionally `expect(button).toBeVisible()` on non-existent element). No change to `src/app/(dashboard)/members/page.tsx` yet.
  - **Concrete targets:** `e2e/retreat-member-preinterest.spec.ts` (create); discovery `src/app/(dashboard)/members/page.tsx`, `src/lib/rbac/guards.ts`, `src/app/(dashboard)/retreat-registrations/page.tsx`.
  - **Dependencies:** none (RED).
  - **Estimate:** M (2–3 h, wiring intercepts + role seed helpers).
  - **Trace:** Spec `Isolation Invariant` + `Online-only and Permissions` + `CaptureForm Reuse` → Design AD-004/005/006 + §7.3 E2E table.

---

## Tasks — Phase 1–4 GREEN (implementation, in order)

> After each GREEN task, its corresponding RED suite must turn from RED→GREEN and **no pre-existing test regresses**. Keep `/retiro` anon path (`register_retreat_preinscription`, `member_id IS NULL`) green throughout. `members/page.tsx` directory load must remain `db.members.filter(m => m.deleted_at===null)` — verify via code search.

- [x] **T-005 GREEN — Migration `013_retreat_member_link.sql`: column + partial index + comment + NOTIFY** <!-- sdd-owner: implementation -->
  - **Description:** Create `supabase/migrations/013_retreat_member_link.sql` as a single transactional, fully idempotent file per Design AD-001 + AD-007: `ALTER TABLE public.retreat_registrations ADD COLUMN IF NOT EXISTS member_id UUID NULL REFERENCES public.members(id) ON DELETE SET NULL;` plus conditional `DO $$` to add FK constraint `retreat_registrations_member_id_fkey` if column pre-existed without it; `CREATE INDEX IF NOT EXISTS retreat_registrations_member_id_idx ON public.retreat_registrations(member_id) WHERE member_id IS NOT NULL;` (plain, NOT `CONCURRENTLY`); `COMMENT ON COLUMN public.retreat_registrations.member_id IS 'Nullable FK … ON DELETE SET NULL preserves audit.';` and terminal `NOTIFY pgrst, 'reload schema';`. No `NOT NULL`, no `UNIQUE(member_id)`, no backfill, no `members` mutation, no Dexie change.
  - **Tests / Verification:** `supabase db reset` (or `psql` applying file inside `BEGIN … ROLLBACK` locally) succeeds; `\d public.retreat_registrations` shows `member_id uuid` nullable, FK `ON DELETE SET NULL`; `\di retreat_registrations_member_id_idx` shows `WHERE member_id IS NOT NULL`; inserting a second row with same `member_id` allowed (no unique). Existing anon RPC `register_retreat_preinscription` still inserts `member_id IS NULL` row.
  - **Rollback boundary:** Additive DDL — dropping the file and `supabase db reset` reverts; hard rollback is `DROP INDEX IF EXISTS …; ALTER TABLE … DROP COLUMN IF EXISTS member_id; NOTIFY pgrst…` (no data loss beyond FK link).
  - **Dependencies:** T-001 RED committed (so failure reason is known).
  - **Estimate:** S (1–2 h).
  - **Trace:** Spec `Member Interest Link` (4 scenarios) → Design AD-001 + AD-007.

- [x] **T-006 GREEN — RPC `register_retreat_preinscription_for_member` + grants + comment (completes 013)** <!-- sdd-owner: implementation -->
  - **Description:** In the same `supabase/migrations/013_retreat_member_link.sql` file, append (within the same transaction, before the final `NOTIFY`) the normative `CREATE OR REPLACE FUNCTION public.register_retreat_preinscription_for_member(p_member_id uuid, p_birthday date DEFAULT NULL, p_legal_rep_name text DEFAULT NULL, p_general_consent boolean DEFAULT false, p_sensitive_consent boolean DEFAULT false, p_denomination text DEFAULT NULL, p_community_name text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''` per Design AD-002 body: `user_role()` gate → `SELECT btrim(name), regexp_replace(btrim(phone),'[^0-9]','g'), lower(btrim(email)), COALESCE(p_birthday, members.birthday) FROM public.members WHERE id=p_member_id AND deleted_at IS NULL`; non-empty checks; `p_general_consent IS TRUE` else `23514`; `is_minor` derive via `age(CURRENT_DATE, v_birthday)` + `legal_rep` required; `EXISTS` duplicate pre-check on `member_id/email/phone` with `event_key=c_event_key` → `RAISE already_preinscribed USING ERRCODE 23505`; sensitive gating only when `p_sensitive_consent IS TRUE`; `INSERT … (event_key=c_event_key, name, phone, email, birthday, is_minor, legal_rep_name, status='preinscrito', general_consent_accepted_at=now(), policy_version='pdtp-v1.0-2026-07-17', sensitive_*, denomination, community_name, member_id=p_member_id) RETURNING id`; `EXCEPTION WHEN unique_violation THEN RAISE already_preinscribed USING ERRCODE 23505; WHEN OTHERS THEN RAISE`; then `REVOKE ALL ON FUNCTION … FROM PUBLIC; GRANT EXECUTE … TO authenticated;` and `COMMENT ON FUNCTION …`. Do NOT `GRANT TO anon` or `service_role`. Do NOT modify existing `register_retreat_preinscription (anon)`.
  - **Tests / Verification:** `supabase db reset` replay clean; `psql -f supabase/tests/retreat_rls.test.sql` — all new member blocks in T-001 now emit `PASS:` (leader creates `preinscrito` with `member_id`, normalized phone digit-only + email lower/btrim, consent stamps, `event_key` invariant; duplicate cases `23505 already_preinscribed`; `anon` `permission denied`; `server` `42501 not_authorized`; `deleted_at` guard; sensitive gating; payment status still `preinscrito→pagos_parciales→inscrito`). Existing 38 `PASS` stay `PASS`.
  - **Rollback boundary:** Single transaction — function drop does not touch data or `members`; `REVOKE EXECUTE FROM authenticated` immediately disables leader path.
  - **Dependencies:** T-005 (column+index land first); T-001 RED.
  - **Estimate:** M (3–4 h, normalization + error `ERRCODE` subtleties).
  - **Trace:** Spec `Authenticated RPC` + `Duplicate Handling` + `Event Key Invariant` + `Online-only and Permissions` → Design AD-002 + AD-006.

- [x] **T-007 GREEN — `CaptureForm` `initialValues` prefill (additive, no breaking change)** <!-- sdd-owner: implementation -->
  - **Description:** Modify `src/components/forms/CaptureForm.tsx`: add `export type CaptureFormInitialValues = Partial<CaptureSubmitPayload>;` and `initialValues?: CaptureFormInitialValues` to `CaptureFormProps`; after existing `useState` declarations add `useEffect(() => { if(!initialValues) return; if(iv.name!==undefined) setName(iv.name); if(iv.phone) setPhone(iv.phone); if(iv.email) setEmail(iv.email); if(iv.birthday!==undefined) handleBirthdayChange(iv.birthday); if(iv.legalRepName!==undefined) setLegalRepName(iv.legalRepName); }, [initialValues, handleBirthdayChange])` — deliberately NOT hydrating `generalConsent`/`sensitiveConsent` (stay `false`) and NOT hydrating `denomination/communityName` unless a future caller sets `sensitiveConsent` true (but V1 `memberToInitialValues` omits them). Keep `variant="retreat"` `captureFormConfig` path, `RETREAT_PRIVACY_NOTICE_ES`, `showOptionalContactCards=false`, validators `validateGeneralConsent`/`validateMinorFields`/`checkMinorStatus` unchanged. Additive only.
  - **Tests / Verification:** `npx vitest --run src/components/forms/__tests__/CaptureForm.initialValues.test.tsx` turns GREEN (all cases in T-002); existing `src/components/forms/__tests__/**` suites stay green; `npx tsc --noEmit` passes; no storage/queue side-effects.
  - **Rollback boundary:** Removing the `initialValues` prop + `useEffect` restores original `CaptureForm`; no DB impact.
  - **Dependencies:** T-002 RED; T-006 (RPC param shape known for Trace).
  - **Estimate:** S (1–2 h).
  - **Trace:** Spec `CaptureForm Reuse with Prefill` → Design AD-003.

- [x] **T-008 GREEN — Client adapter `submitRetreatPreinscriptionForMember` (no Dexie/queue)** <!-- sdd-owner: implementation -->
  - **Description:** Modify `src/lib/retreat/submit-adapter.ts` additive: add `export async function submitRetreatPreinscriptionForMember(memberId: string, payload: CaptureSubmitPayload): Promise<void>` that `createClient().rpc('register_retreat_preinscription_for_member', { p_member_id: memberId, p_birthday: emptyToNull(payload.birthday), p_legal_rep_name: emptyToNull(payload.legalRepName), p_general_consent: payload.generalConsent, p_sensitive_consent: payload.sensitiveConsent, p_denomination: payload.denomination, p_community_name: payload.communityName })` and re-throws `error` unchanged (caller maps `already_preinscribed`/`23505` to toast). Keep existing `submitRetreatPreinscription` untouched. Reuse `emptyToNull` helper. Do NOT write `db.members`, `db.sync_queue`, or `enqueue`.
  - **Tests / Verification:** `npx vitest --run src/lib/retreat/__tests__/submit-adapter.member.test.ts` turns GREEN (param mapping + `emptyToNull` + re-throw). `npx tsc --noEmit` passes. Search `grep -R 'submitRetreatPreinscriptionForMember' --include='*.ts' --include='*.tsx'` shows exactly the adapter + one consumer in `members/page.tsx` (T-009).
  - **Rollback boundary:** Deleting the new export is a one-file revert; no migration.
  - **Dependencies:** T-003 RED; T-007 (needs `CaptureSubmitPayload` type).
  - **Estimate:** S (1 h).
  - **Trace:** Spec `CaptureForm Reuse with Prefill` + `Duplicate Handling` → Design AD-003 § client adapter + §6.2 contract.

- [x] **T-009 GREEN — Members UI: dialog button + second dialog + gating + toast + Ver en Retiro** <!-- sdd-owner: implementation -->
  - **Description:** Modify `src/app/(dashboard)/members/page.tsx` (keeping `db.members.filter(m=>m.deleted_at===null)` directory load as the only load): import `canManageRetreatRegistrations` from `src/lib/rbac/guards.ts`, `CaptureForm` + `CaptureFormInitialValues`, `submitRetreatPreinscriptionForMember`, `RETREAT_EVENT_KEY`, `createClient`, `useRouter` from `next/navigation`, `useRole` session if not already present; add `const [retreatDialogOpen, setRetreatDialogOpen] = useState(false)` + helper `function memberToInitialValues(m: Member): CaptureFormInitialValues { return { name:m.name, phone:m.phone, email:m.email, birthday:m.birthday ?? '', isMinor:m.is_minor, legalRepName:m.legal_rep_name ?? '' } }` (omit `generalConsent/sensitiveConsent/denomination/communityName`); inside `selectedMember && (…)` render `<Button onClick={()=>setRetreatDialogOpen(true)} disabled={!canShow} title={!online?'Requiere conexión':undefined}>Preinscribir al retiro</Button>` where `canShow = role!==null && canManageRetreatRegistrations(role) && selectedMember.deleted_at===null && navigator.onLine && supabaseSession!==null`; when false button hidden/disabled with tooltip `Requiere conexión`. Add second `<Dialog open={retreatDialogOpen} onOpenChange={setRetreatDialogOpen}><DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Preinscribir a {selectedMember.name} al retiro</DialogTitle><DialogDescription>Los datos se precargan del miembro y son editables. Se requiere consentimiento fresco (Ley 1581).</DialogDescription></DialogHeader><CaptureForm variant="retreat" initialValues={memberToInitialValues(selectedMember)} submitAdapter={(payload)=>submitRetreatPreinscriptionForMember(selectedMember.id, payload)} onSuccess={()=>{ toast.success('Preinscripción creada', { action:{ label:'Ver en Retiro', onClick:()=>router.push('/retreat-registrations')}}); setRetreatDialogOpen(false); void refreshBadge(selectedMember.id); }} /></DialogContent></Dialog>` with outer error mapper for `already_preinscribed`/`23505` → `toast.error('Ya existe una preinscripción con ese email/teléfono para este retiro. Ver en Retiro.', { action:{label:'Ver en Retiro', onClick:()=>router.push('/retreat-registrations')}})`, `not_authorized/42501`, `missing_consent/23514`. Preserve existing `handleViewMember` (loads `social_media`/`whatsapp_numbers` Dexie) and `handleDeleteMember`. Do NOT add `SELECT * FROM retreat_registrations` to `loadMembers`.
  - **Tests / Verification:** `npx tsc --noEmit` + `npx next lint` pass; manual: leader online sees button, clicks → prefilled editable form with `RETREAT_PRIVACY_NOTICE_ES`, unchecked consents, can edit stale phone before submit; `server`/`anon` not seeing button; offline → `disabled` + tooltip and no `supabase.rpc` hit (intercept in Playwright). No `supabase.from('retreat_registrations')` outside badge path (verify `grep -n 'retreat_registrations' src/app/\(dashboard\)/members/page.tsx` only shows badge query).
  - **Rollback boundary:** Revert of this file only hides the feature; retreat module / anon flow unaffected.
  - **Dependencies:** T-007, T-008 (needs form + adapter); T-004 RED.
  - **Estimate:** M (3–4 h, two dialogs + role/online/session gating + toast mapping).
  - **Trace:** Spec `CaptureForm Reuse` (button, `initialValues`, `submitAdapter`, editable, encrypted not prefilled, `Ver en Retiro`) + `Online-only and Permissions` → Design AD-003 + AD-004.

- [x] **T-010 GREEN — Badge `Preinscrito` via single-row lookup (optional hook, non-bulk)** <!-- sdd-owner: implementation -->
  - **Description:** Add badge lookup that does NOT violate Isolation: either inline in `src/app/(dashboard)/members/page.tsx` or extracted as `src/hooks/useRetreatBadge.ts` (`export function useRetreatBadge(memberId: string|null): { hasBadge: boolean|null, refresh: ()=>Promise<void> }`). Implementation: `const supabase=createClient(); const { data } = await supabase.from('retreat_registrations').select('id').eq('member_id', memberId).eq('event_key', RETREAT_EVENT_KEY).maybeSingle()` (i.e., `SELECT id … LIMIT 1`). Trigger only when `selectedMember` dialog is open (or debounced after filtered page render for batch; batch alt `supabase.from('retreat_registrations').select('member_id').in('member_id', memberIds).eq('event_key', RETREAT_EVENT_KEY)` is allowed). Show `<Badge variant="outline" className="bg-emerald-50 text-emerald-800">Preinscrito</Badge>` next to `selectedMember.name` in detail header (and optionally in table row). Errors suppressed, loading does not block directory. Uses `retreat_registrations_member_id_idx WHERE member_id IS NOT NULL`.
  - **Tests / Verification:** Directory load (`db.members.filter(deleted_at===null)`) emits no `rest/v1/retreat_registrations?select` (Playwright isolation intercept); opening dialog emits one `?member_id=eq.<uuid>&event_key=eq.retiro-juvenil-octubre-2026` with `maybeSingle`; badge appears `Preinscrito` after success; `grep -n 'from.*retreat_registrations' src/app/\(dashboard\)/members/page.tsx` shows at most the badge line. `npx vitest` unaffected; `npx playwright test --project=chromium e2e/retreat-member-preinterest.spec.ts -g "Badge|isolation"` green.
  - **Rollback boundary:** Removing the hook + badge JSX is a one-file revert; index/column untouched.
  - **Dependencies:** T-009 (dialog context); T-006 (index exists for performance).
  - **Estimate:** S (1–2 h).
  - **Trace:** Spec `Isolation Invariant` (badge `maybeSingle` / `IN (ids)`, no bulk `SELECT *`, no `retreat_payments` in members) → Design AD-005.

---

## Tasks — Phase 5 Cross-slice verification

- [x] **T-011 GREEN — Typecheck + lint + unit suite is green (no regressions)** <!-- sdd-owner: implementation -->
  - **Description:** Run `npx tsc --noEmit` (strict), `npx next lint` (fix any `@typescript-eslint` / `next/core-web-vitals` findings introduced by `initialValues` / `members/page.tsx`), and `npx vitest --run` (all `src/**/__tests__/**/*.test.{ts,tsx}` incl. new `CaptureForm.initialValues` + `submit-adapter.member`; existing member/retreat tests excluded only if they were intentionally red — they must be green). Confirm `src/lib/retreat/constants.ts` still exports `RETREAT_EVENT_KEY='retiro-juvenil-octubre-2026'`, `src/lib/rbac/guards.ts` `canManageRetreatRegistrations` still maps `leader`/`super_admin`, and `src/lib/sync/db.ts` `AttendanceCaptureDB` version is still `1` with no `retreat_registrations` store.
  - **Acceptance:** `tsc` exits 0, `next lint` exits 0 (or only pre-existing warnings), `vitest` exits 0 with new suites `PASS`. Attach `git diff --stat` showing total `+`/`-` <400 and `grep -R 'members_update' supabase/` showing only pre-existing `super_admin` policies.
  - **Concrete targets:** `src/components/forms/CaptureForm.tsx`, `src/lib/retreat/submit-adapter.ts`, `src/app/(dashboard)/members/page.tsx`, `src/hooks/useRetreatBadge.ts` (if created), `tsconfig.json` / `.eslintrc.json`.
  - **Dependencies:** T-007, T-008, T-009, T-010.
  - **Estimate:** S (1–2 h).
  - **Trace:** Spec `Member Interest Link` (members untouched, Dexie not bumped) → Design AD-006 + AD-007 changed-line budget.

- [x] **T-012 GREEN — Supabase `db reset` replay + owner RLS test harness is green** <!-- sdd-owner: implementation --> — **RECONCILED 2026-08-27** via `verify-report.md` §2/§4 rows 7-8: `supabase db reset` exit 0 replay 001→013, `docker exec psql -f retreat_rls.test.sql` 52 PASS (38 anon +14 member-linked) incl. `PASS: leader member-linked`, `PASS: duplicate already_preinscribed 23505`, `PASS: anon deny`, `PASS: server deny 42501`, `ROLLBACK`; satisfies T-012 Acceptance (stale-checkbox per verify §2)
  - **Description:** Run `supabase db reset` (or `supabase db push` on staging) to replay `001→013` and the new `supabase/tests/retreat_rls.test.sql` extension inside a `BEGIN … ROLLBACK` harness (owner `POSTGRES` role, as in existing tests). Verify every `RAISE NOTICE 'PASS: …'` in the file appears, including new member-linked blocks, and that `register_retreat_preinscription` (anon) still creates `member_id IS NULL` rows unaffected. If `supabase` CLI is unavailable in CI, run the same file via `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/retreat_rls.test.sql` against a local `supabase start` instance and capture the log.
  - **Acceptance:** `supabase db reset` exits 0; `psql` run shows all `PASS:` lines including `PASS: leader member-linked preinscription`, `PASS: duplicate already_preinscribed`, `PASS: anon cannot EXECUTE new RPC`, `PASS: server denied`, `PASS: member not found`, `PASS: missing consent`, `PASS: payments still derive status`, and `ROLLBACK` at end. No `FAIL:` raised.
  - **Concrete targets:** `supabase/migrations/013_retreat_member_link.sql`, `supabase/tests/retreat_rls.test.sql`, `supabase/migrations/011_youth_retreat_preregistration.sql` (reference for `retreat_payments_guard_total` / `apply_status` unchanged).
  - **Dependencies:** T-005, T-006; T-011.
  - **Estimate:** M (2–3 h including `supabase start` spin-up).
  - **Trace:** Spec `Authenticated RPC` + `Duplicate Handling` + `Isolation Invariant` + `Event Key Invariant` → Design §7.2 + AD-002 + AD-006 + Threat Matrix in Design §8.

- [x] **T-013 GREEN — Playwright `retreat-member-preinterest` E2E is green (chromium, firefox optional)** <!-- sdd-owner: implementation --> — **RECONCILED 2026-08-27 as WARNING** via `verify-report.md` §2/§4 row 5: `npx playwright test e2e/retreat-member-preinterest.spec.ts --list` 10 tests (5 chromium+5 firefox) listed OK (leader prefill/editable/toast+badge, isolation intercept, duplicate toast+Ver en Retiro, offline disabled Requiere conexión, server hidden+rpc denied); `tsc 0` selectors valid; full run with dev server deferred per anti-hang but WARNING is non-blocking per verify PASS WITH WARNINGS (orchestrator explicit approval)
  - **Description:** Run `npx playwright test e2e/retreat-member-preinterest.spec.ts --project=chromium` (and `--project=firefox` when available). Scenarios per T-004 and Design §7.3: leader `members → detail → prefilled editable retreat form → submit → toast 'Preinscripción creada' + Ver en Retiro link → badge `Preinscrito` → retreat registrations list shows `preinscrito` row → record two `retreat_payments` → badge/status `pagos_parciales → inscrito`; isolation intercept (no bulk `rest/v1/retreat_registrations` returning multiple rows on directory load); duplicate toast Spanish + link; offline button `disabled` `Requiere conexión` no `rpc`; server cannot see button and direct `supabase.rpc('register_retreat_preinscription_for_member')` fails `not_authorized`. Seed via `supabase db reset` + helpers (do not bypass consent with raw `INSERT` where the test wants UI consent). Capture `npx playwright show-report` or `html` reporter output.
  - **Acceptance:** All 5 scenarios in `e2e/retreat-member-preinterest.spec.ts` are `PASS` on `chromium` (and `firefox` when exercised); trace/screenshots on failure only; no remaining `test.skip`.
  - **Concrete targets:** `e2e/retreat-member-preinterest.spec.ts`, `playwright.config.ts` (`testDir`, `use.baseURL`, `webServer`), `src/app/(dashboard)/members/page.tsx` (button/Dialog/badge), `src/lib/retreat/constants.ts` (`RETREAT_EVENT_KEY`).
  - **Dependencies:** T-009, T-010, T-012 (DB/RLS must be green first).
  - **Estimate:** M (3–4 h, seed + role JWT + intercepts).
  - **Trace:** Spec 7 requirements end-to-end → Design §7.3 E2E table.

- [x] **T-014 GREEN — Final delivery gate: isolation + regression + docs + tag** <!-- sdd-owner: implementation --> — **RECONCILED 2026-08-27** via `verify-report.md` §2/§4 rows 9-13: `grep -n retreat_registrations src/app/(dashboard)/members/page.tsx` 1 hit badge maybeSingle only, `grep retreat_payments src/app/(dashboard)/members` 0, `grep Dexie src/lib/sync/db.ts` 0 retreat store, `grep RETREAT_EVENT_KEY` constant invariant OK, `git diff --stat HEAD` 244 ins (<400) production ~365, `tsc 0` `next lint 0` `vitest 259/259`; satisfies T-014 Acceptance (stale-checkbox)
  - **Description:** Single-session final pass: (a) `grep -R 'retreat_registrations' --include='*.tsx' src/app/(dashboard)/members` only shows badge query; `grep -R 'RETREAT_EVENT_KEY' --include='*.ts' --include='*.tsx' --include='*.sql'` shows only `src/lib/retreat/constants.ts` + `013` `c_event_key` + `retreat-registrations/page.tsx` `eq(event_key)` + badge query (constant invariant); (b) `grep -R 'supabase.*from.*retreat_payments' --include='*.tsx' src/app/(dashboard)/members` returns no matches (no payment in members); (c) `rg 'Dexie|AttendanceCaptureDB' src/lib/sync/db.ts` shows no `retreat_registrations` store; (d) `git diff --stat` still <400; (e) append a short `NOTES` block to `openspec/changes/retreat-member-preinterest/tasks.md` (this file) with `supabase db reset` + `retreat_rls.test.sql` PASS log excerpt, or link to CI artifact; (f) tag `feat/retreat-member-link` ready for review (no `feature-branch-chain`).
  - **Acceptance:** `grep` checks pass; anon `/retiro → register_retreat_preinscription (member_id IS NULL)` still works (manual quick test via `src/app/retiro/page.tsx`); `git log --oneline` shows only `feat/retreat-member-link` commits since base; `openspec/changes/retreat-member-preinterest/tasks.md` is up to date and reviewable.
  - **Concrete targets:** `src/app/(dashboard)/members/page.tsx`, `src/lib/retreat/constants.ts`, `src/lib/sync/db.ts`, `src/app/retiro/page.tsx`, `supabase/tests/retreat_rls.test.sql` log, `openspec/changes/retreat-member-preinterest/tasks.md` itself.
  - **Dependencies:** T-011, T-012, T-013.
  - **Estimate:** S (1 h).
  - **Trace:** Spec `Isolation Invariant` + `Event Key Invariant` + `Online-only` (no Dexie write) → Design AD-005/006/007 + §13 Conformance.

---

## Post-apply / Bounded Review (parent-owned)

> These run **after** the implementation batch above is committed on `feat/retreat-member-link` and the native review is started. `implementation` never opens a review; `parent` owns the bounded review lifecycle.

- [x] **T-015 Bounded review — start or reuse review for `feat/retreat-member-link` and collect findings** <!-- sdd-owner: parent --> — **RECONCILED 2026-08-27 parent-owned deferred, non-blocking**: `gentle-ai review mode status` = `receipt-driven development: off (clone_local off)` → bounded review transport `immutable_review_transport_unsupported` (non-GenAI runtime); review not required with RDD off per archive contract (reviewGate structurally absent = proceed under ordinary policy); single PR `244 ins` <400 Low forecast holds, no correction budget needed; parent/orchestrator owns lifecycle via `sdd-archive` (this report)
  - **Description:** Run `gentle-ai review status --cwd <repo> --contract gentle-ai.review-integration/v2 --agent pi --next-transition` then the returned `execute`/`collect` transitions (up to 4 lenses over the frozen candidate, correction budget `min(200, ceil(changed_lines/2))`). Collect `review.capture-result` inputs in order with the exact `GENTLE_AI_REVIEW_BINDING {…}` prefix. Do not mutate the candidate after `review.start` except via the single bounded correction transaction if the review requests `correction_lines`.
  - **Acceptance:** Review receipt is `allow` or bounded correction is applied + re-validated and `reviewGate.result: allow` is present for the candidate. Any `severe` finding must be candidate-caused (not base-only).
  - **Concrete targets:** `supabase/migrations/013_retreat_member_link.sql`, `src/components/forms/CaptureForm.tsx`, `src/lib/retreat/submit-adapter.ts`, `src/app/(dashboard)/members/page.tsx`, `supabase/tests/retreat_rls.test.sql` (as review scope).
  - **Dependencies:** T-014 (candidate frozen).
  - **Estimate:** M (review runtime, not author time).
  - **Trace:** Design Threat Matrix (RLS/GRANT/`SECURITY DEFINER`/Ley 1581/duplicate).

- [x] **T-016 Decision — delivery strategy confirmation if 400-line risk escalates** <!-- sdd-owner: parent --> — **RECONCILED 2026-08-27 parent-owned guard, no split**: `tasks.md` Forecast `Decision needed before apply: No`, `Chained PRs recommended: No`, `stacked-to-main`; actual `git diff --stat HEAD` 244 ins (<400) production ~365 (<400) → Low risk holds, `ask-on-risk` needs no owner ping; single PR `feat/retreat-member-link → main` confirmed, no `size:exception` required
  - **Description:** If during apply the `git diff --stat` estimate exceeds 400 (e.g., optional `useRetreatBadge.ts` + batched badge + extra tests push over), apply the cached `delivery_strategy=ask-on-risk`: ask the repo owner to choose `single-pr` with `size:exception` or `stacked-to-main: split docs vs DDL` (never auto-split). This change as specced does not need it; entry is a guard.
  - **Acceptance:** No chain decision is needed (`budget risk: Low` holds) OR owner choice is recorded before any split/chain work.
  - **Concrete targets:** `openspec/changes/retreat-member-preinterest/tasks.md` (this forecast), `git diff --stat` evidence.
  - **Dependencies:** Forecast Low — gate only.
  - **Estimate:** S.
  - **Trace:** Workload Forecast + Delivery Strategy in proposal §11.

---

## Estimates summary

| Task | Size | Hours |
|------|------|-------|
| T-001 RED SQL/RLS harness | M | 3–4 |
| T-002 RED CaptureForm initialValues | S | 1–2 |
| T-003 RED adapter member | S | 1–2 |
| T-004 RED E2E skeleton | M | 2–3 |
| T-005 GREEN 013 DDL | S | 1–2 |
| T-006 GREEN RPC + grants | M | 3–4 |
| T-007 GREEN CaptureForm reuse | S | 1–2 |
| T-008 GREEN adapter member | S | 1 |
| T-009 GREEN members dialog + gating | M | 3–4 |
| T-010 GREEN badge single-row | S | 1–2 |
| T-011 tsc/lint/vitest | S | 1–2 |
| T-012 db reset + RLS harness | M | 2–3 |
| T-013 Playwright E2E | M | 3–4 |
| T-014 final isolation gate | S | 1 |
| T-015 bounded review | M | — (system) |
| T-016 delivery decision | S | — (guard) |
| **Total author time** | — | **~24–34 h** spread across 2–3 sessions; one PR is sufficient |

## Traceability matrix (quick)

| Spec Requirement | AD | Tasks |
|------------------|----|-------|
| **Member Interest Link** (nullable FK, partial index, no `members` touch, `NOTIFY`) | AD-001 + AD-007 | T-001 RED, T-005 GREEN, T-011, T-012, T-014 |
| **Authenticated RPC** (signature, `SECURITY DEFINER search_path=''`, role gate, SELECT from `members`, consent/minor, sensitive gating, `member_id` insert) | AD-002 + AD-006 | T-001 RED, T-006 GREEN, T-008 GREEN, T-012, T-013 |
| **CaptureForm Reuse with Prefill** (`initialValues`, editable, encrypted not prefilled) | AD-003 + AD-004 | T-002 RED, T-003 RED, T-007 GREEN, T-008 GREEN, T-009 GREEN, T-013 |
| **Isolation Invariant** (Dexie-only load, single-row badge, canonical list, RLS unchanged) | AD-005 + AD-006 + AD-004 | T-004 RED iso, T-010 GREEN, T-013 iso, T-014 |
| **Duplicate Handling** (`EXISTS` + `unique_violation→already_preinscribed`, Spanish toast + `Ver en Retiro`) | AD-002 + AD-004 | T-001 RED dup, T-003 RED re-throw, T-006 GREEN pre-check+mapper, T-009 toast, T-013 duplicate |
| **Online-only and Permissions** (no Dexie, `Requiere conexión`, `canManageRetreatRegistrations`, `GRANT TO authenticated`) | AD-006 + AD-002 + AD-004 | T-004 RED offline, T-006 grants, T-009 gating, T-012 anon/server, T-013 offline+server |
| **Event Key Invariant** (`RETREAT_EVENT_KEY='retiro-juvenil-octubre-2026'` constant) | AD-002 + AD-007 | T-006 GREEN `c_event_key`, T-012 invariant, T-014 constant grep |

---

## `openspec` store note

This file is the file-store mirror. The Engram entry `sdd/retreat-member-preinterest/tasks` is the same content (saved via `mem_save` for cross-session recovery per `artifact_store=both`). Do not diverge them — `supabase db reset` + `npx vitest --run` + `npx playwright test` logs are the evidence that travels with both.

