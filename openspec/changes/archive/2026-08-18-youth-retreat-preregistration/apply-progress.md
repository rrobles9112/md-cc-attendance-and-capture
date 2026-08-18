# Apply Progress: youth-retreat-preregistration

**Change**: youth-retreat-preregistration
**Mode**: Strict TDD
**Status**: 17/17 tasks complete

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `supabase/tests/retreat_rls.test.sql` | Integration | ✅ 8/8 `rls.test.sql` | ✅ Written first; missing relation | ✅ Anon SELECT/DML denied | ✅ Both tables + PII re-check | ➖ Deny paths complete |
| 1.2 | same | Integration | ✅ 8/8 | ✅ Written first | ✅ RPC `preinscrito` + consent; table INSERT denied | ✅ No `members` / `consent_records` | ➖ None needed |
| 1.3 | same | Integration | ✅ 8/8 | ✅ Written first | ✅ Validation + unique indexes | ✅ Case/punct email+phone; sensitive yes vs NULL | ✅ `v_is_minor` |
| 1.4 | same | Integration | ✅ 8/8 | ✅ Written first | ✅ Payments refused; stay `preinscrito` | ✅ empty, `0`, `-5`, non-numeric, amount `0`/`-10` | ➖ None needed |
| 1.5 | same | Integration | ✅ 8/8 | ✅ Written first | ✅ Status machine + server deny | ✅ 0 / 40/100 / 100/100 / overpay; leader cannot set total; super_admin subsequent 40+20 | ➖ None needed |
| 1.6 | `011_youth_retreat_preregistration.sql` | Integration | N/A (new) | ✅ Tests already failing | ✅ `db reset` applied 011 | N/A (implements triangulated tests) | ✅ REVOKE+RLS+EXECUTE |
| 2.1 | `e2e/retiro.spec.ts` | E2E | N/A (new) | ✅ Written | ✅ Chromium passed | ✅ heading/name/button/privacy/no login/no money | ✅ unique PREINSCRIPCIÓN matcher |
| 2.2 | adapter + CaptureForm tests | Unit + Integration | ✅ validation 12/12 | ✅ Written | ✅ vitest passed | ✅ RPC args, null birthday, Dexie default vs adapter | ✅ ResizeObserver stub |
| 2.3 | adapter tests | Unit | N/A (new) | ✅ missing modules | ✅ passed | ✅ EVENT_KEY + empty→null | ➖ already minimal |
| 2.4 | `CaptureForm.adapter.test.tsx` | Integration | ✅ default Dexie path | ✅ adapter ignored | ✅ passed | ✅ member vs retreat chrome | ✅ exhaustive `captureFormConfig` |
| 2.5 | privacy-notice + e2e | Unit + E2E | N/A (new) | ✅ constant undefined | ✅ passed | ✅ Ley 1581/ARCO vs attendance notice | ➖ none needed |
| 3.1 | `guards.test.ts` + `role-enforcement.spec.ts` | Unit + E2E | ✅ 34/34 | ✅ Written | ✅ passed | ✅ 3 roles + deny UI | ✅ Login helper |
| 3.2 | `app-settings.test.ts` | Unit | N/A (new) | ✅ Written | ✅ passed | ✅ stored/missing/empty/set | ✅ no `Number(null)` default |
| 3.3 | `payments.test.ts` + staff page | Unit | N/A (new) | ✅ Written | ✅ passed | ✅ remaining, blocked, sums, source | ✅ Exhaustive status switch |
| 3.4 | layout + e2e | Unit + E2E | ✅ layout existed | ✅ Written | ✅ nav + e2e | ✅ helper not new enum | ✅ Grouped imports |
| 4.1 | SQL + source inspection | Integration | ✅ Dexie/realtime unchanged | ✅ retreat SQL re-run | ✅ 38 PASS notices | ✅ `/capture` no adapter | ➖ none |
| 4.2 | tsc/lint/vitest/playwright | Mixed | N/A | N/A (verify) | ✅ tsc 0, lint 0, vitest 158, Playwright 9 passed 1 skipped | ✅ leader staff page load | ✅ exact cost-title locator |

## Work Unit Evidence

| Unit | Focused test | Runtime harness | Rollback boundary |
|------|--------------|-----------------|-------------------|
| PR 1 Schema/RPC | `retreat_rls.test.sql` → All retreat RLS/RPC/status tests passed | `supabase db reset` applies `011` | `011_*.sql` + `retreat_rls.test.sql` + CI psql step |
| PR 2 Public form | vitest adapter/CaptureForm/privacy + `e2e/retiro.spec.ts` | Unauth GET `/retiro` | `retiro/page.tsx`, `src/lib/retreat/*`, CaptureForm adapter, privacy notice |
| PR 3 Staff UI | vitest guards/settings/payments + role-enforcement retreat cases | Leader loads `/retreat-registrations` without AdminPage | Staff page, layout nav, RBAC alias, app-settings helpers |

## Completed tasks

All 17 tasks `[x]` in `tasks.md`.
