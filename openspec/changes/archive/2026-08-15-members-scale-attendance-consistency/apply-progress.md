# Apply Progress: Members Scale & Attendance Consistency

## Work-unit status

- Change: `members-scale-attendance-consistency`
- Parent session completed remaining lifecycle after S4 apply: commits 1.8/2.6/3.7/4.4, Phase 5 verification, and four stacked-to-main PRs.
- All 30 tasks are checked. S1–S4 implementation evidence below is preserved.

## Parent-owned delivery (2026-08-15)

Stacked commits on `test/attendance-hydration-realtime`:

```text
ca07219 test(attendance): add hydration and realtime component-level consistency tests
d961497 feat(attendance): add load-more pagination with PAGE_SIZE=50
7b3b4e4 feat(attendance): add debounced client-side search across name, phone, email
82ebdd7 fix(attendance): correct counter and exclude orphaned attendance records
```

Stacked PRs:

| PR | Slice | URL | Base |
|---|---|---|---|
| 1 / S1 | Counter + orphans | https://github.com/rrobles9112/md-cc-attendance-and-capture/pull/74 | `main` |
| 2 / S2 | Debounced search | https://github.com/rrobles9112/md-cc-attendance-and-capture/pull/75 | `fix/attendance-counter-orphans` |
| 3 / S3 | Load-more + attendance E2E | https://github.com/rrobles9112/md-cc-attendance-and-capture/pull/76 | `feat/attendance-debounced-search` |
| 4 / S4 | Hydration/realtime tests | https://github.com/rrobles9112/md-cc-attendance-and-capture/pull/77 | `feat/attendance-load-more-pagination` |

Phase 5 evidence:

| Task | Command | Result |
|---|---|---|
| 5.1 | `npx vitest run` | PASS — 13 files / 115 tests |
| 5.2 | `npx playwright test` | In-scope attendance: 12 passed. Full suite 16 passed / 14 failed on pre-existing export, offline-sync, and role-enforcement specs that still use stale `/login` selectors or unrelated UI contracts. Those files were not changed by this work. |
| 5.3 | `npx next lint` | PASS — no ESLint warnings or errors |
| 5.4 | `npx tsc --noEmit` | PASS |
| 5.5 | `git log --oneline` + 4 PRs | Four conventional commits stacked-to-main; PRs #74–#77 |

## Prior S4 apply slice

- Assigned slice at last apply: **S4-hydration-realtime-component-tests only** (tasks 4.1–4.3).
- S1–S3 implementation evidence is preserved below.

## Structured SDD status

### Consumed

- `changeName`: `members-scale-attendance-consistency`
- `artifactStore`: `openspec`; project config mode `both`; OpenSpec and Engram write-back preserved
- `workspaceRoot`: repository root
- `allowedEditRoots`: repository root
- `nextRecommended`: `apply`
- `applyState`: `ready`
- `taskProgress` at S4 launch: `18/30 complete`
- `applyProgress` artifact: present and read before work; this document merges the prior S1+S2+S3 evidence with S4 evidence
- `verifyReport` artifact: missing
- `blockedReasons`: none
- `actionContext` warnings: none; all edits remained inside the authoritative repository root
- Review workload guard: `Decision needed before apply: No`, `Chained PRs recommended: Yes`, `Chain strategy: stacked-to-main`, `400-line budget risk: High`; resolved delivery path was `auto-chain`, so this phase implemented only the assigned S4 work-unit slice
- Native runtime attempt authority: parent-owned bounded S4 attempt was already acquired; this phase did not acquire, settle, reset, or alter native attempt state

### Produced / parent-owned follow-up

- OpenSpec tasks 3.1–3.6 and 4.1–4.3 are checked. Tasks 1.8, 2.6, 3.7, 4.4, and 5.1–5.5 remain unchecked. The corresponding Engram tasks observation is kept aligned.
- The parent-owned lifecycle remains responsible for native attempt settlement, review/verification routing, receipts, commits, pushes, and delivery gates.
- No commit, push, bounded review, receipt, or delivery-gate action was performed.

