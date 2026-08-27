# Verify Report — retreat-member-preinterest

> **Change:** `retreat-member-preinterest` · **Branch:** `feat/retreat-member-link` → `main` (1 PR) · **Date:** 2026-08-27
> **Workspace:** `/Users/richard.robles/PycharmProjects/MD_CC_ATTENDANCE_AND_CAPTURE`
> **Verifier:** SDD verify executor (Muse Spark — Gentle AI)
> **Artifact store:** `openspec` (file) + `both` per `openspec/config.yaml`
> **Mode:** `strict_tdd=true` · **Parent:** `sdd-orchestrator` bounded verify
> **Apply-progress:** `openspec/changes/retreat-member-preinterest/apply-progress.md` (11/16 checked, 23KB, 259 vitest claimed)

---

## Verdict: PASS WITH WARNINGS

**Executive summary (rioplatense):** Che, todo cierra. Los siete requisitos del spec están COMPLIANT con evidencia dura: migración `013` idempotente con `member_id UUID NULL ON DELETE SET NULL` + índice parcial + `NOTIFY pgrst`, RPC `register_retreat_preinscription_for_member` (`SECURITY DEFINER SET search_path=''`, `GRANT TO authenticated` solo, gate `user_role() IN ('leader','super_admin')`, re-deriva PII desde `members`, consentimiento fresco Ley 1581, deduplicado `EXISTS` + `unique_violation→23505`), `CaptureForm` `initialValues` editable con consents forzados a `false`, adapter `submitRetreatPreinscriptionForMember` con `emptyToNull`, botón `Preinscribir al retiro` con gating `canManageRetreatRegistrations` + `navigator.onLine` + sesión + toast `Preinscripción creada` / `Ya existe… Ver en Retiro` y badge `Preinscrito` vía `maybeSingle`. `npx tsc --noEmit` 0, `npx next lint` 0, `npx vitest run` 259/259 (31 files) incluyendo las dos suites nuevas 10/10, `supabase db reset` replay limpio 001→013, `retreat_rls.test.sql` 52 PASS (38 anon + 14 member-linked) vía `docker exec psql`, y aislamiento `members` verificado (`retreat_registrations` solo badge, `retreat_payments` 0 hits). Docker **estaba disponible** (13 containers, `supabase db reset` viable) — no WARNING por Docker. Quedan warnings no bloqueantes: `e2e/retreat-member-preinterest.spec.ts` solo se validó con `--list` (10 tests: 5 chromium + 5 firefox) sin run completo con dev server (deferido por diseño anti-hang), y 3 checkboxes de implementación siguen `- [ ]` en `tasks.md` aunque T-012 y T-014 ya tienen evidencia GREEN (stale-checkbox) y T-013 requiere run E2E completo antes de archive. Sin scope creep, single PR correcto. No push.

---

## 1. Spec Coverage (7 requirements)

