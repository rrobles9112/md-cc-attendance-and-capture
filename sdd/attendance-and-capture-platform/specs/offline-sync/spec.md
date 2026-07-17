# Offline Sync Specification

## Purpose

Provide offline-first data access and mutation via a local cache. Queue writes when offline and flush to the server on reconnect. Resolve conflicts deterministically. Ensure zero data loss during offline-to-online transitions.

## Requirements

### Requirement: Local Cache Hydration

The system MUST hydrate the local cache from the server on app load. The UI SHALL render from local cache for instant display and offline operation.

#### Scenario: App loads with connectivity

- GIVEN the device has network connectivity
- WHEN the user opens the app
- THEN the system fetches members, sessions, and attendance from the server
- AND populates the local cache
- AND the UI renders from the local cache

#### Scenario: App loads without connectivity

- GIVEN the device has no network connectivity
- WHEN the user opens the app
- THEN the system loads data from the local cache
- AND the UI renders the previously cached data

### Requirement: Write Queue

The system MUST queue all write operations (create, update, delete) to a sync queue when offline. The queue SHALL persist across app restarts.

#### Scenario: Queue a create operation offline

- GIVEN the device is offline
- WHEN the user creates a new member
- THEN the member is stored in the local cache
- AND the create operation is enqueued with operation type, table, payload, and timestamp

#### Scenario: Queue survives app restart

- GIVEN 3 operations are queued while offline
- WHEN the user closes and reopens the app
- THEN the 3 queued operations are still present in the queue

### Requirement: Queue Flush on Reconnect

The system MUST flush the sync queue to the server when connectivity is restored. Flush SHALL process operations in FIFO order.

#### Scenario: Flush after reconnect

- GIVEN 5 operations are queued
- WHEN the device regains connectivity
- THEN the system processes all 5 operations in order
- AND clears the queue after successful flush
- AND updates the sync health indicator to "synced"

#### Scenario: Partial flush failure

- GIVEN 5 operations are queued
- WHEN the device regains connectivity and operation 3 fails
- THEN operations 1 and 2 are flushed successfully
- AND operation 3 is retained in the queue with an error flag
- AND operations 4 and 5 are retained pending retry

### Requirement: Conflict Resolution — Attendance

The system MUST resolve attendance conflicts via upsert on (member_id, session_id). Last-write-wins based on timestamp. The audit log SHALL record all conflicting writes.

#### Scenario: Conflicting attendance marks

- GIVEN device A marks member M in session S at time T1 (offline)
- AND device B marks member M in session S at time T2 > T1 (online)
- WHEN device A syncs
- THEN the upsert resolves to T2's data (last-write-wins)
- AND the audit log contains both T1 and T2 marking events

### Requirement: Conflict Resolution — Member Capture

The system MUST detect potential duplicate members during sync via fuzzy match on normalized name + phone or exact match on email. Duplicates SHALL be flagged for admin review.

#### Scenario: Duplicate member detected on sync

- GIVEN device A captures "Juan Pérez" with phone "+573001234567" (offline)
- AND device B captures "Juan Perez" with phone "+573001234567" (offline)
- WHEN both devices sync
- THEN the system detects the fuzzy match
- AND flags both records as potential duplicates
- AND an admin can review and merge or dismiss

### Requirement: BackgroundSync Safety Net

The system SHOULD use the BackgroundSync API as a safety net for write retries when available. On platforms without BackgroundSync (iOS Safari), the system MUST use an interval-based retry fallback.

#### Scenario: BackgroundSync triggers retry (supported browser)

- GIVEN queued operations exist and the browser supports BackgroundSync
- WHEN the device regains connectivity
- THEN the browser's BackgroundSync event triggers queue flush

#### Scenario: iOS Safari fallback

- GIVEN queued operations exist on iOS Safari
- WHEN the app is open and connectivity is restored
- THEN an interval-based retry mechanism flushes the queue

### Requirement: Sync Health Indicator

The system MUST display a sync health indicator showing current status (synced, syncing, offline, error) and the number of pending operations.

#### Scenario: Sync health displays pending count

- GIVEN 4 operations are queued
- WHEN the user views the sync indicator
- THEN it shows "4 pending" with offline status

#### Scenario: Sync health shows success

- GIVEN the queue is empty and last sync succeeded
- WHEN the user views the sync indicator
- THEN it shows "Synced" with a green indicator

### Requirement: No Data Loss Guarantee

The system MUST NOT lose any user-initiated data during offline-to-online transitions. All queued operations SHALL eventually be flushed or explicitly flagged as failed.

#### Scenario: Full offline-to-online cycle

- GIVEN the user captures 3 members and marks 10 attendance records while offline
- WHEN connectivity is restored
- THEN all 13 operations are synced to the server
- AND no data is lost