## Completed tasks and persisted checkbox updates

The following legacy implementation-owned rows were completed and changed from `- [ ]` to `- [x]` in `openspec/changes/members-scale-attendance-consistency/tasks.md`. The corresponding Engram tasks observation was also updated.

- 3.1 RED pagination tests
- 3.2 GREEN `PAGE_SIZE = 50` and `paginateMembers`
- 3.3 GREEN attendance barrel export
- 3.4 GREEN `AttendanceGrid` visible-count/load-more/reset wiring
- 3.5 E2E scenarios for counter toggle, load-more, hidden load-more, and no-results empty state
- 3.6 REFACTOR: focused unit + e2e verification now passes after the login helper waited for the real post-login `/capture` route, then opened `/attendance`.
- 4.1 RED AttendanceGrid hydration/realtime consistency tests
- 4.2 GREEN existing AttendanceGrid hydration/realtime wiring
- 4.3 REFACTOR focused component-test verification

## TDD Cycle Evidence

### Preserved S1 evidence

| Cycle | Evidence | Result |
|---|---|---|
| RED | Added `count.test.ts` and `orphans.test.ts` before production modules. Ran the focused S1 Vitest command. | Expected failure: both suites failed during import resolution because `../count` and `../orphans` did not yet exist; 0 tests ran. |
| GREEN | Added `count.ts`, `orphans.ts`, and `index.ts`; re-ran the focused S1 command. | PASS: 2 test files, 5 tests. |
| TRIANGULATE | Wired `AttendanceGrid.tsx` to derive `markedCount` with `countPresent` and filter loaded attendance against active member IDs; re-ran focused S1 tests and typecheck. | PASS: 2 test files, 5 tests; `npx tsc --noEmit` passed with no diagnostics. |
| REFACTOR | Reviewed final S1 wiring and confirmed the old attendance-map key count was removed. | PASS: focused S1 suite remained green. |

### Preserved S2 evidence

| Task / cycle | Test file / command | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|
| 2.1–2.2 | `src/lib/attendance/__tests__/filter.test.ts` | Existing S1 baseline: 2 files / 5 tests passed before modifying `AttendanceGrid.tsx`. | Wrote four required tests before `filter.ts`; focused run failed during import resolution because `../filter` did not exist. | Created `filter.ts`; focused suite passed: 1 file / 4 tests. | Added a cross-field case proving the same term matches phone and email records; focused suite passed: 1 file / 5 tests. | Removed unnecessary `async` markers; focused suite remained green. |
| 2.3 | `src/lib/attendance/index.ts` | Existing S1 consumers remained covered. | N/A — structural export addition. | Added `filterBySearch` to the attendance barrel. | Triangulation skipped: one possible export wiring with no branching behavior. | No further refactor needed. |
| 2.4 | `src/components/forms/AttendanceGrid.tsx` | Existing S1 baseline: 2 files / 5 tests passed before the component edit. | Pure-function tests established search behavior before component wiring. | Added `useDeferredValue`, memoized `filterBySearch(members, deferredSearch)` with `[members, deferredSearch]`, and kept distinct empty-state copy gated by the deferred query. | Combined focused suite passed: 3 files / 10 tests; typecheck also passed. | Final source review confirmed the inline filter was removed, S1 counter/orphan wiring remained intact, and no additional component refactor was needed. |
| 2.5 | `npx vitest run src/lib/attendance/__tests__/filter.test.ts` | N/A — verification task. | N/A — prior RED evidence recorded above. | N/A — prior GREEN evidence recorded above. | N/A — prior triangulation evidence recorded above. | PASS: 1 file / 5 tests; final combined S1+S2 suite also passed. |

### S3 evidence