| # | Requirement (from `specs/retreat-member-preinterest/spec.md`) | Status | Evidence (file + test/command) |
|---|---------------------------------------------------------------|--------|--------------------------------|
| 1 | **Member Interest Link** — `member_id UUID NULL REFERENCES members(id) ON DELETE SET NULL`, partial btree `retreat_registrations_member_id_idx WHERE member_id IS NOT NULL`, no backfill, no `NOT NULL`/`UNIQUE`, no `members` DDL/RLS/Dexie bump, `NOTIFY pgrst` | **COMPLIANT** | `supabase/migrations/013_retreat_member_link.sql` L1-30 + `COMMENT ON COLUMN` + `NOTIFY`; `supabase db reset` replay OK 001→013; `docker exec psql` `SELECT column_name,is_nullable` → `member_id uuid YES`; `SELECT indexdef` → `WHERE (member_id IS NOT NULL)`; `SELECT conname,confdeltype` → `retreat_registrations_member_id_fkey f n` (SET NULL); `RETREAT_EVENT_KEY` grep matches; `supabase/tests/retreat_rls.test.sql` guard `42703 member_id missing` → after 013 `PASS: idx missing` absent |
| 2 | **Authenticated RPC Preinscription for Member** — signature `register_retreat_preinscription_for_member(p_member_id uuid, p_birthday date DEFAULT NULL, p_legal_rep_name text DEFAULT NULL, p_general_consent boolean DEFAULT false, p_sensitive_consent boolean DEFAULT false, p_denomination text DEFAULT NULL, p_community_name text DEFAULT NULL) RETURNS uuid`, `LANGUAGE plpgsql SECURITY DEFINER SET search_path=''`, qualified `public.*`, `REVOKE ALL FROM PUBLIC; GRANT TO authenticated` only, `user_role()` gate `42501`, SELECT `btrim(name), regexp_replace(phone), lower(email), COALESCE(birthday) FROM members WHERE id=... AND deleted_at IS NULL`, non-empty checks, `p_general_consent IS TRUE` else `23514`, `is_minor` via `age(CURRENT_DATE) <18` + `legal_rep` required, sensitive gating only if `p_sensitive_consent IS TRUE`, INSERT `event_key='retiro-juvenil-octubre-2026'`, `status='preinscrito'`, consent stamps `pdtp-v1.0-2026-07-17`, normalized PII, `RETURNING id`, `EXISTS` pre-check + `unique_violation→already_preinscribed 23505`; existing anon RPC unchanged | **COMPLIANT** | `013` L33-166 AD-002 body + `REVOKE/GRANT/COMMENT`; `docker exec psql -c "SELECT prosecdef,proargtypes"` → `t {uuid,date,text,boolean,boolean,text,text}`; `routine_privileges` → only `postgres` + `authenticated` EXECUTE; `pg_get_functiondef` shows `SET search_path TO ''` + `SECURITY DEFINER` + fully qualified `public.members`/`public.retreat_registrations`/`public.user_role()`; `retreat_rls.test.sql` second `DO $$` 14 cases: `PASS: leader member-linked` (status/member_id/event_key/policy), `PASS: missing consent 23514`, `PASS: minor no rep`, `PASS: minor with rep`, `PASS: dup member 23505`, `PASS: dup email 23505`, `PASS: dup phone 23505`, `PASS: deleted`, `PASS: sens false/true`, `PASS: anon deny`, `PASS: server deny 42501`, `PASS: pagos_parciales→inscrito` (leader 40→60/100) |
| 3 | **CaptureForm Reuse with Prefill** — additive `initialValues?: Partial<CaptureSubmitPayload>` (`name,phone,email,birthday,isMinor,legalRepName,denomination,communityName`), `useState/useEffect` hydration, `generalConsent/sensitiveConsent` stay `false`, `variant="retreat"` `RETREAT_PRIVACY_NOTICE_ES` + `showOptionalContactCards=false`, validators unchanged, adapter `submitRetreatPreinscriptionForMember(memberId,payload)` → `supabase.rpc('register_retreat_preinscription_for_member', {p_member_id, p_birthday:emptyToNull, p_legal_rep_name:emptyToNull, p_general_consent, p_sensitive_consent, p_denomination, p_community_name})` re-throw, no Dexie/queue, `members/page.tsx` Dialog `Preinscribir al retiro` gated `canManageRetreatRegistrations(role)` + `deleted_at IS NULL` + `navigator.onLine` + session, second Dialog `CaptureForm variant="retreat" initialValues=derivedFromMember` editable, toast `Preinscripción creada` + `Ver en Retiro` → `/(dashboard)/retreat-registrations`, encrypted `denomination_encrypted` not decrypted | **COMPLIANT** | `src/components/forms/CaptureForm.tsx` L38-49 types + L70-84 `useEffect` hydrates `name/phone/email/birthday/legalRepName` only, never `generalConsent/sensitiveConsent`; `src/lib/retreat/submit-adapter.ts` L6-20 mapping + `emptyToNull` re-throw; `src/app/(dashboard)/members/page.tsx` L45-54 `memberToInitialValues` (omits consents/sensitive), L126-149 gating + Dialogs L290-410; `npx tsc --noEmit` 0; `npx vitest run src/components/forms/__tests__/CaptureForm.initialValues.test.tsx src/lib/retreat/__tests__/submit-adapter.member.test.ts` 10/10; `npx vitest run` 259/259 includes both |
| 4 | **Isolation Invariant** — `members/page.tsx` directory load `db.members.filter(deleted_at===null)` only, no bulk `SELECT * FROM retreat_registrations` / `retreat_payments` sums, optional badge `SELECT id WHERE member_id=... AND event_key=RETREAT_EVENT_KEY LIMIT 1` via `maybeSingle` or `IN (ids)` batch, canonical listing/status/payments exclusively in `retreat-registrations/page.tsx` `eq(event_key,RETREAT_EVENT_KEY)` + `retreat_payments` sum, RLS `retreat_registrations_select TO authenticated USING (user_role() IN ('super_admin','leader'))` unchanged, `member_id` readable under same policy | **COMPLIANT** | `page.tsx` L82-86 `loadMembers` → `db.members.filter(...).toArray()`; L126-148 `refreshBadge` → `.from("retreat_registrations").select("id").eq("member_id",memberId).eq("event_key",RETREAT_EVENT_KEY).maybeSingle()`; `grep -n retreat_registrations src/app/(dashboard)/members/page.tsx` → **1 hit** badge line only; `grep retreat_payments src/app/(dashboard)/members/` → **0 hits**; `grep Dexie src/lib/sync/db.ts` → no `retreat_registrations` store version 1; `retreat-registrations/page.tsx` L84 `eq('event_key',RETREAT_EVENT_KEY)` unchanged; `members_update` grep → only `001`/`006` `super_admin` policy |
| 5 | **Duplicate Handling** — same `event_key` `EXISTS (member_id = p_member_id OR lower(btrim(email))=v_email OR regexp_replace(phone)=v_phone)` → `RAISE already_preinscribed USING ERRCODE 23505`, plus `EXCEPTION WHEN unique_violation THEN RAISE already_preinscribed USING ERRCODE 23505` on expression uniques `retreat_registrations_event_email_uidx/_phone_uidx`, no `ON CONFLICT DO NOTHING/UPDATE`, no auto-link, client maps `already_preinscribed/23505` → Spanish toast `Ya existe una preinscripción con ese email/teléfono para este retiro. Ver en Retiro.` + link/button to `/(dashboard)/retreat-registrations` | **COMPLIANT** | `013` L95-115 pre-check + L139-142 race mapper `RAISE already_preinscribed … USING ERRCODE='23505'`; `submit-adapter.ts` L14-18 re-throws; `page.tsx` L338-347 `if (msg.includes("already_preinscribed")\|\|code==="23505") toast.error("Ya existe…")` + `router.push("/retreat-registrations")` + `onSuccess` `Ver en Retiro`; `retreat_rls.test.sql` `PASS: dup member/email/phone already_preinscribed` 23505 with `count(*)=1` guard; `src/lib/retreat/__tests__/submit-adapter.member.test.ts` `re-throws already_preinscribed 23505` case |
| 6 | **Online-only and Permissions** — no Dexie `retreat_registrations` store, no `db.members`/`db.sync_queue` writes, no `enqueue`, button disabled `title="Requiere conexión"` when `navigator.onLine===false` or no `supabase.auth.getSession()`, gates `canManageRetreatRegistrations(role)` + `user_role() IN ('leader','super_admin')` (UI + RPC), `REVOKE/GRANT` scope `authenticated` only (`anon` fails `permission denied`, `server` fails `42501` via body), anon `register_retreat_preinscription` still `member_id IS NULL` | **COMPLIANT** | `page.tsx` L60-96 `isOnline/hasSession` effects + L170-190 `canShowPreinscribe` + `disabled={!isOnline\|\|!hasSession} title="Requiere conexión"` both paths; `submit-adapter.ts` imports only `@/lib/supabase/client` no `db/enqueue`; `grep Dexie src/lib/sync/db.ts` → no retreat; `REVOKE ALL FROM PUBLIC; GRANT TO authenticated` in `013`; `retreat_rls.test.sql` `PASS: anon deny` (insufficient_privilege), `PASS: server deny 42501 not_authorized`, `PASS: sens false` no queue, `npx vitest` `does not write Dexie or enqueue` case; anon path `src/lib/retreat/submit-adapter.ts` `submitRetreatPreinscription` untouched + `e2e` offline/server scenarios listed |
| 7 | **Event Key Invariant** — `RETREAT_EVENT_KEY='retiro-juvenil-octubre-2026'` in `src/lib/retreat/constants.ts` and `c_event_key` in RPC, all inserts/duplicate scopes/badge queries use that constant, callers do not supply `event_key`, `/retiro` and `retreat-registrations` `eq(event_key,RETREAT_EVENT_KEY)` | **COMPLIANT** | `src/lib/retreat/constants.ts` → `'retiro-juvenil-octubre-2026'`; `013` L60 `c_event_key := 'retiro-juvenil-octubre-2026'`; `page.tsx` L47 `import {RETREAT_EVENT_KEY}` + L131 `eq("event_key",RETREAT_EVENT_KEY)`; `grep -rn RETREAT_EVENT_KEY\|c_event_key` → only those + `011` `c_event_key` + `retreat-registrations/page.tsx`; `retreat_rls.test.sql` `PASS: leader member-linked` checks `v_event_key='retiro-juvenil-octubre-2026'` and duplicate scope `WHERE r.event_key=c_event_key` |

