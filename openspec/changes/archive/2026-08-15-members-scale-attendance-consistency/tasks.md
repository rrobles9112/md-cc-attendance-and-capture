# Tasks: Members Scale & Attendance Consistency

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~530 |
| 400-line budget risk | High |
| 800-line budget risk | Low |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (S1) → PR 2 (S2) → PR 3 (S3) → PR 4 (S4) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
800-line budget risk: Low

> **Note**: Design Work Slice Summary estimated ~350 lines but omitted S4 component-level tests (hydration refresh + realtime insert). This forecast includes S4 honestly at ~100 lines, pushing total to ~530.

### Suggested Work Units

| Unit | Slice | Goal | Likely PR | Lines | Focused test command | Runtime harness | Rollback boundary |
|------|-------|------|-----------|-------|----------------------|-----------------|-------------------|
| 1 | S1 | Counter + Orphan filter | PR 1 | ~130 | `npx vitest run src/lib/attendance/__tests__/count.test.ts src/lib/attendance/__tests__/orphans.test.ts` | N/A — pure functions, no runtime boundary needed | `src/lib/attendance/count.ts`, `src/lib/attendance/orphans.ts`, their tests, S1 changes to AttendanceGrid.tsx |
| 2 | S2 | Debounced search | PR 2 | ~125 | `npx vitest run src/lib/attendance/__tests__/filter.test.ts` | N/A — pure function, no runtime boundary needed | `src/lib/attendance/filter.ts`, its tests, S2 changes to AttendanceGrid.tsx |
| 3 | S3 | Load-more pagination + e2e | PR 3 | ~175 | `npx vitest run src/lib/attendance/__tests__/paginate.test.ts && npx playwright test e2e/attendance.spec.ts` | `npx playwright test e2e/attendance.spec.ts` — verifies "Cargar más" button loads next 50 rows | `src/lib/attendance/paginate.ts`, its tests, S3 changes to AttendanceGrid.tsx, e2e additions |
| 4 | S4 | Hydration + realtime component tests | PR 4 | ~100 | `npx vitest run src/components/forms/__tests__/AttendanceGrid.consistency.test.tsx` | N/A — component tests with mocked hooks | `src/components/forms/__tests__/AttendanceGrid.consistency.test.tsx` |

---

## Phase 1: S1 — Counter & Orphan Consistency (PR 1)

**RED → GREEN → REFACTOR → COMMIT**

- [x] 1.1 Write RED: `src/lib/attendance/__tests__/count.test.ts` — tests: `countPresent › returns 0 when no attendance`, `countPresent › counts only members with attendance`, `countPresent › excludes attendance for members not in filteredMembers`
- [x] 1.2 Write RED: `src/lib/attendance/__tests__/orphans.test.ts` — tests: `excludeOrphanedAttendance › drops records for non-existent members`, `excludeOrphanedAttendance › keeps records for active members`
- [x] 1.3 GREEN: Create `src/lib/attendance/count.ts` — implement `countPresent(filteredMembers, attendanceMap): number`
- [x] 1.4 GREEN: Create `src/lib/attendance/orphans.ts` — implement `excludeOrphanedAttendance(records, activeMemberIds): Record<string, Attendance>`
- [x] 1.5 GREEN: Create `src/lib/attendance/index.ts` — barrel export for count, orphans
- [x] 1.6 GREEN: Modify `src/components/forms/AttendanceGrid.tsx` — wire `countPresent` into counter badge; apply `excludeOrphanedAttendance` inside `loadAttendance`; replace `Object.keys(attendanceMap).length`
- [x] 1.7 REFACTOR: verify all S1 tests pass (`npx vitest run src/lib/attendance/__tests__/count.test.ts src/lib/attendance/__tests__/orphans.test.ts`)
- [x] 1.8 COMMIT: `fix(attendance): correct counter and exclude orphaned attendance records`

## Phase 2: S2 — Debounced Search (PR 2)

**RED → GREEN → REFACTOR → COMMIT**