| Task / cycle | Test file / command | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|
| 3.1–3.2 | `src/lib/attendance/__tests__/paginate.test.ts` | Existing attendance baseline passed: 3 files / 10 tests before S3 edits. | Wrote the three required tests before `paginate.ts`; `npx vitest run src/lib/attendance/__tests__/paginate.test.ts` failed during import resolution because `../paginate` did not exist. | Added `PAGE_SIZE = 50` and `paginateMembers`; focused suite passed: 1 file / 3 tests. | The three cases cover a 75-member first page, a 30-member list, and a visible count larger than list length; focused suite remained green. | No production refactor was needed; final focused suite passed again. |
| 3.3 | `src/lib/attendance/index.ts` | Pagination unit tests covered the direct module. | N/A — structural export addition. | Added `PAGE_SIZE` and `paginateMembers` to the attendance barrel. | Triangulation skipped: one possible export wiring with no branching behavior. | No further refactor needed. |
| 3.4 | `src/components/forms/AttendanceGrid.tsx` | Existing unit baseline: 3 files / 10 tests; previous S1/S2 component behavior preserved by typecheck and source review. | Pagination E2E scenarios were written before this component wiring. | Added `visibleCount` state initialized to `PAGE_SIZE`, memoized `visibleMembers`, the conditional `Cargar más` button, increment-by-50 behavior, and reset effect keyed by `deferredSearch` and `selectedSessionId`. | Unit pagination cases exercise the slice contract; typecheck passed with no diagnostics. Browser-backed component behavior could not be executed because Playwright browsers are unavailable. | Final source review confirmed counter still uses full `filteredMembers`, denominator remains `members.length`, and S1/S2 wiring remains intact. |
| 3.5 | `e2e/attendance.spec.ts` | Existing E2E baseline was attempted: 4 tests were discovered but could not launch either configured browser because executables were missing. | Added the four requested scenarios and helpers before final verification: counter delta after checkbox toggle, next 50 rows, hidden button after all rows load, and no-results copy. | Runtime execution unavailable; no E2E PASS is claimed. | Four distinct scenarios were authored, including both pagination boundary states and the search empty state. | No further E2E refactor was performed because the browser runtime was unavailable. |
| 3.6 | `npx vitest run src/lib/attendance/__tests__/paginate.test.ts && npx playwright test e2e/attendance.spec.ts` | Focused unit command passed: 1 file / 3 tests. Prior E2E RED timeline: missing browsers → `/login` route mismatch → `#email` selector correction → `waitForURL('/attendance')` timeout. | Prior RED evidence is recorded above and in the login-helper correction section. | Unit portion PASS: 1 file / 3 tests. E2E portion PASS after helper correction: 12 passed (36.1s). | Four S3 scenarios plus the two existing attendance flows ran on Chromium and Firefox against a logged-in `/attendance` page. | Helper now waits for `/capture` (production login redirect), then navigates to `/attendance` and asserts the `Asistencia` heading. |

## Files changed in S3

- `src/lib/attendance/__tests__/paginate.test.ts` — new strict-TDD pagination tests.
- `src/lib/attendance/paginate.ts` — new `PAGE_SIZE` constant and pure pagination function.
- `src/lib/attendance/index.ts` — added pagination barrel exports.
- `src/components/forms/AttendanceGrid.tsx` — added visible-count state, pagination, load-more button, and search/session reset wiring; prior S1/S2 behavior preserved.
- `e2e/attendance.spec.ts` — added the four requested attendance/pagination scenarios and test helpers.
- `openspec/changes/members-scale-attendance-consistency/tasks.md` — S3 implementation rows 3.1–3.6 are checked; commit task 3.7 and all later work remain unchecked.
- `openspec/changes/members-scale-attendance-consistency/apply-progress.md` — cumulative S1 + S2 + S3 evidence.

## Verification evidence

