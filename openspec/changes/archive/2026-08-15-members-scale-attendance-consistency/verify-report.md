```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:06570f27b3e752af7ef70862be8c1e1a837df20f9258191649e3bba5ee37c9e3
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 17/17
scenarios: 30/30
test_command: npx vitest run
test_exit_code: 0
test_output_hash: sha256:9a5bec3e96699671fecf1e391ec366e4cbb52c17fad2d27d2ae270194c7420ae
build_command: npx tsc --noEmit
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

## Verification Report

**Change**: members-scale-attendance-consistency
**Version**: N/A
**Mode**: Strict TDD
**Kind**: Maintainer-authorized verification refresh after covering tests were added. The historical fail report is preserved below; this envelope is the current admitted result.

### Historical fail (preserved)

The previous admitted verify-report remains part of the audit trail and is not erased:

```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:1b0fea79652d208f1870f513e113dbcd79612f7d53b1b24ad5456d3b375a6ba8
verdict: fail
blockers: 7
critical_findings: 7
requirements: 7/17
scenarios: 18/30
test_command: npx vitest run
test_exit_code: 0
test_output_hash: sha256:3f2582f0be858ffbb7284ca375e8448a314bed30c4b99ffcd4caba569358f5a3
build_command: npx tsc --noEmit
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

That fail recorded 18/30 COMPLIANT, 5/30 PARTIAL, and 7/30 UNTESTED. Native attempt ordinal 8 settled against `sha256:1b0fea79652d208f1870f513e113dbcd79612f7d53b1b24ad5456d3b375a6ba8`. This refresh was authorized after covering tests were added for those previously incomplete scenarios. Vitest grew from 115 passing tests to 127 passing tests (13 files).

Previously UNTESTED (7), now covered by passing component tests:
1. Denominator stays constant during search
2. Input remains responsive during rapid typing
3. Memoized filter avoids unnecessary recomputation
4. No members in system
5. Pagination resets on new search
6. Session switch resets visible count
7. Search change resets pagination

Previously PARTIAL (5), now covered by passing tests:
1. Denominator excludes soft-deleted members
2. Non-super_admin roles see consistent data
3. super_admin and leader see same counter
4. Soft-deleted member excluded from search results
5. Counter shows total even when partially loaded

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 30 |
| Tasks complete | 30 |
| Tasks incomplete | 0 |
| Requirements complete | 17/17 |
| Scenarios compliant | 30/30 |

OpenSpec `tasks.md` has every row 1.1 through 5.5 checked. Native status reports `taskProgress=30/30`, `applyState=all_done`. Engram tasks #63 agrees all 30 tasks are complete. `reviewGate` is absent.

Authoritative spec counts were re-measured from the three delta specs with heading regex `### Requirement:` and `#### Scenario:`:
- attendance-counter-consistency: 5 requirements, 10 scenarios
- attendance-grid-search: 6 requirements, 11 scenarios
- attendance-grid-pagination: 6 requirements, 9 scenarios
- Totals: 17 requirements, 30 scenarios

A requirement is complete only when every scenario under it is COMPLIANT.

