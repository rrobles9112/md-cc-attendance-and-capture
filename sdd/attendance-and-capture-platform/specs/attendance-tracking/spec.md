# Attendance Tracking Specification

## Purpose

Track per-session attendance by creating junction records between members and sessions. Supports concurrent marking across multiple sessions with realtime visibility. Operates offline with conflict-free sync via upsert semantics.

## Requirements

### Requirement: Session Creation

The system SHALL allow authorized users (leader, super_admin) to create prayer group sessions. Each session MUST have a name, date, and creator.

#### Scenario: Leader creates a session

- GIVEN the user has role "leader"
- WHEN the user creates a session named "Viernes 18 Julio" with date "2026-07-18"
- THEN the system creates the session record with created_by = current user ID
- AND the session becomes visible to all users

#### Scenario: Server cannot create sessions

- GIVEN the user has role "server"
- WHEN the user attempts to create a session
- THEN the system denies the action
- AND displays an insufficient-permissions message

### Requirement: Attendance Marking

The system SHALL allow servers, leaders, and super_admins to mark attendance for a member in a session. The system MUST upsert on (member_id, session_id) so duplicate marks update the existing record (last-write-wins).

#### Scenario: Mark attendance for a member

- GIVEN session "Viernes 18 Julio" exists and member "Juan Pérez" exists
- WHEN a server marks Juan Pérez as present in the session
- THEN the system creates an attendance record with member_id, session_id, marked_by = current user, and timestamp
- AND the attendance is visible to all connected users in realtime

#### Scenario: Duplicate mark resolves via upsert

- GIVEN Juan Pérez is already marked present in session "Viernes 18 Julio"
- WHEN another server marks Juan Pérez again in the same session
- THEN the system updates the existing record (last-write-wins)
- AND the audit log records both marking events

### Requirement: Attendance List View

The system SHALL display all members marked present for a given session. The list MUST update in realtime as other users mark attendance.

#### Scenario: View attendance for active session

- GIVEN 15 members have been marked in session "Viernes 18 Julio"
- WHEN a leader opens the attendance view for that session
- THEN the system displays all 15 members with their marking timestamps
- AND new marks from other users appear without page refresh

### Requirement: Session List

The system SHALL display all sessions with attendance counts. Sessions MUST be orderable by date.

#### Scenario: View session list

- GIVEN 5 sessions exist with varying attendance counts
- WHEN a user opens the session list
- THEN the system displays each session with name, date, and attendance count
- AND sessions are sorted by date (most recent first)

### Requirement: Offline Attendance Marking

The system MUST allow attendance marking when offline. Marks SHALL persist locally and sync when connectivity is restored.

#### Scenario: Mark attendance while offline

- GIVEN the device has no network connectivity
- WHEN a server marks a member as present
- THEN the attendance record is stored in the local cache
- AND the record is queued for sync
- AND the local attendance list reflects the mark immediately

### Requirement: Concurrent Session Visibility

The system MUST support multiple sessions running concurrently with realtime attendance visibility across all active sessions.

#### Scenario: Two sessions running simultaneously

- GIVEN sessions "Viernes A" and "Viernes B" are both active
- WHEN a server marks attendance in "Viernes A"
- THEN users viewing "Viernes A" see the update in realtime
- AND users viewing "Viernes B" are unaffected