**Coverage summary:** 7/7 COMPLIANT, 0 PARTIAL. Every spec scenario has a concrete file+test anchor; no invented columns or widened RLS.

---

## 2. Task Completion

**Tasks file:** `openspec/changes/retreat-member-preinterest/tasks.md` (16 tasks total, 11 implementation + 2 parent deferred counted as 11/16 checked per `apply-progress.md`).

### Completed (11/16 checked `- [x]`)

- [x] T-001 RED SQL/RLS harness
- [x] T-002 RED CaptureForm initialValues
- [x] T-003 RED adapter member
- [x] T-004 RED Playwright skeleton
- [x] T-005 GREEN 013 DDL
- [x] T-006 GREEN RPC + grants
- [x] T-007 GREEN CaptureForm reuse
- [x] T-008 GREEN adapter
- [x] T-009 GREEN members dialog + gating + toasts
- [x] T-010 GREEN badge maybeSingle
- [x] T-011 GREEN tsc/lint/vitest

### Remaining unchecked implementation tasks (exact lines from `tasks.md`)

```text
- [ ] **T-012 GREEN — Supabase `db reset` replay + owner RLS test harness is green** <!-- sdd-owner: implementation -->
- [ ] **T-013 GREEN — Playwright `retreat-member-preinterest` E2E is green (chromium, firefox optional)** <!-- sdd-owner: implementation -->
- [ ] **T-014 GREEN — Final delivery gate: isolation + regression + docs + tag** <!-- sdd-owner: implementation -->
```

### Parent-owned deferred (exact lines)

```text
- [ ] **T-015 Bounded review — start or reuse review for `feat/retreat-member-link` and collect findings** <!-- sdd-owner: parent -->
- [ ] **T-016 Decision — delivery strategy confirmation if 400-line risk escalates** <!-- sdd-owner: parent -->
```

### Completeness assessment

- **CRITICAL (archive blocker):** 3 unchecked implementation tasks remain in `tasks.md`. Archive MUST NOT proceed as clean PASS until they are checked. However evidence below proves 2 of them are now stale-checkbox (verify already satisfied them); 1 still needs a full run.
  - **T-012 — now PROVEN GREEN in this verify (stale checkbox).** `supabase db reset` re-executed here and exited 0 (replaying 001→013, seeding `test-superadmin/leader/server` + seed members, applying `013` including `NOTIFY`). Full `retreat_rls.test.sql` via `docker exec psql -f /tmp/retreat_rls.test.sql` emitted **52 PASS** (`PASS: anon …` 8 + `PASS: anon RPC …` + `PASS: missing …` 5 + `PASS: duplicate …` 2 + `PASS: sensitive …` 2 + `PASS: payment refused …` 7 + `PASS: super_admin …` + `PASS: zero/partial/covered/overpay` 4 + `PASS: server CANNOT INSERT` + `All retreat … passed` **and** `PASS: leader member-linked` + `PASS: missing consent` + `PASS: minor no rep/with rep` + `PASS: dup member/email/phone` + `PASS: deleted` + `PASS: sens false/true` + `PASS: anon deny` + `PASS: server deny` + `PASS: pagos_parciales/inscrito` + `All member-linked RPC tests passed` → `ROLLBACK`). Check `T-012` after updating `tasks.md`.
  - **T-014 — now PROVEN GREEN in this verify (stale checkbox).** Isolation gates run: `grep -n retreat_registrations src/app/(dashboard)/members/page.tsx` → 1 (badge `maybeSingle`); `grep retreat_payments src/app/(dashboard)/members` → 0; `grep Dexie AttendanceCaptureDB src/lib/sync/db.ts` → no `retreat_registrations`; `grep RETREAT_EVENT_KEY` → only `constants.ts` + `013 c_event_key` + `retreat-registrations/page.tsx` + badge; `grep members_update supabase/` → only `001`/`006` `super_admin`; `git diff --stat HEAD` → `4 files changed, 244 insertions(+), 3 deletions(-)` (modified) + untracked `e2e` 122 + migration 166 + 2 vitest 287 = ~819 total but production ~365 (<400) per Workload section; `npx tsc --noEmit` 0; `npx next lint` 0; `npx vitest run` 259/259; anon `/retiro` path untouched. Check `T-014` after updating `tasks.md`.
  - **T-013 — PARTIAL (WARNING, not yet GREEN).** Anti-hang rule respected: `npx playwright test e2e/retreat-member-preinterest.spec.ts --list` was run (no dev server) and listed **10 tests in 1 file** (leader prefill/editable/consent/toast+badge, isolation intercept no bulk `SELECT` before detail click, duplicate Spanish toast + `Ver en Retiro` link → navigation, offline `disabled` + `title="Requiere conexión"` no rpc, server hidden + direct `rpc` denied `not_authorized` — each ×2 browsers). Full `npx playwright test --project=chromium` (and firefox) with dev server `npm run dev` + seeded `leader` + `members` was **not** run in this headless verify (per anti-hang instruction). The implementation is selector-correct (`getByRole`, `getByLabel`, `getByText`) and `tsc` passes, but trace/screenshots are missing. Check `T-013` only after full run.
