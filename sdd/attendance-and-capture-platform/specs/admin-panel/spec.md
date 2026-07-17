# Admin Panel Specification

## Purpose

Provide administrative interfaces for user management, role assignment, audit log viewing, sync health monitoring, ARCO/DSAR request management, and data retention purge controls. Restricted to super_admin for destructive operations.

## Requirements

### Requirement: User Management

The system MUST allow super_admin to list, create, edit, and deactivate user accounts. The system SHALL display each user's role and account status.

#### Scenario: List all users

- GIVEN 5 users exist with various roles
- WHEN a super_admin opens the user management page
- THEN all 5 users are displayed with name, email, role, and status

#### Scenario: Create a new user

- GIVEN a super_admin is on the user management page
- WHEN the admin creates a user with email "leader@church.com" and role "leader"
- THEN the user account is created
- AND the new user appears in the user list

#### Scenario: Deactivate a user

- GIVEN an active user "server@church.com" exists
- WHEN a super_admin deactivates the user
- THEN the user cannot log in
- AND the user's status shows "inactive"

### Requirement: Role Assignment

The system MUST allow super_admin to change a user's role. Role changes SHALL be reflected in the user's JWT on next login.

#### Scenario: Change user role

- GIVEN user "leader@church.com" has role "leader"
- WHEN a super_admin changes the role to "server"
- THEN the role is updated in the database
- AND the user's next JWT contains role = "server"

#### Scenario: Cannot self-demote

- GIVEN a super_admin is viewing their own account
- WHEN the admin attempts to change their own role
- THEN the system prevents the action
- AND displays a message that self-demotion is not allowed

### Requirement: Audit Log Viewer

The system MUST display the audit log with filtering by table, action, user, and date range. Each entry SHALL show user_id, action, table, record_id, old_value, new_value, and timestamp.

#### Scenario: Filter audit log by table

- GIVEN 100 audit entries exist across members, attendance, and sessions
- WHEN a super_admin filters by table = "members"
- THEN only members-related audit entries are displayed

#### Scenario: Filter audit log by date range

- GIVEN audit entries span January to July 2026
- WHEN a super_admin filters for July 2026
- THEN only July entries are displayed

#### Scenario: View audit entry detail

- GIVEN an audit entry exists for a member update
- WHEN a super_admin clicks the entry
- THEN the old and new values are displayed in a diff view

### Requirement: Sync Health Dashboard

The system MUST display sync health metrics including pending operations count, last sync timestamp, sync success/failure rate, and connection status.

#### Scenario: View sync health

- GIVEN 3 devices have pending sync operations
- WHEN a super_admin views the sync health dashboard
- THEN the dashboard shows total pending operations per device
- AND the last successful sync timestamp for each device

#### Scenario: Sync failure alert

- GIVEN a device has failed to sync for 24 hours
- WHEN a super_admin views the dashboard
- THEN the device is flagged with a warning indicator

### Requirement: ARCO Request Management

The system MUST allow admins to view, assign, and fulfill ARCO/DSAR requests. The system SHALL track request type, status, deadline, and fulfillment actions.

#### Scenario: View pending ARCO requests

- GIVEN 3 ARCO requests are pending
- WHEN an admin opens the ARCO management page
- THEN all 3 requests are displayed with type, subject name, submission date, and deadline

#### Scenario: Fulfill an access request

- GIVEN an ARCO access request for "Juan Pérez" is pending
- WHEN an admin clicks "Fulfill" and exports the subject's data
- THEN the request status changes to "fulfilled"
- AND the fulfillment date and action are recorded

#### Scenario: ARCO request overdue

- GIVEN an ARCO request's deadline has passed
- WHEN an admin views the ARCO page
- THEN the overdue request is highlighted with a red indicator

### Requirement: Retention Purge Controls

The system MUST allow super_admin to view records eligible for purge (soft-deleted > 90 days) and initiate hard delete. The system SHALL require confirmation before purge.

#### Scenario: View purge-eligible records

- GIVEN 10 records have been soft-deleted for 90+ days
- WHEN a super_admin opens the purge controls
- THEN all 10 records are listed with original data and deletion date

#### Scenario: Purge selected records

- GIVEN 5 records are selected for purge
- WHEN a super_admin confirms the purge action
- THEN the 5 records are permanently deleted
- AND the audit log retains tombstone entries
- AND the remaining 5 eligible records are unaffected

#### Scenario: Purge requires confirmation

- GIVEN a super_admin selects records for purge
- WHEN the admin clicks "Purge"
- THEN a confirmation dialog appears
- AND the purge only executes on explicit confirmation
