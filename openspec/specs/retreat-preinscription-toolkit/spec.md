# Retreat Preinscription Toolkit Specification

## Purpose

Make the October 2026 youth retreat (`retiro-juvenil-octubre-2026`) operationally usable end-to-end: reliable hosted admin user creation with clear conflict feedback (W1), whatsapp-pastoreo migrations that actually apply locally and hosted (W2), a deterministic synthetic seed cohort for QA of the retreat status machine and the Valientes transfer (W3), and in-module "Nueva preinscripción" creation on the retreat-registrations page (W4). This is a new capability domain: every requirement below is ADDED and additive to the existing canonical capabilities (`youth-retreat-preregistration`, `youth-retreat-payments`, `whatsapp-pastoreo-notifications`, `retreat-valientes-transfer`) — no existing requirement is modified or removed. Seed data is synthetic and marker-tagged, never real personal data; consent handling follows Ley 1581 de 2012 under policy `pdtp-v1.0-2026-07-17`. UI copy is es-CO; this artifact is in English.

## ADDED Requirements

### Requirement: Hosted Admin User Creation

The hosted deployment (Vercel Production and Preview, with `SUPABASE_SERVICE_ROLE_KEY` configured per the ops runbook) MUST create admin-managed users end-to-end: `POST /api/admin/users` with valid input from an authenticated `super_admin` MUST return 201 and create both the auth user and the `profiles` row. A create attempt with an email already registered in GoTrue MUST be classified as a conflict: the API MUST return 409 — never 500 — serializing the conflict code and the es-CO message "Ya existe una cuenta registrada con ese correo electrónico.", and the admin users panel MUST surface that message as a toast. GoTrue failures that are not the duplicate-email case MUST keep their existing error mapping.

#### Scenario: Valid user creation on the hosted environment

- GIVEN the Vercel Production and Preview environments have `SUPABASE_SERVICE_ROLE_KEY` configured and redeployed (ops action)
- WHEN an authenticated `super_admin` submits a valid new user to `POST /api/admin/users`
- THEN the API SHALL return 201
- AND the auth user SHALL be created and the `profiles` row SHALL exist
- AND the previous generic "error de servidor" symptom SHALL be gone

#### Scenario: Duplicate email returns 409, never 500

- GIVEN an email already registered in GoTrue (`admin.auth.admin.createUser` returns "User already registered")
- WHEN an authenticated `super_admin` submits a create with that email
- THEN the API SHALL return 409 with the es-CO message "Ya existe una cuenta registrada con ese correo electrónico."
- AND the response SHALL serialize the conflict code
- AND the API SHALL NOT return 500 for this case

#### Scenario: UsersPanel surfaces the conflict as an es-CO toast

- GIVEN the admin users panel receives the 409 conflict response
- WHEN the panel displays the outcome
- THEN a toast SHALL show the es-CO message "Ya existe una cuenta registrada con ese correo electrónico."
- AND the generic server-error toast SHALL NOT be shown for this case

#### Scenario: Non-duplicate GoTrue failures keep their mapping

- GIVEN a GoTrue `createUser` failure that is not the duplicate-email case (for example an invalid password)
- WHEN an authenticated `super_admin` submits the create
- THEN the API SHALL keep the existing error mapping for that failure class
- AND only the duplicate-email case SHALL be classified as conflict

### Requirement: Migration Numbering Integrity