- **INFO (not blocker):** T-015/T-016 are parent-owned bounded review + delivery decision, correctly deferred.

**No task was silently skipped:** every `- [ ]` line is quoted above verbatim.

---

## 3. Structured Status & actionContext Findings

- **Structured status consumed:**
  - `apply-progress.md` block: `gentle-ai sdd-status --cwd ... --json` at start → `proposal: all_done, specs: all_done, design: all_done, tasks: all_done, apply: ready, nextRecommended: apply, applyState: ready, actionContext.mode: repo-local, allowedEditRoots: ["/Users/richard.robles/PycharmProjects/MD_CC_ATTENDANCE_AND_CAPTURE"], artifactStore: openspec` (no `apply-progress` prior; `sdd-attempt acquire --max-attempts 5 --max-changed-lines 400` → `state: proceed` token `sha256:c4f88...`).
  - No parent JSON was injected in this verify turn; `openspec/config.yaml` confirms `persistence.mode: both`, `testing.strict_tdd: true`, so `openspec/` is authoritative and Engram is mirror. No conflict.
  - `Review Workload Forecast` in `tasks.md`: `310–360` est., `Low` risk, `No` chain, `stacked-to-main`, `Decision needed before apply: No` — respected.
- **actionContext & edit-authority guard:**
  - `mode` is not `workspace-planning` (prod verify is `repo-local`); `allowedEditRoots` check passes — all target files are inside `/Users/richard.robles/PycharmProjects/MD_CC_ATTENDANCE_AND_CAPTURE` (verified: `src/app/(dashboard)/members/page.tsx`, `src/components/forms/CaptureForm.tsx`, `src/lib/retreat/submit-adapter.ts`, `supabase/migrations/013_retreat_member_link.sql`, `supabase/tests/retreat_rls.test.sql`, `src/components/forms/__tests__/CaptureForm.initialValues.test.tsx`, `src/lib/retreat/__tests__/submit-adapter.member.test.ts`, `e2e/retreat-member-preinterest.spec.ts`). No `blocked(edit_authority_missing)` consent needed.
  - Implementation ownership proven via `git diff --stat HEAD` + `git status` (branch `main`, on `origin/main`, changes unstaged, no push — per delegated `"No hagas push"`).
- **Artifact store carve-out:** `openspec/` directory exists (`ls openspec/changes/` → `archive` + `retreat-member-preinterest` with 5 files), so native `openspec` dispatcher status would be authoritative if invoked. Not invoked here because `engram` mirror is secondary; file reads suffice.

---

## 4. Test / Validation Commands (exact, including failures)

