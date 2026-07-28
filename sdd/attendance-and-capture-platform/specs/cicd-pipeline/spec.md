# CI/CD Pipeline Specification

## Purpose

Automate quality gates, testing, deployment, and security scanning via GitHub Actions on the `rrobles9112` / `rrobles9112/md-cc-attendance-and-capture` repository. Every PR is gated before merge. Production deploys on push to main. Nightly jobs run extended checks.

## Requirements

### Requirement: PR Quality Gate

The system MUST run lint, typecheck, unit/component tests, and build on every pull request. The PR SHALL NOT be mergeable until all checks pass.

#### Scenario: PR passes all checks

- GIVEN a PR is opened with valid code
- WHEN the CI pipeline runs
- THEN lint, typecheck, test, and build all pass
- AND the PR is marked as mergeable

#### Scenario: PR fails lint

- GIVEN a PR contains a lint error
- WHEN the CI pipeline runs
- THEN the lint step fails
- AND the PR is blocked from merging

#### Scenario: PR fails typecheck

- GIVEN a PR contains a TypeScript type error
- WHEN the CI pipeline runs
- THEN the typecheck step fails
- AND the PR is blocked from merging

### Requirement: Supabase Migration Apply Validation

The system MUST validate that SQL migrations apply cleanly before merge. Validation SHALL start an ephemeral local Supabase (Docker) and apply migrations with `supabase db reset` (or equivalent). Soft-fail commands (`|| true`) MUST NOT be used to hide migration errors.

#### Scenario: Migration validates successfully

- GIVEN a PR includes a new or changed Supabase migration
- WHEN the migration validation job executes
- THEN the migration applies without errors against a fresh local database
- AND the job exits non-zero on any SQL error

#### Scenario: Migration fails validation

- GIVEN a PR includes a migration with invalid SQL
- WHEN the migration validation job executes
- THEN the step fails with the SQL error
- AND the PR is blocked from merging

### Requirement: Database Integration Tests in CI

The system MUST run SQL integration tests (RLS, audit trigger, pgcrypto) in CI against the ephemeral local database after migrations apply. Tests live under `supabase/tests/`.

#### Scenario: RLS tests pass in CI

- GIVEN migrations and seed data are applied locally in CI
- WHEN `supabase/tests/rls.test.sql` (and sibling SQL tests) run
- THEN all assertions pass
- AND a failure blocks the PR

### Requirement: Demo Seed Isolation

Demo and test Auth users (and sample domain data) MUST NOT remain in production after migrate. Local development SHALL load demo data via `supabase/seed.sql` (configured in `supabase/config.toml`). A cleanup migration MUST strip deterministic demo accounts from environments that previously received seed embedded in schema migrations.

#### Scenario: Local reset seeds demo users

- GIVEN a developer runs `supabase db reset`
- WHEN migrations and seed complete
- THEN the three RBAC demo accounts exist and can sign in with `test-password`

#### Scenario: Production migrate strips demo accounts

- GIVEN a cloud project previously received demo seed via a migration
- WHEN the demo-cleanup migration is applied
- THEN deterministic demo Auth users and related sample rows are removed
- AND no `test-password` demo login remains usable

### Requirement: Preview Deployment

The system MUST create a preview deployment for every PR. The preview SHALL have a unique URL accessible to reviewers.

#### Scenario: Preview deployed on PR open

- GIVEN a PR is opened
- WHEN the CI pipeline completes successfully
- THEN a preview deployment is created
- AND the preview URL is posted as a PR comment

#### Scenario: Preview updated on PR push

- GIVEN a PR has an existing preview deployment
- WHEN the author pushes new commits
- THEN the preview deployment is updated
- AND the URL remains the same

### Requirement: Production Deployment

The system MUST deploy to production on push to main. The deployment SHALL run migrations first, then deploy the application. Production deployment MUST be gated on passing tests and build.

#### Scenario: Production deploy on main push

- GIVEN all tests and build pass on main
- WHEN the push to main completes
- THEN Supabase migrations are applied to production
- AND the Next.js app is deployed to Vercel production

#### Scenario: Production deploy blocked on test failure

- GIVEN a push to main introduces a test failure
- WHEN the CI pipeline runs
- THEN the deployment step is skipped
- AND the failure is reported

### Requirement: Nightly Job

The system MUST run a nightly job that executes the full test suite, Lighthouse/PWA audit, and dependency vulnerability scan.

#### Scenario: Nightly job runs successfully

- GIVEN the nightly schedule triggers at the configured time
- WHEN the job executes
- THEN the full test suite passes
- AND a Next.js server is started before Lighthouse runs
- AND Lighthouse uses `.lighthouserc.json`
- AND high-severity npm audit findings fail the security job (surfacing via failure issue)

#### Scenario: Nightly job detects vulnerability

- GIVEN a dependency has a known high or critical vulnerability
- WHEN the nightly vulnerability scan runs
- THEN the scan fails the security-audit job
- AND a notification/issue is generated when the nightly workflow fails

### Requirement: E2E Smoke (Nightly)

The system SHOULD run Playwright e2e smoke tests on the nightly schedule (role login / nav at minimum). Full e2e on every PR is optional until browser install cost is acceptable.

#### Scenario: Nightly role smoke documented

- GIVEN demo Auth is only available on local Supabase after `db reset`
- WHEN nightly Actions lack a local Supabase + seeded Auth stack for Playwright
- THEN the job documents the skip / follow-up condition rather than silently claiming coverage

### Requirement: Branch Protection

The main branch MUST require PR review and passing CI. Direct pushes and force-pushes to main SHALL be blocked.

#### Scenario: Direct push to main blocked

- GIVEN branch protection rules are configured
- WHEN a user attempts to push directly to main
- THEN the push is rejected
- AND the user is instructed to create a PR

#### Scenario: Force-push to main blocked

- GIVEN branch protection rules are configured
- WHEN a user attempts to force-push to main
- THEN the push is rejected

### Requirement: Secrets Management

The system MUST store secrets (Supabase keys, Vercel tokens) as GitHub Actions secrets. The production service-role key SHALL NOT be available in CI — only in runtime (Vercel/Supabase).

#### Scenario: Secrets available in CI

- GIVEN the CI pipeline needs SUPABASE_ACCESS_TOKEN
- WHEN the pipeline runs
- THEN the token is read from GitHub Actions secrets
- AND the token is not exposed in logs

#### Scenario: Service-role key not in CI

- GIVEN the CI pipeline runs
- WHEN the pipeline executes
- THEN the Supabase service-role key is NOT available as a CI secret
- AND only the anon key and access token are used

### Requirement: Required Build Env Vars

PR and production builds MUST receive non-empty `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from GitHub Actions variables. The build job SHALL fail fast if either is missing.
