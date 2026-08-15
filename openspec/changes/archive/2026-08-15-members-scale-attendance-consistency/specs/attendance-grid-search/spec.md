# attendance-grid-search Specification

## Purpose

The attendance grid SHALL provide client-side search across name, phone, and email fields using debounced deferral. Search operates entirely from the local Dexie cache, requiring no network connectivity.

## Requirements

### Requirement: Search Field Matching

The system SHALL match the search query against `name`, `phone`, and `email` fields of each active member. A member matches if ANY of these fields contains the search term.

#### Scenario: Search by name (case-insensitive)

- GIVEN active members: "Ana García", "Carlos López", "Ana Martínez"
- WHEN the user types "ana" in the search field
- THEN the grid SHALL display "Ana García" and "Ana Martínez"
- AND "Carlos López" SHALL NOT appear

#### Scenario: Search by phone (substring match)

- GIVEN active members with phones: "555-1234", "555-5678", "111-9999"
- WHEN the user types "555" in the search field
- THEN the grid SHALL display members with "555-1234" and "555-5678"
- AND the member with "111-9999" SHALL NOT appear

#### Scenario: Search by email (case-insensitive)

- GIVEN active members with emails: "Ana@Example.com", "bob@test.com"
- WHEN the user types "ana@" in the search field
- THEN the grid SHALL display the member with "Ana@Example.com"

#### Scenario: Search matches across different fields

- GIVEN active members: "Ana" (phone "555-1234"), "Bob" (email "bob@555.com")
- WHEN the user types "555"
- THEN both members SHALL appear (phone match and email match)

### Requirement: Debounced Search Deferral

The system SHALL use `useDeferredValue` to defer the search filter computation. The search input SHALL remain responsive while the filter computation runs asynchronously.

#### Scenario: Input remains responsive during rapid typing

- GIVEN a member list of 1000 entries
- WHEN the user types "abc" rapidly (3 keystrokes in quick succession)
- THEN the input field SHALL update immediately for each keystroke
- AND the filtered list SHALL update after the deferral settles (not per keystroke)

#### Scenario: Memoized filter avoids unnecessary recomputation

- GIVEN the search term has not changed since the last render
- WHEN a re-render occurs due to unrelated state change
- THEN the filtered members list SHALL NOT be recomputed (memo hit)

### Requirement: Search Scope

The system SHALL search only within the active-members set (pre-filtered `deleted_at === null`). Soft-deleted members SHALL NOT appear in search results.

#### Scenario: Soft-deleted member excluded from search results

- GIVEN a soft-deleted member named "Deleted User" with email "deleted@test.com"
- WHEN the user searches for "deleted"
- THEN "Deleted User" SHALL NOT appear in results

### Requirement: Empty State Distinction

The system SHALL display distinct messages for "no results found" (search active, no matches) versus "no members registered" (no members exist in the system).

#### Scenario: No search results

- GIVEN active members exist but none match the search query "xyz123"
- WHEN the search filter completes
- THEN the grid SHALL display "No se encontraron miembros"

#### Scenario: No members in system

- GIVEN the members table is empty (no active members)
- WHEN the grid loads (search is empty)
- THEN the grid SHALL display "No hay miembros registrados"

### Requirement: Search Resets Pagination

When the search term changes, the system SHALL reset the visible member count to `PAGE_SIZE` (50). This prevents showing a deep page of results that no longer match the new query.

#### Scenario: Pagination resets on new search

- GIVEN the user has loaded 200 members via "Load more"
- WHEN the user types a search query
- THEN the visible count SHALL reset to 50
- AND only the first 50 matching results SHALL render

### Requirement: Offline Search Capability

The system SHALL perform search entirely from the local Dexie cache without requiring network connectivity. All search behavior SHALL work identically online and offline.

#### Scenario: Search works offline

- GIVEN the device is offline with cached member data in Dexie
- WHEN the user types a search query
- THEN the grid SHALL filter and display matching members
- AND no network request SHALL be attempted for search
