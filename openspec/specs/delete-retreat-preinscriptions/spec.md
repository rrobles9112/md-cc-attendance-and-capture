# Delete Retreat Preinscriptions Specification

## Purpose

Authorized staff (`super_admin` and `leader`) SHALL be able to delete youth retreat
preinscriptions (`retreat_registrations`) and their payments (`retreat_payments`)
from the `retreat-registrations` page, with three explicit options, Spanish toasts,
RLS-enforced authorization, owner-side status recalculation, and automatic audit
via the existing `audit_retreat_*` triggers. Unauthorized roles SHALL have no UI
affordance and no SQL delete capability (fail-closed).

Baseline: working tree (retreat RLS = migration `011` only). Migration `021`
depends solely on objects created in `011`; it MUST NOT touch migrations
`013`–`020`.

UX defaults fixed from proposal R9: after option (b) `status` resets to
`preinscrito` (when no payments remain); double confirmation applies ONLY to
option (a).

## Requirements

### Requirement: Delete Action Visibility Gated by Role

The system MUST render the Eliminar action (new "Acciones" column in the
`retreat-registrations` table) only when `canDeleteRetreatRegistration(role)`
returns true (i.e. `super_admin` or `leader`). Roles for which the guard returns
false (`server`, anonymous, any other role) MUST NOT see the Eliminar button or
column. Page-level access MUST remain controlled by
`canManageRetreatRegistrations` as today; in this baseline `server` does not see
the page at all, and this requirement MUST still hold if the module is opened to
`server` in the future (button hidden via the delete guard even when the page is
visible).

#### Scenario: Leader sees the Eliminar action

- GIVEN an authenticated user with role `leader`
- WHEN the `retreat-registrations` page renders with at least one row
- THEN each row SHALL show an Eliminar action
- AND the "Acciones" column SHALL be visible

#### Scenario: Super_admin sees the Eliminar action

- GIVEN an authenticated user with role `super_admin`
- WHEN the `retreat-registrations` page renders with at least one row
- THEN each row SHALL show an Eliminar action

#### Scenario: Server never sees the Eliminar action

- GIVEN an authenticated user with role `server` (whether or not the page itself
  is visible to `server` in a future baseline)
- WHEN the `retreat-registrations` page renders (if accessible at all)
- THEN no Eliminar button SHALL be rendered
- AND no "Acciones" column SHALL be rendered

#### Scenario: Anonymous sees no delete affordance

- GIVEN a visitor with no authentication session
- WHEN the `retreat-registrations` page is requested
- THEN no Eliminar button SHALL be rendered

### Requirement: Delete Dialog With Explicit Options

The system MUST present a confirmation `Dialog` (Radix, existing
`src/components/ui/dialog.tsx` API) before any delete. The offered options MUST
be derived from the accumulated payment for the row
(`paidByRegistration.get(id) ?? 0`): when the sum is greater than 0 the dialog
MUST offer exactly options (a) and (b); when the sum is 0 it MUST offer exactly
option (c). The options are mutually exclusive.

- (a) eliminar preinscripción + pagos.
- (b) eliminar solo pagos, conservando la preinscripción.
- (c) sin pagos registrados, eliminar solo la información de preinscripción.

#### Scenario: Row with payments offers (a) and (b) only

- GIVEN a registration row with accumulated payments greater than 0
- WHEN the user opens the Eliminar dialog
- THEN the dialog SHALL present option (a) and option (b)
- AND option (c) SHALL NOT be presented

#### Scenario: Row without payments offers (c) only

- GIVEN a registration row with accumulated payments equal to 0
- WHEN the user opens the Eliminar dialog
- THEN the dialog SHALL present option (c)
- AND options (a) and (b) SHALL NOT be presented

### Requirement: Option (a) — Delete Registration Plus Payments

For option (a) the client MUST issue two sequential DELETEs: first
`DELETE FROM retreat_payments WHERE registration_id = X`, then
`DELETE FROM retreat_registrations WHERE id = X`. The payments-first order is
mandatory because the FK `retreat_payments.registration_id` has no `ON DELETE
CASCADE`. Option (a) MUST require double confirmation (two explicit destructive
confirmations; a typed-name confirmation is NOT required). On full success the UI
MUST show a Spanish success toast and MUST reload table data via `loadData()`.

#### Scenario: Option (a) deletes payments then registration

- GIVEN a registration with existing payments and an authorized role
- WHEN the user confirms option (a) through both confirmations
- THEN the client SHALL delete the payments first and the registration second
- AND afterwards zero rows SHALL exist in both tables for that `registration_id`
- AND a Spanish success toast SHALL be shown
- AND the table data SHALL be reloaded

