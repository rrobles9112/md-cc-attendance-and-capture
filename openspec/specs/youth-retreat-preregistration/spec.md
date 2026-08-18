# Youth Retreat Preregistration Specification

## Purpose

Unauthenticated youth (and legal representatives) SHALL pre-register for the October 2026 youth retreat through a public Spanish form. Submissions MUST persist as dedicated retreat registrations with Ley 1581 consent on the registration row, and MUST NOT write attendance `members` or the offline Dexie/sync queue.

## ADDED Requirements

### Requirement: Public Retreat Form

The system MUST expose `/retiro` outside the authenticated dashboard. An unauthenticated visitor MUST load the page without a login session. The page MUST reuse the member capture form fields (not a forked field set) and MUST present Spanish retreat copy, including titles that identify pre-registration (not complete inscription). The page MUST display a Spanish Ley 1581 privacy notice whose purpose is retreat pre-registration, not attendance-only capture.

#### Scenario: Unauthenticated load of /retiro

- GIVEN a visitor with no authentication session
- WHEN the visitor opens `/retiro`
- THEN the public pre-registration form SHALL render
- AND the visitor SHALL NOT be redirected to login

#### Scenario: Spanish retreat copy and privacy notice

- GIVEN the public `/retiro` page is displayed
- WHEN the visitor reads the form chrome and privacy notice
- THEN titles and actions SHALL be Spanish retreat pre-registration copy
- AND a Spanish privacy notice for retreat pre-registration SHALL be visible

### Requirement: General Consent Required

The system MUST reject a public pre-registration submit when general (Ley 1581) consent is not accepted. The system MUST NOT create a `retreat_registrations` row without that consent.

#### Scenario: Submit without general consent is rejected

- GIVEN `/retiro` is filled with required identity fields
- AND general consent is not accepted
- WHEN the visitor submits
- THEN the system SHALL reject the submit
- AND no `retreat_registrations` row SHALL be created

#### Scenario: Submit with general consent may proceed

- GIVEN `/retiro` is filled with required identity fields
- AND general consent is accepted
- AND no other validation rule fails
- WHEN the visitor submits
- THEN the system SHALL accept the request for RPC persistence

### Requirement: RPC Pre-registration Persistence

A successful public submit MUST execute the retreat registration RPC and MUST create one `retreat_registrations` row with status `preinscrito`. That row MUST store general-consent evidence (accepted-at timestamp and policy version) on the registration itself, not in `consent_records`. The submit MUST NOT insert into `members`. The public adapter MUST NOT write Dexie and MUST NOT enqueue a sync job.

#### Scenario: Successful RPC creates preinscrito with consent on the row

- GIVEN a valid `/retiro` payload with general consent accepted
- WHEN the visitor submits
- THEN the RPC SHALL insert one `retreat_registrations` row
- AND that row status SHALL be `preinscrito`
- AND the row SHALL contain general-consent timestamp and policy version

#### Scenario: Successful submit does not insert members

- GIVEN a valid public pre-registration submit
- WHEN the RPC completes successfully
- THEN `members` SHALL contain no new row for that person
- AND `consent_records` SHALL contain no new row for that submit

#### Scenario: Public submit does not write Dexie or enqueue

- GIVEN a valid public pre-registration submit on `/retiro`
- WHEN the visitor submits
- THEN the client SHALL NOT add a Dexie `members` record
- AND the client SHALL NOT enqueue a sync insert

### Requirement: Authenticated Capture Adapter Unchanged

Authenticated `/capture` MUST keep the default submit path. When no retreat adapter is supplied, the member capture form MUST persist through Dexie and the sync queue as before this change.

#### Scenario: /capture still uses Dexie and enqueue

- GIVEN an authenticated leader on `/capture`
- WHEN the leader submits a valid member capture
- THEN the client SHALL add the member in Dexie
- AND the client SHALL enqueue a `members` insert

#### Scenario: /capture does not call the retreat RPC

- GIVEN an authenticated leader on `/capture`
- WHEN the leader submits a valid member capture
- THEN the retreat registration RPC SHALL NOT be invoked
- AND no `retreat_registrations` row SHALL be created

### Requirement: Minor Legal Representative