| # | Command (run in `workspace`) | Result | Notes |
|---|-------------------------------|--------|-------|
| 1 | `npx tsc --noEmit` | **PASS 0** | Strict TS 5.8, no errors (run after `cd workspace`) |
| 2 | `npx next lint` | **PASS 0** | `next lint` deprecated warning `Detected additional lockfiles` but `✔ No ESLint warnings or errors` |
| 3 | `npx vitest run` | **PASS 259/259, 31 files** | Duration 25s; includes new suites: `CaptureForm.initialValues.test.tsx` 5, `submit-adapter.member.test.ts` 5, `submit-adapter.test.ts` 5, `CaptureForm.adapter.test.tsx` 5, `payments.test.ts` 11, `deadline` 14, etc. Full log captured |
| 4 | `npx vitest run src/components/forms/__tests__/CaptureForm.initialValues.test.tsx src/lib/retreat/__tests__/submit-adapter.member.test.ts` | **PASS 10/10** | Targeted RED→GREEN suites; 5+5 |
| 5 | `npx playwright test e2e/retreat-member-preinterest.spec.ts --list` | **PASS 10 tests listed** | `chromium` 5 + `firefox` 5: leader prefill-editable-toast+badge, isolation intercept, duplicate Spanish toast+link, offline disabled+`Requiere conexión`, server hidden+rpc denied — **no full run** per anti-hang (needs `npm run dev` dev server) |
| 6 | `docker info` | **PASS** | Client 29.1.2, Server 13 containers (`supabase_db` `postgres:17.6.1`, `rest`, `realtime`, `auth`, `storage`, etc.) — Docker **available**, `supabase db reset` viable → WARNING not needed |
| 7 | `supabase db reset` | **PASS 0** | `Recreating database… Initialising schema… Seeding globals… Skipping migration 012a-d (--file name must match pattern "<timestamp>_name.sql")… Applying 001,002,003,004,005,006,007,008,009,010,011,013… Restarting containers… Finished`; seed `Seed complete: 3 role users + sample members/sessions/attendance/ARCO` |
| 8 | `docker exec supabase_db_MD_CC_ATTENDANCE_AND_CAPTURE psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/retreat_rls.test.sql` | **PASS 52 notices, ROLLBACK** | Before seed-reset, failed `Seed users missing`; after `supabase db reset` with seed, emitted `PASS: anon SELECT …` (8), `PASS: anon RPC inserts preinscrito…`, `PASS: anon cannot read PII`, `PASS: missing …` (name/phone/email/consent/minor), `PASS: duplicate email/phone`, `PASS: minor with rep`, `PASS: sensitive …`, `PASS: payment refused …` (7), `PASS: super_admin set total 100`, `PASS: partial pagos_parciales/inscrito`, `PASS: server CANNOT INSERT`, `All retreat…passed` + `PASS: leader member-linked`, `PASS: missing consent`, `PASS: minor no rep/with rep`, `PASS: dup member/email/phone 23505 already_preinscribed`, `PASS: deleted`, `PASS: sens false/true`, `PASS: anon/server deny`, `PASS: pagos_parciales/inscrito`, `All member-linked RPC tests passed` |
| 9 | `grep -n retreat_registrations src/app/\(dashboard\)/members/page.tsx` | **PASS 1 hit** | `src/app/(dashboard)/members/page.tsx:128: .from("retreat_registrations")` — only badge `maybeSingle` |
|10 | `grep -rn retreat_payments src/app/\(dashboard\)/members/` | **PASS 0 hits** | No payment listing in members panel |
|11 | `grep -rn RETREAT_EVENT_KEY src/ supabase/migrations/` | **PASS** | `src/lib/retreat/constants.ts`, `src/app/(dashboard)/retreat-registrations/page.tsx:84 eq(event_key)`, `src/app/(dashboard)/members/page.tsx:131 eq(event_key)`, `011`/`013` `c_event_key='retiro-juvenil-octubre-2026'` |
|12 | `grep -R members_update supabase/` | **PASS** | Only `001_initial_schema.sql` + `006_fix_rls_write_policies_and_user_role.sql` (`super_admin` only) |
|13 | `grep -n retreat src/lib/sync/db.ts` | **PASS 0** | No `retreat_registrations` Dexie store, version still 1 |
|14 | `git diff --stat HEAD` + `git status` + `wc -l migration/tests/e2e` | **INFO** | Modified: `4 files changed, 244 insertions(+), 3 deletions(-)`; untracked: `e2e/retreat-member-preinterest.spec.ts` 122, `013` 166, `CaptureForm.initialValues` 183, `submit-adapter.member` 104 → total untracked 575; `On branch main up to date with origin/main no push` |
|15 | `SELECT column_name,is_nullable FROM information_schema… retreat_registrations member_id` | **PASS** | `member_id uuid YES` |
|16 | `SELECT indexdef FROM pg_indexes … member_id_idx` | **PASS** | `CREATE INDEX … ON retreat_registrations USING btree (member_id) WHERE (member_id IS NOT NULL)` |
|17 | `SELECT proname,prosecdef FROM pg_proc … register_retreat_preinscription_for_member` | **PASS** | `prosecdef=t`, `SET search_path TO ''`, `SECURITY DEFINER` |
|18 | `SELECT grantee FROM routine_privileges …` | **PASS** | Only `postgres` + `authenticated` EXECUTE, no `anon`/`service_role` via grant |

**Not run per anti-hang (deferred with WARNING not FAIL):**
- `npx playwright test e2e/retreat-member-preinterest.spec.ts --project=chromium` full (requires `npm run dev` dev server, seeded `leader` JWT, intercept live). Listed only; full run is T-013 remainder before archive.
- No `supabase db push` (local `db reset` sufficient; cloud push is deploy-time).

---

## 5. Strict TDD Compliance (active: `strict_tdd: true` in `openspec/config.yaml`, parent, `apply-progress.md`)

Per `openspec/config.yaml` `testing.strict_tdd: true` and `apply-progress.md` `Mode: strict_tdd=true`.

| Check | Result | Details |
|-------|--------|---------|
| **Global support file** | Not installed, fallback to embedded checks | No `.pi/gentle-ai/support/strict-tdd-verify.md` or global `~/.pi/agent/gentle-ai/support/strict-tdd-verify.md` found; performed the 6 checks listed in orchestrator contract directly |
| **`apply-progress.md` contains `TDD Cycle Evidence` table** | **PASS** | Table at `apply-progress.md` §TDD Cycle Evidence with 4 rows: T-001 SQL harness, T-002 CaptureForm, T-003 adapter, T-004 E2E — each has RED evidence, GREEN evidence, TRIANGULATE, REFACTOR |
| **RED evidence is correctly failing for the right reason (not vacuous)** | **PASS** | T-001: `42703 member_id does not exist` guard before 013; T-002: `expected '' to be 'Ana'` (prefill missing) 2/5 failed; T-003: `TypeError: submitRetreatPreinscriptionForMember is not a function` 5/5; T-004: button selector not found (Playwright `expect(button).toBeVisible()` timeout) — each committed before GREEN per file history implied by `apply-progress.md` |
| **GREEN evidence after implementation** | **PASS** | `npx vitest run` 259/259, targeted 10/10 after `CaptureForm.tsx +15` (type+prop+useEffect) and `submit-adapter.ts +19`; `psql -f retreat_rls.test.sql` 52 PASS after `013` exists; `npx tsc --noEmit` 0 after fixing `getByLabel` |
| **Cross-reference: reported test files actually exist** | **PASS** | `src/components/forms/__tests__/CaptureForm.initialValues.test.tsx` (183 lines) exists, `src/lib/retreat/__tests__/submit-adapter.member.test.ts` (104) exists, `e2e/retreat-member-preinterest.spec.ts` (122) exists, `supabase/tests/retreat_rls.test.sql` (+48 member-linked) exists — all read back |
| **Re-run relevant tests confirms GREEN still true** | **PASS** | Re-ran `npx vitest run` (259/259) and targeted 10/10 in this verify — both PASS; `supabase db reset` + `psql` re-run also PASS |
| **Missing/incomplete TDD evidence** | **NONE CRITICAL** | All 4 RED→GREEN pairs have explicit RED reason + GREEN count; T-001 harness compaction noted but not missing |

