# attendance-counter-consistency Specification

## Purpose

The attendance counter ("X / Y presentes") SHALL derive both numerator and denominator from the same filtered, active-member source of truth. This eliminates the mismatch where soft-deleted members' attendance records inflate the numerator while the rendered list excludes those members.

## Requirements

### Requirement: Counter Numerator Derivation

The system SHALL compute `markedCount` by counting members in `filteredMembers` whose `member_id` exists as a key in `attendanceMap`. The system MUST NOT use `Object.keys(attendanceMap).length` as the numerator source.

#### Scenario: Counter matches checked rows for super_admin with soft-deleted members

- GIVEN a session with 3 active members and 1 soft-deleted member who has an attendance record
- WHEN a super_admin user views the attendance grid
- THEN the counter SHALL show "0 / 3 presentes" (not "1 / 3 presentes")
- AND the rendered list SHALL contain exactly 3 rows, all unchecked

#### Scenario: Counter updates when attendance is toggled

- GIVEN a session with 5 active members and 0 attendance records
- WHEN the user checks attendance for member A and member B
- THEN the counter SHALL show "2 / 5 presentes"
- AND exactly 2 rows SHALL render with checked checkboxes

#### Scenario: Counter updates when attendance is unchecked

- GIVEN a session with 5 active members and 3 attendance records
- WHEN the user unchecks attendance for one member
- THEN the counter SHALL show "2 / 5 presentes"

### Requirement: Counter Denominator Derivation

The system SHALL derive the denominator from `members.length` where `members` is the active-members set (filtered `deleted_at === null`). The denominator MUST equal the total count of active members, not the count of search-filtered members.

#### Scenario: Denominator stays constant during search

- GIVEN a session with 100 active members
- WHEN the user types a search query matching 5 members
- THEN the counter SHALL show "X / 100 presentes" (denominator remains 100)
- AND only 5 rows SHALL render in the table

#### Scenario: Denominator excludes soft-deleted members

- GIVEN 50 active members and 10 soft-deleted members in the database
- WHEN the attendance grid loads
- THEN the denominator SHALL be 50

### Requirement: Orphaned Attendance Exclusion

The system SHALL filter attendance records by cross-referencing against the active-members set. Any attendance record whose `member_id` is absent from the active-members set SHALL be excluded from `attendanceMap` before rendering or counting.

#### Scenario: Orphaned attendance record is excluded for super_admin

- GIVEN member M is soft-deleted but has an attendance record for session S
- AND the Dexie `Attendance` interface lacks `deleted_at`
- WHEN a super_admin loads session S
- THEN member M's attendance record SHALL NOT appear in `attendanceMap`
- AND the counter SHALL NOT count member M's record

#### Scenario: Non-super_admin roles see consistent data

- GIVEN a leader user with RLS filtering `deleted_at IS NULL` on attendance
- WHEN the leader loads the attendance grid
- THEN the counter SHALL match the rendered checked rows
- AND the client-side orphan filter SHALL still apply (defense in depth)

### Requirement: Realtime and Hydration Consistency

The system SHALL reload both `members` and `attendanceMap` from Dexie on hydration and realtime events. Both loads SHALL complete before the counter is recomputed.

#### Scenario: Hydration refresh preserves counter accuracy

- GIVEN the counter shows "3 / 10 presentes"
- WHEN a cache hydration event fires (new data synced from server)
- THEN both `loadMembers()` and `loadAttendance()` SHALL execute
- AND the counter SHALL reflect the refreshed data without intermediate mismatch

#### Scenario: Realtime attendance insert updates counter

- GIVEN the counter shows "2 / 10 presentes"
- WHEN a realtime `INSERT` event fires for attendance on session S
- THEN `loadAttendance()` SHALL reload from Dexie
- AND the counter SHALL update to "3 / 10 presentes"

### Requirement: Role-Independent Counter Behavior

The system SHALL produce identical counter values for all roles (super_admin, leader, server) given the same underlying active-members and attendance data. RLS differences SHALL NOT cause counter drift because the client-side orphan filter is role-agnostic.

#### Scenario: super_admin and leader see same counter

- GIVEN the same session with 10 active members and 5 attendance records
- AND 2 soft-deleted members with orphaned attendance records
- WHEN a super_admin and a leader each load the grid
- THEN both SHALL see "5 / 10 presentes"