- `npx vitest run src/lib/attendance/__tests__/count.test.ts src/lib/attendance/__tests__/orphans.test.ts src/lib/attendance/__tests__/filter.test.ts` — PASS baseline before S3 edits, 3 files / 10 tests.
- `npx vitest run src/lib/attendance/__tests__/paginate.test.ts` — PASS, 1 file / 3 tests (GREEN and final focused verification).
- `npx vitest run src/lib/attendance/__tests__/paginate.test.ts && npx playwright test e2e/attendance.spec.ts` — unit portion PASS, 1 file / 3 tests; E2E portion attempted and exited 1 at browser launch. Playwright scheduled 12 tests across Chromium and Firefox; Chromium executable was missing at `/Users/richard.robles/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell`, and Firefox executable was missing at `/Users/richard.robles/Library/Caches/ms-playwright/firefox-1538/firefox/Nightly.app/Contents/MacOS/firefox`. No E2E behavior was observed and no E2E PASS is claimed.
- `npx playwright test e2e/attendance.spec.ts` baseline — 4 tests attempted, same missing-browser infrastructure result.
- `npx tsc --noEmit` — PASS, no diagnostics.
- `git diff --check` — PASS.
- Runtime harness: E2E runtime was requested and attempted; unavailable because the configured Playwright browser binaries are not installed. No browser installation or unrelated infrastructure change was performed.

## Design deviations

- No material production deviation from the design. Pagination uses `slice(0, visibleCount)` through the pure `paginateMembers` function, fixes `PAGE_SIZE` at 50, renders the conditional Spanish `Cargar más` button, and resets pagination on deferred search/session changes.
- E2E additions use accessible roles and existing Spanish UI copy. They were authored but could not be runtime-verified because both configured browser executables are unavailable.
- No S1/S2 behavior was intentionally changed; the existing counter, orphan filter, deferred search, memoized filtering, and empty-state behavior remain in `AttendanceGrid.tsx`.

## Workload and PR boundary

- Delivery strategy: `auto-chain`
- Chain strategy: `stacked-to-main`
- Current boundary: PR 3 / S3 load-more pagination plus attendance E2E scenarios, approximately 175 changed lines forecast.
- Start state: S1 and S2 implementation complete with commit tasks 1.8 and 2.6 deferred; prior S1+S2 apply evidence preserved.
- End state: pagination tests/helper, barrel export, `AttendanceGrid` load-more/reset wiring, four E2E scenarios, focused unit verification, and typecheck complete; E2E runtime evidence unavailable; S4 and final verification excluded.
- Rollback boundary: remove `src/lib/attendance/paginate.ts`, `src/lib/attendance/__tests__/paginate.test.ts`, the pagination barrel exports, only the S3 visible-count/load-more/reset changes in `AttendanceGrid.tsx`, and the four S3 E2E additions; retain S1 counter/orphan and S2 search behavior.
- Commit task 3.7 is intentionally deferred; no commit was created.

## Remaining tasks

The following exact unchecked implementation/lifecycle rows remain in the persisted tasks artifact after S4 implementation:

- [ ] 1.8 COMMIT: `fix(attendance): correct counter and exclude orphaned attendance records`
- [ ] 2.6 COMMIT: `feat(attendance): add debounced client-side search across name, phone, email`
- [ ] 3.7 COMMIT: `feat(attendance): add load-more pagination with PAGE_SIZE=50`
- [ ] 4.4 COMMIT: `test(attendance): add hydration and realtime component-level consistency tests`
- [ ] 5.1 Run full unit suite: `npx vitest run`
- [ ] 5.2 Run e2e suite: `npx playwright test`
- [ ] 5.3 Run lint: `npx next lint`
- [ ] 5.4 Run typecheck: `npx tsc --noEmit`
- [ ] 5.5 Verify all 4 PRs stacked-to-main: `git log --oneline` confirms clean commit history

Parent-owned follow-up: settle the already-acquired native S4 attempt and route the parent lifecycle. This phase does not prescribe a future implementation phase.

## Post-install E2E re-verification