### Build & Tests Execution
**Build**: Passed
```text
npx tsc --noEmit
exit 0
empty stdout/stderr
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

**Tests**: 127 passed / 0 failed / 0 skipped (13 files)
```text
npx vitest run
exit 0
Test Files  13 passed (13)
Tests  127 passed (127)
In-scope files that passed: count.test.ts (3), orphans.test.ts (3), filter.test.ts (5), paginate.test.ts (3), AttendanceGrid.consistency.test.tsx (13)
test_output_hash: sha256:9a5bec3e96699671fecf1e391ec366e4cbb52c17fad2d27d2ae270194c7420ae
```

**In-scope runtime harness**: `npx playwright test e2e/attendance.spec.ts` — cited parent evidence: 12 passed. This verify phase did not re-run Playwright.

**Out-of-scope full Playwright**: parent already ran `npx playwright test` — 16 passed / 14 failed in `e2e/export.spec.ts`, `e2e/offline-sync.spec.ts`, and `e2e/role-enforcement.spec.ts`. Those files are outside this change rollback boundary. Recorded as WARNING only; they do not set the envelope test_exit_code.

**Lint**: `npx next lint` exit 0 — No ESLint warnings or errors. Next.js printed a workspace-root lockfile inference warning; that is not an ESLint finding.

**Coverage**: Not available / threshold: 0 → skipped. `vitest.config.ts` has no coverage reporter. Coverage analysis skipped — no coverage tool detected.

### Spec Compliance Matrix

#### attendance-counter-consistency (5 requirements, 10 scenarios)

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Counter Numerator Derivation | Counter matches checked rows for super_admin with soft-deleted members | `count.test.ts > excludes attendance for members not in filteredMembers` plus `orphans.test.ts > drops records for non-existent members` | COMPLIANT |
| Counter Numerator Derivation | Counter updates when attendance is toggled | `e2e/attendance.spec.ts > counter matches checkbox state after toggle` (parent 12 passed) plus `count.test.ts > counts only members with attendance` | COMPLIANT |
| Counter Numerator Derivation | Counter updates when attendance is unchecked | `e2e/attendance.spec.ts > counter matches checkbox state after toggle` (delta -1 when already checked) | COMPLIANT |
| Counter Denominator Derivation | Denominator stays constant during search | `AttendanceGrid.consistency.test.tsx > denominator stays constant during search` asserts `1 / 10 presentes` while only Member 01 renders | COMPLIANT |
| Counter Denominator Derivation | Denominator excludes soft-deleted members | `AttendanceGrid.consistency.test.tsx > denominator excludes soft-deleted members` asserts `1 / 10 presentes` and Deleted User is absent | COMPLIANT |
| Orphaned Attendance Exclusion | Orphaned attendance record is excluded for super_admin | `orphans.test.ts > drops records for non-existent members` | COMPLIANT |
| Orphaned Attendance Exclusion | Non-super_admin roles see consistent data | `orphans.test.ts > is role-agnostic for leader and super_admin` plus default-leader grid render | COMPLIANT |
| Realtime and Hydration Consistency | Hydration refresh preserves counter accuracy | `AttendanceGrid.consistency.test.tsx > counter updates after hydration refreshes both members and attendance` | COMPLIANT |
| Realtime and Hydration Consistency | Realtime attendance insert updates counter | `AttendanceGrid.consistency.test.tsx > realtime attendance INSERT updates counter from 2/10 to 3/10` | COMPLIANT |
| Role-Independent Counter Behavior | super_admin and leader see same counter | `AttendanceGrid.consistency.test.tsx > super_admin and leader see the same counter` asserts `2 / 10 presentes` for both roles | COMPLIANT |

#### attendance-grid-search (6 requirements, 11 scenarios)

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Search Field Matching | Search by name (case-insensitive) | `filter.test.ts > matches by name case-insensitive` | COMPLIANT |
| Search Field Matching | Search by phone (substring match) | `filter.test.ts > matches by phone substring` | COMPLIANT |
| Search Field Matching | Search by email (case-insensitive) | `filter.test.ts > matches by email case-insensitive` | COMPLIANT |
| Search Field Matching | Search matches across different fields | `filter.test.ts > matches across phone and email fields` | COMPLIANT |
| Debounced Search Deferral | Input remains responsive during rapid typing | `AttendanceGrid.consistency.test.tsx > input remains responsive during rapid typing` asserts input value a/ab/abc immediately | COMPLIANT |
| Debounced Search Deferral | Memoized filter avoids unnecessary recomputation | `AttendanceGrid.consistency.test.tsx > memoized filter avoids unnecessary recomputation` asserts filterBySearch call count unchanged after Nueva sesión toggle | COMPLIANT |
| Search Scope | Soft-deleted member excluded from search results | `AttendanceGrid.consistency.test.tsx > soft-deleted member is excluded from search results` | COMPLIANT |
| Empty State Distinction | No search results | `e2e/attendance.spec.ts > shows the no-results empty state for an unmatched search` | COMPLIANT |
| Empty State Distinction | No members in system | `AttendanceGrid.consistency.test.tsx > shows empty-registry copy when no members exist` asserts `No hay miembros registrados` | COMPLIANT |
| Search Resets Pagination | Pagination resets on new search | `AttendanceGrid.consistency.test.tsx > pagination resets on new search` | COMPLIANT |
| Offline Search Capability | Search works offline | `filter.test.ts` exercises the pure Dexie-side matcher with no network | COMPLIANT |

#### attendance-grid-pagination (6 requirements, 9 scenarios)

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Page Size Constant | Initial load renders 50 members | `paginate.test.ts > returns the first PAGE_SIZE members` plus e2e `Cargar más loads the next 50 members` starting at 50 rows | COMPLIANT |
| Page Size Constant | Fewer than 50 members renders all | `paginate.test.ts > returns all members when fewer than PAGE_SIZE exist` | COMPLIANT |
| Load More Button | Load more appends next chunk | `e2e/attendance.spec.ts > Cargar más loads the next 50 members` (50 to 100) | COMPLIANT |
| Load More Button | Load more near end of list | `paginate.test.ts > returns members when visibleCount is greater than the member list length` | COMPLIANT |
| Load More Button | Load more when all members visible | `e2e/attendance.spec.ts > Cargar más is hidden when all members are loaded` | COMPLIANT |
| Pagination Reset on Session Change | Session switch resets visible count | `AttendanceGrid.consistency.test.tsx > session switch resets visible count` | COMPLIANT |
| Pagination Reset on Search Change | Search change resets pagination | `AttendanceGrid.consistency.test.tsx > search change resets pagination` | COMPLIANT |
| Counter Unaffected by Pagination | Counter shows total even when partially loaded | `AttendanceGrid.consistency.test.tsx > counter shows total even when partially loaded` asserts `10 / 60 presentes` with 50 checkboxes | COMPLIANT |
| Offline Pagination | Load more works offline | `paginate.test.ts` slices a local array with no network | COMPLIANT |

**Compliance summary**: 30/30 scenarios COMPLIANT, 0/30 PARTIAL, 0/30 UNTESTED

Complete requirements (every scenario COMPLIANT): all 17.

### Correctness (Static Evidence)
| Requirement | Status | Notes |
|------------|--------|-------|
| Counter Numerator Derivation | Implemented | `markedCount = countPresent(filteredMembers, attendanceMap)`; `Object.keys(attendanceMap).length` is gone |
| Counter Denominator Derivation | Implemented | Badge uses `members.length` (active set), not filtered or visible length |
| Orphaned Attendance Exclusion | Implemented | `excludeOrphanedAttendance` inside `loadAttendance`; function has no role parameter |
| Realtime and Hydration Consistency | Implemented | `useCacheHydration` calls both loaders; attendance `useRealtime` `onInsert` calls `loadAttendance` |
| Role-Independent Counter Behavior | Implemented | Counter path has no role branch; dual-role component test asserts identical badge |
| Search Field Matching | Implemented | `filterBySearch` matches name, phone, email case-insensitive substring |
| Debounced Search Deferral | Implemented | `useDeferredValue(search)` plus `useMemo` keyed on `[members, deferredSearch]` |
| Search Scope | Implemented | `loadMembers` keeps `deleted_at === null` only; deleted fixture is excluded from search |
| Empty State Distinction | Implemented | Distinct Spanish copy gated by `deferredSearch.trim()`; empty-registry copy now asserted |
| Search Resets Pagination | Implemented | `useEffect` resets `visibleCount` to `PAGE_SIZE` on `deferredSearch` |
| Offline Search Capability | Implemented | Pure function over in-memory members |
| Page Size Constant | Implemented | `PAGE_SIZE = 50`, not user-configurable |
| Load More Button | Implemented | `Cargar más` when `filteredMembers.length > visibleCount`; increment by 50 |
| Pagination Reset on Session Change | Implemented | Same reset effect depends on `selectedSessionId` |
| Pagination Reset on Search Change | Implemented | Same reset effect depends on `deferredSearch` |
| Counter Unaffected by Pagination | Implemented | Numerator from `filteredMembers`, denominator from `members.length` |
| Offline Pagination | Implemented | `paginateMembers` is `slice(0, visibleCount)` |

Implementation matches the specs. Previously missing covering tests now pass at runtime.

### Coherence (Design)
| Decision | Followed? | Notes |
|----------|-----------|-------|
| Orphan filter inside loadAttendance | Yes | `excludeOrphanedAttendance` runs before `setAttendanceMap` |
| Client-side slice vs server-side keyset | Yes | `paginateMembers` slices Dexie results; no schema change |
| Pure function extraction into src/lib/attendance/ | Yes | count, orphans, filter, paginate, barrel index |
| Realtime and hydration coordinated via React batching | Yes | Independent `loadMembers` + `loadAttendance`; component tests prove both loaders |

No production design deviation.

### TDD Compliance
| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | Found | apply-progress.md has S1–S4 TDD Cycle Evidence tables; Engram apply-progress #64 |
| All tasks have tests | 26/26 implementation tasks | Commit and Phase 5 verification tasks are not production units; S1–S4 test files exist |
| RED confirmed (tests exist) | 6/6 test files verified | count, orphans, filter, paginate, consistency, e2e/attendance.spec.ts |
| GREEN confirmed (tests pass) | 5/5 Vitest files pass on this run; e2e cited parent 12 passed | 127/127 Vitest green |
| Triangulation adequate | Yes | S1 6 cases (orphans now 3), S2 5 cases, S3 3 unit plus 4 e2e, S4 consistency file now 13 cases covering the prior UNTESTED/PARTIAL gaps |
| Safety Net for modified files | Documented | S1–S3 recorded baseline suites before AttendanceGrid edits; S4 test file is new; refresh tests were added after the fail report |

**TDD Compliance**: 6/6 checks passed for recorded apply evidence. Covering tests added after the historical fail are present and green on this run; apply-progress TDD tables still describe the original 2 consistency tests and were not rewritten for the refresh.

### Test Layer Distribution
| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | 14 | 4 | vitest |
| Integration | 13 | 1 | vitest plus testing-library (jsdom) |
| E2E | 6 authored / 12 browser runs | 1 | playwright (parent evidence) |
| **Total** | **33 in-scope authored** | **6** | |

Vitest full suite is 127 tests across 13 files; 27 of those tests are this change's unit plus component files.

### Changed File Coverage
Coverage analysis skipped — no coverage tool detected in `vitest.config.ts`.

### Assertion Quality
| File | Line | Assertion | Issue | Severity |
|------|------|-----------|-------|----------|
| `AttendanceGrid.consistency.test.tsx` | 239 | `expect(harness.filterCalls).toBe(callsAfterLoad)` | Mock call-count assertion for memo hit | WARNING |
| `orphans.test.ts` | 32 | `expect(excludeOrphanedAttendance(...)).toEqual(...)` | Role-agnostic case does not pass a role and is a near-duplicate of the drop-orphans case; dual-role behavior is covered by the component test | WARNING |

**Assertion quality**: 0 CRITICAL, 2 WARNING. Remaining in-scope assertions verify real behavior (badge text, visible row counts, empty-state copy, input values).

### Quality Metrics
**Linter**: No errors (`npx next lint` exit 0)
**Type Checker**: No errors (`npx tsc --noEmit` exit 0)

### Issues Found
**CRITICAL**: None

**WARNING**:
1. Full Playwright suite 16 passed / 14 failed in pre-existing out-of-scope files (`e2e/export.spec.ts`, `e2e/offline-sync.spec.ts`, `e2e/role-enforcement.spec.ts`) using stale `/login` helpers and unrelated UI contracts. Not part of this change rollback boundary.
2. Attendance E2E was not re-run in this verify process; COMPLIANT e2e cells rely on parent evidence of 12 passed.
3. apply-progress.md still contains stale later sections that list commit/Phase 5 tasks unchecked; the parent-owned header and OpenSpec `tasks.md` are 30/30.
4. Coverage tool not configured; changed-file coverage was not measured.
5. Assertion quality: memo coverage uses a `filterBySearch` call-count spy; the orphans role-agnostic test does not take a role argument.

**SUGGESTION**:
1. Record the post-fail covering tests in apply-progress TDD tables so the refresh is visible in the apply audit trail.
2. Silence the Next.js multiple-lockfile workspace-root warning in `next.config` if lint logs should stay clean.

### Verdict
PASS WITH WARNINGS
30/30 scenarios are COMPLIANT with passing covering tests. The seven previously UNTESTED scenarios and five previously PARTIAL scenarios now have green runtime evidence. Authoritative Vitest (127/127) and tsc passed. Remaining warnings are out-of-scope Playwright failures, unre-run in-scope E2E citation, stale apply-progress prose, missing coverage tooling, and two assertion-quality notes. Archive may proceed from verification evidence; reviewGate is absent.