The four whatsapp-pastoreo migrations MUST be renumbered `015`–`018` to match the Supabase CLI numeric migration pattern — `015_whatsapp_pastoreo_core.sql`, `016_whatsapp_pastoreo_indexes.sql`, `017_whatsapp_pastoreo_rls.sql`, `018_whatsapp_pastoreo_cron.sql` — with contents byte-identical to the pre-rename files EXCEPT Amendment A1 (owner sign-off 2026-08-29): in `015`, the `age_years` `GENERATED ALWAYS` column (PG15 rejects non-immutable `age()` in generation expressions, SQLSTATE 42P17) is replaced by a plain `age_years INT` column maintained by a `BEFORE INSERT OR UPDATE OF birthday` trigger plus a one-time backfill `UPDATE` for pre-existing rows; in `016`, the nine `CREATE INDEX CONCURRENTLY` statements become plain `CREATE INDEX` (the Supabase CLI applies each migration inside a single transaction, where `CONCURRENTLY` is invalid) and its header comments are updated to record the amendment; in `018`, the `DO` block switches to distinct dollar-quote tags (`$do$` outer, `$$` inner) because identical tags made the parser close the outer body at the cron command's opening `$$` (SQLSTATE 42601). All other content of the four files SHALL remain byte-identical to the pre-rename files. A local `supabase db reset` MUST apply migrations 001–018. No test in the repository MAY reference the old `012a`–`012d` paths. After the hosted `supabase db push` (ops action, dry-run reviewed first), the hosted `PGRST205` error on `notification_log` and `42703` error on `profiles.whatsapp_opt_in` MUST be gone.

#### Scenario: Local reset applies the full chain

- GIVEN the four migrations renamed to `015`–`018` with contents byte-identical except Amendment A1
- WHEN `supabase db reset` runs on a dev machine
- THEN `schema_migrations` SHALL list 001–018, including 015, 016, 017, and 018
- AND `notification_log` SHALL exist and `profiles.whatsapp_opt_in` SHALL exist locally
- AND `members.age_years` SHALL equal `EXTRACT(YEAR FROM age(birthday))::int` for rows with a birthday, maintained by trigger

#### Scenario: Amendment A1 keeps the chain transactional

- GIVEN `015` computes `members.age_years` via a `BEFORE INSERT OR UPDATE OF birthday` trigger with a backfill `UPDATE`, `016` creates its nine indexes without `CONCURRENTLY`, and `018` quotes its `DO` block with a distinct `$do$` tag around the cron command's `$$`
- WHEN `supabase db reset` applies the chain inside the CLI's per-file transaction
- THEN neither the `42P17` generation-expression error, nor the `25001` concurrent-index-inside-a-transaction error, nor the `42601` dollar-quote collision SHALL occur
- AND `src/lib/pastoreo/__tests__/explain.test.ts` SHALL pin the amendment by asserting `016` contains no `CONCURRENTLY`

#### Scenario: No test references the old migration paths

- GIVEN `src/lib/pastoreo/__tests__/explain.test.ts` asserts `supabase/migrations/016_whatsapp_pastoreo_indexes.sql` and `src/__tests__/rls/whatsapp_pastoreo.test.ts` asserts `supabase/migrations/017_whatsapp_pastoreo_rls.sql`
- WHEN the Vitest suite runs
- THEN the suite SHALL pass
- AND zero tests SHALL reference the old `012a`–`012d` literal paths

#### Scenario: Renumbering is order-safe with 013/014

- GIVEN environments where migrations 013 and 014 were previously applied while `012a`–`012d` were skipped
- WHEN the renumbered `015`–`018` apply in numeric order
- THEN no object collision or application failure SHALL occur, because the four migrations are additive-only and idempotent

#### Scenario: Hosted push repairs the hosted schema

- GIVEN the hosted database lacks `notification_log` and `profiles.whatsapp_opt_in` (live `PGRST205` / `42703` errors)
- WHEN the ops `supabase db push` applies 015–018 after dry-run review
- THEN the hosted pastoreo monitoring page SHALL load
- AND the `PGRST205` and `42703` errors SHALL be gone

### Requirement: Deterministic Seed Cohort Generator

The system MUST provide a pure generator module that builds N preinscription plans for `event_key` `retiro-juvenil-octubre-2026`, with N defaulting to 12 (roughly 4 plans per status bucket). Generation MUST be deterministic: driven by a `--seed` PRNG value with all timestamps and the operator id injected as parameters (no `Math.random` and no `Date.now` inside the generator), the same seed MUST reproduce the identical cohort across runs and across runtimes (Vitest and the Node runner). Every cohort MUST include at least one plan per status class — payment sum `0` → `preinscrito`, `0 < sum < total` → `pagos_parciales`, `sum ≥ total` → `inscrito` — via explicit deterministic bucket allocation (~N/3 per bucket). Emails MUST be unique per run on a single reserved marker domain (`@seed.retiro.test`) that is never real personal data; phones MUST be unique digits-only values, together satisfying the unique indexes on `(event_key, lower(btrim(email)))` and `(event_key, digits-only phone)`. Every plan MUST stamp `general_consent_accepted_at` (injected timestamp) and `general_consent_policy_version` `pdtp-v1.0-2026-07-17` (Ley 1581), and MUST carry the injected `recorded_by` operator profile id.

