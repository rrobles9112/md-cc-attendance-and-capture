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

Only `super_admin` MUST be allowed to set `retreat.youth.total_cost`, covering both the `UPDATE` path (existing) and the `INSERT ... ON CONFLICT` path used by client `upsert`. `leader`, `server`, and `anon` MUST NOT insert or update that setting. `leader`/`server` keep read access via the existing `app_settings_select` policy; this change MUST NOT alter role semantics in `guards.ts`/`useRole.ts`.

(Modified by `fix-retiro-costo-total` (PRs #152/#153, merged 2026-09-16). Previously: canonical requirement covered set/update persistence and leader refusal, but did not cover the `INSERT` branch of `upsert`, coded error mapping, or the `anon` case.)

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

#### Scenario: Leader INSERT denied via upsert path

- GIVEN an authenticated `leader`
- WHEN that user attempts the client `upsert` of `retreat.youth.total_cost` (i.e. `INSERT ... ON CONFLICT DO UPDATE`)
- THEN the write SHALL be refused with `42501`
- AND the stored total SHALL be unchanged
- AND the UI SHALL show the specific permission message

#### Scenario: Anon cannot write total cost

- GIVEN an anonymous (`anon`) session
- WHEN that client attempts to insert or update `retreat.youth.total_cost`
- THEN the operation SHALL fail
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

### Requirement: Total-Cost Persistence Recalculates Balance

The system MUST persist `retreat.youth.total_cost = '480000'` when saved by an authenticated `super_admin` through `setRetreatTotalCost`/`setSetting`, and the retreat-registrations page MUST recalculate Saldo and % from the new stored total on reload.

#### Scenario: Saving 480000 as super_admin persists and recalculates

- GIVEN an authenticated `super_admin` with effective SQL role `super_admin` (verified via `supabase/diagnose_user_role.sql`)
- AND stored total `retreat.youth.total_cost` is the old value (e.g. `400000`)
- WHEN the user saves `'480000'` through the cost card (`handleSaveCost` → `setRetreatTotalCost('480000')`)
- THEN `app_settings` SHALL contain `key = 'retreat.youth.total_cost'` with `value = '480000'`
- AND the UI SHALL show toast `"Costo total del retiro actualizado"` and reload data (`loadData`)
- AND Saldo/% SHALL be recomputed from `480000` (no longer `400.000,00` from the old total)

#### Scenario: Upsert targets the key conflict explicitly

- GIVEN `setSetting('retreat.youth.total_cost', '480000')` with an authenticated session
- WHEN the client writes to `app_settings`
- THEN the write SHALL resolve the conflict on `key` (observable as `upsert(payload, { onConflict: 'key' })`, matching the `seed-cohort.ts:93` pattern)
- AND the payload SHALL still contain `key`, `value`, and `updated_by`

### Requirement: INSERT Policy for super_admin Upserts

The database MUST provide an additive RLS policy `FOR INSERT` on `public.app_settings` restricted to `TO authenticated` with `WITH CHECK (user_role() = 'super_admin')`, so that `INSERT ... ON CONFLICT DO UPDATE` (the PostgREST translation of `upsert`) is permitted for `super_admin`. The policy MUST NOT open `INSERT` to `anon`, MUST NOT use `WITH CHECK true`, and MUST NOT alter existing SELECT/UPDATE policies. RLS stays enabled.

#### Scenario: super_admin upsert path succeeds

- GIVEN role `authenticated` with effective `user_role() = 'super_admin'`
- WHEN the client executes `INSERT INTO app_settings(key,value) VALUES ('__t1','480000') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
- THEN the statement SHALL succeed

#### Scenario: leader INSERT denied with 42501

- GIVEN role `authenticated` with effective `user_role() = 'leader'` (or no role claim)
- WHEN the same `INSERT ... ON CONFLICT` statement is executed
- THEN the statement SHALL be refused with code `42501` and the stored value SHALL be unchanged

#### Scenario: anon INSERT denied

- GIVEN role `anon`
- WHEN the same `INSERT ... ON CONFLICT` statement is executed
- THEN the statement SHALL be refused (denied) and the stored value SHALL be unchanged

### Requirement: Permission Error Mapping

The system MUST map database error code `42501` from `setSetting` to a typed `permission-denied` failure, and the cost card MUST render the specific permission message instead of the generic save error.

#### Scenario: 42501 maps to permission message

- GIVEN `supabase.from('app_settings').upsert` rejects with `{ code: '42501' }`
- WHEN `setSetting('retreat.youth.total_cost', '480000')` is called
- THEN it SHALL reject with a typed `permission-denied` error (suggesting role review / re-login for a stale JWT)
- AND `handleSaveCost` SHALL show the specific "Sin permisos para guardar el costo (requiere super_admin)" toast, not the generic one

### Requirement: Connection Error Mapping

The system MUST map network/fetch failures from `setSetting` (no error code, e.g. `TypeError: fetch failed`) to a typed `network` failure, and the cost card MUST render the specific connection message.

#### Scenario: Network failure maps to connection message

- GIVEN the `upsert` call fails with a fetch/network error without a code
- WHEN `setSetting('retreat.youth.total_cost', '480000')` is called
- THEN it SHALL reject with a typed `network` error
- AND `handleSaveCost` SHALL show the specific "Sin conexión…" toast, not the generic one

#### Scenario: Unauthenticated session preserved

- GIVEN `supabase.auth.getSession()` returns no session
- WHEN `setSetting` is called
- THEN it SHALL reject with `Not authenticated` (existing behavior, unchanged)

### Requirement: Single Write on Double Activation
The cost card MUST guarantee a single logical write per user intent: a rapid double-click on Guardar MUST produce exactly one `setRetreatTotalCost` invocation (one write, one success toast or one error toast), with no visual/layout change to the card or table.

#### Scenario: Double-click yields single write

- GIVEN the cost card with a valid draft `'480000'` and the save button enabled
- WHEN the user double-clicks Guardar rapidly (second activation before the first round-trip re-renders `disabled`)
- THEN only one `setRetreatTotalCost` call SHALL reach Supabase
- AND only one toast (success or the coded error toast) SHALL appear (no double "Error al guardar el costo total")

### Requirement: Shared setSetting Regression for DPO Email
The fix MUST preserve the shared `setSetting` path used by `src/app/(dashboard)/admin/page.tsx` `handleSaveDpoEmail` (`dpo_contact_email`); no UI change there, and its save path MUST keep working under the same `onConflict` + error-mapping behavior.

#### Scenario: DPO email regression via shared setSetting

- GIVEN an authenticated `super_admin` on the admin page
- WHEN the user saves the DPO contact email through `handleSaveDpoEmail` → `setSetting('dpo_contact_email', ...)`
- THEN the value SHALL persist via the same `upsert(..., { onConflict: 'key' })` path
- AND `42501`/network failures SHALL surface through the same typed errors (no silent generic failure)

### Requirement: Public Signatures Unchanged
The system MUST NOT change the public signatures of `setSetting`, `getSetting`, `setRetreatTotalCost`, or `getRetreatTotalCost`, so existing callers (`retreat-registrations/page.tsx`, `admin/page.tsx`) keep compiling and passing `npx tsc --noEmit`.

#### Scenario: Signatures unchanged

- GIVEN existing imports of `setSetting`, `getSetting`, `setRetreatTotalCost`, `getRetreatTotalCost`
- WHEN the change is applied
- THEN all existing call sites SHALL typecheck without modification
- AND `npx tsc --noEmit` SHALL pass

### Requirement: Zero Table-Layout Changes (T2 Boundary)
This change MUST NOT modify any table layout, class, or responsive behavior in `src/app/(dashboard)/retreat-registrations/page.tsx`. Table overflow (12 columns, `overflow-x-clip`, `sticky`, `hidden sm/md/lg:table-cell`, `w-56 md:w-64`) belongs exclusively to sibling change `fix-retiro-responsive-table`.

#### Scenario: Table diff is empty

- GIVEN the final diff of this change
- WHEN `git diff --stat` and the table-class grep (`overflow-x-clip`, `sticky`, `hidden sm:table-cell`, `hidden md:table-cell`, `hidden lg:table-cell`, `w-56`, `w-64`) are inspected
- THEN zero hunks SHALL touch table markup, table classes, `colSpan`, `src/components/ui/table.tsx`, toolbar, pagination, or payment/transfer/delete logic

### Requirement: RED Test Contracts (Strict TDD)
The change MUST be delivered under strict TDD: the RED tests below MUST fail against the current code and pass after the fix. Unit tests run with `npx vitest`; SQL policy tests use the existing `SET LOCAL ROLE authenticated` + JWT-claims harness; `npx tsc --noEmit` MUST stay green; e2e is deferred unless the 400-line `ask-on-risk` budget allows it.

#### Scenario: Unit onConflict RED contract

- GIVEN `src/lib/settings/__tests__/app-settings.test.ts` extended to assert `setSetting('retreat.youth.total_cost','480000')` calls `upsert(payload, { onConflict: 'key' })` with `key/value/updated_by` preserved (existing l.63-82 assertion kept)
- WHEN run with `npx vitest` against the current code (single-arg `upsert`)
- THEN the new assertion SHALL fail (RED); after the fix it SHALL pass (GREEN)

#### Scenario: Unit error-mapping RED contract

- GIVEN the same test file extended so `upsert → { code: '42501' }` rejects with typed `permission-denied`, `upsert → TypeError: fetch failed` (no code) rejects with typed `network`, and no-session `getSession` still rejects `Not authenticated`
- WHEN run with `npx vitest` against the current code (`throw error` raw)
- THEN the mapping assertions SHALL fail (RED); after the fix they SHALL pass (GREEN)

#### Scenario: SQL INSERT policy RED contract

- GIVEN new `supabase/tests/app_settings_insert.test.sql` following `retreat_rls.test.sql` l.1329 / `retreat_valientes_transfer.test.sql` l.55 (`SET LOCAL ROLE authenticated` + JWT claims): `super_admin` ⇒ `INSERT ... ON CONFLICT DO UPDATE` succeeds; `leader`/no-claim ⇒ `42501`; `anon` ⇒ denied
- WHEN run against the current migration set (no `FOR INSERT` policy on `app_settings`)
- THEN the `super_admin` case SHALL fail (RED); after the additive migration it SHALL pass (GREEN) while `leader`/`anon` stay denied

#### Scenario: Deferred e2e only if budget allows

- GIVEN the 400-line review budget (`ask-on-risk`)
- WHEN `git diff --stat` would exceed 400 lines by adding `e2e/retreat-cost.spec.ts` (playwright chromium: login `super_admin`, set `480000`, assert success toast + recalculated Saldo; simulated RLS denial asserts the specific permission message)
- THEN the e2e SHALL be deferred (not implemented in the first slice) and the delivery decision SHALL be asked before proceeding (no invented chain, no silent `size:exception`)
