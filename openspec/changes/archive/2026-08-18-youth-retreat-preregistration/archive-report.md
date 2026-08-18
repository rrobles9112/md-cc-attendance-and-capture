# Archive Report: youth-retreat-preregistration

**Change**: youth-retreat-preregistration
**Project**: md-cc-attendance-and-capture
**Artifact store**: hybrid (openspec + Engram)
**Archived on**: 2026-08-18
**Archived to**: `openspec/changes/archive/2026-08-18-youth-retreat-preregistration/`
**Status**: closed
**reviewGate**: absent — archive proceeded under ordinary repository policy; no review receipt was required or consulted

## Final State at Close

All 17 implementation and verification tasks are checked in the persisted OpenSpec `tasks.md`. The SDD cycle is complete. Implementation lives in this working tree and is not yet merged to `main`.

| Field | Value |
|-------|-------|
| Tasks | 17/17 complete, 0 unchecked (filesystem `tasks.md`) |
| Apply | all_done |
| Verify | all_done — PASS WITH WARNINGS |
| Requirements | 18/18 complete |
| Scenarios | 39/39 COMPLIANT |
| Vitest | 158/158 passed (18 files) |
| Typecheck | `npx tsc --noEmit` exit 0 |
| Lint | `npx next lint` exit 0 |
| Retreat SQL | 38 PASS (`retreat_rls.test.sql`) |
| Playwright (in-scope) | 9 passed, 1 skipped (legacy `/rest/v1` DELETE) |
| CRITICAL findings | 0 |
| blockers | 0 |
| reviewGate | structurally absent |
| evidence_revision | sha256:87ee7db8dd002cc97f6aa9b2fc841ab8f213498dbc8a0efef88b94e275fefd82 |

### Final-state ranking (4.1–4.2)

Filesystem `tasks.md` (Task Completion Gate) and explicit archive-launch final-state facts both record 4.1–4.2 as complete. Engram tasks #79 (written 2026-08-18 16:03:37) still shows those two rows as `[ ]`. That Engram observation is a stale snapshot. It is recorded below for traceability and is not current state. No archive-time checkbox reconciliation was performed; the persisted OpenSpec artifact already has all 17 rows `[x]`.

`apply-progress` and `verify-report` are intermediate snapshots. Current admitted verify-report #81 matches the launch-prompt final numbers (18/18, 39/39, 0 blockers, Vitest 158/158, tsc 0, retreat_rls 38 PASS, Playwright 9 passed / 1 skipped).

## Observation IDs Read (traceability)

| Artifact | Topic key | Observation ID | Type |
|----------|-----------|----------------|------|
| proposal | `sdd/youth-retreat-preregistration/proposal` | #76 | architecture |
| spec | `sdd/youth-retreat-preregistration/spec` | #77 | architecture |
| design | `sdd/youth-retreat-preregistration/design` | #78 | architecture |
| tasks | `sdd/youth-retreat-preregistration/tasks` | #79 | architecture |
| verify-report | `sdd/youth-retreat-preregistration/verify-report` | #81 | architecture |

Review topics were not read: `reviewGate` is absent, so no review transaction, ledger, receipt, or gate-context exists for this candidate.

Referenced but not required for archive retrieval: apply-progress #80 (cited by verify-report #81 as intermediate apply evidence, including TDD Cycle Evidence).

## Specs Synced

Main specs for these domains did not exist. Each change-folder spec is a full new capability (Purpose + ADDED Requirements; no MODIFIED/REMOVED/RENAMED sections). Each was copied mechanically into a new main spec. Existing attendance-grid specs were not modified.

| Domain | Action | Details |
|--------|--------|---------|
| youth-retreat-preregistration | Created | 9 ADDED requirements (Public Retreat Form, General Consent Required, RPC Pre-registration Persistence, Authenticated Capture Adapter Unchanged, Minor Legal Representative, Sensitive Religious Data Consent, Anonymous PostgREST Isolation, Duplicate Contact Uniqueness, Required Identity Fields) — 20 scenarios |
| youth-retreat-payments | Created | 9 ADDED requirements (Configured Positive Total Required, Super Admin Sets Total Cost, Staff List and Consecutive Payments, Server Role Denied Staff Payments, Payment Status Machine, Overpayment Allowed, Positive Payment Amount, Staff Page Without AdminPage, Anonymous Payment Isolation) — 19 scenarios |

