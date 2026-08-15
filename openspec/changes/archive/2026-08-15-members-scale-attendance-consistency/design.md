# Design: Members Scale & Attendance Consistency

## Technical Approach

Extract pure attendance logic into `src/lib/attendance/` and rewire `AttendanceGrid.tsx` to consume it. The orphan filter runs inside `loadAttendance` (not a derived memo) so `attendanceMap` is always clean at the source. Client-side pagination via `slice(0, visibleCount)` with `useDeferredValue` debouncing satisfies Phase 1 offline-first constraints — no network dependency, no schema changes.

## Architecture Decisions

### Decision: Orphan filter placement — inside loadAttendance

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Inside `loadAttendance` | `attendanceMap` always clean; counter logic trivial; filter runs once per load | **Chosen** |
| Derived `useMemo` | Keeps raw map available; adds complexity; filter re-runs every render | Rejected |

**Rationale**: Filtering at load time means every consumer (counter, checkbox, realtime handler) sees consistent data without re-deriving. The raw unfiltered map is never needed — orphaned records have no UI purpose.

### Decision: Client-side slice vs server-side keyset

| Option | Tradeoff | Decision |
|--------|----------|----------|
| `slice(0, visibleCount)` on Dexie result | Works offline, zero schema change, simple | **Chosen** |
| Supabase keyset cursor | Scales to millions, needs network, needs new index | Phase 2 |

**Rationale**: Dexie holds the full member set in IndexedDB (~1MB at 10k rows). A `slice` over an already-in-memory array is sub-millisecond. This satisfies Phase 1 without schema migrations or network dependency.

### Decision: Pure function extraction into src/lib/attendance/

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Extract to `src/lib/attendance/` | Testable in isolation, matches existing `src/lib/` convention | **Chosen** |
| Inline in component | Fewer files, untestable, grows component | Rejected |

**Rationale**: Project convention uses `src/lib/{domain}/` for business logic (see `src/lib/sync/`, `src/lib/rbac/`). Pure functions enable strict TDD without component rendering overhead.

### Decision: Realtime and Hydration Consistency — coordinated reload via React batching

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Independent `loadMembers` + `loadAttendance` with React batching | Simple; relies on React 18 automatic batching to coalesce state updates into one render; counter recomputes only after both settle | **Chosen** |
| `Promise.all([loadMembers, loadAttendance])` with explicit loading gate | Guarantees atomic update; adds loading state complexity; blocks UI until both resolve | Rejected |
| Single combined load function | Tightest coupling; harder to test in isolation; violates single-responsibility | Rejected |

**Rationale**: `useCacheHydration` (lines 78–81) fires both `loadMembers()` and `loadAttendance()` via `void` — two independent async calls. `useRealtime` for `attendance` (lines 83–89) fires `loadAttendance()` on INSERT/UPDATE/DELETE; `useRealtime` for `members` (lines 91–96) fires `loadMembers()`. Both `loadAttendance` applies `excludeOrphanedAttendance` (after rework) so `attendanceMap` is always clean at the source. React 18 automatic batching coalesces the two `setState` calls into a single render cycle — the derived `useMemo` counter recomputes only after both `members` and `attendanceMap` are fresh, preventing intermediate mismatch. No loading gate is needed because both Dexie reads are sub-millisecond (IndexedDB is in-process).

**Hooks referenced**: `src/hooks/useCacheHydration.ts` (lines 10–20: subscribes to `onCacheHydrated`, fires callback when `result.ok && !result.skipped`); `src/hooks/useRealtime.ts` (lines 15–45: subscribes to `realtimeManager`, stable callback proxy via `useRef` avoids re-subscription on every render).

**Current wiring** (AttendanceGrid.tsx lines 78–96):
```typescript
useCacheHydration(() => {
  void loadMembers()
  void loadAttendance()
})

useRealtime({ table: 'attendance', onInsert: () => loadAttendance(), ... })
useRealtime({ table: 'members', onInsert: () => loadMembers(), ... })
```

## Data Flow

