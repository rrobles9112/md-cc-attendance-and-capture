# Youth Retreat Payments Specification

## Purpose

Leaders and super_admins SHALL record successive installment payments against retreat pre-registrations until the staff-configured total is covered. Status MUST follow `preinscrito` → `pagos_parciales` → `inscrito`. The public form MUST NOT collect money. No default price MAY be invented.

## ADDED Requirements

### Requirement: Configured Positive Total Required

The retreat total cost MUST come from `app_settings` key `retreat.youth.total_cost`. The system MUST NOT invent a numeric default. A payment insert MUST be refused until that setting is a positive number.

#### Scenario: Payment refused when total is unset

- GIVEN `retreat.youth.total_cost` is missing or empty
- AND a `preinscrito` registration exists
- WHEN a leader attempts to record an installment
- THEN the payment SHALL be refused
- AND no `retreat_payments` row SHALL be created
- AND registration status SHALL remain `preinscrito`

#### Scenario: Payment refused when total is not positive

- GIVEN `retreat.youth.total_cost` is `0` or a negative number
- AND a `preinscrito` registration exists
- WHEN a leader attempts to record an installment
- THEN the payment SHALL be refused
- AND no `retreat_payments` row SHALL be created

### Requirement: Super Admin Sets Total Cost

Only `super_admin` MUST be allowed to set `retreat.youth.total_cost`. `leader` and `server` MUST NOT update that setting.

#### Scenario: Super admin sets a positive total

- GIVEN an authenticated `super_admin`
- WHEN that user sets `retreat.youth.total_cost` to a positive number
- THEN the setting SHALL persist that value
- AND subsequent valid payment inserts SHALL be allowed

#### Scenario: Leader cannot set total cost

- GIVEN an authenticated `leader`
- WHEN that user attempts to set `retreat.youth.total_cost`
- THEN the update SHALL be refused
- AND the stored total SHALL be unchanged

### Requirement: Staff List and Consecutive Payments

`leader` and `super_admin` MUST list retreat registrations and MUST record consecutive installment payments (successive positive amounts that accumulate). Status MUST be derived from the payment sum, not a staff-edited dropdown.

#### Scenario: Leader lists registrations and records an installment

- GIVEN a positive configured total
- AND at least one `preinscrito` registration
- AND an authenticated `leader`
- WHEN the leader opens the staff retreat page and records a positive installment less than the total
- THEN the payment SHALL persist
- AND the registration SHALL appear in the staff list

#### Scenario: Super admin records a subsequent installment

- GIVEN a registration with an existing payment whose sum is still below the total
- AND an authenticated `super_admin`
- WHEN that user records another positive installment
- THEN the new payment SHALL persist
- AND the registration payment sum SHALL include both installments

### Requirement: Server Role Denied Staff Payments

The `server` role MUST NOT record retreat payments and MUST NOT open the staff retreat payments page.

#### Scenario: Server cannot insert payments

- GIVEN an authenticated `server` session
- WHEN that role inserts into `retreat_payments`
- THEN the operation SHALL fail
- AND no payment row SHALL be created

#### Scenario: Server cannot open the staff page

- GIVEN an authenticated `server` user
- WHEN that user requests the staff retreat registrations page
- THEN access SHALL be denied
- AND no payment UI SHALL be shown

### Requirement: Payment Status Machine

Registration status MUST be `preinscrito` when the payment sum is `0`, `pagos_parciales` when `0 < sum < total`, and `inscrito` when `sum >= total`. Reaching `inscrito` MUST NOT insert a `members` row.

#### Scenario: Zero sum stays preinscrito

- GIVEN a registration with no payments
- AND a positive configured total
- WHEN status is evaluated
- THEN status SHALL be `preinscrito`

#### Scenario: Partial sum becomes pagos_parciales

- GIVEN a positive configured total of `100`
- AND payments that sum to `40`
- WHEN status is evaluated
- THEN status SHALL be `pagos_parciales`
- AND the registration SHALL NOT be `inscrito`

#### Scenario: Covered sum becomes inscrito without members insert

- GIVEN a positive configured total of `100`
- AND payments that sum to `100`
- WHEN status is evaluated
- THEN status SHALL be `inscrito`
- AND `members` SHALL receive no new row

### Requirement: Overpayment Allowed

The system MUST accept an installment that makes the payment sum exceed the configured total. The registration MUST become `inscrito`. Overpayment MUST NOT be rejected solely because the sum exceeds the total.

#### Scenario: Overpayment is accepted and marked inscrito

- GIVEN a positive configured total of `100`
- AND existing payments summing to `80`
- WHEN staff records an installment of `50`
- THEN the payment SHALL persist
- AND status SHALL be `inscrito`

#### Scenario: Exact total is also inscrito

- GIVEN a positive configured total of `100`
- AND existing payments summing to `70`
- WHEN staff records an installment of `30`
- THEN the payment SHALL persist
- AND status SHALL be `inscrito`

### Requirement: Positive Payment Amount

The system MUST reject installment amounts that are zero or negative. Rejected amounts MUST NOT change registration status.

#### Scenario: Negative payment is rejected

- GIVEN a positive configured total
- AND a `preinscrito` registration
- WHEN staff records an installment of `-10`
- THEN the payment SHALL be refused
- AND status SHALL remain `preinscrito`

#### Scenario: Zero payment is rejected

- GIVEN a positive configured total
- AND a `preinscrito` registration
- WHEN staff records an installment of `0`
- THEN the payment SHALL be refused
- AND status SHALL remain `preinscrito`

### Requirement: Staff Page Without AdminPage

Leaders MUST reach the staff retreat registrations page without using AdminPage. AdminPage MAY remain super_admin-only. The staff page MUST be reachable from dashboard navigation for `leader` and `super_admin`.

#### Scenario: Leader opens staff retreat page

- GIVEN an authenticated `leader`
- WHEN the leader follows dashboard navigation to retreat registrations
- THEN the staff list and payment recording UI SHALL be available
- AND the leader SHALL NOT be required to open AdminPage

#### Scenario: Leader is not forced through AdminPage

- GIVEN an authenticated `leader` who cannot open AdminPage
- WHEN that leader requests the staff retreat registrations route
- THEN the page SHALL load
- AND payment recording SHALL remain available

### Requirement: Anonymous Payment Isolation

The anonymous role MUST NOT INSERT, SELECT, UPDATE, or DELETE `retreat_payments` through PostgREST. Public `/retiro` MUST NOT collect or submit payment amounts.

#### Scenario: Anon cannot insert payments

- GIVEN a request using the anonymous key
- WHEN the client inserts into `retreat_payments` via PostgREST
- THEN the operation SHALL fail
- AND no payment row SHALL be created

#### Scenario: Public form does not collect money

- GIVEN a visitor on `/retiro`
- WHEN the visitor completes pre-registration
- THEN the form SHALL NOT accept a payment amount
- AND no `retreat_payments` row SHALL be created by that submit
