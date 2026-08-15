# Archive Report: members-scale-attendance-consistency

**Change**: members-scale-attendance-consistency
**Project**: md-cc-attendance-and-capture
**Artifact store**: hybrid (openspec + Engram)
**Archived on**: 2026-08-15
**Archived to**: `openspec/changes/archive/2026-08-15-members-scale-attendance-consistency/`
**Status**: closed
**reviewGate**: absent — archive proceeded under ordinary repository policy; no review receipt was required or consulted

## Final State at Close

All 30 implementation and verification tasks are checked. The SDD cycle is complete.

| Field | Value |
|-------|-------|
| Tasks | 30/30 complete, 0 unchecked |
| Apply | all_done |
| Verify | all_done — PASS WITH WARNINGS |
| Requirements | 17/17 complete |
| Scenarios | 30/30 COMPLIANT |
| Vitest | 127/127 passed (13 files) |
| Typecheck | `npx tsc --noEmit` exit 0 |
| Lint | `npx next lint` exit 0 |
| CRITICAL findings | 0 |
| reviewGate | structurally absent |

### Delivery

Stacked commits: `82ebdd7`, `7b3b4e4`, `d961497`, `ca07219`, `edeee9e`

Stacked PRs:

- #74 S1 → main
- #75 S2 → S1
- #76 S3 → S2
- #77 S4 → S3

### Verification (current)

Per Engram verify-report #66 at verification time, current admitted envelope:

```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:06570f27b3e752af7ef70862be8c1e1a837df20f9258191649e3bba5ee37c9e3
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 17/17
scenarios: 30/30
```

Historical fail envelope is preserved in that report and is not current state:

```yaml
evidence_revision: sha256:1b0fea79652d208f1870f513e113dbcd79612f7d53b1b24ad5456d3b375a6ba8
verdict: fail
```

Out-of-scope Playwright failures in `e2e/export.spec.ts`, `e2e/offline-sync.spec.ts`, and `e2e/role-enforcement.spec.ts` remain warnings, not blockers.

`apply-progress` and the first-fail verify-report are intermediate snapshots. Final-state facts in the archive launch prompt outrank those snapshots and match the persisted tasks artifact and current verify-report #66.

## Observation IDs Read (traceability)

| Artifact | Topic key | Observation ID | Type |
|----------|-----------|----------------|------|
| proposal | `sdd/members-scale-attendance-consistency/proposal` | #58 | architecture |
| spec | `sdd/members-scale-attendance-consistency/spec` | #59 | architecture |
| design | `sdd/members-scale-attendance-consistency/design` | #60 | architecture |
| tasks | `sdd/members-scale-attendance-consistency/tasks` | #63 | architecture |
| verify-report | `sdd/members-scale-attendance-consistency/verify-report` | #66 | architecture |

Review topics were not read: `reviewGate` is absent, so no review transaction, ledger, receipt, or gate-context exists for this candidate.

Referenced but not required for archive retrieval: apply-progress #64 (cited by verify-report #66 as intermediate apply evidence).

## Specs Synced

`openspec/specs/` did not exist. Each delta spec is a full spec (Purpose + Requirements; no MODIFIED/REMOVED/RENAMED sections). Each was copied mechanically into a new main spec. No existing requirements were at risk.

| Domain | Action | Details |
|--------|--------|---------|
| attendance-counter-consistency | Created | 5 ADDED requirements (Counter Numerator Derivation, Counter Denominator Derivation, Orphaned Attendance Exclusion, Realtime and Hydration Consistency, Role-Independent Counter Behavior) |
| attendance-grid-search | Created | 6 ADDED requirements (Search Field Matching, Debounced Search Deferral, Search Scope, Empty State Distinction, Search Resets Pagination, Offline Search Capability) |
| attendance-grid-pagination | Created | 6 ADDED requirements (Page Size Constant, Load More Button, Pagination Reset on Session Change, Pagination Reset on Search Change, Counter Unaffected by Pagination, Offline Pagination) |

Main specs now at:

- `openspec/specs/attendance-counter-consistency/spec.md`
- `openspec/specs/attendance-grid-search/spec.md`
- `openspec/specs/attendance-grid-pagination/spec.md`

`openspec/config.yaml` has no `rules.archive` entries. Merge was additive only (no destructive REMOVED deltas).

## Mechanical Copy Readback

All `diff -r` comparisons produced empty output (byte-identical). Empty diff is the only passing evidence.

### Step 2 — delta spec → main spec

```text
diff -r openspec/changes/members-scale-attendance-consistency/specs/attendance-counter-consistency/spec.md openspec/specs/attendance-counter-consistency/spec.md
```

```text
```

```text
diff -r openspec/changes/members-scale-attendance-consistency/specs/attendance-grid-search/spec.md openspec/specs/attendance-grid-search/spec.md
```

```text
```

```text
diff -r openspec/changes/members-scale-attendance-consistency/specs/attendance-grid-pagination/spec.md openspec/specs/attendance-grid-pagination/spec.md
```

```text
```

### Step 3 — change folder → archive

`git mv` failed because the change folder was untracked (`fatal: source directory is empty`). Fallback `mv` succeeded. Source directory is gone.

```text
diff -r "$snapshot_root/source" openspec/changes/archive/2026-08-15-members-scale-attendance-consistency
```

```text
```

This `archive-report.md` is additive and was written after the move; it is excluded from the snapshot comparison.

## Archive Contents

- proposal.md
- exploration.md
- design.md
- tasks.md (30/30 complete, 0 unchecked)
- specs/attendance-counter-consistency/spec.md
- specs/attendance-grid-search/spec.md
- specs/attendance-grid-pagination/spec.md
- apply-progress.md (intermediate snapshot)
- verify-report.md (current PASS WITH WARNINGS; historical fail preserved)
- archive-report.md (this file; additive)

Active path `openspec/changes/members-scale-attendance-consistency/` no longer exists.

## What Shipped

Client-side attendance grid consistency and scale:

- Counter numerator from `countPresent(filteredMembers, attendanceMap)`; orphaned soft-deleted attendance excluded via `excludeOrphanedAttendance` inside `loadAttendance`
- Debounced search across name, phone, and email via `useDeferredValue` + `filterBySearch`
- Load-more pagination with `PAGE_SIZE = 50`
- Hydration and realtime component tests proving coordinated Dexie reloads

No schema change. Rollback boundary remains the `src/lib/attendance/` modules, `AttendanceGrid.tsx`, and the S1–S4 tests.

## Remaining Warnings (non-blocking)

1. Out-of-scope Playwright failures in export, offline-sync, and role-enforcement specs.
2. In-scope attendance E2E was cited from parent evidence (12 passed), not re-run in the final verify process.
3. Coverage tooling is not configured.
4. Two assertion-quality notes in consistency and orphans tests.

## SDD Cycle Complete

The change has been planned, implemented, verified, and archived. Main specs are the source of truth. Ready for the next change.
