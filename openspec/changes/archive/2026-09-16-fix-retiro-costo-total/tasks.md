# Tasks — fix-retiro-costo-total (store: openspec)

> Design: `openspec/changes/fix-retiro-costo-total/design.md` · Spec: `openspec/changes/fix-retiro-costo-total/specs/youth-retreat-payments/spec.md` · Proposal: `openspec/changes/fix-retiro-costo-total/proposal.md`
> Strict TDD active (`openspec/config.yaml`: `npx vitest`, `npx tsc --noEmit`, `npx playwright test`). E2E deferred unless budget allows — explicitly out of first slice (see T6 + Forecast).

## Review Workload Forecast

| Field | Value |
| ------- | ------- |
| Estimated changed lines | 120–180 (migration ~15 + app-settings.ts ~30 + page.tsx ~25 + unit tests ~60 + SQL test ~40) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR (migration → client → tests, one reviewable unit) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

```text
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low
```

Budget note: if `git diff --stat` exceeds 400 at T6, pause per `ask-on-risk` (no invented chain, no silent `size:exception`). E2E (`e2e/retreat-cost.spec.ts`) is deferred and MUST NOT be added to hit budget — state explicitly: E2E deferred unless budget allows with spare headroom confirmed.

## Implementation tasks (dependency-ordered, strict TDD)

### T0 — Diagnose gate (blocking, no code)

- [ ] T0.1 Run `supabase/diagnose_user_role.sql` in repro env (Dashboard → SQL Editor), capture full output: `user_role()` def (007 active?), `user_role()` with super_admin JWT, without `app_metadata`, `profiles.role` vs `auth.users.raw_app_meta_data`, applied migrations list. If desync (missing/wrong profile row or stale JWT without `app_metadata.role`), re-sync role (refresh JWT after grant) and re-run before T1. Do not modify `user_role()`. <!-- sdd-owner: implementation -->

> NOTE (apply 2026-09-16): T0.1 output is user-side and still pending — code work did not block on it per run instruction. Run it in the repro env before validating the fix.

### T1 — RED unit tests (fail first)

- [x] T1.1 Extend `src/lib/settings/__tests__/app-settings.test.ts`: T-UNIT-1 assert `setSetting('retreat.youth.total_cost','480000')` calls `upsert(payload, { onConflict: 'key' })` with `key/value/updated_by` preserved (keep existing l.63–82 payload assertion); run `npx vitest run src/lib/settings/__tests__/app-settings.test.ts` and confirm RED (single-arg `upsert` today). <!-- sdd-owner: implementation -->
  - RED 2026-09-16: T-UNIT-1 failed pre-fix (single-arg upsert); GREEN post-fix (12/12 scoped).
- [x] T1.2 Same file: T-UNIT-2 `upsert → { code: '42501' }` rejects `toMatchObject({ code: 'permission-denied' })`; T-UNIT-3 `mockRejectedValue(new TypeError('fetch failed'))` (+ `Failed to fetch` case) rejects `{ code: 'network' }`; T-UNIT-4 no-session `getSession → null` rejects `Not authenticated` with `mockUpsert` not called; T-UNIT-5 DPO key `setSetting('dpo_contact_email',…)` same `onConflict` + one 42501 mapping case. Confirm RED (raw `throw error` today). <!-- sdd-owner: implementation -->
  - RED 2026-09-16: T-UNIT-2/3(x2)/5 failed pre-fix; T-UNIT-4 passed pre-fix as designed (preserved behavior). GREEN post-fix incl. added NetworkError-name triangulation case.

### T2 — RED SQL policy test (fail first)

- [x] T2.1 Create `supabase/tests/app_settings_insert.test.sql` following `supabase/tests/retreat_rls.test.sql:1329` + `retreat_valientes_transfer.test.sql:55` harness (`SET LOCAL ROLE authenticated` + `request.jwt.claims` with `app_metadata.role`); statement `INSERT INTO public.app_settings(key,value) VALUES ('__t1','480000') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value` with `__t`-keys + cleanup `DELETE`; cases: T-SQL-1 super_admin succeeds, T-SQL-2 leader → 42501 unchanged, T-SQL-3 anon denied, T-SQL-4 no-claim authenticated denied. Run harness pre-migration and confirm T-SQL-1 RED (42501, no FOR INSERT policy). <!-- sdd-owner: implementation -->
  - DONE 2026-09-16 with harness pending: test file written per harness; no runnable SQL harness in this env (Docker daemon down). T-SQL-1 RED inferred from absent FOR INSERT policy (migrations 001–023). Run cmd: `docker exec -i supabase_db_MD_CC_ATTENDANCE_AND_CAPTURE psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/app_settings_insert.test.sql`.

### T3 — Additive migration (GREEN for T-SQL-1)