- The user-authorized `npx playwright install chromium firefox` completed successfully; Chromium and Firefox launched during the subsequent verification attempt.
- `npx playwright test e2e/attendance.spec.ts` was then run exactly once after installation: 12 tests discovered, 0 passed, 12 failed.
- All failures timed out while filling `[name="email"]` at `e2e/attendance.spec.ts:5`, `:29`, or `:118`; no attendance behavior was reached.
- Root cause evidence: `/login` redirects to `/`, while the current login form is at the root route; the E2E helper still expects a login form at `/login`. This is a test/runtime-route mismatch, not a missing-browser failure.
- Next correction requires a new bounded native attempt and maintainer-approved rescoping/reset; no source correction was started in this verification action.

## Maintainer-authorized route correction evidence

- Correction scope: changed only the three authored E2E navigation references in `e2e/attendance.spec.ts` from `/login` to `/`: the shared `loginAndOpenAttendance` helper, the direct `create session and mark attendance` case, and the two-context realtime login loop. No application routing, unrelated tests, or S1/S2/S3 implementation were changed.
- Safety net / RED evidence: before the correction, `npx playwright test e2e/attendance.spec.ts` ran 12 tests across Chromium and Firefox and failed all 12 while filling `[name="email"]` after navigation to `/login`; the failure matched the previously recorded route mismatch (`/login` redirects to `/`).
- Focused command after correction: `npx playwright test e2e/attendance.spec.ts` (run exactly once after the correction).
- Exact result: **FAIL — 12 tests, 0 passed, 12 failed** (6 Chromium, 6 Firefox). Every failure timed out at `page.fill('[name="email"]', ...)` after navigation to `/` (`e2e/attendance.spec.ts:5`, `:29`, or `:118`); no attendance behavior was reached. The command exited with code 1.
- No `npx tsc --noEmit` run: this correction changed only E2E route string literals, so typecheck was not needed for bounded evidence.
- Task persistence: `3.6` remains visibly `- [ ]` in OpenSpec and Engram; no task was newly completed. S4 and final verification were not started.
- Current structured status: `changeName=members-scale-attendance-consistency`, `artifactStore=openspec` with project config `both`, `nextRecommended=apply` consumed at launch, `taskProgress=17/30`, `applyProgress=done`, `verifyReport=missing`, `blockedReasons=none`, `workspaceRoot` and `allowedEditRoots` are the repository root. `actionContext` had no warnings; the correction stayed inside the allowed root. Parent-owned native attempt state was not acquired, settled, reset, or altered.
- Current PR boundary remains PR 3 / S3, `auto-chain` with `stacked-to-main`; no commit, push, review, receipt, S4, or final verification action was performed.

## Final maintainer-authorized selector correction

- Correction scope: changed only the authored login selectors in `e2e/attendance.spec.ts`: every existing `[name="email"]` selector is now `#email`, and every existing `[name="password"]` selector is now `#password`. The shared login helper, direct session-creation flow, and two-context realtime login loop were updated. No application code, routes, unrelated tests, or S1/S2/S3 implementation were changed.
- Application contract readback: `src/app/page.tsx` defines the login inputs with `id="email"` and `id="password"` and no `name` attributes, so the selector correction matches the existing application markup.
- Strict-TDD safety net / RED evidence: the prior focused run before this selector correction failed all 12 scheduled tests at `[name="email"]` before reaching attendance behavior. That existing failing evidence was used as the correction's RED signal; no production code was changed.
- Focused command run exactly once after the selector correction: `npx playwright test e2e/attendance.spec.ts`.
- Exact captured result: the Playwright process started 12 tests using 4 workers. The selector fills succeeded far enough for failures to move to `page.waitForURL` navigation: observed failures timed out after 30 seconds waiting for `/attendance` at `e2e/attendance.spec.ts:8`, `:32`, and `:121`. The command harness then terminated at 120 seconds with `Command timed out after 120 seconds`; no final Playwright summary or process exit code was captured. The captured output reported at least seven numbered failures before termination; remaining scheduled tests had no final result in the captured output. No attendance behavior was reached.
- Task persistence: task 3.6 remains visibly `- [ ]`; no task checkbox was changed because the focused E2E verification did not complete successfully. S4 and final verification were not started.
- Files changed by this correction: `e2e/attendance.spec.ts` only. No commit or push was performed.
- Parent-owned native runtime attempt state was not acquired, settled, reset, or altered. The parent remains responsible for settlement and lifecycle routing.