- [x] 2.1 Write RED: `src/lib/attendance/__tests__/filter.test.ts` — tests: `filterBySearch › matches by name case-insensitive`, `filterBySearch › matches by phone substring`, `filterBySearch › matches by email case-insensitive`, `filterBySearch › returns all on empty query`
- [x] 2.2 GREEN: Create `src/lib/attendance/filter.ts` — implement `filterBySearch(members, query): Member[]`
- [x] 2.3 GREEN: Update `src/lib/attendance/index.ts` — add filter export
- [x] 2.4 GREEN: Modify `src/components/forms/AttendanceGrid.tsx` — add `deferredSearch = useDeferredValue(search)`; wrap `filterBySearch` in `useMemo` keyed on `[members, deferredSearch]`; replace inline `.filter()`; add empty state messages: "No se encontraron miembros" vs "No hay miembros registrados"
- [x] 2.5 REFACTOR: verify all S2 tests pass (`npx vitest run src/lib/attendance/__tests__/filter.test.ts`)
- [x] 2.6 COMMIT: `feat(attendance): add debounced client-side search across name, phone, email`

## Phase 3: S3 — Load-More Pagination + E2E (PR 3)

**RED → GREEN → REFACTOR → COMMIT**

- [x] 3.1 Write RED: `src/lib/attendance/__tests__/paginate.test.ts` — tests: `paginateMembers › returns first PAGE_SIZE members`, `paginateMembers › returns all when fewer than PAGE_SIZE`, `paginateMembers › returns members when visibleCount > length`
- [x] 3.2 GREEN: Create `src/lib/attendance/paginate.ts` — implement `PAGE_SIZE = 50`, `paginateMembers(members, visibleCount): Member[]`
- [x] 3.3 GREEN: Update `src/lib/attendance/index.ts` — add paginate export
- [x] 3.4 GREEN: Modify `src/components/forms/AttendanceGrid.tsx` — add `visibleCount` state; wire `paginateMembers`; add "Cargar más" `<Button>` when `filteredMembers.length > visibleCount`; add reset `useEffect` on `deferredSearch` and `selectedSessionId` change
- [x] 3.5 Write E2E: `e2e/attendance.spec.ts` — add scenarios: counter matches checkbox state after toggle, "Cargar más" loads next 50, "Cargar más" hidden when all loaded, empty state "No se encontraron miembros"
- [x] 3.6 REFACTOR: verify unit + e2e (`npx vitest run src/lib/attendance/__tests__/paginate.test.ts && npx playwright test e2e/attendance.spec.ts`)
- [x] 3.7 COMMIT: `feat(attendance): add load-more pagination with PAGE_SIZE=50`

## Phase 4: S4 — Hydration & Realtime Component Tests (PR 4)

**RED → GREEN → REFACTOR → COMMIT**

- [x] 4.1 Write RED: `src/components/forms/__tests__/AttendanceGrid.consistency.test.tsx` — tests: `AttendanceGrid › counter updates after hydration refreshes both members and attendance`, `AttendanceGrid › realtime attendance INSERT updates counter from 2/10 to 3/10` (mock `useCacheHydration`, `useRealtime`, Dexie)
- [x] 4.2 GREEN: Verify component tests pass with existing AttendanceGrid wiring (no new implementation needed — tests validate current hydration/realtime contract from design decisions)
- [x] 4.3 REFACTOR: verify (`npx vitest run src/components/forms/__tests__/AttendanceGrid.consistency.test.tsx`)
- [x] 4.4 COMMIT: `test(attendance): add hydration and realtime component-level consistency tests`

## Phase 5: Final Verification

- [x] 5.1 Run full unit suite: `npx vitest run`
- [x] 5.2 Run e2e suite: `npx playwright test`
- [x] 5.3 Run lint: `npx next lint`
- [x] 5.4 Run typecheck: `npx tsc --noEmit`
- [x] 5.5 Verify all 4 PRs stacked-to-main: `git log --oneline` confirms clean commit history