#### Scenario: Option (a) requires double confirmation

- GIVEN a registration with existing payments
- WHEN the user selects option (a) and confirms only once
- THEN no DELETE SHALL be issued yet
- AND a second explicit confirmation SHALL be required before deletion

#### Scenario: Option (a) reversed order fails on FK

- GIVEN a registration with existing payments
- WHEN the registration row is deleted before its payments
- THEN the database SHALL reject it with a foreign-key violation
- AND the UI SHALL report an error (never success)

### Requirement: Option (b) — Delete Only Payments, Keep Registration

For option (b) the client MUST issue only
`DELETE FROM retreat_payments WHERE registration_id = X` and MUST NOT issue any
direct UPDATE of the registration. The surviving registration's `status` MUST be
recalculated by the owner-side `AFTER DELETE ON retreat_payments` trigger (see
RLS/SQL requirement). The registration row MUST remain listed. On success the UI
MUST show a Spanish success toast and MUST reload table data via `loadData()`.
Double confirmation MUST NOT be required for option (b) — a single confirmation
is sufficient.

#### Scenario: Option (b) keeps the registration with reset status

- GIVEN a registration with status `inscrito` and existing payments
- WHEN the user confirms option (b)
- THEN only the payments SHALL be deleted
- AND the registration row SHALL still exist with `status = 'preinscrito'`
- AND the row SHALL remain listed in the table
- AND a Spanish success toast SHALL be shown

#### Scenario: Option (b) issues no client-side UPDATE

- GIVEN a registration with existing payments
- WHEN option (b) executes
- THEN the client SHALL NOT send any UPDATE to `retreat_registrations`
- AND the status change SHALL come solely from the owner-side trigger

#### Scenario: Option (b) needs only single confirmation

- GIVEN a registration with existing payments
- WHEN the user selects option (b)
- THEN a single confirmation SHALL be sufficient to proceed

### Requirement: Option (c) — Delete Registration Without Payments

For option (c) (precondition: no registered payments) the client MUST issue only
`DELETE FROM retreat_registrations WHERE id = X` with a single simple
confirmation. On success the UI MUST show a Spanish success toast and MUST reload
table data via `loadData()`. If concurrent payments appear between dialog render
and delete, the FK constraint SHALL block the registration delete and the UI
MUST report an error.

#### Scenario: Option (c) deletes a payment-free registration

- GIVEN a registration with zero payments
- WHEN the user confirms option (c) with a single confirmation
- THEN the registration row SHALL be deleted
- AND a Spanish success toast SHALL be shown
- AND the table data SHALL be reloaded

#### Scenario: Option (c) blocked by concurrent payments

- GIVEN option (c) was offered for a registration with zero payments
- AND payments for it are inserted concurrently before the delete lands
- WHEN the registration DELETE executes
- THEN the FK constraint SHALL reject it
- AND the UI SHALL report an error toast (never success)

### Requirement: RLS and SQL Migration 021

Migration `021_retreat_registration_deletes.sql` MUST create only the following,
exclusively over objects from `011`:

- `GRANT DELETE ON public.retreat_registrations TO authenticated` and
  `GRANT DELETE ON public.retreat_payments TO authenticated`.
- One `FOR DELETE TO authenticated` policy per table with
  `USING (public.user_role() IN ('super_admin','leader'))`, keeping literal role
  parity with `canDeleteRetreatRegistration` (per proposal R4).
- One owner-side (`SECURITY DEFINER`, `SET search_path = ''`, consistent with the
  existing triggers) `AFTER DELETE ON public.retreat_payments` trigger that
  recalculates the surviving registration's `status`:
  - remaining sum = 0 → `preinscrito`;
  - remaining sum > 0 with a valid total → `pagos_parciales` or `inscrito`
    (same threshold semantics as `retreat_payments_apply_status`);
  - remaining sum > 0 but the configured total is missing/invalid → the trigger
    MUST leave the row untouched.
- A `NOTIFY pgrst, 'reload schema'` at the end.

The migration MUST NOT create any `SECURITY DEFINER` RPC for deletion, MUST NOT
add `deleted_at` or any other column, MUST NOT add client UPDATE grants/policies,
and MUST NOT modify migrations `013`–`020` (nor depend on them). On rebase/merge
against HEAD, `021` MUST be kept after `020` and revalidated against `019`.

#### Scenario: Staff roles can delete in payments-first order

- GIVEN migration `021` applied and a leader or super_admin session
- WHEN the client deletes payments then the registration
- THEN both DELETEs SHALL affect the expected rows

#### Scenario: Invalid total with remaining payments leaves status untouched

