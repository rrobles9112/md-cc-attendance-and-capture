# attendance-grid-pagination Specification

## Purpose

The attendance grid SHALL progressively load members in chunks of 50 via a "Load more" button. This prevents rendering thousands of DOM nodes at once, keeping the grid performant as membership scales.

## Requirements

### Requirement: Page Size Constant

The system SHALL define `PAGE_SIZE = 50` as the number of members rendered per chunk. This constant SHALL NOT be configurable by the user.

#### Scenario: Initial load renders 50 members

- GIVEN 500 active members in the database
- WHEN the attendance grid loads
- THEN exactly 50 member rows SHALL render in the table

#### Scenario: Fewer than 50 members renders all

- GIVEN 30 active members in the database
- WHEN the attendance grid loads
- THEN all 30 member rows SHALL render
- AND the "Load more" button SHALL NOT be visible

### Requirement: Load More Button

The system SHALL display a "Load more" button when `filteredMembers.length > visibleCount`. Clicking the button SHALL increment `visibleCount` by `PAGE_SIZE`.

#### Scenario: Load more appends next chunk

- GIVEN 200 active members and visibleCount is 50
- WHEN the user clicks "Load more"
- THEN the visible count SHALL become 100
- AND 100 member rows SHALL render

#### Scenario: Load more near end of list

- GIVEN 120 active members and visibleCount is 100
- WHEN the user clicks "Load more"
- THEN the visible count SHALL become 150
- AND all 120 member rows SHALL render (no partial chunk)

#### Scenario: Load more when all members visible

- GIVEN 120 active members and visibleCount is 150 (all loaded)
- WHEN the grid re-renders
- THEN the "Load more" button SHALL NOT be visible

### Requirement: Pagination Reset on Session Change

The system SHALL reset `visibleCount` to `PAGE_SIZE` when the selected session changes. This prevents stale pagination state from carrying over between sessions.

#### Scenario: Session switch resets visible count

- GIVEN the user has loaded 300 members for session A
- WHEN the user switches to session B
- THEN the visible count SHALL reset to 50
- AND only 50 members SHALL render initially

### Requirement: Pagination Reset on Search Change

The system SHALL reset `visibleCount` to `PAGE_SIZE` when the search term changes. This is handled by the search spec; listed here for cross-reference.

#### Scenario: Search change resets pagination

- GIVEN the user has loaded 200 members
- WHEN the user types a new search query
- THEN the visible count SHALL reset to 50

### Requirement: Counter Unaffected by Pagination

The system SHALL compute the counter (`markedCount / members.length`) from the FULL active-members and attendance sets, not from the paginated subset. The counter denominator SHALL always reflect total active members regardless of how many are visible.

#### Scenario: Counter shows total even when partially loaded

- GIVEN 500 active members with 10 attendance records
- AND only 50 members are visible (first chunk)
- WHEN the counter renders
- THEN it SHALL show "10 / 500 presentes"
- AND NOT "X / 50 presentes"

### Requirement: Offline Pagination

The system SHALL paginate entirely from the local Dexie cache. Pagination SHALL work identically online and offline.

#### Scenario: Load more works offline

- GIVEN the device is offline with 300 cached active members
- WHEN the user clicks "Load more"
- THEN the next 50 members SHALL render from local cache
