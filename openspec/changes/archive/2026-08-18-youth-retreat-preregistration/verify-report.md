```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:87ee7db8dd002cc97f6aa9b2fc841ab8f213498dbc8a0efef88b94e275fefd82
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 18/18
scenarios: 39/39
test_command: npx vitest run
test_exit_code: 0
test_output_hash: sha256:d0129d3677ca3b9ede451cd4277d71fcefd50f08a1009f6b650dd46a264fbaee
build_command: npx tsc --noEmit
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

## Verification Report

**Change**: youth-retreat-preregistration
**Version**: N/A
**Mode**: Strict TDD
**Kind**: Maintainer-authorized verification refresh after covering tests were added. The historical fail report is preserved below; this envelope is the current admitted result.

### Historical fail (preserved)

The previous admitted verify-report remains part of the audit trail and is not erased:

```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:0e043b2464777bed5da9f6dac4f023371df5281e29774942cc549dc04ee8672e
verdict: fail
blockers: 1
critical_findings: 1
requirements: 16/18
scenarios: 36/39
test_command: npx vitest run
test_exit_code: 0
test_output_hash: sha256:1145dd2e15fa46cd26d4bed87a7776efe4d7739af04c308396a3ea43ae060ed2
build_command: npx tsc --noEmit
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

That fail recorded 36/39 COMPLIANT, 3/39 PARTIAL, 0/39 UNTESTED, 0/39 FAILING, plus one CRITICAL Strict TDD blocker (apply-progress had no TDD Cycle Evidence table). Native verification settled against `sha256:0e043b2464777bed5da9f6dac4f023371df5281e29774942cc549dc04ee8672e`. This refresh was authorized after covering tests were added for those previously incomplete scenarios and TDD Cycle Evidence was restored.

Previously PARTIAL (3), now covered by passing runtime tests:
1. Super admin records a subsequent installment — `retreat_rls.test.sql` `PASS: super_admin subsequent installment persists with both payments` (leader 40 + super_admin 20, count 2, sum 60)
2. Leader opens staff retreat page — `e2e/role-enforcement.spec.ts > leader opens staff retreat page without AdminPage` clicks `/retreat-registrations` and asserts heading, consecutive-payment copy, no AdminPage, no cost editor
3. Leader is not forced through AdminPage — `e2e/role-enforcement.spec.ts > leader can load retreat registrations route without AdminPage` `goto /retreat-registrations` and asserts heading, Registrar pago column, no permission-denied copy

Previously CRITICAL (1), now resolved:
1. TDD Cycle Evidence table is present in filesystem `apply-progress.md` and Engram apply-progress #80 (17 task rows).

Authoritative spec counts were re-measured from the two NEW delta specs with heading regex `### Requirement:` and `#### Scenario:`:
- youth-retreat-preregistration: 9 requirements, 20 scenarios
- youth-retreat-payments: 9 requirements, 19 scenarios
- Totals: 18 requirements, 39 scenarios

A requirement is complete only when every scenario under it is COMPLIANT.

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 17 |
| Tasks complete | 17 |
| Tasks incomplete | 0 |
| Requirements complete | 18/18 |
| Scenarios compliant | 39/39 |

OpenSpec `openspec/changes/youth-retreat-preregistration/tasks.md` has every row 1.1 through 4.2 checked. Orchestrator `applyState=all_done`. Engram tasks #79 is stale: 4.1 and 4.2 still show `[ ]` even though filesystem and apply-progress #80 report 17/17.

