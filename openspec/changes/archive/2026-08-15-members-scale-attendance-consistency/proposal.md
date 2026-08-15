# Proposal: Members Scale & Attendance Consistency

## Intent

The attendance counter ("X / Y presentes") is the trust anchor for prayer group leaders. Today it shows wrong numbers for super_admin users because soft-deleted member attendance records inflate the count while the rendered list excludes those members. At scale (~10k members), the full table render kills the browser. This change restores counter correctness, adds efficient search, and introduces progressive loading so the grid stays usable as membership grows.

## Scope

### In Scope (Phase 1)
- **Counter fix**: derive `markedCount` from `filteredMembers.filter(m => attendanceMap[m.id])`, not `Object.keys(attendanceMap).length`
- **Attendance filter**: after loading attendance records, drop any whose `member_id` is absent from the active-members set (JOIN-based exclusion)
- **Debounced search**: `useDeferredValue` + `useMemo` over name, phone, email
- **Load-more pagination**: progressive 50-row chunks via "Load more" button; `PAGE_SIZE = 50`
- **Result feedback**: empty-state messages for "no results" vs "no members"
- **Unit tests** (Vitest): counter logic, search filter, pagination slice — strict TDD
- **E2E coverage**: Playwright happy-path for counter correctness and load-more interaction

### Out of Scope (Phase 2)
- Server-side keyset pagination (Supabase cursor queries)
- pg_trgm indexes / server-side search
- Virtual scrolling (react-window / tanstack-virtual)
- Dexie schema migration adding `deleted_at` to `Attendance` interface
- Export view changes (attendance export still sees all records)
- Cleanup of orphaned attendance records

## Capabilities

### New Capabilities
- `attendance-grid-pagination`: Progressive load-more pagination for the member attendance grid
- `attendance-grid-search`: Debounced client-side search across name, phone, email
- `attendance-counter-consistency`: Correct present/active counter derived from single filtered source

### Modified Capabilities
- None (no existing specs in `openspec/specs/`)

## Approach

Single source of truth: one `activeMembers` collection (Dexie query filtered `deleted_at === null`, sorted by name) feeds counter, search, and list. Attendance records are cross-referenced against this set to drop orphaned entries. Search uses `useDeferredValue` for debounce + `useMemo` to avoid re-filtering on every render. Pagination is a simple `slice(0, visibleCount)` with a "Load more" button incrementing by 50.

All logic extracted into testable pure functions: `filterBySearch`, `paginateMembers`, `countPresent`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/components/forms/AttendanceGrid.tsx` | Modified | Counter, search, pagination, attendance filtering |
| `src/lib/attendance/__tests__/` | New | Unit tests for filter/paginate/count logic |
| `e2e/attendance.spec.ts` | Modified | Add counter + load-more scenarios |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Realtime event fires during hydration → stale state | Medium | Both handlers reload from Dexie; last-write-wins is acceptable |
| super_admin sees deleted attendance via RLS → counter drift after filter | Low | JOIN-based filter handles this client-side regardless of RLS |
| Sync queue backlog delays attendance visibility offline | Low | Optimistic local write + enqueue; UI reflects immediately |
| `useDeferredValue` may cause brief stale search results | Low | Acceptable UX tradeoff; input stays responsive |

## Rollback Plan

Git revert of the feature branch. No schema changes, no Dexie version bump, no migrations — pure client-side refactor. Reverting restores the old counter (incorrect but functional) and removes pagination.

## Dependencies

- None (no new packages, no schema changes)

## Success Criteria

- [ ] Counter shows correct count matching visible checked rows for all roles (super_admin, leader)
- [ ] Search filters by name, phone, or email with < 100ms perceived latency at 1k members
- [ ] "Load more" renders 50 rows per click; total DOM nodes never exceed 50 until next click
- [ ] All unit tests pass in strict TDD (write test → fail → implement → pass)
- [ ] E2E: counter matches checkbox state after toggling attendance

## Review Workload Forecast

~120–180 changed lines across `AttendanceGrid.tsx` + ~100 lines of extracted logic + ~150 lines of tests. Total: **~370–430 lines**. Fits comfortably in a single PR under 800-line budget.