When date of birth indicates a minor, the system MUST require a legal representative. The system MUST reject the submit when that representative is missing. An adult registrant MUST NOT be required to provide a legal representative.

#### Scenario: Minor without legal representative is rejected

- GIVEN date of birth that makes the registrant a minor
- AND legal-representative fields are empty
- WHEN the visitor submits `/retiro`
- THEN the system SHALL reject the submit
- AND no `retreat_registrations` row SHALL be created

#### Scenario: Minor with legal representative is accepted

- GIVEN date of birth that makes the registrant a minor
- AND required legal-representative fields are provided
- AND general consent and required identity fields are valid
- WHEN the visitor submits `/retiro`
- THEN the RPC SHALL create a `preinscrito` registration
- AND the row SHALL include the legal-representative data

### Requirement: Sensitive Religious Data Consent

The system MUST persist sensitive religious fields (denomination and community name) on the registration only when sensitive consent is accepted. When sensitive consent is not accepted, those fields MUST NOT be stored.

#### Scenario: Sensitive fields stored with sensitive consent

- GIVEN denomination and community name are filled
- AND sensitive consent is accepted
- AND the submit is otherwise valid
- WHEN the visitor submits `/retiro`
- THEN the registration row SHALL store those sensitive values

#### Scenario: Sensitive fields omitted without sensitive consent

- GIVEN denomination and community name are filled
- AND sensitive consent is not accepted
- AND the submit is otherwise valid
- WHEN the visitor submits `/retiro`
- THEN the registration SHALL be created
- AND denomination and community name SHALL be empty or null on the row

### Requirement: Anonymous PostgREST Isolation

The anonymous role MUST NOT SELECT, INSERT, UPDATE, or DELETE `retreat_registrations` or any child tables through PostgREST. Anonymous insert MUST be possible only by EXECUTE of the registration RPC.

#### Scenario: Anon SELECT on retreat tables is denied

- GIVEN a request using the anonymous key
- WHEN the client selects `retreat_registrations` or a child table via PostgREST
- THEN the operation SHALL fail or return no rows under RLS
- AND no registration PII SHALL be readable

#### Scenario: Anon direct DML on retreat tables is denied

- GIVEN a request using the anonymous key
- WHEN the client INSERT, UPDATE, or DELETE `retreat_registrations` or a child table via PostgREST
- THEN the operation SHALL fail
- AND no row SHALL be written or removed

#### Scenario: Anon RPC execute is allowed for insert

- GIVEN a valid pre-registration payload
- WHEN the anonymous client executes the registration RPC
- THEN the RPC SHALL insert the `preinscrito` row
- AND PostgREST table INSERT SHALL remain denied

### Requirement: Duplicate Contact Uniqueness

For the same `event_key`, the system MUST reject a second registration with the same email or the same phone. Uniqueness is `(event_key, email)` and `(event_key, phone)`. Duplicate submits MUST NOT create a second row. The same email or phone MAY register for a different `event_key`.

#### Scenario: Duplicate email for the same event is rejected

- GIVEN an existing registration for event_key `youth-retreat-2026-10` with email `ana@example.com`
- WHEN a visitor submits another registration for that event_key with the same email
- THEN the system SHALL reject the submit
- AND no second `retreat_registrations` row SHALL exist for that pair

#### Scenario: Duplicate phone for the same event is rejected

- GIVEN an existing registration for event_key `youth-retreat-2026-10` with phone `3001234567`
- WHEN a visitor submits another registration for that event_key with the same phone
- THEN the system SHALL reject the submit
- AND no second `retreat_registrations` row SHALL exist for that pair

### Requirement: Required Identity Fields

The system MUST require name, phone, and email on public pre-registration. A submit missing any of those fields MUST be rejected and MUST NOT create a registration.

#### Scenario: Missing name is rejected

- GIVEN phone and email are filled and general consent is accepted
- AND name is empty
- WHEN the visitor submits `/retiro`
- THEN the system SHALL reject the submit
- AND no `retreat_registrations` row SHALL be created

#### Scenario: Missing phone or email is rejected

- GIVEN name is filled and general consent is accepted
- AND phone is empty or email is empty
- WHEN the visitor submits `/retiro`
- THEN the system SHALL reject the submit
- AND no `retreat_registrations` row SHALL be created