## TDD Cycle Evidence — final correction

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 3.6 selector correction | `e2e/attendance.spec.ts` | E2E | Prior 12-test selector-timeout evidence preserved | Existing failure at `[name="email"]` established the selector defect | Not achieved: post-correction run advanced past selector fill but timed out waiting for `/attendance` | Not run; exactly one focused command was authorized | Not achieved; task remains unchecked |

## Remaining unchecked tasks after final correction

- [ ] 1.8 COMMIT: `fix(attendance): correct counter and exclude orphaned attendance records`
- [ ] 2.6 COMMIT: `feat(attendance): add debounced client-side search across name, phone, email`
- [ ] 3.7 COMMIT: `feat(attendance): add load-more pagination with PAGE_SIZE=50`
- [x] 4.1 Write RED: `src/components/forms/__tests__/AttendanceGrid.consistency.test.tsx` — tests: `AttendanceGrid › counter updates after hydration refreshes both members and attendance`, `AttendanceGrid › realtime attendance INSERT updates counter from 2/10 to 3/10` (mock `useCacheHydration`, `useRealtime`, Dexie)
- [x] 4.2 GREEN: Verify component tests pass with existing AttendanceGrid wiring (no new implementation needed — tests validate current hydration/realtime contract from design decisions)
- [x] 4.3 REFACTOR: verify (`npx vitest run src/components/forms/__tests__/AttendanceGrid.consistency.test.tsx`)
- [ ] 4.4 COMMIT: `test(attendance): add hydration and realtime component-level consistency tests`
- [ ] 5.1 Run full unit suite: `npx vitest run`
- [ ] 5.2 Run e2e suite: `npx playwright test`
- [ ] 5.3 Run lint: `npx next lint`
- [ ] 5.4 Run typecheck: `npx tsc --noEmit`
- [ ] 5.5 Verify all 4 PRs stacked-to-main: `git log --oneline` confirms clean commit history

## Structured status produced

- `changeName`: `members-scale-attendance-consistency`
- `artifactStore`: `openspec`; project config mode `both`; OpenSpec and Engram write-back preserved
- `workspaceRoot` / `allowedEditRoots`: repository root; correction stayed within the authoritative root
- `nextRecommended`: `apply` remains parent-lifecycle controlled because commit task 3.7 and S4/Phase 5 remain unchecked
- `taskProgress`: `18/30` complete; task 3.6 is checked
- `applyProgress`: cumulative artifact updated
- `verifyReport`: missing; no verification phase was started
- `blockedReasons`: none
- `actionContext` warnings: none
- Workload / PR boundary: PR 3 / S3, `auto-chain`, `stacked-to-main`; no S4, final verification, commit, push, review, receipt, or delivery-gate action

## Task 3.6 login-helper correction and passing verification

- Root cause: production login (`src/app/page.tsx`) calls `router.push('/capture')` after a successful `signInWithPassword`. The E2E helper waited for `/attendance`, so Playwright timed out before any attendance behavior ran. This was a helper contract mismatch, not a production routing defect.
- Contributing runtime facts: `.env.local` points at local Supabase (`127.0.0.1`); Docker/Supabase were down at the start of this slice, and a leftover `next dev` on port 3000 was hung (curl timed out with 0 bytes). Docker Desktop was started, `npx supabase start` reported the local stack running, and `auth.users` contained `test-leader@test.com`. Seed data had only 4 active members / 2 sessions.
- Correction scope (E2E only): `loginAsLeader` waits for `**/capture` and fails fast on the login error banner; `loginAndOpenAttendance` then navigates to `/attendance` and asserts the `Asistencia` heading. Shared helper reused by the create-session and realtime cases. Local pagination fixture seeds 100 members via `npx supabase db query --local` so "Cargar más" can execute. Create-session assertions wait for the present badge and combobox text. No production routing, Spanish UI copy, or S1/S2/S3 AttendanceGrid behavior was changed.
- Authored diff for this slice: `e2e/attendance.spec.ts` +143 / −39. Under the 400-line budget.
- Focused command: `npx vitest run src/lib/attendance/__tests__/paginate.test.ts && npx playwright test e2e/attendance.spec.ts`
- Exact result: Vitest PASS — 1 file / 3 tests. Playwright summary: **12 passed (36.1s)**. Exit code 0.
- Task persistence: `3.6` is now `[x]` in OpenSpec `tasks.md` and Engram observation #63. S4 and commit tasks remain unchecked. No commit or push was performed.

