# Member Capture Specification

## Purpose

Capture first-time visitor personal data through a form that complies with Colombian Ley 1581 de 2012 (Habeas Data). The form collects contact information, optional social media, WhatsApp, birthday, and religious background (sensitive data with separate consent). Data persists locally for offline use and syncs to the server.

## Requirements

### Requirement: General Consent

The system MUST obtain prior, express, and informed consent before collecting any personal data. Consent MUST NOT use pre-checked boxes. The consent notice MUST be in Spanish. The system MUST record consent with a timestamp and policy version in the audit log.

#### Scenario: User accepts general consent

- GIVEN the capture form is displayed
- WHEN the user checks the general consent checkbox (unchecked by default) and submits
- THEN the system stores the member data with consent_recorded = true
- AND logs the consent event with timestamp and policy version to the audit log

#### Scenario: User submits without consent

- GIVEN the capture form is displayed
- WHEN the user submits without checking the general consent checkbox
- THEN the system rejects the submission
- AND displays an error indicating consent is required

### Requirement: Required Contact Fields

The system SHALL require name, phone, and email for every captured member. The system MUST normalize name and phone for duplicate detection.

#### Scenario: Successful capture with all required fields

- GIVEN the user has accepted general consent
- WHEN the user provides name "Juan Pérez", phone "+573001234567", and email "juan@example.com"
- THEN the system creates a member record with the provided data
- AND the record is queued for sync

#### Scenario: Missing required field

- GIVEN the user has accepted general consent
- WHEN the user submits with an empty phone field
- THEN the system rejects the submission
- AND highlights the missing phone field

### Requirement: Conditional Social Media

The system MAY collect social media handles for Instagram, TikTok, Facebook, X, and a freeform "other" platform. Social media fields are optional.

#### Scenario: Capture with social media

- GIVEN the user is filling the capture form
- WHEN the user adds an Instagram handle "@juanp"
- THEN the system stores the social media entry linked to the member
- AND the entry includes platform type and handle

#### Scenario: Capture without social media

- GIVEN the user is filling the capture form
- WHEN the user skips all social media fields and submits
- THEN the system creates the member record without social media entries

### Requirement: WhatsApp Number

The system MAY collect a WhatsApp number. The system SHALL distinguish between the primary phone (has-WhatsApp flag) and an additional WhatsApp-only number.

#### Scenario: Primary phone has WhatsApp

- GIVEN the user entered phone "+573001234567"
- WHEN the user indicates the primary phone has WhatsApp
- THEN the system marks the primary phone with has_whatsapp = true

#### Scenario: Additional WhatsApp number

- GIVEN the user entered a primary phone
- WHEN the user provides a separate WhatsApp number "+573009876543"
- THEN the system stores the additional number as a WhatsApp-specific entry

### Requirement: Birthday Collection

The system MAY collect date of birth for birthday campaigns. If the DOB indicates the person is under 18, the system MUST require legal-representative authorization.

#### Scenario: Adult birthday capture

- GIVEN the user enters DOB "1990-05-15"
- WHEN the form validates the DOB
- THEN the system stores the birthday and proceeds normally

#### Scenario: Minor birthday capture

- GIVEN the user enters DOB indicating age < 18
- WHEN the form validates the DOB
- THEN the system requires legal-representative name and authorization
- AND stores the minor flag with representative details

### Requirement: Religious Background (Sensitive Data)

The system MUST collect religious background (denomination and community name) as optional sensitive data. The system SHALL display a separate, explicit opt-in with a notice that the person is NOT obliged to provide this information and that refusing has no negative consequence. This opt-in MUST NOT be bundled with the general consent.

#### Scenario: User opts into religious background

- GIVEN the capture form displays the separate religious-background consent
- WHEN the user checks the religious-background checkbox and provides denomination "Catholic" and community "Comunidad San Pablo"
- THEN the system stores the religious data linked to the member
- AND logs the sensitive-data consent event separately in the audit log

#### Scenario: User declines religious background

- GIVEN the capture form displays the separate religious-background consent
- WHEN the user leaves the religious-background checkbox unchecked and submits
- THEN the system creates the member record without religious data
- AND the submission is accepted without penalty

### Requirement: Privacy Notice

The system MUST display a privacy notice (in Spanish) at the capture form, informing the data subject of the controller's identity, purposes, their ARCO rights, and the existence of the Personal Data Treatment Policy.

#### Scenario: Privacy notice displayed

- GIVEN the capture form is loaded
- WHEN the user views the form
- THEN a visible privacy notice in Spanish is displayed
- AND includes a link to the full Personal Data Treatment Policy