#### Scenario: Same seed reproduces the identical cohort

- GIVEN the generator invoked with seed X, cohort size N, and the same injected timestamps and operator id
- WHEN the cohort is built twice, once in Vitest and once via the Node runner
- THEN both builds SHALL produce identical plans (same names, marker-domain emails, phones, and abonos in the same order)

#### Scenario: Every status bucket is covered

- GIVEN a generated cohort of the default size 12 (or any N ≥ 3)
- WHEN the plans are classified by payment-sum bucket
- THEN at least one plan SHALL have sum 0 (`preinscrito`)
- AND at least one plan SHALL have `0 < sum < total` (`pagos_parciales`)
- AND at least one plan SHALL have `sum ≥ total` (`inscrito`)
- AND the bucket allocation SHALL be deterministic (~N/3 per bucket)

#### Scenario: Unique synthetic contacts satisfying the unique indexes

- GIVEN a generated cohort
- WHEN the plans are validated against the retreat uniqueness indexes
- THEN emails SHALL be unique on the reserved marker domain `@seed.retiro.test`, never real personal data
- AND phones SHALL be unique digits-only values
- AND no plan SHALL collide on `(event_key, lower(btrim(email)))` or `(event_key, digits-only phone)`

#### Scenario: Consent stamps on every seed plan

- GIVEN a generated cohort
- WHEN any plan is inspected
- THEN it SHALL carry `general_consent_accepted_at` from the injected timestamp
- AND `general_consent_policy_version` SHALL be `pdtp-v1.0-2026-07-17`
- AND `event_key` SHALL be `retiro-juvenil-octubre-2026`
- AND `recorded_by` SHALL be the injected operator profile id

### Requirement: Seed Runner Safety and Cleanup

The system MUST provide a seed runner script that persists a generated cohort through direct service-role inserts (bypassing RLS by design; the public RPC path stays covered end-to-end by the real UI flow). The runner MUST resolve the operator profile used as `recorded_by` (the first `super_admin` profile by default, overridable via `--recorded-by`) and inject it into the pure generator. The runner MUST ensure the `app_settings` key `retreat.youth.total_cost` is a positive number BEFORE inserting any payment (default `--ensure-total` 400000; idempotent when already set to a positive value; explicit flag to overwrite) — otherwise the `retreat_payments_guard_total()` trigger rejects every payment. The runner MUST insert `retreat_registrations` rows first and then `retreat_payments` rows; statuses MUST be computed by the existing `retreat_payments_apply_status()` trigger and the script MUST NOT write statuses directly. On completion the runner MUST read back the seeded registrations and print the status distribution as verification output. The default target MUST be the local Supabase environment; a hosted run MUST require explicit `--url`/`--service-key` (or env overrides), and setting the hosted `retreat.youth.total_cost` is a product/ops decision requiring explicit confirmation — never a script default. `--clean` MUST remove previously seeded rows by marker domain (payments first, then registrations) without touching non-seed rows. `--dry-run` MUST print the generated plan without touching the database.

#### Scenario: Total is ensured before any payment insert

- GIVEN `app_settings` `retreat.youth.total_cost` is missing or empty
- WHEN the runner executes with the default `--ensure-total 400000`
- THEN the setting SHALL be set to a positive number before any payment insert
- AND the payments SHALL persist without rejection by the guard trigger

#### Scenario: Ensure-total is idempotent

- GIVEN `retreat.youth.total_cost` is already a positive number
- WHEN the runner executes without the explicit overwrite flag
- THEN the stored total SHALL remain unchanged