### TDD Cycle Evidence — 3.6 complete

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 3.6 | `src/lib/attendance/__tests__/paginate.test.ts` + `e2e/attendance.spec.ts` | Unit + E2E | Unit 3/3 passing before helper edits; prior 12-test `/attendance` waitForURL timeout preserved | Existing E2E failure waiting for `/attendance` after successful fills | PASS: unit 3/3; Playwright `12 passed (36.1s)` | Four S3 scenarios plus create-session and realtime ran on Chromium and Firefox | Helper waits for `/capture` then opens `/attendance`; pagination fixture and create-session assertions aligned to current UI |

## S4 — Hydration & realtime component tests

- Assigned slice: **S4-hydration-realtime-component-tests** (tasks 4.1–4.3 only). Task 4.4 commit and Phase 5 remain parent-owned.
- No production `AttendanceGrid.tsx` change. Existing wiring already calls `loadMembers` + `loadAttendance` from `useCacheHydration`, and `loadAttendance` from attendance `useRealtime` `onInsert`.
- Test harness: 4 mocks (`useCacheHydration`, `useRealtime`, `useRole`, Dexie `@/lib/sync/db`). `useRole` returns `null` so supabase/sonner/enqueue are not required to render. Radix Select is exercised through the real combobox/option UI with local jsdom pointer/ResizeObserver polyfills.
- Vitest JSX: `vitest.config.ts` now sets `esbuild.jsx = 'automatic'` so Next.js components that omit a React import can render under Vitest. This is a test-harness change, not a production behavior change.

### TDD Cycle Evidence — S4

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 4.1 | `src/components/forms/__tests__/AttendanceGrid.consistency.test.tsx` | Component (mocked hooks) | N/A (new test file). Attendance unit baseline still run: 4 files / 13 tests passed. | Wrote both required tests first. First focused run failed: `React is not defined` at `render(<AttendanceGrid />)` because Vitest used classic JSX. | N/A this row — GREEN is 4.2. | Two spec paths authored: hydration refresh and realtime INSERT. | N/A this row. |
| 4.2 | `src/components/forms/__tests__/AttendanceGrid.consistency.test.tsx` | Component (mocked hooks) | N/A — no production file modified. | Prior RED: 2 failed (`React is not defined`). | PASS against existing AttendanceGrid wiring after `esbuild.jsx = 'automatic'`: 1 file / 2 tests (258ms). `npx tsc --noEmit` passed. | Hydration: Dexie changes to 10 members (member 10 renamed `Hydrated Member`) + 3 attendance, captured `useCacheHydration` callback → badge `3 / 10 presentes` and `Hydrated Member` visible (proves both loaders). Realtime: attendance 2→3 rows, captured attendance `onInsert` → badge `3 / 10 presentes`. | N/A this row. |
| 4.3 | `src/components/forms/__tests__/AttendanceGrid.consistency.test.tsx` | Component (mocked hooks) | N/A — verification task. | Prior RED evidence recorded above. | Prior GREEN evidence recorded above. | Two distinct code paths remain covered; no third case added (spec has exactly these two S4 scenarios). | PASS: focused command 1 file / 2 tests (274ms) after removing the unused React import. Helpers left as-is. |