```
Dexie (IndexedDB)
  │
  ├─ loadMembers() → db.members.filter(deleted_at===null).toArray()
  │     ↓
  │   members (sorted, active-only)
  │     │
  │     ├─ filterBySearch(members, deferredSearch) → filteredMembers
  │     │     ↓
  │     │   paginateMembers(filteredMembers, visibleCount) → visibleMembers → <TableBody>
  │     │
  │     └─ countPresent(filteredMembers, attendanceMap) → markedCount ──→ <Badge>
  │                                                ↑
  └─ loadAttendance() → db.attendance.where(session_id).toArray()
        ↓
      excludeOrphanedAttendance(records, activeMemberIds) → attendanceMap
                                                            ↑
                                              handleToggleAttendance() updates both
```

**Single source of truth**: `members` state (active-only from Dexie) feeds counter numerator, denominator, search, and list. `attendanceMap` is cross-referenced against `memberIds` at load time.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/lib/attendance/filter.ts` | Create | `filterBySearch(members, query)` — case-insensitive match on name/phone/email |
| `src/lib/attendance/paginate.ts` | Create | `paginateMembers(members, visibleCount)` — `slice(0, visibleCount)` |
| `src/lib/attendance/count.ts` | Create | `countPresent(filteredMembers, attendanceMap)` — count members with attendance |
| `src/lib/attendance/orphans.ts` | Create | `excludeOrphanedAttendance(records, activeMemberIds)` — filter by member existence |
| `src/lib/attendance/index.ts` | Create | Barrel export for all pure functions |
| `src/lib/attendance/__tests__/filter.test.ts` | Create | Unit tests for search filtering |
| `src/lib/attendance/__tests__/paginate.test.ts` | Create | Unit tests for pagination slice |
| `src/lib/attendance/__tests__/count.test.ts` | Create | Unit tests for counter logic |
| `src/lib/attendance/__tests__/orphans.test.ts` | Create | Unit tests for orphan exclusion |
| `src/components/forms/AttendanceGrid.tsx` | Modify | Wire extracted functions; add `visibleCount` state; add `useDeferredValue`; add "Load more" button |
| `e2e/attendance.spec.ts` | Modify | Add counter correctness + load-more scenarios |

## Interfaces / Contracts

```typescript
// src/lib/attendance/filter.ts
export function filterBySearch(members: Member[], query: string): Member[]
// Matches name, phone, email (case-insensitive, substring). Empty query → all members.

// src/lib/attendance/paginate.ts
export const PAGE_SIZE = 50
export function paginateMembers(members: Member[], visibleCount: number): Member[]
// Returns members.slice(0, visibleCount)

// src/lib/attendance/count.ts
export function countPresent(
  filteredMembers: Member[],
  attendanceMap: Record<string, Attendance>
): number
// filteredMembers.filter(m => !!attendanceMap[m.id]).length