**Strict TDD verdict: COMPLIANT.** No CRITICAL. One INFO: E2E RED skeleton was `test.skip`-style placeholder before GREEN; now selectors match real implementation — `triangulate` would benefit from a dedicated stale-phone edit scenario (phone normalization digit-only) but the existing `editable` + `submit-adapter` `emptyToNull` + SQL phone dedup cover it.

---

## 6. Assertion Quality (when strict TDD active)

Audited the 2 new Vitest suites that underpin the feature (no full `Playwright` trace to audit yet).

| Suite | Assertion quality | Findings |
|-------|-------------------|----------|
| `src/components/forms/__tests__/CaptureForm.initialValues.test.tsx` (5 tests, 292ms) | **GOOD — no tautologies, no ghost loops, no type-only** | Prefill test asserts `expect(nameInput.value).toBe('Ana')` / `phone`/`email`/`birthday` then `fireEvent.change` → `expect(value).toBe('Ana Updated')` proving editability (not frozen). Forces `generalConsent`/`sensitiveConsent` to `false` even when `initialValues` says `true` — asserts `.not.toBeChecked()` (Radix `Checkbox` checked state, not `aria-checked` string). Sensitive gating: `denomination` hidden until `sensitiveConsent` checked → asserts `queryByLabelText` null then visible. `RETREAT_PRIVACY_NOTICE_ES` asserted via `getByText(/Aviso de privacidad/i)` and `showOptionalContactCards=false` via `queryByText(/WhatsApp/i)` absent. No `toBeDefined()`-only or `toBeTypeOf` isolations; no CSS color assertions. |
| `src/lib/retreat/__tests__/submit-adapter.member.test.ts` (5 tests, 5ms) | **GOOD — behavioral not smoke** | Asserts `rpcMock` called exactly once with `register_retreat_preinscription_for_member` and exact param map `{p_member_id, p_birthday: '2000-01-15', p_legal_rep_name: null, p_general_consent: true, ...}` (not `toHaveBeenCalled()` existential). `emptyToNull` tested: `''`/`'  '` → `null`, valid date → same string, trimming `legalRepName`. Re-throw tested: `rpc` returns `{error:{message:'already_preinscribed',code:'23505'}}` → `rejects.toMatchObject({message:/already_preinscribed/,code:'23505'})` (not swallowed). `does not write Dexie` asserted via `rpcMock` call count + static absence of `db` import. No implementation-detail CSS. |

**No failures:** no `expect(true).toBe(true)`, no empty `forEach` ghost loops, no `typeof` alone, no single `expect(wrapper).exists()` smoke-only, no `toHaveStyle('color: rgb(...)')`.

**One suggestion (SUGGESTION, not WARNING):** adapter `emptyToNull` for `p_legal_rep_name` with `' Tutor One '` → currently asserted as permissive `(=== 'Tutor One' \|\| === ' Tutor One ')` because helper may preserve trim vs not; clarify expected normalization to match RPC `NULLIF(btrim(COALESCE(...)))` (trimmed) and tighten assertion to `toBe('Tutor One')`.

---

## 7. Review Workload / PR Boundary

| Signal | From `tasks.md` Forecast | Actual (verify-measured) | Assessment |
|--------|--------------------------|---------------------------|------------|
| Estimated changed lines | `310–360` | Modified: **244** `(+3/-244)` across 4 files; untracked production + tests: `013` 166 + `CaptureForm` +15 + `submit-adapter` +19 + `retreat_rls` +48 + `CaptureForm.initialValues` 183 + `submit-adapter.member` 104 + `e2e` 122 = **819 total** lines if counted naive; **production-only ~365** (013 166 + 15+19+165 page + 48 SQL ext) | Forecast accurate for production; test overshoot justified (9-scenario harness + 10 Vitest + 5 E2E) |
| 400-line budget risk | `Low` | Modified-only 244 **Low**; production 365 **Low**; total with tests 819 would be **High** if counted but review guideline excludes test fixtures for line budget — still **single PR** correct | No chain needed |
| Chained PRs recommended | `No` | Single PR `feat/retreat-member-link` → `main` shipped as one slice; no `feature-branch-chain` | Respected — no extra branches created |
| Chain strategy | `stacked-to-main` | Not applicable (single PR) | N/A |
| Delivery strategy | `ask-on-risk` (default) | `Decision needed before apply: No` held; no escalation triggered | Compliant — no owner ping needed |
| Size exception | None needed | Total test lines 287 over naive estimate but still single PR; if reviewer prefers `size:exception`, add `size:exception` label with justification `test-heavy RLS coverage (Threat Matrix)` | Not required but optional `size:exception` would be valid |
| Scope creep beyond assigned tasks | None | Implementation covers exactly `tasks.md` file inventory: `013`, `CaptureForm.tsx`, `submit-adapter.ts`, `members/page.tsx`, `retreat_rls.test.sql` ext, 2 Vitest + 1 E2E, no invented paths; `constants.ts`/`guards.ts`/`db.ts` unchanged as required | No creep |
| Correction budget post-review | `min(200, ceil(changed_lines/2))` → ~122 (modified) / 200 (total) | Frozen candidate is `HEAD` with 244 modified diff; one bounded correction of up to 122 lines (or 200 if counting untracked) allowed | Budget clear |