### Build & Tests Execution
**Build**: Passed
```text
npx tsc --noEmit
exit 0
empty stdout/stderr
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

**Tests**: 158 passed / 0 failed / 0 skipped (18 files)
```text
npx vitest run
exit 0
Test Files  18 passed (18)
Tests  158 passed (158)
In-scope files that passed: submit-adapter.test.ts (5), payments.test.ts (11), CaptureForm.adapter.test.tsx (5), privacy-notice.test.ts (2), app-settings.test.ts (5), guards.test.ts (37 including 3 retreat)
test_output_hash: sha256:d0129d3677ca3b9ede451cd4277d71fcefd50f08a1009f6b650dd46a264fbaee
```

**SQL authenticated RLS**: `{ echo "SET ROLE authenticated;"; cat supabase/tests/rls.test.sql; } | docker exec -i supabase_db_MD_CC_ATTENDANCE_AND_CAPTURE psql -U postgres -d postgres -v ON_ERROR_STOP=1` — exit 0, 8/8 PASS, `All RLS tests passed`. output_hash: sha256:e44820993f8606db96124f03350714f1c8a46c3661c17aa203a8eb528c548c04

**SQL retreat owner**: `docker exec -i supabase_db_MD_CC_ATTENDANCE_AND_CAPTURE psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/retreat_rls.test.sql` — exit 0, 38 PASS notices, `All retreat RLS/RPC/status tests passed`. output_hash: sha256:add38dffb0a97620ab0ed3e8efb1ef3d866afc4852808c8fef3a25f97b2e1b43

**In-scope Playwright**: `npx playwright test e2e/retiro.spec.ts e2e/role-enforcement.spec.ts --project=chromium` — exit 0, 9 passed / 1 skipped (legacy `/rest/v1` DELETE; Next has no PostgREST proxy). output_hash: sha256:fd4e22f84eeecd6cdbb903aa340fe9f48e48a7caa2a81d3c2b365f0a90e4b031

**Lint**: `npx next lint` exit 0 — No ESLint warnings or errors. Next.js printed a workspace-root lockfile inference warning; that is not an ESLint finding. output_hash: sha256:da253038afbae7366cad7bbf019fe86b724b03ec9575fca5601315c8d41c17bb

**Coverage**: Not available / threshold: 0 → skipped. `vitest.config.ts` has no coverage reporter. Coverage analysis skipped — no coverage tool detected.

**Cross-slice 4.1 static**: `/capture` still renders `<CaptureForm />` with no adapter. No `retreat_*` in `src/lib/sync`. Dexie stores and realtime hydrate unions are unchanged.

evidence_revision is SHA-256 of concatenated tsc + vitest + lint + rls + retreat_rls + playwright exact outputs.

### Spec Compliance Matrix

#### youth-retreat-preregistration (9 requirements, 20 scenarios)

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Public Retreat Form | Unauthenticated load of /retiro | `e2e/retiro.spec.ts > unauthenticated GET /retiro shows the Spanish retreat form` | COMPLIANT |
| Public Retreat Form | Spanish retreat copy and privacy notice | `e2e/retiro.spec.ts` plus `privacy-notice.test.ts` plus `CaptureForm.adapter.test.tsx > hides WhatsApp and social cards and uses retreat copy` | COMPLIANT |
| General Consent Required | Submit without general consent is rejected | `retreat_rls.test.sql > PASS: missing general consent rejected` and no rejected-email row | COMPLIANT |
| General Consent Required | Submit with general consent may proceed | `retreat_rls.test.sql > PASS: anon RPC inserts preinscrito with consent on the row` | COMPLIANT |
| RPC Pre-registration Persistence | Successful RPC creates preinscrito with consent on the row | `retreat_rls.test.sql` asserts status `preinscrito`, consent timestamp, policy `pdtp-v1.0-2026-07-17` | COMPLIANT |
| RPC Pre-registration Persistence | Successful submit does not insert members | `retreat_rls.test.sql` members and consent_records counts unchanged | COMPLIANT |
| RPC Pre-registration Persistence | Public submit does not write Dexie or enqueue | `submit-adapter.test.ts > never imports or calls Dexie members.add or enqueue` plus `CaptureForm.adapter.test.tsx > calls submitAdapter ... skips Dexie` | COMPLIANT |
| Authenticated Capture Adapter Unchanged | /capture still uses Dexie and enqueue | `CaptureForm.adapter.test.tsx > uses Dexie and enqueue when no submitAdapter is provided`; `/capture` page renders `<CaptureForm />` | COMPLIANT |
| Authenticated Capture Adapter Unchanged | /capture does not call the retreat RPC | `CaptureForm.adapter.test.tsx` `rpcMock` not called on default path | COMPLIANT |
| Minor Legal Representative | Minor without legal representative is rejected | `retreat_rls.test.sql > PASS: minor without legal representative rejected` | COMPLIANT |
| Minor Legal Representative | Minor with legal representative is accepted | `retreat_rls.test.sql > PASS: minor with legal representative persisted` | COMPLIANT |
| Sensitive Religious Data Consent | Sensitive fields stored with sensitive consent | `retreat_rls.test.sql > PASS: sensitive fields stored with sensitive consent` | COMPLIANT |
| Sensitive Religious Data Consent | Sensitive fields omitted without sensitive consent | `retreat_rls.test.sql > PASS: sensitive fields NULL without sensitive consent` | COMPLIANT |
| Anonymous PostgREST Isolation | Anon SELECT on retreat tables is denied | `retreat_rls.test.sql > PASS: anon SELECT on retreat_registrations denied` and payments equivalent | COMPLIANT |
| Anonymous PostgREST Isolation | Anon direct DML on retreat tables is denied | `retreat_rls.test.sql` anon INSERT/UPDATE/DELETE denied on both tables | COMPLIANT |
| Anonymous PostgREST Isolation | Anon RPC execute is allowed for insert | `retreat_rls.test.sql` RPC insert plus `PASS: anon table INSERT still denied` | COMPLIANT |
| Duplicate Contact Uniqueness | Duplicate email for the same event is rejected | `retreat_rls.test.sql > PASS: duplicate email rejected` and exactly one `ana@example.com` row | COMPLIANT |
| Duplicate Contact Uniqueness | Duplicate phone for the same event is rejected | `retreat_rls.test.sql > PASS: duplicate phone rejected` | COMPLIANT |
| Required Identity Fields | Missing name is rejected | `retreat_rls.test.sql > PASS: missing name rejected` plus CaptureForm client required-name | COMPLIANT |
| Required Identity Fields | Missing phone or email is rejected | `retreat_rls.test.sql > PASS: missing phone rejected` and `missing email rejected` | COMPLIANT |

#### youth-retreat-payments (9 requirements, 19 scenarios)

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Configured Positive Total Required | Payment refused when total is unset | `retreat_rls.test.sql > PASS: payment refused when total is empty` and `when total key is missing` | COMPLIANT |
| Configured Positive Total Required | Payment refused when total is not positive | `retreat_rls.test.sql > PASS: payment refused when total is 0` and `when total is negative` | COMPLIANT |
| Super Admin Sets Total Cost | Super admin sets a positive total | `retreat_rls.test.sql > PASS: super_admin set retreat.youth.total_cost to 100` | COMPLIANT |
| Super Admin Sets Total Cost | Leader cannot set total cost | `retreat_rls.test.sql > PASS: leader cannot set retreat.youth.total_cost` and stored value remains `100` | COMPLIANT |
| Staff List and Consecutive Payments | Leader lists registrations and records an installment | `retreat_rls.test.sql` leader INSERT `40` then status `pagos_parciales`; e2e leader sees Retiro nav and staff list | COMPLIANT |
| Staff List and Consecutive Payments | Super admin records a subsequent installment | `retreat_rls.test.sql > PASS: super_admin subsequent installment persists with both payments` leader 40 then super_admin 20; count 2; sum 60; status `pagos_parciales` | COMPLIANT |
| Server Role Denied Staff Payments | Server cannot insert payments | `retreat_rls.test.sql > PASS: server CANNOT INSERT retreat_payments` | COMPLIANT |
| Server Role Denied Staff Payments | Server cannot open the staff page | `e2e/role-enforcement.spec.ts > server cannot see retreat registrations route` | COMPLIANT |
| Payment Status Machine | Zero sum stays preinscrito | `retreat_rls.test.sql > PASS: zero sum stays preinscrito` | COMPLIANT |
| Payment Status Machine | Partial sum becomes pagos_parciales | `retreat_rls.test.sql > PASS: partial sum becomes pagos_parciales` | COMPLIANT |
| Payment Status Machine | Covered sum becomes inscrito without members insert | `retreat_rls.test.sql > PASS: covered sum becomes inscrito without members insert` | COMPLIANT |
| Overpayment Allowed | Overpayment is accepted and marked inscrito | `retreat_rls.test.sql > PASS: overpayment accepted and marked inscrito` | COMPLIANT |
| Overpayment Allowed | Exact total is also inscrito | `retreat_rls.test.sql` `40+60=100` status `inscrito` | COMPLIANT |
| Positive Payment Amount | Negative payment is rejected | `retreat_rls.test.sql > PASS: negative payment amount refused` status stays `preinscrito` | COMPLIANT |
| Positive Payment Amount | Zero payment is rejected | `retreat_rls.test.sql > PASS: payment amount 0 refused` | COMPLIANT |
| Staff Page Without AdminPage | Leader opens staff retreat page | `e2e/role-enforcement.spec.ts > leader opens staff retreat page without AdminPage` clicks nav, heading, consecutive-payment copy, no `/admin`, no cost editor | COMPLIANT |
| Staff Page Without AdminPage | Leader is not forced through AdminPage | `e2e/role-enforcement.spec.ts > leader can load retreat registrations route without AdminPage` `goto /retreat-registrations`, heading, Registrar pago column, no permission-denied copy | COMPLIANT |
| Anonymous Payment Isolation | Anon cannot insert payments | `retreat_rls.test.sql > PASS: anon INSERT on retreat_payments denied` | COMPLIANT |
| Anonymous Payment Isolation | Public form does not collect money | `e2e/retiro.spec.ts` amount/pago labels count 0 plus adapter omits money args | COMPLIANT |

**Compliance summary**: 39/39 scenarios COMPLIANT, 0/39 PARTIAL, 0/39 UNTESTED, 0/39 FAILING

Complete requirements (every scenario COMPLIANT): 18/18.

### Correctness (Static Evidence)
| Requirement | Status | Notes |
|------------|--------|-------|
| Public Retreat Form | Implemented | `src/app/retiro/page.tsx` is outside `(dashboard)`; Spanish heading and `CaptureForm variant="retreat"` |
| General Consent Required | Implemented | Client `validateGeneralConsent` plus RPC reject without consent |
| RPC Pre-registration Persistence | Implemented | `submitRetreatPreinscription` calls `register_retreat_preinscription` only |
| Authenticated Capture Adapter Unchanged | Implemented | `/capture` uses `<CaptureForm />` with default Dexie+enqueue |
| Minor Legal Representative | Implemented | Client minor validators plus RPC legal-rep check |
| Sensitive Religious Data Consent | Implemented | RPC stores denomination/community iff sensitive consent, else NULL |
| Anonymous PostgREST Isolation | Implemented | RLS enabled, no anon policies, REVOKE, RPC EXECUTE for anon |
| Duplicate Contact Uniqueness | Implemented | Unique `(event_key, lower(btrim(email)))` and digit-normalized phone |
| Required Identity Fields | Implemented | Client required name/phone/email plus RPC re-check |
| Configured Positive Total Required | Implemented | Seed `''`; trigger refuses missing/empty/non-numeric/`<=0` |
| Super Admin Sets Total Cost | Implemented | Cost editor gated by `canManageUsers`; SQL RLS refuses leader update |
| Staff List and Consecutive Payments | Implemented | Staff page lists registrations and INSERTs payments; status from trigger; super_admin subsequent INSERT covered |
| Server Role Denied Staff Payments | Implemented | `canManageRetreatRegistrations` false for server; SQL INSERT denied |
| Payment Status Machine | Implemented | AFTER INSERT `0→preinscrito`, partial `pagos_parciales`, `sum>=total→inscrito` |
| Overpayment Allowed | Implemented | Overpay `80+50` accepted as `inscrito` |
| Positive Payment Amount | Implemented | CHECK/trigger amount `>0` |
| Staff Page Without AdminPage | Implemented | Dedicated `retreat-registrations/page.tsx`; nav via `canManageRetreatRegistrations`; not AdminPage |
| Anonymous Payment Isolation | Implemented | Anon payment DML denied; public form has no money fields |

Implementation matches the specs for all 18 requirements. Previously incomplete actor/page scenarios now have passing covering tests.

### Coherence (Design)
| Decision | Followed? | Notes |
|----------|-----------|-------|
| AD-PublicRoute | Yes | `/retiro` outside dashboard; no login redirect in e2e |
| AD-CaptureFormAdapter | Yes | Optional `variant` default `member`; `/retiro` passes RPC adapter |
| AD-Validation | Yes | Client plus RPC re-check; no row on fail |
| AD-RpcInsert | Yes | SECURITY DEFINER RPC, consent on row, no members |
| AD-SensitiveFields | Yes | Store TEXT iff sensitive consent else NULL |
| AD-AnonIsolation | Yes | REVOKE + no anon policies; auth SELECT/INSERT as designed |
| AD-Uniqueness | Yes | Normalized unique indexes; other event_key allows same email |
| AD-EventKey | Yes | Constant `retiro-juvenil-octubre-2026`; RPC ignores client key |
| AD-MoneyAndTotal | Yes | `numeric(12,2)`; seed empty string; no invented default |
| AD-StatusTrigger | Yes | Trigger owns status; overpay OK; no members insert |
| AD-StaffRbac | Yes | Dedicated staff page; nav `canManageRetreatRegistrations`; cost `canManageUsers` |
| AD-NoRealtimeHydration | Yes | No `retreat_*` in Dexie, hydrate union, or RealtimeManager |
| AD-Migration011 | Yes | `011_youth_retreat_preregistration.sql` present |

Design said modify `rls.test.sql`; tasks 1.1 moved anon/RPC/status cases to owner-run `retreat_rls.test.sql`. That matches tasks, not the design file-change bullet.

### TDD Compliance
| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | Found | Filesystem `apply-progress.md` and Engram #80 include a full TDD Cycle Evidence table with 17 task rows |
| All tasks have tests | 15/15 implementation tasks | 1.1–3.4 have SQL/Vitest/Playwright files; 4.1–4.2 are verification tasks |
| RED confirmed (tests exist) | 9/9 in-scope test files verified | `retreat_rls.test.sql`, `submit-adapter.test.ts`, `CaptureForm.adapter.test.tsx`, `payments.test.ts`, `privacy-notice.test.ts`, `app-settings.test.ts`, `guards.test.ts`, `e2e/retiro.spec.ts`, `e2e/role-enforcement.spec.ts` |
| GREEN confirmed (tests pass) | 9/9 pass on this run | Vitest 158/158, SQL 8/8 plus 38 retreat PASS, Playwright 9 passed / 1 skipped |
| Triangulation adequate | Adequate | RPC/status/uniqueness/consent triangulated in SQL; staff-page leader load covered by click-nav and goto tests; super_admin subsequent INSERT is 40+20 |
| Safety Net for modified files | Partial | CaptureForm/layout/guards recorded baselines. `privacy-notice.ts` and `app-settings.ts` were modified but tasks 2.5/3.2 show N/A (new) |

**TDD Compliance**: 5/6 checks passed (safety net warning on two modified existing files)

---

### Test Layer Distribution
| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | 26 in-scope (5+11+5+2+3 retreat guards) | 5 | vitest |
| Integration | 5 component + 38 SQL PASS + 8 RLS PASS | 1 tsx + 2 sql | vitest testing-library; docker psql |
| E2E | 7 retreat-related of 9 passed / 1 skipped | 2 | playwright chromium |
| **Total in-scope authored** | **Vitest 31 new/changed-file tests; SQL 46 PASS notices; e2e 9 passed** | **9** | |

Vitest full suite is 158 tests across 18 files.

---

### Changed File Coverage
Coverage analysis skipped — no coverage tool detected in `vitest.config.ts`.

---

### Assertion Quality
| File | Line | Assertion | Issue | Severity |
|------|------|-----------|-------|----------|
| `src/lib/retreat/__tests__/payments.test.ts` | 87–103 | `expect(source).toContain('canManageRetreatRegistrations')` | Source-string coupling for staff page/nav; e2e now covers page load | WARNING |
| `src/lib/retreat/__tests__/submit-adapter.test.ts` | 113–117 | `expect(source).not.toMatch(/db\.members\.add/)` | Source-scan companion; runtime `membersAddMock`/`enqueueMock` not called is the behavioral proof | WARNING |

**Assertion quality**: 0 CRITICAL, 2 WARNING. Remaining in-scope assertions verify RPC args, SQL PASS/FAIL, consent copy, Dexie/enqueue behavior, and e2e visibility.

---

### Quality Metrics
**Linter**: No errors (`npx next lint` exit 0)
**Type Checker**: No errors (`npx tsc --noEmit` exit 0)

### Issues Found
**CRITICAL**: None

**WARNING**:
1. Engram tasks #79 still shows 4.1–4.2 unchecked while OpenSpec `tasks.md` is 17/17.
2. Coverage tool not configured; changed-file coverage was not measured.
3. Design bullet said modify `rls.test.sql`; implementation added `retreat_rls.test.sql` per tasks 1.1.
4. Assertion quality: two source-inspection companions for staff page/adapter isolation.
5. Playwright skip remains for legacy `/rest/v1` DELETE.
6. Tasks 2.5 and 3.2 mark Safety Net N/A (new) even though `privacy-notice.ts` and `app-settings.ts` were modified existing files.

**SUGGESTION**:
1. Upsert Engram tasks so 4.1–4.2 match filesystem `[x]`.
2. Silence the Next.js multiple-lockfile workspace-root warning if lint logs should stay clean.

### Verdict
PASS WITH WARNINGS
Build and declared Vitest are green (158/158, tsc 0). SQL (8/8 + 38 retreat PASS) and Playwright (9 passed / 1 skipped) harnesses also passed. 39/39 scenarios are COMPLIANT. Strict TDD Cycle Evidence is present. Remaining items are warnings only; archive is allowed after this admitted refresh.
