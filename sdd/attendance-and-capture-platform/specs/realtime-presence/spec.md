# Realtime Presence Specification

## Purpose

Provide realtime visibility of attendance and member data changes across concurrent sessions. When one user marks attendance or captures a member, all connected clients see the update immediately without page refresh.

## Requirements

### Requirement: Realtime Attendance Updates

The system MUST broadcast attendance changes to all connected clients in realtime. When a user marks a member as present, all clients viewing that session SHALL see the update within 2 seconds.

#### Scenario: Attendance mark visible to other users

- GIVEN 3 users are viewing session "Viernes 18 Julio"
- WHEN user A marks member "Juan Pérez" as present
- THEN users B and C see Juan Pérez appear in the attendance list within 2 seconds
- AND no page refresh is required

#### Scenario: Attendance mark in non-viewed session

- GIVEN user A is viewing session "Viernes A" and user B is viewing session "Viernes B"
- WHEN user A marks attendance in "Viernes A"
- THEN user B's view of "Viernes B" is unaffected

### Requirement: Realtime Member Updates

The system MUST broadcast member creation/updates to all connected clients. When a new member is captured, all clients SHALL see the member appear in their local cache.

#### Scenario: New member visible across clients

- GIVEN 2 users are on the members list
- WHEN user A captures a new member "María López"
- THEN user B sees María López appear in the members list within 2 seconds

### Requirement: Connection Scaling

The system MUST support at least 20 concurrent users. The system SHOULD handle up to 50 concurrent users without degradation.

#### Scenario: 20 concurrent connections

- GIVEN 20 users are connected simultaneously
- WHEN any user makes a change
- THEN all 20 users receive the realtime update within 2 seconds

### Requirement: Connection Recovery

The system MUST automatically reconnect the realtime subscription when the connection drops. The system SHALL resynchronize missed changes upon reconnection.

#### Scenario: Reconnect after network drop

- GIVEN a realtime connection is established
- WHEN the network drops for 10 seconds and reconnects
- THEN the system re-establishes the realtime subscription
- AND fetches any changes that occurred during the disconnection

#### Scenario: Reconnect after app backgrounding

- GIVEN a user backgrounds the app on mobile
- WHEN the user returns to the foreground
- THEN the system re-establishes the realtime subscription if needed
- AND displays current data

### Requirement: Local Cache Sync

The system MUST update the local cache when realtime changes are received. The UI SHALL reflect changes from the local cache, not directly from the realtime channel.

#### Scenario: Realtime update persists to local cache

- GIVEN a realtime event indicates member "Juan Pérez" was updated
- WHEN the system processes the event
- THEN the local cache is updated with the new data
- AND the UI re-renders from the local cache