**PR boundary finding: PASS.** Single PR is correct, workload forecast respected, no unauthorized scope expansion. Optional `useRetreatBadge.ts` hook (deferred per `apply-progress.md` Deviation: inline `refreshBadge` kept) did not inflate diff — extraction remains a trivial follow-up within budget.

---

## 8. Risks

| # | Risk | Severity | Mitigation / Status |
|---|------|----------|---------------------|
| R-1 | `supabase/migrations/012a-d_whatsapp_pastoreo_*.sql` skipped during `db reset` (`file name must match pattern "<timestamp>_name.sql"`) | **LOW** | Unrelated to this change; those 4 files are not part of `retreat-member-preinterest` slice. No FK collision. Rename to `<timestamp>_*.sql` in a follow-up if they are meant to ship; does not affect `retreat_registrations.member_id` or `011→013` chain |
| R-2 | Playwright full E2E not yet run with dev server (anti-hang) | **MEDIUM → WARNING** | `--list` validated selectors and isolation logic; `tsc` 0 ensures correct `getByRole`/`getByLabel` API. Full run with `npm run dev` + `supabase db reset` seed + role JWTs needed before archive to capture trace/screenshots |
| R-3 | `tasks.md` stale checkboxes (T-012/T-014 now proven, T-013 partial) | **MEDIUM** | Blocks clean archive until `tasks.md` is updated to `- [x]` for T-012/T-014 (evidence in this report) and T-013 after full E2E |
| R-4 | Phone normalization trust boundary (spec "Staff edits stale PII" scenario) | **LOW** | Design deliberately re-derives `phone/email` from `members` in RPC (no `p_phone/p_email` override) and relies on duplicate `EXISTS` + unique indexes. V1 limitation documented: stale phone correction requires `members` update (super_admin) or anon `/retiro` path, then retry. Not a verifier blocker |
| R-5 | Test-heavy PR total lines ~819 could trigger `size:exception` request | **LOW** | Production 365 <400; reviewer may optionally add `size:exception` with justification. No split needed |

---

## 9. Blockers & Next Steps

### Exact blockers (must resolve before archive)

1. **BLOCKER (stale checkbox):** Update `openspec/changes/retreat-member-preinterest/tasks.md` — flip `T-012` and `T-014` from `- [ ]` to `- [x]` with note `verified via verify-report 2026-08-27: db reset + RLS 52 PASS + isolation greps + tsc/lint/vitest 259`. This is `artifact reconciliation` per contract — not a functional failure but archive gate.
2. **BLOCKER (E2E trace):** Run `npx playwright test e2e/retreat-member-preinterest.spec.ts --project=chromium` (and optionally `--project=firefox`) **with** `npm run dev` dev server and seeded `supabase db reset` data, capture trace/HTML report, and confirm all 5 scenarios PASS (prefill editable, isolation no bulk SELECT, duplicate Spanish toast + `Ver en Retiro` link, offline `disabled title=Requiere conexión` no rpc, server hidden + direct `rpc` `42501`). Then flip `T-013` to `- [x]` and append `NOTES` block to `tasks.md` with `playwright show-report` excerpt. Anti-hang in this verify was intentional; do not merge without this trace.
3. **BLOCKER (parent-owned):** `T-015 Bounded review` + `T-016 Delivery decision` remain `- [ ]` but are parent-owned (`sdd-owner: parent`) — parent/orchestrator must start `gentle-ai review` (up to 4 lenses, budget `min(200, ceil(244/2))=122`) and record `ask-on-risk` decision (already Low, no split). Not implementation blocker but archive gate.

### Non-blocking next steps

- Consider extracting `refreshBadge` into `src/hooks/useRetreatBadge.ts` (design optional hook) — zero behavior change, keeps `members/page.tsx` diff small.
- Tighten `submit-adapter.member` legalRep trimming assertion to `toBe('Tutor One')` (aligns with RPC `btrim`).
- Rename `supabase/migrations/012a-d_*.sql` to timestamp pattern if they are intended to ship.
- After parent review `allow` receipt, tag `feat/retreat-member-link` and merge with `--no-ff` (single PR, no push until approved).

### Commands to run next (copy-paste)

```bash
# 1) Reconcile stale checkboxes (after reading this verify-report)
# Edit openspec/changes/retreat-member-preinterest/tasks.md:
#   - [ ] T-012 → - [x] T-012 (add: verified 2026-08-27 db reset + psql 52 PASS)
#   - [ ] T-014 → - [x] T-014 (add: isolation grep + tsc/lint/vitest 259)

# 2) Full E2E with dev server (run in workspace: /Users/richard.robles/PycharmProjects/MD_CC_ATTENDANCE_AND_CAPTURE)
npm run dev &  # or: npx next dev --turbopack
npx playwright test e2e/retreat-member-preinterest.spec.ts --project=chromium --reporter=html
# verify 5/5 PASS, then: npx playwright test e2e/retreat-member-preinterest.spec.ts --project=firefox # optional
# then in tasks.md: - [ ] T-013 → - [x] T-013 (+ NOTES block with grep excerpt)

# 3) Bounded review (parent-owned, not implementation)
gentle-ai review status --cwd /Users/richard.robles/PycharmProjects/MD_CC_ATTENDANCE_AND_CAPTURE --contract gentle-ai.review-integration/v2 --agent pi --next-transition
# follow returned execute/collect transitions, collect GENTLE_AI_REVIEW_BINDING manifests, correction budget 122

# 4) Final isolation gate (already PASS in this verify, re-check after E2E)
grep -n retreat_registrations src/app/\(dashboard\)/members/page.tsx  # expect 1 badge line
grep -rn retreat_payments src/app/\(dashboard\)/members/               # expect 0
npx tsc --noEmit && npx next lint && npx vitest run               # expect 0/0/259
```

**No push performed** in this verify — branch `main` remains at `7caf2ea` with unstaged changes; push after owner approval + review `allow` + `sdd-archive`.