// src/lib/attendance/orphans.ts
export function excludeOrphanedAttendance(
  records: Attendance[],
  activeMemberIds: Set<string>
): Record<string, Attendance>
// Filters records by member_id ∈ activeMemberIds, returns map keyed by member_id
```

## AttendanceGrid.tsx Rework

| Concern | Current | After |
|---------|---------|-------|
| Search | Inline `.filter()` on every render | `useDeferredValue(search)` + `useMemo(() => filterBySearch(...), [members, deferredSearch])` |
| Counter | `Object.keys(attendanceMap).length` | `countPresent(filteredMembers, attendanceMap)` |
| Orphan filter | None | Applied inside `loadAttendance` via `excludeOrphanedAttendance` |
| Pagination | None (renders all rows) | `visibleCount` state; `paginateMembers(filteredMembers, visibleCount)` |
| Empty state | Single message | Distinct: "No se encontraron miembros" vs "No hay miembros registrados" |
| Load more | N/A | `<Button>Cargar más</Button>` below table when `filteredMembers.length > visibleCount` |
| Reset triggers | N/A | `visibleCount` resets on `search` change and `selectedSessionId` change |

**State additions**:
```typescript
const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
const deferredSearch = useDeferredValue(search)
```

**Reset logic** (via `useEffect`):
- On `deferredSearch` change → `setVisibleCount(PAGE_SIZE)`
- On `selectedSessionId` change → `setVisibleCount(PAGE_SIZE)`

## Testing Strategy

### Unit Tests (Vitest — strict TDD)

| Work Slice | Test Name (RED first) | Function | Spec Scenario |
|------------|----------------------|----------|---------------|
| S1: Counter | `countPresent › returns 0 when no attendance` | `countPresent` | Counter matches checked rows |
| S1: Counter | `countPresent › counts only members with attendance` | `countPresent` | Counter updates on toggle |
| S1: Counter | `countPresent › excludes attendance for members not in filteredMembers` | `countPresent` | Orphaned record excluded |
| S1: Orphan | `excludeOrphanedAttendance › drops records for non-existent members` | `excludeOrphanedAttendance` | Orphaned attendance exclusion |
| S1: Orphan | `excludeOrphanedAttendance › keeps records for active members` | `excludeOrphanedAttendance` | Non-super_admin consistency |
| S2: Search | `filterBySearch › matches by name case-insensitive` | `filterBySearch` | Search by name |
| S2: Search | `filterBySearch › matches by phone substring` | `filterBySearch` | Search by phone |
| S2: Search | `filterBySearch › matches by email case-insensitive` | `filterBySearch` | Search by email |
| S2: Search | `filterBySearch › returns all on empty query` | `filterBySearch` | Empty state distinction |
| S3: Paginate | `paginateMembers › returns first PAGE_SIZE members` | `paginateMembers` | Initial load renders 50 |
| S3: Paginate | `paginateMembers › returns all when fewer than PAGE_SIZE` | `paginateMembers` | Fewer than 50 renders all |
| S3: Paginate | `paginateMembers › returns members when visibleCount > length` | `paginateMembers` | Load more near end |
| S4: Hydration | `AttendanceGrid › counter updates after hydration refreshes both members and attendance` | Component (Vitest + mock Dexie + mock hooks) | Hydration refresh preserves counter accuracy |
| S4: Realtime | `AttendanceGrid › realtime attendance INSERT updates counter from 2/10 to 3/10` | Component (Vitest + mock Dexie + mock hooks) | Realtime attendance insert updates counter |

### TDD Ordering (per slice)

1. Write RED test → `npx vitest` fails
2. Implement minimum code → GREEN
3. Refactor if needed → still GREEN
4. Commit work-unit

### E2E (Playwright)

| Scenario | Assertion |
|----------|-----------|
| Counter matches checkbox state after toggle | Badge text matches checked count |
| "Cargar más" button loads next 50 | Row count increases by 50 after click |
| "Cargar más" hidden when all loaded | Button not visible after loading all |
| Empty state "No se encontraron miembros" | Visible when search has no matches |

**Note on hydration/realtime tests (S4)**: Component-level Vitest is the honest choice here. Playwright cannot reliably trigger Dexie hydration or Supabase realtime events in E2E without either (a) a live Supabase project with test fixtures or (b) a mock server that replicates the realtime protocol — both are out of scope for Phase 1. Component tests with mocked `useCacheHydration` and `useRealtime` hooks give deterministic control over event timing and are sufficient to prove the contract.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No migration required. Pure client-side refactor: no Dexie version bump, no Supabase schema changes, no new packages. Rollback = git revert of the feature branch.

## Work Slice Summary

| Slice | Scope | Files | Est. Lines |
|-------|-------|-------|------------|
| S1 | Counter + Orphan filter | `count.ts`, `orphans.ts`, tests, `AttendanceGrid.tsx` | ~120 |
| S2 | Search | `filter.ts`, tests, `AttendanceGrid.tsx` | ~100 |
| S3 | Pagination | `paginate.ts`, tests, `AttendanceGrid.tsx`, `e2e/attendance.spec.ts` | ~130 |
| **Total** | | | **~350** |

Fits within 370–430 forecast and 800-line review budget.

## Open Questions

- [ ] None — all questions resolved in exploration and proposal.
