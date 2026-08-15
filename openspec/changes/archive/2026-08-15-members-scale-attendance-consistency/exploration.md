# Exploration: members-scale-attendance-consistency

## Current State

### Architecture Overview

The application is a Next.js 15 App Router + React 19 attendance tracking system with offline-first architecture:

- **Primary DB**: Supabase (Postgres 15) with RLS policies
- **Local Cache**: Dexie (IndexedDB) for offline-first access
- **Sync Layer**: Queue-based sync (`src/lib/sync/queue.ts`) with conflict resolution
- **Realtime**: Supabase Realtime for live updates (`src/lib/realtime/manager.ts`)

### Attendance Page Data Flow

```
AttendancePage (src/app/(dashboard)/attendance/page.tsx)
  └─ AttendanceGrid (src/components/forms/AttendanceGrid.tsx)
       ├─ loadMembers() → db.members.filter(deleted_at === null).toArray()
       ├─ loadAttendance() → db.attendance.where(session_id).equals(selectedSessionId).toArray()
       └─ filteredMembers = members.filter(search) → client-side filtering
```

**Key observation**: All data comes from Dexie (local cache), not directly from Supabase. The UI is a pure client-side component (`'use client'`).

### Database Schema (Supabase)

**Members table** (`supabase/migrations/001_initial_schema.sql`):
```sql
CREATE TABLE members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  deleted_at TIMESTAMPTZ,  -- soft delete
  ...
);
```

**Attendance table**:
```sql
CREATE TABLE attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id),
  session_id UUID NOT NULL REFERENCES sessions(id),
  marked_by UUID NOT NULL REFERENCES profiles(id),
  marked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,  -- soft delete exists in Supabase
  UNIQUE(member_id, session_id)
);
```

**Dexie schema** (`src/lib/sync/db.ts`):
```typescript
attendance: 'id, member_id, session_id, [member_id+session_id]'
```

**CRITICAL FINDING**: The Dexie `Attendance` interface does NOT include `deleted_at`:
```typescript
export interface Attendance {
  id: string
  member_id: string
  session_id: string
  marked_by: string
  marked_at: string
  // NO deleted_at field!
}
```

### RLS Policies (Migration 009)

```sql
CREATE POLICY attendance_select ON attendance FOR SELECT USING (
  public.user_role() IN ('super_admin', 'leader', 'server')
  AND (
    deleted_at IS NULL
    OR public.user_role() = 'super_admin'  -- super_admin sees ALL records
  )
);
```

**Key finding**: `super_admin` users can see soft-deleted attendance records via RLS.

### Indexes

**No explicit indexes found** in any migration beyond PRIMARY KEY and UNIQUE constraints. The only indexes are:
- `members`: PK on `id`
- `attendance`: PK on `id`, UNIQUE on `(member_id, session_id)`
- No indexes on `name`, `phone`, `email`, `session_id`, or `deleted_at`

---

## ROOT CAUSE ANALYSIS: Present/Absent Inconsistency

### The Bug

The counter shows "1 / 31 presentes" but EVERY row checkbox renders unchecked.

### Trace

**Counter computation** (`AttendanceGrid.tsx` line 180):
```typescript
const markedCount = Object.keys(attendanceMap).length
```

**Checkbox rendering** (`AttendanceGrid.tsx` line 266):
```typescript
const isMarked = !!attendanceMap[member.id]
```

Both use `attendanceMap`, which is populated by `loadAttendance()` (lines 56-68):
```typescript
const records = await db.attendance
  .where('session_id')
  .equals(selectedSessionId)
  .toArray()
const map: Record<string, Attendance> = {}
records.forEach((r) => { map[r.member_id] = r })
setAttendanceMap(map)
```

**Members list** is populated by `loadMembers()` (lines 49-54):
```typescript
const allMembers = await db.members
  .filter((m) => m.deleted_at === null)  // FILTERS OUT soft-deleted members
  .toArray()
setMembers(allMembers.sort((a, b) => a.name.localeCompare(b.name)))
```

