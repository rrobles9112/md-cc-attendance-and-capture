# CI/CD Pipeline Specification

## Purpose

Automate quality gates, testing, deployment, and security scanning via GitHub Actions on the `rroles9112` repository. Every PR is gated before merge. Production deploys on push to main. Nightly jobs run extended checks.

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

### Requirement: Supabase Migration Dry-Run

The system MUST validate Supabase SQL migrations and RLS policies before merge. The dry-run SHALL use an ephemeral database or branching.

#### Scenario: Migration validates successfully

- GIVEN a PR includes a new Supabase migration
- WHEN the migration dry-run executes
- THEN the migration applies without errors
- AND RLS policies are validated

#### Scenario: Migration fails validation

- GIVEN a PR includes a migration with invalid SQL
- WHEN the migration dry-run executes
- THEN the step fails with the SQL error
- AND the PR is blocked from merging

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
- AND Lighthouse scores meet thresholds (PWA audit)
- AND no critical vulnerabilities are found

#### Scenario: Nightly job detects vulnerability

- GIVEN a dependency has a known critical vulnerability
- WHEN the nightly vulnerability scan runs
- THEN the scan reports the vulnerability
- AND a notification/alert is generated

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
