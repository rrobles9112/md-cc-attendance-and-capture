# Apply progress — fix-retiro-costo-total (store: openspec)

> Strict TDD active (`openspec/config.yaml`: `npx vitest`, `npx tsc --noEmit`, `npx playwright test`).
> Delivery: `single-pr` per run instruction (forecast 120–180 lines, Low risk).
> Skills loaded before work: supabase (`SKILL.md`), supabase-postgres-best-practices (`SKILL.md`).

## Structured status consumed

- Change: `fix-retiro-costo-total`, `applyState: ready`, `artifactStore: openspec`,
  `actionContext.mode: repo-local`, workspace `/Users/richard.robles/PycharmProjects/MD_CC_ATTENDANCE_AND_CAPTURE`,
  allowed edit roots = workspace. No `blocked` flags; proceeded.
- Review Workload Forecast gates: `Decision needed before apply: No`,
  `Chained PRs recommended: No`, `400-line budget risk: Low` → single PR, no chaining.

## TDD Cycle Evidence

| Step | Command / action | Result |
| --- | --- | --- |
| Baseline | `npx vitest run src/lib/settings/__tests__/app-settings.test.ts` (pre-change) | 5 passed (GREEN baseline) |
| T1 RED | Extended test file with T-UNIT-1..5, ran same file | **RED: 5 failed / 6 passed** — T-UNIT-1 (single-arg upsert), T-UNIT-2 (raw throw), T-UNIT-3 x2 (raw TypeError), T-UNIT-5 (onConflict). T-UNIT-4 (no-session) passed pre-fix as designed (preserved behavior guard) |
| T2 RED | Wrote `supabase/tests/app_settings_insert.test.sql` | File written; **harness pending** — no runnable SQL harness in this environment (Docker daemon down: `Cannot connect to the Docker daemon`; `supabase status` fails). Pre-migration RED (T-SQL-1 → 42501) inferred from missing FOR INSERT policy in migrations 001–023, not executed |
| T3 migration | `supabase migration new app_settings_insert_super_admin` → filled exact design §3 policy + rollback comment | `supabase/migrations/20260916214255_app_settings_insert_super_admin.sql` created. `supabase db pull/advisors` **pending** (no local DB; same Docker cause) |
| T4 GREEN | Fixed `app-settings.ts` (design §4); legacy payload test updated to 2-arg form (payload assertion preserved) | Scoped suite GREEN |
| T5 | Fixed `handleSaveCost` (ref guard + coded toasts, zero table hunks) | — |
| TRIANGULATE | Added 3rd T-UNIT-3 case (`NetworkError`-named plain Error) to exercise the regex branch, not just `instanceof TypeError` | 12/12 GREEN |
| T6.1 GREEN | `npx vitest run src/lib/settings/__tests__/app-settings.test.ts` | **12 passed / 12 GREEN** |
| T6.1 full | `npx vitest run` (full) | 379 passed / **2 failed** in `src/__tests__/rls/super-admin-retreat-mutations.test.ts` — pre-existing helper fragility (see Risks), not a regression of the fix |
| T6.1 types | `npx tsc --noEmit` | **exit 0 GREEN** |
| T6.3 gates | `git diff --stat` + table-class grep | Tracked diff 149+/13- (≈162 lines); untracked +108 (migration 10 + SQL test 98) → **≈270 total, under 400**; table-class grep over diff **empty (0 matches)** |

## Completed tasks + persisted checkbox updates

