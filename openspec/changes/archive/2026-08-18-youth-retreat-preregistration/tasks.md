# Tasks: Youth Retreat Pre-registration

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 750–1100 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 schema/RPC → PR 2 public form → PR 3 staff UI |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

`DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Schema/RPC/RLS + status trigger | PR 1 → main | `supabase db reset --yes && psql $DB_URL -v ON_ERROR_STOP=1 -c "SET ROLE authenticated" -f supabase/tests/rls.test.sql && psql $DB_URL -v ON_ERROR_STOP=1 -f supabase/tests/retreat_rls.test.sql` | `db reset` applies `011`+seed | `011_youth_retreat_preregistration.sql` + `retreat_rls.test.sql` + CI db-integration step |
| 2 | Adapter + public `/retiro` | PR 2 → main after PR1 | `npx vitest run src/lib/retreat/__tests__/submit-adapter.test.ts && npx playwright test e2e/retiro.spec.ts` | Unauth GET `/retiro` | `retiro/page.tsx`, `src/lib/retreat/*`, CaptureForm adapter, `RETREAT_PRIVACY_NOTICE_ES`, `e2e/retiro.spec.ts` |
| 3 | Staff UI + nav + cost | PR 3 → main after PR2 | `npx vitest run src/lib/rbac/__tests__/guards.test.ts && npx playwright test e2e/role-enforcement.spec.ts` | Server hides payments; leader+ lists | Staff page, `layout.tsx` nav, `app-settings.ts`, RBAC/e2e adds |

## Phase 1: Schema / RPC / RLS (PR 1)

- [x] 1.1 RED `supabase/tests/retreat_rls.test.sql`: anon SELECT/DML on `retreat_registrations`/`retreat_payments` denied; no PII. (CI: new owner-run file — `authenticated` cannot `SET ROLE anon`.)
- [x] 1.2 RED: anon `register_retreat_preinscription` inserts `preinscrito`+consent; table INSERT denied; no `members`/`consent_records`.
- [x] 1.3 RED: reject missing identity/consent, minor without legal rep; unique `(event_key, email|phone)`; sensitive NULL without consent.
- [x] 1.4 RED: refuse payment if `retreat.youth.total_cost` missing/empty/`<=0` or amount `<=0`; stay `preinscrito`.
- [x] 1.5 RED: `0→preinscrito`, partial `pagos_parciales`, `sum>=total→inscrito` (overpay OK); no `members`; `server` INSERT payments fails.
- [x] 1.6 GREEN `supabase/migrations/011_youth_retreat_preregistration.sql`: tables, unique indexes, SECURITY DEFINER RPC (`search_path=''`, EXECUTE anon only), RLS REVOKE+no anon policies, payment triggers, seed total `''`, `NOTIFY pgrst`. Key `retiro-juvenil-octubre-2026`. Prove Unit 1.

## Phase 2: Public form (PR 2)

- [x] 2.1 RED threat-matrix: unauth GET `/retiro` shows form, no login redirect — `e2e/retiro.spec.ts`.
- [x] 2.2 RED `src/lib/retreat/__tests__/submit-adapter.test.ts`: RPC only; never Dexie/`sync_queue`; no money; default CaptureForm Dexie+enqueue, no RPC.
- [x] 2.3 GREEN `src/lib/retreat/constants.ts` + `src/lib/retreat/submit-adapter.ts` (`register_retreat_preinscription`).
- [x] 2.4 GREEN `src/components/forms/CaptureForm.tsx`: `variant` (`member` default) + `submitAdapter`; `/capture` unchanged.
- [x] 2.5 GREEN `src/lib/consent/privacy-notice.ts` `RETREAT_PRIVACY_NOTICE_ES` + `src/app/retiro/page.tsx` Spanish copy + adapter; no money. Prove Unit 2.

## Phase 3: Staff UI (PR 3)

- [x] 3.1 RED threat-matrix: staff route hides payments without leader+ — `src/lib/rbac/__tests__/guards.test.ts` + `e2e/role-enforcement.spec.ts`.
- [x] 3.2 GREEN `src/lib/settings/app-settings.ts` helpers for `retreat.youth.total_cost` (no numeric default).
- [x] 3.3 GREEN `src/app/(dashboard)/retreat-registrations/page.tsx`: leader+ list + payments; super_admin cost editor; not AdminPage.
- [x] 3.4 GREEN `src/app/(dashboard)/layout.tsx` nav via `canCreate`; `server` cannot open payments UI. Prove Unit 3.

## Phase 4: Cross-slice verification

- [x] 4.1 Re-run Unit 1 SQL after PR2/PR3; `/capture` still Dexie; no `retreat_*` in Dexie/realtime/hydrate.
- [x] 4.2 `npx tsc --noEmit` + `npx next lint` + `npx vitest run` + `npx playwright test e2e/retiro.spec.ts e2e/role-enforcement.spec.ts`.
