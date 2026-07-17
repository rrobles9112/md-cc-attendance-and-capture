# Data Export Specification

## Purpose

Export member and attendance data as CSV or XLSX files compatible with Numbers, Google Sheets, and Excel. Client-side generation for bounded datasets (~100 members). Also serves as ARCO access/export fulfillment.

## Requirements

### Requirement: Export Format Support

The system MUST support export in CSV and XLSX formats. Exported files SHALL be compatible with Numbers, Google Sheets, and Excel.

#### Scenario: Export as XLSX

- GIVEN the user requests an export of all members in XLSX format
- WHEN the export is generated
- THEN the system produces a valid .xlsx file
- AND the file opens correctly in Numbers, Google Sheets, and Excel

#### Scenario: Export as CSV

- GIVEN the user requests an export of all members in CSV format
- WHEN the export is generated
- THEN the system produces a valid .csv file with UTF-8 encoding
- AND the file opens correctly in spreadsheet applications

### Requirement: Member Data Export

The system MUST export member data including name, phone, email, birthday, social media, WhatsApp numbers, and religious background (if consented). Soft-deleted members MUST be excluded by default.

#### Scenario: Export active members

- GIVEN 80 active members and 5 soft-deleted members exist
- WHEN the user exports members
- THEN the export contains 80 members
- AND soft-deleted members are not included

#### Scenario: Export includes all consented fields

- GIVEN a member has name, phone, email, birthday, and Instagram handle
- WHEN the export is generated
- THEN the member's row includes all available fields
- AND religious background is included only if the member consented

### Requirement: Attendance Export

The system MUST export attendance data for a selected session or date range. The export SHALL include member name, session name, date, and marking timestamp.

#### Scenario: Export session attendance

- GIVEN session "Viernes 18 Julio" has 25 attendance records
- WHEN the user exports attendance for that session
- THEN the export contains 25 rows with member name, session, date, and timestamp

#### Scenario: Export attendance date range

- GIVEN 10 sessions exist in July 2026
- WHEN the user exports attendance for July 2026
- THEN the export contains attendance records from all 10 sessions

### Requirement: Client-Side Generation

The system MUST generate export files entirely on the client side. No server-side processing SHALL be required for export.

#### Scenario: Export works offline

- GIVEN the device is offline and local cache has member data
- WHEN the user requests an export
- THEN the export file is generated from local cache
- AND the download completes successfully

### Requirement: ARCO Access Fulfillment

The system MUST support exporting a single data subject's information as part of an ARCO access request. The export SHALL include all data associated with that subject.

#### Scenario: Export for ARCO access request

- GIVEN an ARCO access request exists for member "Juan Pérez"
- WHEN an admin fulfills the request
- THEN the system generates an export containing all of Juan Pérez's data
- AND the export is linked to the ARCO request record

### Requirement: Bounded Dataset Performance

The system MUST handle exports of up to 500 records without performance degradation. The export SHOULD complete within 5 seconds for the expected dataset size (~100 members).

#### Scenario: Export 100 members

- GIVEN 100 member records exist
- WHEN the user exports all members as XLSX
- THEN the export completes within 5 seconds
- AND the file size is reasonable (< 1MB)