- [x] T1.1 — `app-settings.test.ts`: T-UNIT-1 `onConflict` assertion (RED→GREEN)
- [x] T1.2 — T-UNIT-2/3/4/5 mapping + DPO regression (RED→GREEN; T-UNIT-4 preserved-behavior)
- [x] T2.1 — `supabase/tests/app_settings_insert.test.sql` written (T-SQL-1..4, `__t` keys + cleanup); harness run pending (exact command below)
- [x] T3.1 — `supabase/migrations/20260916214255_app_settings_insert_super_admin.sql` with exact design §3.2 statement + rollback comment; `db pull`/`advisors` pending
- [x] T4.1 — `app-settings.ts`: `upsert(..., { onConflict: 'key' })` + typed errors, signatures byte-identical
- [x] T5.1 — `page.tsx`: `useRef` import + `savingCostRef` guard + coded toasts; zero table-markup hunks
- [x] T6.3 — budget (≤400 ✓) + table-grep empty ✓ recorded; E2E `e2e/retreat-cost.spec.ts` **deferred** (not implemented)

## Files changed

- `src/lib/settings/app-settings.ts` (T4.1)
- `src/lib/settings/__tests__/app-settings.test.ts` (T1.1/T1.2)
- `src/app/(dashboard)/retreat-registrations/page.tsx` (T5.1 — cost-card hunk only)
- `supabase/tests/app_settings_insert.test.sql` (new, T2.1)
- `supabase/migrations/20260916214255_app_settings_insert_super_admin.sql` (new, T3.1)

Untouched per scope: table markup/classes/toolbar/pagination/transfer logic,
`user_role()`, `guards.ts`, `useRole.ts`, seed 011, `admin/page.tsx`. No commit (per instruction).

## Deviations from design

1. **Legacy payload test updated to 2-arg form** (`persists the value through setSetting…` now expects
   `{ onConflict: 'key' }` as second arg). Required: the old single-arg `toHaveBeenCalledWith` cannot pass
   after the fix; payload (`key/value/updated_by`) assertion preserved per T1.1.
2. **T-UNIT-3 has 3 cases, not 2**: added a `NetworkError`-named plain-`Error('Failed to fetch')` case so the
   message-regex branch (non-`TypeError` path) is triangulated, per design §6.1 "DOMException-style case".

## Remaining tasks (exact unchecked lines)

- [ ] T0.1 `supabase/diagnose_user_role.sql` in repro env — **user-side, pending** (blocking for validation, not for code)
- [ ] T6.1 full-suite GREEN — **partially blocked**: scoped 12/12 ✓, `tsc` ✓; full suite 2 failures from pre-existing
  helper collision (see Risks); SQL-harness rerun + `advisors` pending (no local DB)
- [ ] T6.2 manual verification (super_admin save 480000, toasts, double-click, DPO smoke) — **user-side, pending**

## Pending commands (exact)

- SQL harness: `docker exec -i supabase_db_MD_CC_ATTENDANCE_AND_CAPTURE psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/app_settings_insert.test.sql`
- Migration finalize (needs local DB): `supabase db pull --local --yes`, `supabase migration list --local`, `supabase db advisors`
- T0 diagnose: run `supabase/diagnose_user_role.sql` via Dashboard → SQL Editor in repro env

## Workload / PR boundary

Single PR (migration → client → tests). Total ≈270 lines vs 400 budget → no chaining, no `size:exception`.
`actionContext` warnings: none. No edits outside allowed surfaces.

## Risks

1. **Pre-existing contract-test collision (found during T6.1):** `src/__tests__/rls/super-admin-retreat-mutations.test.ts`
   (commit `3414b00`, PR #146) resolves its target via `latestMigrationMatching("super_admin")` — the newest
   `*super_admin*.sql` file. The T3.1-mandated name `20260916214255_app_settings_insert_super_admin.sql` now sorts
   after `022_restrict_retreat_member_mutations_super_admin.sql`, so both assertions read the new 10-line policy
   file and fail (`retreat_payments_insert`, `transfer_retreat_to_valientes` absent). Verified: with this change
   stashed, the file passes 2/2. **Not fixed** — that test is outside this run's allowed edit surfaces.
   Recommended scoped follow-up (parent/verify): pin the helper to `022_…` or switch to match-any semantics.
2. SQL harness + advisors + T0 diagnose unexecuted (no Docker/local Supabase in this environment) — must run
   pre-merge per design §7 steps 1/7.