#### Scenario: Statuses are trigger-derived and reported

- GIVEN a successful seed run against a database with the full migration chain applied
- WHEN the runner reads back the seeded registrations
- THEN the printed distribution SHALL cover `preinscrito`, `pagos_parciales`, and `inscrito`
- AND the statuses SHALL be the ones computed by the existing triggers, not script-written values

#### Scenario: Clean removes only prior seed rows

- GIVEN prior seed rows exist under the marker domain alongside real registrations and payments
- WHEN the runner executes with `--clean`
- THEN seed payments SHALL be removed first, then seed registrations
- AND non-seed rows SHALL remain untouched

#### Scenario: Dry-run touches nothing

- GIVEN any target database state
- WHEN the runner executes with `--dry-run`
- THEN the generated plan SHALL be printed
- AND no row SHALL be inserted, updated, or deleted

#### Scenario: Hosted targeting is explicit

- GIVEN the runner is invoked without `--url`/`--service-key` or env overrides
- WHEN it executes
- THEN it SHALL target the local Supabase environment
- AND a hosted run SHALL require explicit credentials and explicit product-owner confirmation of `retreat.youth.total_cost`

### Requirement: In-Module Retreat Preinscripción Creation

The retreat-registrations staff page MUST offer a "Nueva preinscripción" button in the page toolbar, excluded from printed output, that opens a dialog mounting the retreat-variant capture form — `<CaptureForm variant="retreat" submitAdapter={submitRetreatPreinscription} />` — the exact same form and RPC path as the public `/retiro` page, with zero changes to `CaptureForm`'s public API or behavior. On successful submit, the es-CO toast "Preinscripción enviada exitosamente" SHALL be shown (existing adapter/form success behavior), the dialog SHALL close, and the page registration data SHALL reload, showing the new row as a `preinscrito` registration with consent stamps per the `youth-retreat-preregistration` capability; active table filters and pagination SHOULD be preserved across the reload. On failed submit, the existing retreat error toast SHALL be shown, the dialog SHALL stay open, and the entered data SHALL be retained. The button SHALL be hidden or disabled when the session role does not pass `canManageRetreatRegistrations`, and disabled with title "Requiere conexión" when the browser is offline.

#### Scenario: Button opens the retreat form in a dialog

- GIVEN an authenticated user whose role passes `canManageRetreatRegistrations` and whose browser is online, on the retreat-registrations page
- WHEN the user clicks "Nueva preinscripción"
- THEN a dialog SHALL open mounting the retreat-variant capture form with the retreat submit adapter
- AND the form SHALL present the same field set, retreat copy, and privacy notice as the public `/retiro` page

#### Scenario: Successful submit closes, refreshes, and toasts

- GIVEN the dialog is open with valid data and general consent accepted
- WHEN the submit succeeds
- THEN the es-CO toast "Preinscripción enviada exitosamente" SHALL be shown
- AND the dialog SHALL close
- AND the page registration data SHALL reload, showing the new `preinscrito` row with its consent stamps

#### Scenario: Failed submit keeps the dialog open

- GIVEN the dialog is open with entered data
- WHEN the submit fails
- THEN the existing retreat error toast SHALL be shown
- AND the dialog SHALL remain open with the entered data retained

#### Scenario: Button is gated by permission

- GIVEN a session whose role does not pass `canManageRetreatRegistrations`
- WHEN the retreat-registrations page renders
- THEN the "Nueva preinscripción" button SHALL be hidden or disabled
- AND the dialog SHALL NOT be reachable from that session

#### Scenario: Button is gated when offline

- GIVEN an otherwise permitted user whose browser is offline
- WHEN the retreat-registrations page renders
- THEN the "Nueva preinscripción" button SHALL be disabled with title "Requiere conexión"

#### Scenario: Shared form contract stays unchanged

- GIVEN the dialog reuses `CaptureForm` with the existing retreat adapter and `onSuccess` hook
- WHEN this change is delivered
- THEN `CaptureForm`'s public API and behavior SHALL be unchanged, with zero modifications to the shared component
- AND the public `/retiro` flow SHALL remain unaffected
