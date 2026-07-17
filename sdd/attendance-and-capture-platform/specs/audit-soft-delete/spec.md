# Audit & Soft Delete Specification

## Purpose

Log all data mutations (inserts, updates, deletes) via Postgres triggers to an audit_log table. Provide soft delete (deleted_at) with 90-day retention before purge eligibility. Support ARCO rights (access, rectification, cancellation, opposition) with statutory response deadlines. Log consent events with policy versioning.

## Requirements

### Requirement: Mutation Audit Logging

The system MUST log every INSERT, UPDATE, and DELETE on mutable tables via Postgres AFTER triggers. Each audit entry SHALL include user_id, action, table_name, record_id, old_value (JSONB), new_value (JSONB), and timestamp.

#### Scenario: Insert logged

- GIVEN a new member is created
- WHEN the INSERT completes
- THEN an audit_log entry is created with action = "INSERT", table = "members", record_id = new member ID, new_value = member data, old_value = null

#### Scenario: Update logged

- GIVEN a member's phone is changed from "+573001" to "+573002"
- WHEN the UPDATE completes
- THEN an audit_log entry is created with action = "UPDATE", old_value containing "+573001", new_value containing "+573002"

#### Scenario: Delete logged

- GIVEN a member is soft-deleted
- WHEN the DELETE trigger fires
- THEN an audit_log entry is created with action = "DELETE", old_value = member data

### Requirement: Consent Event Logging

The system MUST log consent events (acceptance, revocation) to the audit log with the policy version shown to the user and the timestamp of acceptance.

#### Scenario: General consent logged

- GIVEN a user accepts the general consent on the capture form
- WHEN the consent is recorded
- THEN an audit_log entry is created with action = "CONSENT_GENERAL", policy_version = "v1.0", timestamp = acceptance time

#### Scenario: Sensitive data consent logged

- GIVEN a user accepts the religious-background opt-in
- WHEN the consent is recorded
- THEN a separate audit_log entry is created with action = "CONSENT_SENSITIVE", policy_version = "v1.0"

### Requirement: Soft Delete

All mutable tables MUST have a deleted_at column. Queries MUST filter WHERE deleted_at IS NULL by default. Setting deleted_at marks a record as deleted without removing it.

#### Scenario: Soft delete a member

- GIVEN a super_admin deletes member "Juan Pérez"
- WHEN the deletion is processed
- THEN deleted_at is set to the current timestamp
- AND the member no longer appears in default queries
- AND the member data is still in the database

#### Scenario: Soft-deleted record excluded from queries

- GIVEN a member with deleted_at = "2026-07-01" exists
- WHEN a user queries the members list
- THEN the soft-deleted member is NOT included in results

### Requirement: 90-Day Retention and Purge

Soft-deleted records MUST be retained for 90 days. After 90 days, records become eligible for permanent purge. The purge process SHALL be restricted to super_admin.

#### Scenario: Record eligible for purge after 90 days

- GIVEN a member was soft-deleted on 2026-01-01
- WHEN the current date is 2026-04-01 (90+ days later)
- THEN the record is eligible for purge
- AND a super_admin can initiate hard delete

#### Scenario: Record not eligible before 90 days

- GIVEN a member was soft-deleted on 2026-06-15
- WHEN the current date is 2026-07-16 (31 days later)
- THEN the record is NOT eligible for purge
- AND hard delete is not available

### Requirement: Hard Delete

Hard delete MUST permanently remove a record from the database. Hard delete SHALL be restricted to super_admin via RLS. The audit log MUST retain a tombstone entry after hard delete.

#### Scenario: Super admin hard-deletes

- GIVEN a soft-deleted member is eligible for purge
- WHEN a super_admin performs hard delete
- THEN the record is permanently removed from the table
- AND the audit log retains an entry with action = "HARD_DELETE" and the record's final state

#### Scenario: Non-admin cannot hard-delete

- GIVEN a soft-deleted member is eligible for purge
- WHEN a leader attempts hard delete
- THEN the RLS policy denies the action

### Requirement: ARCO Rights — Access

The system MUST provide a data-subject access request (DSAR) workflow. When a person requests access to their data, the system SHALL respond within 10 business days.

#### Scenario: Access request submitted

- GIVEN a data subject submits an access request
- WHEN the request is recorded
- THEN the system creates an ARCO request with type = "ACCESS" and deadline = 10 business days
- AND the admin panel shows the pending request

#### Scenario: Access request fulfilled via export

- GIVEN a pending access request exists
- WHEN an admin fulfills it by exporting the subject's data
- THEN the ARCO request status is updated to "fulfilled"
- AND the audit log records the fulfillment

### Requirement: ARCO Rights — Rectification, Cancellation, Opposition

The system MUST support rectification, cancellation, and opposition requests with a 15-business-day response deadline.

#### Scenario: Rectification request

- GIVEN a data subject requests correction of their phone number
- WHEN the request is recorded
- THEN the system creates an ARCO request with type = "RECTIFICATION" and deadline = 15 business days

#### Scenario: Cancellation request

- GIVEN a data subject requests deletion of their data
- WHEN the request is recorded
- THEN the system creates an ARCO request with type = "CANCELLATION"
- AND upon fulfillment, the member record is soft-deleted

### Requirement: Breach Notification

The system MUST support a breach notification workflow. When a data breach is detected, the system SHALL facilitate notification to SIC within 15 business days.

#### Scenario: Breach recorded

- GIVEN a data breach is detected
- WHEN the breach is logged in the system
- THEN a breach record is created with detection_date and notification_deadline = 15 business days
- AND the admin panel surfaces the breach with countdown