### Work Unit Evidence — S4

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `npx vitest run src/components/forms/__tests__/AttendanceGrid.consistency.test.tsx` — PASS, 1 file / 2 tests (274ms), exit 0. Exact names: `AttendanceGrid › counter updates after hydration refreshes both members and attendance`, `AttendanceGrid › realtime attendance INSERT updates counter from 2/10 to 3/10`. |
| Runtime harness command/scenario and exact result | N/A — component tests with mocked hooks (`useCacheHydration`, `useRealtime`, Dexie, `useRole`). No live hydration or Supabase realtime boundary exists for this slice. |
| Rollback boundary | `src/components/forms/__tests__/AttendanceGrid.consistency.test.tsx` and the `esbuild.jsx = 'automatic'` addition in `vitest.config.ts`. No `AttendanceGrid.tsx` production change to revert. |

### S4 verification evidence

- Safety-net baseline before S4: `npx vitest run src/lib/attendance/__tests__/count.test.ts src/lib/attendance/__tests__/orphans.test.ts src/lib/attendance/__tests__/filter.test.ts src/lib/attendance/__tests__/paginate.test.ts` — PASS, 4 files / 13 tests.
- RED focused command: FAIL, 2 tests, `React is not defined` at AttendanceGrid render (classic JSX).
- GREEN/REFACTOR focused command: PASS, 1 file / 2 tests.
- `npx tsc --noEmit` — PASS, no diagnostics.
- Runtime harness: N/A — mocked-hook component tests; no live Dexie hydration or Supabase realtime server.

### S4 files changed

- `src/components/forms/__tests__/AttendanceGrid.consistency.test.tsx` — created (174 lines). Four mocks. Behavioral badge assertions plus hydration member-name proof.
- `vitest.config.ts` — added `esbuild.jsx: 'automatic'` so existing Next.js components render under Vitest.
- `openspec/changes/members-scale-attendance-consistency/tasks.md` — 4.1–4.3 checked; 4.4 and Phase 5 remain unchecked.
- `openspec/changes/members-scale-attendance-consistency/apply-progress.md` — cumulative S1 + S2 + S3 + S4 evidence.

### S4 design deviations

- None in production. Tests validate the documented contract: hydration calls both `loadMembers` + `loadAttendance`; realtime attendance INSERT calls `loadAttendance()`; counter uses `countPresent`; orphan filter stays inside `loadAttendance`.
- Test-harness only: Vitest automatic JSX. AttendanceGrid was not edited.

### S4 workload and PR boundary

- Delivery strategy: `auto-chain`
- Chain strategy: `stacked-to-main`
- Current boundary: PR 4 / S4 hydration + realtime component tests. Authored product/test lines: new 174-line test file + 3-line Vitest JSX config. Under the 200-line work-unit cap.
- Start state: S1–S3 implementation complete with commit tasks 1.8, 2.6, and 3.7 deferred; prior evidence preserved.
- End state: S4 component tests green against existing wiring; typecheck passed; commit task 4.4 and Phase 5 excluded.
- Rollback boundary: delete the new test file and revert the Vitest JSX config line.

### S4 structured status produced

- `changeName`: `members-scale-attendance-consistency`
- `artifactStore`: `openspec`; project config mode `both`; OpenSpec and Engram write-back preserved
- `workspaceRoot` / `allowedEditRoots`: repository root; S4 edits stayed within the authoritative root
- `nextRecommended`: `apply` remains parent-lifecycle controlled because commit tasks 1.8/2.6/3.7/4.4 and Phase 5 remain unchecked
- `taskProgress`: `21/30` complete; tasks 4.1–4.3 are checked
- `applyProgress`: cumulative artifact updated
- `verifyReport`: missing; no verification phase was started
- `blockedReasons`: none
- `actionContext` warnings: none
- Workload / PR boundary: PR 4 / S4, `auto-chain`, `stacked-to-main`; no commit, push, review, receipt, or delivery-gate action