- GIVEN a registration with remaining payments after a partial delete
- AND the configured total cost is missing or non-numeric
- WHEN the `AFTER DELETE` trigger runs
- THEN the registration `status` SHALL remain unchanged

#### Scenario: Zero remaining payments resets to preinscrito

- GIVEN a registration whose payments are fully deleted
- WHEN the `AFTER DELETE` trigger runs
- THEN the registration `status` SHALL become `preinscrito`

### Requirement: Silent RLS Denial Treated as Error

The UI MUST treat a denied delete — an error return or zero affected rows
(RLS fail-closed produces 0 rows with no error) — as a denial: it MUST show a
Spanish error toast and MUST NOT show success nor reload data as if deleted.
Success toast plus `loadData()` SHALL occur only when the expected rows were
actually removed.

#### Scenario: Zero-rows-affected is reported as denied

- GIVEN an unauthorized role (or a revoked/expired session) attempting a delete
- WHEN the DELETE returns no error but affects 0 rows
- THEN the UI SHALL show a Spanish error toast
- AND it SHALL NOT show a success toast
- AND it SHALL NOT present the data as reloaded/deleted

#### Scenario: Error return is reported as denied

- GIVEN a delete attempt that returns an error (FK violation, RLS error,
  network failure)
- WHEN the error is received
- THEN the UI SHALL show a Spanish error toast
- AND it SHALL NOT show a success toast

### Requirement: Audit Coverage for Deletes

Every DELETE on `retreat_registrations` and `retreat_payments` MUST be captured
by the existing `audit_retreat_registrations` / `audit_retreat_payments`
`AFTER INSERT OR UPDATE OR DELETE → log_mutation()` triggers, producing the
corresponding `audit_log` row(s). No new audit code is required; the migration
MUST NOT drop or alter the existing audit triggers.

#### Scenario: Registration delete leaves an audit trail

- GIVEN an authorized delete of a registration (options (a) or (c))
- WHEN the DELETE commits
- THEN `audit_log` SHALL contain a row for the deleted registration

#### Scenario: Payments delete leaves an audit trail

- GIVEN an authorized delete of payments (options (a) or (b))
- WHEN the DELETE commits
- THEN `audit_log` SHALL contain a row for each deleted payment batch/row per
  `log_mutation()` semantics

### Requirement: Automated Tests

The change MUST extend automated tests at both levels:

- Vitest `src/lib/rbac/__tests__/guards.test.ts`: a new block for
  `canDeleteRetreatRegistration` asserting true for `super_admin` and `leader`,
  and false for `server` and all other roles.
- SQL `supabase/tests/retreat_rls.test.sql` (or a new sibling delete-focused
  test file following the same PASS/FAIL pattern with
  `RAISE NOTICE 'PASS: ...'` / `RAISE EXCEPTION 'FAIL: ...'` and a final
  `ROLLBACK`): cases for leader/super_admin can delete in payments → registration
  order, `server`/anon denied (0 rows), FK violation when the order is inverted,
  `status` reset to `preinscrito` after option (b), and an `audit_log` row after
  DELETE.

#### Scenario: Guard tests pin role parity

- GIVEN the vitest suite runs
- WHEN the `canDeleteRetreatRegistration` block executes
- THEN `super_admin` and `leader` SHALL assert true
- AND `server` and other roles SHALL assert false

#### Scenario: SQL delete tests verify RLS, order, status, and audit

- GIVEN the SQL delete test file runs with `ON_ERROR_STOP=1`
- WHEN all cases execute
- THEN staff deletes in correct order SHALL PASS
- AND `server`/anon deletes affecting 0 rows SHALL PASS as denied
- AND inverted-order FK violation SHALL PASS
- AND post-(b) `status = 'preinscrito'` SHALL PASS
- AND post-DELETE `audit_log` presence SHALL PASS

## Non-goals (from proposal, binding)

- N1: no creation or linking of `members` from a preinscription.
- N2: deletion only; no edit forms for name/email/phone/status.
- N3: single-row deletes with confirmation only; no bulk/multi-select or
  event-wide purge.
- N4: no changes to the anonymous `/retiro` form (no new anon policies, no UX
  changes).
- N5: no `SECURITY DEFINER` RPC for deletion.
- N6: no soft-delete (`deleted_at`); hard delete plus existing `audit_log`.
- N7: no changes to HEAD migrations `013`–`020` (incl. `014`/`019`); `021`
  depends only on `011`.
- N8: reconciling the reverted tree with HEAD `1c2cd28` is an external
  dependency, not part of this change.
- N9: no data export (CSV/report) of deletions; evidence stays in `audit_log`.