### Root Cause (HIGH CONFIDENCE)

**Soft-deleted member attendance mismatch**:

1. A member M was soft-deleted in Supabase (`deleted_at` set)
2. An attendance record for M exists in Supabase (with `deleted_at IS NULL`)
3. Hydration pulls both records into Dexie:
   - Member M is stored with `deleted_at` set
   - Attendance record is stored WITHOUT `deleted_at` (Dexie interface lacks the field)
4. `loadMembers()` filters `deleted_at === null` → M is EXCLUDED from rendered list
5. `loadAttendance()` does NOT filter by member status → M's attendance record IS included
6. Result: `attendanceMap` has 1 entry (M's ID as key), but M is not in the rendered members list
7. Counter: `Object.keys(attendanceMap).length` = 1
8. Checkbox: `!!attendanceMap[member.id]` = false for all rendered members

**Why this affects super_admin users**: The RLS policy allows super_admin to see soft-deleted attendance records. Non-super_admin users have `deleted_at IS NULL` filter in RLS, so they wouldn't see the soft-deleted attendance record.

**Code evidence**:
- `src/components/forms/AttendanceGrid.tsx` line 51: `m.deleted_at === null` filter
- `src/components/forms/AttendanceGrid.tsx` line 61-64: NO filter on attendance records
- `src/lib/sync/db.ts` lines 33-39: Attendance interface lacks `deleted_at`
- `supabase/migrations/001_initial_schema.sql` line 86: `deleted_at TIMESTAMPTZ` exists in Supabase

### Alternative Hypotheses (LOWER CONFIDENCE)

1. **Race condition between hydration and realtime**: Unlikely — both use the same Dexie source, and effects are properly sequenced
2. **Corrupted member_id**: Unlikely — `member_id` comes from `member.id` in the JSX, which is a UUID
3. **Hydration overwriting local data**: Unlikely — `reconcileExact` preserves pending records

---

## Scale Analysis

### Current Behavior

| Operation | Current Implementation | Data Source |
|-----------|----------------------|-------------|
| Load members | `db.members.filter(deleted_at === null).toArray()` | Dexie (full table scan) |
| Load attendance | `db.attendance.where(session_id).equals(id).toArray()` | Dexie (indexed) |
| Search | `members.filter(name/phone/email.includes(search))` | Client-side, O(n) |
| Counter | `Object.keys(attendanceMap).length` | In-memory state |
| Hydration | `fetchAll()` with 1000-row pagination | Supabase (all rows) |

### What Breaks at 1k Members

| Component | Impact | Evidence |
|-----------|--------|----------|
| Rendering | 1k table rows = ~5k DOM nodes. Manageable but not ideal. | No virtualization |
| Search | O(1000) per keystroke. Sub-millisecond but wasteful. | Client-side filter |
| Dexie query | ~100KB in memory. Fine. | Full table load |
| Hydration | 1 page (1000 rows). Fast. | `fetchAll()` pagination |

### What Breaks at 10k Members

| Component | Impact | Evidence |
|-----------|--------|----------|
| Rendering | **CRITICAL**: 10k rows = ~50k DOM nodes. Severe jank, slow scrolling, high memory. | No virtualization |
| Search | O(10k) per keystroke. ~10ms but re-renders are expensive. | Client-side filter |
| Dexie query | ~1MB in memory. Fine for modern browsers. | Full table load |
| Hydration | 10 pages (10 network requests). Several seconds. | `fetchAll()` pagination |
| Sync queue | Unlikely bottleneck unless many pending changes. | Queue-based |

### Missing Optimizations

1. **No indexes on searchable columns**: `name`, `phone`, `email` have no indexes in Supabase
2. **No LIMIT/range on member queries**: Full table scan in Dexie
3. **No virtualization**: All rows rendered in DOM
4. **No debouncing on search**: Filter runs on every keystroke
5. **Client-side search only**: No server-side search capability

---

## Approaches

### Problem 1: Pagination

#### Option A: Offset Pagination (Supabase range)

```typescript
const { data } = await supabase
  .from('members')
  .select('*')
  .range(offset, offset + pageSize - 1)
  .order('name')
```

- **Pros**: Simple, familiar pattern
- **Cons**: O(n) scan for deep pages, inconsistent with concurrent inserts/deletes
- **Effort**: Low

#### Option B: Keyset (Cursor) Pagination

```typescript
const { data } = await supabase
  .from('members')
  .select('*')
  .gt('name', lastCursor)
  .order('name')
  .limit(pageSize)
```

- **Pros**: O(1) with index, consistent results, efficient for large datasets
- **Cons**: Can't jump to arbitrary pages, slightly more complex
- **Effort**: Medium

#### Option C: Client-Side Pagination (paginate Dexie results)

```typescript
const allMembers = await db.members.filter(m => m.deleted_at === null).toArray()
const paginated = allMembers.slice(offset, offset + pageSize)
```

- **Pros**: Works offline, simple implementation
- **Cons**: Still loads all data into memory, doesn't scale
- **Effort**: Low

#### Option D: Infinite Scroll / Load More

- **Pros**: Good UX for browsing, progressive loading
- **Cons**: Hard to jump to specific items, complex scroll management
- **Effort**: Medium

**Recommendation**: Start with **Option C** (client-side pagination) for immediate fix, migrate to **Option B** (keyset pagination) for scale. Use "Load More" UX pattern.

### Problem 2: Search

#### Option A: Client-Side Filtering (current)

```typescript
const filtered = members.filter(m =>
  m.name.toLowerCase().includes(search.toLowerCase()) ||
  m.phone.includes(search) ||
  m.email.toLowerCase().includes(search.toLowerCase())
)
```

- **Pros**: Works offline, no server calls, simple
- **Cons**: O(n) per keystroke, doesn't scale
- **Effort**: None (current)

#### Option B: Server-Side ILIKE with pg_trgm

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX members_name_trgm ON members USING gin (name gin_trgm_ops);
CREATE INDEX members_phone_trgm ON members USING gin (phone gin_trgm_ops);
CREATE INDEX members_email_trgm ON members USING gin (email gin_trgm_ops);
```

```typescript
const { data } = await supabase
  .from('members')
  .select('*')
  .or(`name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`)
  .range(0, 49)
```

- **Pros**: Scales to millions of rows, indexed search
- **Cons**: Requires network, doesn't work offline, needs pg_trgm extension
- **Effort**: Medium

#### Option C: Server-Side Full-Text Search (tsvector)

```sql
ALTER TABLE members ADD COLUMN search_vector tsvector;
CREATE INDEX members_search_idx ON members USING gin(search_vector);
```

- **Pros**: Most powerful, supports ranking, handles complex queries
- **Cons**: More complex setup, requires schema change, overkill for this use case
- **Effort**: High

#### Option D: Hybrid (server when online, client when offline)

- **Pros**: Best of both worlds
- **Cons**: More complex, need to handle transitions
- **Effort**: High

**Recommendation**: Start with **Option A** (client-side) with debouncing and `useMemo`. Add **Option B** (pg_trgm) when dataset exceeds 5k members.

### Problem 3: Attendance Consistency

#### Option A: Fix Counter to Match Checkboxes (immediate)

```typescript
// Instead of:
const markedCount = Object.keys(attendanceMap).length

// Use:
const markedCount = filteredMembers.filter(m => !!attendanceMap[m.id]).length
```

- **Pros**: One-line fix, immediately correct
- **Cons**: Doesn't fix root cause (orphaned attendance records)
- **Effort**: Low

#### Option B: Add deleted_at to Dexie Attendance Interface

```typescript
export interface Attendance {
  id: string
  member_id: string
  session_id: string
  marked_by: string
  marked_at: string
  deleted_at: string | null  // ADD THIS
}

// Update Dexie schema:
attendance: 'id, member_id, session_id, deleted_at, [member_id+session_id]'

// Filter in loadAttendance:
const records = await db.attendance
  .where('session_id')
  .equals(selectedSessionId)
  .filter(r => r.deleted_at === null)
  .toArray()
```

- **Pros**: Proper fix, aligns Dexie with Supabase schema
- **Cons**: Requires Dexie schema migration, more complex
- **Effort**: Medium

#### Option C: Cleanup Orphaned Records

```typescript
// During hydration, remove attendance for soft-deleted members
const memberIds = new Set(members.map(m => m.id))
const orphaned = attendance.filter(a => !memberIds.has(a.member_id))
await db.attendance.bulkDelete(orphaned.map(a => a.id))
```

- **Pros**: Cleans up data, prevents future issues
- **Cons**: Runs on every hydration, could be slow
- **Effort**: Medium

#### Option D: JOIN-based Query

```typescript
// Load attendance with member existence check
const records = await db.attendance
  .where('session_id')
  .equals(selectedSessionId)
  .toArray()

const memberIds = new Set(members.map(m => m.id))
const validRecords = records.filter(r => memberIds.has(r.member_id))
```

- **Pros**: Ensures consistency, no schema changes
- **Cons**: Requires loading members first, extra filtering
- **Effort**: Low

**Recommendation**: Implement **Option A** (immediate fix) + **Option D** (JOIN-based filtering). Add **Option B** (deleted_at in Dexie) as a proper fix in a follow-up.

---

## Recommendation

### Phase 1: Immediate Fixes (this change)

1. **Consistency Fix**: Change counter to use same data source as checkboxes
   ```typescript
   const markedCount = filteredMembers.filter(m => !!attendanceMap[m.id]).length
   ```

2. **Attendance Filtering**: Filter attendance by member existence
   ```typescript
   const memberIds = new Set(members.map(m => m.id))
   const validRecords = records.filter(r => memberIds.has(r.member_id))
   ```

3. **Search Optimization**: Add debouncing and useMemo
   ```typescript
   const debouncedSearch = useDeferredValue(search)
   const filteredMembers = useMemo(() =>
     members.filter(m => /* search logic */),
     [members, debouncedSearch]
   )
   ```

4. **Client-Side Pagination**: Add simple pagination to member list
   ```typescript
   const PAGE_SIZE = 50
   const [page, setPage] = useState(0)
   const paginatedMembers = filteredMembers.slice(0, (page + 1) * PAGE_SIZE)
   ```

### Phase 2: Scale Improvements (follow-up)

1. **Server-Side Search**: Add pg_trgm indexes and Supabase search queries
2. **Keyset Pagination**: Replace offset with cursor-based pagination
3. **Virtual Scrolling**: Add virtualization for 10k+ members
4. **Dexie Schema Migration**: Add `deleted_at` to Attendance interface

### Open Questions for Product Owner

1. **Page size**: What's the expected page size? 25? 50? 100?
2. **Search fields**: Should search include name, phone, email? Any other fields?
3. **Offline search**: Must search work offline? Or is server-side search acceptable?
4. **Counter meaning**: Is "X / Y presentes" a source of truth or derived? Should it count only rendered members?
5. **Soft-delete cleanup**: Should attendance records be cleaned up when a member is soft-deleted?

---

## Risks

1. **Dexie schema migration**: Adding `deleted_at` to Attendance requires a version bump and migration logic
2. **Offline-first tradeoffs**: Server-side search doesn't work offline; need fallback strategy
3. **Realtime race conditions**: Hydration and realtime events can conflict; need proper ordering
4. **Sync queue growth**: If many attendance changes are pending, queue could grow large
5. **RLS complexity**: Different roles see different data; need to test all role scenarios

---

## Ready for Proposal

**Yes** — the root cause is identified with high confidence, and the approach is clear. The immediate fix (counter + filtering) is a small change. The scale improvements (pagination + search) are well-defined.

**What to tell the user**:
1. Root cause: Soft-deleted member attendance records cause counter/checkbox mismatch (affects super_admin)
2. Immediate fix: One-line counter change + attendance filtering
3. Scale plan: Client-side pagination now, server-side search later
4. Need input: Page size, search fields, offline requirements
