# RBAC Auth Specification

## Purpose

Enforce role-based access control with three roles: super_admin (full access including delete and hard delete), leader (read all + create, cannot modify or delete), and server (marks attendance). Enforcement happens at the database layer (RLS) with app-level UX guards.

## Requirements

### Requirement: Authentication

The system MUST authenticate users via Supabase Auth. The system SHALL support email/password authentication. JWT tokens MUST carry a custom `role` claim.

#### Scenario: User logs in with valid credentials

- GIVEN a user exists with email "admin@church.com" and role "super_admin"
- WHEN the user provides valid credentials
- THEN the system returns a JWT with role = "super_admin"
- AND the user is redirected to the dashboard

#### Scenario: User logs in with invalid credentials

- GIVEN no user exists with email "unknown@church.com"
- WHEN the user attempts login
- THEN the system returns an authentication error
- AND no JWT is issued

### Requirement: Three-Role Model

The system MUST support exactly three roles: super_admin, leader, server. Each role SHALL have distinct permissions enforced at the database layer.

#### Scenario: Role assignment on user creation

- GIVEN an admin creates a new user
- WHEN the user record is created
- THEN the system assigns one of the three roles
- AND the role is stored in the users table and reflected in JWT claims

### Requirement: Super Admin Permissions

Super_admin MUST have full CRUD access to all tables including the ability to soft-delete and hard-delete records. Only super_admin can perform hard deletes.

#### Scenario: Super admin deletes a member

- GIVEN the user has role "super_admin"
- WHEN the user soft-deletes member "Juan Pérez"
- THEN the member record has deleted_at set to the current timestamp
- AND the audit log records the deletion

#### Scenario: Super admin hard-deletes a record

- GIVEN a member has been soft-deleted for 90+ days
- WHEN the super_admin performs a hard delete
- THEN the record is permanently removed
- AND the audit log retains a tombstone entry

### Requirement: Leader Permissions

Leader MUST have read access to all records and create (insert) access. Leader MUST NOT be able to update or delete existing records.

#### Scenario: Leader creates a member

- GIVEN the user has role "leader"
- WHEN the user captures a new member
- THEN the member record is created successfully

#### Scenario: Leader cannot update a member

- GIVEN the user has role "leader"
- WHEN the user attempts to update an existing member's phone number
- THEN the system denies the action via RLS policy
- AND displays an insufficient-permissions message

#### Scenario: Leader cannot delete a member

- GIVEN the user has role "leader"
- WHEN the user attempts to delete a member
- THEN the system denies the action
- AND the delete button is hidden in the UI (app-level guard)

### Requirement: Server Permissions

Server MUST have read access to members and sessions, and insert access to the attendance table. Server MUST NOT be able to create members, create sessions, or delete any records.

#### Scenario: Server marks attendance

- GIVEN the user has role "server"
- WHEN the user marks a member as present in a session
- THEN the attendance record is created

#### Scenario: Server cannot capture members

- GIVEN the user has role "server"
- WHEN the user attempts to access the capture form
- THEN the system denies access
- AND the capture form is not visible in the navigation

### Requirement: RLS Enforcement

All database tables MUST have Row Level Security policies. No row SHALL be readable or writable without a matching RLS policy. RLS policies MUST check the JWT role claim.

#### Scenario: Direct API bypass attempt

- GIVEN a user with role "leader" has a valid JWT
- WHEN the user sends a direct PATCH request to the members table (bypassing the UI)
- THEN the RLS policy rejects the update
- AND no data is modified

### Requirement: Data Transmission Agreement Context

The system MUST document that Supabase acts as a Data Processor. The JWT role claim and RLS policies enforce that users only access data within their permitted scope.

#### Scenario: JWT contains role claim

- GIVEN a user with role "server" authenticates
- WHEN the JWT is issued
- THEN the JWT contains a `role` claim with value "server"
- AND RLS policies evaluate this claim for every query