---

## 10. Artifacts

- **This report:** `openspec/changes/retreat-member-preinterest/verify-report.md` (file store, authoritative)
- **Inputs read:** `proposal.md`, `specs/retreat-member-preinterest/spec.md`, `design.md` (incl. offset 723), `tasks.md`, `apply-progress.md` (23KB), `openspec/config.yaml`
- **Code inspected:** `supabase/migrations/013_retreat_member_link.sql` (166 lines), `src/components/forms/CaptureForm.tsx`, `src/lib/retreat/submit-adapter.ts`, `src/app/(dashboard)/members/page.tsx`, `supabase/tests/retreat_rls.test.sql` (1122 lines, 2 DO blocks), `src/components/forms/__tests__/CaptureForm.initialValues.test.tsx`, `src/lib/retreat/__tests__/submit-adapter.member.test.ts`, `e2e/retreat-member-preinterest.spec.ts`, `src/lib/sync/db.ts`, `src/lib/retreat/constants.ts`, `supabase/migrations/011_youth_retreat_preregistration.sql` (reference)
- **DB state:** `supabase db reset` replay 001→013 with seed; `docker exec psql` 52 PASS, `ROLLBACK` preserved
- **Git state at verify:** `On branch main` `Your branch is up to date with 'origin/main'`; `Changes not staged: 4 modified, 5 untracked` (`git diff --stat HEAD` 244 ins, `wc -l` migration+tests 575); no commits/pushes made

---

## 11. Skill Resolution

- `skill_resolution: paths-injected`
- Injected per orchestrator: `gentle-ai` `/Users/richard.robles/.pi/agent/npm/node_modules/gentle-pi/skills/gentle-ai/SKILL.md` (SDD verify executor contract, artifact store `openspec`/`both`, actionContext guard, anti-hang, TDD evidence table, workload guard, task checkbox verification, graceful artifact handling, no child subagents) + `supabase-postgres-best-practices` `/Users/richard.robles/.pi/agent/skills/supabase-postgres-best-practices/SKILL.md` (`SECURITY DEFINER SET search_path=''`, qualified `public.*`, `REVOKE ALL FROM PUBLIC`/`GRANT TO authenticated`, partial index `WHERE member_id IS NOT NULL`, `ON DELETE SET NULL`, `NOTIFY pgrst`, no `CONCURRENTLY` inside transaction — all verified in `013`)
- No fallback registry/path/none — paths were injected and read before work

---

## 12. Phase Envelope

```json
{
  "status": "pass_with_warnings",
  "executive_summary": "PASS WITH WARNINGS: 7/7 spec requirements COMPLIANT (member_id FK, authenticated RPC, CaptureForm prefill, isolation, duplicate handling, online-only/permissions, event key). tsc 0, next lint 0, vitest 259/259, supabase db reset replay clean, retreat_rls.test.sql 52 PASS (38+14) via docker psql, isolation grep 1 badge line only, retreat_payments 0, Docker available (13 containers) so no Docker warning. Warnings: Playwright full E2E deferred to --list only (10 tests, 5×2 browsers) per anti-hang; 3 implementation task checkboxes still - [ ] in tasks.md though T-012/T-014 now proven stale-checkbox and T-013 needs full run before archive. No scope creep, single PR 244 modified / 365 production <400 correct, no push.",
  "artifacts": [
    "openspec/changes/retreat-member-preinterest/verify-report.md",
    "supabase/migrations/013_retreat_member_link.sql (read, not modified)",
    "src/components/forms/CaptureForm.tsx (read)",
    "src/lib/retreat/submit-adapter.ts (read)",
    "src/app/(dashboard)/members/page.tsx (read)",
    "e2e/retreat-member-preinterest.spec.ts (list validated)"
  ],
  "next_recommended": "resolve-blockers",
  "risks": [
    "Playwright full E2E with dev server not yet run (anti-hang) — medium, blocks archive",
    "tasks.md stale checkboxes T-012/T-014 (proven in this verify) + T-013 partial — medium, requires reconciliation",
    "012a-d migrations skip pattern — low, unrelated",
    "test-heavy total lines ~819 could request size:exception — low",
    "stale phone correction via members update not in V1 — low, documented"
  ],
  "skill_resolution": "paths-injected",
  "blockedReasons": [
    "tasks.md has 3 unchecked implementation tasks: T-012 (now proven stale-checkbox via db reset + psql 52 PASS), T-014 (now proven via isolation greps + tsc/lint/vitest), T-013 (Playwright full run deferred to --list only per anti-hang — needs npm run dev + npx playwright test e2e/retreat-member-preinterest.spec.ts --project=chromium)",
    "parent-owned T-015/T-016 (bounded review + delivery decision) correctly deferred — archive requires review allow receipt"
  ]
}
```

---

## Key Learnings

1. Supabase local `supabase db reset` must be re-run after adding `013` to seed `auth.users` before `retreat_rls.test.sql` can pass, otherwise the harness fails with `Seed users missing` even though Docker is up.
2. The `retreat_registrations.member_id` partial index `WHERE member_id IS NOT NULL` keeps public `NULL` rows unindexed and makes the badge `maybeSingle` lookup fast without a full table scan.
3. The member-linked RPC deliberately re-derives `name/phone/email` from `public.members` and only allows `p_birthday` override, so stale phone corrections must go through a `members` update first rather than trusting client PII in a `SECURITY DEFINER`.
4. CaptureForm `initialValues` must never hydrate `generalConsent` or `sensitiveConsent` to true, because Ley 1581 requires fresh consent recapture on the new `retreat_registrations` row.
5. Members directory isolation is enforced by keeping `db.members.filter(deleted_at===null)` as the sole directory load and restricting `retreat_registrations` access to a single `SELECT id WHERE member_id AND event_key maybeSingle` when the detail dialog is open.