Main specs now at:

- `openspec/specs/youth-retreat-preregistration/spec.md`
- `openspec/specs/youth-retreat-payments/spec.md`

`openspec/config.yaml` has no `rules.archive` entries. Merge was additive only (no destructive REMOVED deltas).

## Mechanical Copy Readback

All `diff -r` comparisons produced empty output (byte-identical). Empty diff is the only passing evidence.

### Step 2 — delta spec → main spec

```text
diff -r openspec/changes/youth-retreat-preregistration/specs/youth-retreat-preregistration/spec.md openspec/specs/youth-retreat-preregistration/spec.md
```

```text
```

```text
diff -r openspec/changes/youth-retreat-preregistration/specs/youth-retreat-payments/spec.md openspec/specs/youth-retreat-payments/spec.md
```

```text
```

### Step 3 — change folder → archive

`git mv` failed because the change folder was untracked (`fatal: source directory is empty, source=openspec/changes/youth-retreat-preregistration, destination=openspec/changes/archive/2026-08-18-youth-retreat-preregistration`). Fallback `mv` succeeded. Source directory is gone.

```text
diff -r "$snapshot_root/source" openspec/changes/archive/2026-08-18-youth-retreat-preregistration
```

```text
```

This `archive-report.md` is additive and was written after the move; it is excluded from the snapshot comparison.

## Archive Contents

- proposal.md
- exploration.md
- design.md
- tasks.md (17/17 complete, 0 unchecked)
- specs/youth-retreat-preregistration/spec.md
- specs/youth-retreat-payments/spec.md
- apply-progress.md (intermediate snapshot)
- verify-report.md (current PASS WITH WARNINGS; historical fail preserved)
- state.yaml
- archive-report.md (this file; additive)

Active path `openspec/changes/youth-retreat-preregistration/` no longer exists.

## What Shipped

Public Spanish youth-retreat pre-registration plus staff installment tracking, without anonymous `members` writes:

- Public `/retiro` outside `(dashboard)`, reusing `CaptureForm` via optional `variant` + `submitAdapter`
- Dedicated `retreat_registrations` / `retreat_payments`; anon insert only via SECURITY DEFINER RPC `register_retreat_preinscription`
- Ley 1581 consent stored on the registration row; `/capture` remains Dexie/enqueue
- Staff page `/retreat-registrations` for leader+; super_admin sets `retreat.youth.total_cost`; status `preinscrito` → `pagos_parciales` → `inscrito`
- Migration `011_youth_retreat_preregistration.sql`; owner-run `retreat_rls.test.sql`

Rollback boundary remains: revert deploy; drop `011` or non-prod `db reset`; revoke RPC `EXECUTE` from `anon`. `/capture` is unchanged by this change.

## Remaining Warnings (non-blocking)

These are close-time warnings, not remaining SDD tasks:

1. Engram tasks #79 still showed 4.1–4.2 unchecked at save time; filesystem `tasks.md` is 17/17.
2. Playwright skip remains for the legacy `/rest/v1` DELETE (Next has no PostgREST proxy).
3. Coverage tool is not configured; changed-file coverage was not measured.
4. Design file-change bullet said modify `rls.test.sql`; implementation added `retreat_rls.test.sql` per tasks 1.1.
5. Two source-inspection companion assertions in payments and submit-adapter tests.
6. Tasks 2.5 and 3.2 marked Safety Net N/A while `privacy-notice.ts` and `app-settings.ts` were modified existing files.

## SDD Cycle Complete

The change has been planned, implemented, verified, and archived. Main specs are the source of truth. Implementation is not yet merged to `main`. Ready for the next change.