- [x] T3.1 Create migration via `supabase migration new app_settings_insert_super_admin` (never hand-invent prefix), fill `supabase/migrations/0XX_app_settings_insert_super_admin.sql` with exactly `CREATE POLICY "app_settings_insert_super_admin" ON public.app_settings FOR INSERT TO authenticated WITH CHECK ((SELECT public.user_role()) = 'super_admin');` (WITH CHECK only, no USING; no `TO anon`, no `WITH CHECK true`, no `SECURITY DEFINER`, no changes to SELECT/UPDATE policies or seed 011), include rollback comment `DROP POLICY IF EXISTS "app_settings_insert_super_admin" ON public.app_settings;`, iterate via `execute_sql`/`supabase db query` (not per-iteration `apply_migration`), finalize `supabase db pull --local --yes` + `supabase migration list --local` + `supabase db advisors` clean per skill supabase §6 checklist. <!-- sdd-owner: implementation -->
  - DONE 2026-09-16: `supabase/migrations/20260916214255_app_settings_insert_super_admin.sql` via CLI with exact policy + rollback comment. `db pull`/`migration list`/`advisors` pending (no local DB — Docker daemon down).

### T4 — `app-settings.ts` fix (GREEN for T1, signatures unchanged)

- [x] T4.1 Edit `src/lib/settings/app-settings.ts` only: `upsert({ key, value, updated_by, updated_at }, { onConflict: 'key' })`; map `code === '42501'` → throw `Error` with `.code='permission-denied'` + `cause`, catch code-less fetch failures (`TypeError`/`Failed to fetch|Load failed|network`i) → `.code='network'` + `cause`, preserve no-session `Not authenticated`, rethrow all else unchanged; keep public signatures `setSetting/getSetting/setRetreatTotalCost/getRetreatTotalCost` byte-identical. <!-- sdd-owner: implementation -->

### T5 — `handleSaveCost` coded toasts + sync guard (no layout change)

- [x] T5.1 Edit `src/app/(dashboard)/retreat-registrations/page.tsx` only: add `useRef` import + `savingCostRef = useRef(false)` next to `savingCost` state (l.192), guard `if (savingCostRef.current) return;` before validation, set ref + `setSavingCost(true)` before first `await`, reset both in `finally`; switch catch on `(e).code`: `permission-denied` → `toast.error("Sin permisos para guardar el costo (requiere super_admin). Verifique su rol o vuelva a iniciar sesión.")`, `network` → `toast.error("Sin conexión. Verifique su red e intente de nuevo.")`, `Not authenticated` → `toast.error("No hay una sesión activa")`, default → existing generic; keep success `toast.success("Costo total del retiro actualizado")` + `await loadData()`; zero hunks to table markup/classes/colSpan/toolbar/pagination/transfer logic. <!-- sdd-owner: implementation -->

### T6 — GREEN verification + budget gates

- [ ] T6.1 Run `npx vitest run src/lib/settings/__tests__/app-settings.test.ts` GREEN, rerun SQL harness `supabase/tests/app_settings_insert.test.sql` (super_admin success, leader/anon denied), then `npx vitest` (scoped/full per config) + `npx tsc --noEmit` GREEN + `supabase db advisors` clean. <!-- sdd-owner: implementation -->
  - PARTIAL 2026-09-16: scoped 12/12 GREEN ✓; `npx tsc --noEmit` exit 0 ✓; full `npx vitest` 379/381 — 2 failures in pre-existing `src/__tests__/rls/super-admin-retreat-mutations.test.ts` caused by `latestMigrationMatching("super_admin")` now resolving to the new T3.1 migration file (outside allowed edit surfaces — left for parent/verify follow-up); SQL rerun + advisors pending (no local DB).
- [ ] T6.2 Manual: login super_admin → save `480000` persists `retreat.youth.total_cost='480000'` + toast success + reload Saldo/% recomputed (not `400.000,00`); simulated 42501 → permission toast, offline → network toast, rapid double-click → single write/toast; regression smoke `src/app/(dashboard)/admin/page.tsx` DPO email save persists. <!-- sdd-owner: implementation -->
- [x] T6.3 Budget/layout gates: `git diff --stat` vs 400 lines (if exceeded, pause per ask-on-risk, do not chain/invent exception); table-class grep over diff (`overflow-x-clip|sticky|hidden sm:table-cell|hidden md:table-cell|hidden lg:table-cell|w-56|w-64|colSpan`) returns empty; record outputs in PR/task log. E2E `e2e/retreat-cost.spec.ts` deferred — do not implement unless T6.3 shows clear headroom AND explicit approval; state deferral in PR description. <!-- sdd-owner: implementation -->
  - DONE 2026-09-16: tracked 149+/13- + untracked 108 ≈ 270 total ≤ 400 ✓ (single PR, no chain/exception); table-class grep empty ✓. E2E deferred (not implemented).

## Bounded review (parent-owned, post-apply only)

- [ ] Start or reuse bounded review for the single PR (verify T0 output attached, RED→GREEN evidence, advisors clean, diff ≤400, table-grep empty). <!-- sdd-owner: parent -->
- [ ] Lifecycle gate: approve merge only if success criteria (proposal §12 / design §8) all met; otherwise return scoped defects. <!-- sdd-owner: parent -->
