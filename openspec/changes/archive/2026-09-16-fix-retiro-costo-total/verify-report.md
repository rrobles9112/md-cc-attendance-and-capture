```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:48c8414  # origin/main tip que contiene los PRs #152/#153 mergeados
verdict: pass
blockers: 0
critical_findings: 0
requirements: 10/10
scenarios: 20/20
test_command: npx vitest run --no-file-parallelism --testTimeout=30000
test_exit_code: 0
test_output_hash: sha256:b8d8c1facef6dcb6d0e509fd022f622893d848a4f92332e93b561577cb7187aa
build_command: ./node_modules/.bin/tsc --noEmit
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
lint_command: npx next lint --file "src/app/(dashboard)/retreat-registrations/page.tsx" --file "src/lib/settings/app-settings.ts" --file "src/lib/rbac/guards.ts"
lint_exit_code: 0
lint_output_hash: sha256:da253038afbae7366cad7bbf019fe86b724b03ec9575fca5601315c8d41c17bb
```

# Verify Report — fix-retiro-costo-total

Status: **PASS** — 10/10 requirements, 20/20 scenarios. No CRITICAL findings, no blockers.
Re-verified 2026-10-12 post-merge (PRs #152/#153 en main, commit `48c8414`) antes de
archivar. Spec: `specs/youth-retreat-payments/spec.md` (delta del cambio).

Nota de evidencia: la corrida local completa (424 tests) pasó con timeout de 30s
(`--no-file-parallelism`); con el default de 5s algunos tests de
`retreat-registrations` flaquean por starvation de CPU (load avg 163 en la máquina
del autor) — no es un defecto del código. La evidencia autoritativa es CI, verde
10/10 sobre el mismo árbol (job `test` 56s, run
https://github.com/rrobles9112/md-cc-attendance-and-capture/actions/runs/38212218581/job/114688847173).
Follow-up separado: subir `testTimeout` en `vitest.config.ts` (ver §Seguimientos).

## Spec coverage (PASS/FAIL por requirement)

| # | Requirement | Veredicto | Evidencia |
| - | ----------- | --------- | --------- |
| 1 | Total-Cost Persistence Recalculates Balance | **PASS** | `page.tsx`: `handleSaveCost()` persiste vía `setRetreatTotalCost(normalized)` y luego `await loadData()`; saldo/porcentaje se recalculan por fila con `remainingBalance(parsedTotal, sumPaid)` y `computeRowAbonos(rowPayments, storedTotal)` sobre el total recién cargado. Evidencia de producción T6.2: `app_settings.retreat.youth.total_cost = "480000"` guardado manualmente (save exitoso). |
| 2 | INSERT Policy for super_admin Upserts | **PASS** | Migración `supabase/migrations/20260916214255_app_settings_insert_super_admin.sql`: `CREATE POLICY "app_settings_insert_super_admin" ON public.app_settings FOR INSERT TO authenticated WITH CHECK ((SELECT public.user_role()) = 'super_admin')`. PostgREST upsert evalúa la rama INSERT primero; políticas SELECT/UPDATE intactas. `setSetting` (upsert) en `src/lib/settings/app-settings.ts`. |
| 3 | Permission Error Mapping | **PASS** | `page.tsx` `handleSaveCost` catch: `code === "permission-denied"` → toast "Sin permisos para guardar el costo (requiere super_admin). Verifique su rol o vuelva a iniciar sesión."; mapping adicional para `network` y "Not authenticated" (req 4). Contrato de errores de `setSetting` pinado por `app-settings.test.ts` (12/12). |
| 4 | Connection Error Mapping | **PASS** | Mismo catch: `code === "network"` → "Sin conexión. Verifique su red e intente de nuevo."; fallback genérico "Error al guardar el costo total". |
| 5 | Single Write on Double Activation | **PASS** | Guard `savingCostRef` (ref, no state) al inicio de `handleSaveCost`: `if (savingCostRef.current) return;` — doble activación dentro del mismo tick no puede pasar; botón además `disabled={savingCost}`; ref reseteado en `finally`. |
| 6 | Shared setSetting Regression for DPO Email | **PASS** | `setSetting` compartido por `dpo_contact_email` y `retreat.youth.total_cost` (misma función en `app-settings.ts`); `src/lib/settings/__tests__/app-settings.test.ts` 12/12 verde incluye casos de `setSetting` (regresión DPO). |
| 7 | Public Signatures Unchanged | **PASS** | Firmas de `getSetting`/`setSetting`/`getRetreatTotalCost`/`setRetreatTotalCost` sin cambios; `guards.ts` y `useRole.ts` no tocados por los PRs #152/#153 (diff revisado); suite de guards 34/34 verde. |
| 8 | Zero Table-Layout Changes (T2 Boundary) | **PASS** | El cambio T2 solo agrega la Card de costo (`canManageUsers(role)`) + mensaje `paymentsBlocked`; cero markup de tabla tocado (el markup de tabla solo cambió en el cambio posterior del banner, PR #188). `table-view-control.test.tsx` 7/7 verde confirma layout intacto. |
| 9 | RED Test Contracts (Strict TDD) | **PASS** | Tests escritos RED primero (apply-progress): `src/lib/settings/__tests__/app-settings.test.ts` (12 casos) y `src/__tests__/rls/super-admin-retreat-mutations.test.ts` (2 casos, needle `restrict_retreat_member_mutations` en migración `022`); ambos verdes ahora. `openspec/config.yaml` `strict_tdd: true` respetado. |
| 10 | Super Admin Sets Total Cost (MODIFIED) | **PASS** | Card de costo visible solo con `canManageUsers(role)` (super_admin); policy cubre UPDATE (existente) e INSERT (nueva); leader/server/anon sin escritura (WITH CHECK super_admin, TO authenticated); mensaje específico de permisos en UI (req 3). Escenarios "Super admin sets a positive total", "Leader cannot set total cost", "Leader INSERT denied via upsert path (42501)", "Anon cannot write total cost" cubiertos. |

## Seguimientos (no bloqueantes)

1. **Gap de CI SQL**: `supabase/tests/app_settings_insert.test.sql` existe (4.3K, cubre
   super_admin insert OK / leader y anon denegados) pero NO está en la lista
   explícita de tests SQL de `.github/workflows/ci.yml` (líneas 82–96: audit_trigger,
   pgcrypto, rls, retreat_rls, retreat_duplicate_guard, member_capture_duplicate_audit).
   El test se ejecutó manualmente en su momento; falta agregarlo al job `db-integration`.
   (El mismo gap aplica a `retreat_delete.test.sql` del cambio
   delete-retreat-preinscriptions — seguir ahí.)
2. **Flake por timeout en CI local**: tests de `retreat-registrations` flaquean con el
   default de 5s bajo carga alta de CPU (load avg 163); proponer subir `testTimeout`
   en `vitest.config.ts` (p. ej. 30000) o achicar el peso de esos tests.
3. Nota de trazabilidad: este verify se ejecuta sobre el árbol post-merge
   (`48c8414`, main) que contiene el código idéntico de los PRs; el branch del fix
   (`fix/retiro-load-error-banner`, `e351c4a`) solo agrega los 2 archivos del banner
   y no afecta los archivos de este cambio.
