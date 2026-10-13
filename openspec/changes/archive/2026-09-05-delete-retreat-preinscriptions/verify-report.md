```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:8cc847de34ccb4343b4a67d4ae12f5f66429f40992e1c82ba7750eb66f9a0585
verdict: pass
blockers: 0
critical_findings: 0
requirements: 9/9
scenarios: 23/23
test_command: npx vitest run src/lib/rbac/__tests__/guards.test.ts
test_exit_code: 0
test_output_hash: sha256:9bc4bb61f4d761e71d689e89e9889a99457dc24a43d0359fe9ec136306b4e4bb
build_command: npx tsc --noEmit
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

# Verify Report — delete-retreat-preinscriptions

Status: **PASS** — 9/9 requirements, 23/23 scenarios. No CRITICAL findings, no blockers.
Re-verified 2026-09-04 by re-running all evidence commands (vitest, tsc, SQL S1–S8,
regresión SQL, lint). Spec: `specs/delete-retreat-preinscriptions/spec.md`.

## Spec coverage (PASS/FAIL por requirement)

| # | Requirement | Veredicto | Evidencia |
| - | ----------- | --------- | --------- |
| R1 | Delete Action Visibility Gated by Role | **PASS** | `page.tsx`: `canDelete = canDeleteRetreatRegistration(role)` tras el gate `canManageRetreatRegistrations` (no tocado); columna `Acciones` + botón `Eliminar` solo si `canDelete`; `colSpan {canDelete ? 8 : 7}`. Vitest 47/47 (bloque nuevo: super_admin/leader true, server false). |
| R2 | Delete Dialog With Explicit Options | **PASS** | `page.tsx`: opciones derivadas de `paidByRegistration.get(id) ?? 0`; `sumPaid > 0` → radio exacto (a)/(b), nunca (c); `=== 0` → solo texto (c) sin radio. Mutuamente excluyentes por `deleteMode`. |
| R3 | Option (a) — Delete Registration Plus Payments | **PASS** | `handleConfirmDelete`: pagos primero → registro después (FK sin CASCADE); doble confirmación por checkbox `deleteConfirmed` solo en modo `'both'` (botón deshabilitado hasta marcar); éxito → toast `Preinscripción y pagos eliminados` + `loadData()`. SQL S5 confirma FK en orden invertido; S1/S2 confirman orden correcto. |
| R4 | Option (b) — Delete Only Payments, Keep Registration | **PASS** | Solo `DELETE retreat_payments`; **cero `.update(` en todo `page.tsx`** (grep); `status` recalculado por trigger owner-side. SQL S6: `inscrito` + DELETE pagos → `preinscrito`, fila sobrevive. Confirmación simple (sin checkbox fuera de `'both'`). Toast `Pagos eliminados, preinscripción conservada` + `loadData()`. |
| R5 | Option (c) — Delete Registration Without Payments | **PASS** | Solo `DELETE retreat_registrations`, confirmación simple. Toast `Preinscripción eliminada` + `loadData()`. Caso concurrente: FK rechaza → rama `catch` con `failedStep='registration'` → `Error al eliminar la preinscripción`, nunca éxito. |
| R6 | RLS and SQL Migration 021 | **PASS** | `021` (107 líneas) = DDL exacto de design §1: 2 `GRANT DELETE TO authenticated`, 2 policies `FOR DELETE TO authenticated USING ((SELECT public.user_role()) IN ('super_admin','leader'))`, función `…_on_delete()` `SECURITY DEFINER SET search_path = ''` + `REVOKE FROM PUBLIC`, trigger `AFTER DELETE FOR EACH ROW`, `NOTIFY pgrst`. Sin RPC (solo mención en comentario), sin `deleted_at`, sin grants/policies UPDATE, sin tocar ni depender de `013`–`020` (solo nota de rebase en comentarios, exigida por el propio spec). Solo objetos de `011`. |
| R7 | Silent RLS Denial Treated as Error | **PASS** | Cada DELETE con `.select('id')`; 0 filas → toast ES de permiso (`…estos pagos` / `…esta preinscripción`), sin éxito, sin `loadData()`, diálogo abierto. Paridad literal cliente↔SQL: `role === "super_admin" \|\| role === "leader"` vs `IN ('super_admin','leader')` en ambas policies. SQL S3/S4: server/anon 0 filas. |
| R8 | Audit Coverage for Deletes | **PASS** | Sin código nuevo de auditoría; `021` no altera triggers. SQL S8: `audit_log` contiene DELETE de `retreat_payments` (por `record_id` del pago) y de `retreat_registrations`. |
| R9 | Automated Tests | **PASS** | Vitest: bloque `canDeleteRetreatRegistration` en `guards.test.ts` (3 tests nuevos, 47/47). SQL: archivo nuevo `supabase/tests/retreat_delete.test.sql` (hermano delete-focused, permitido por el spec) con S1–S8 + `PASS/FAIL` + `ROLLBACK` final; post-021 los 8 PASS + `All retreat DELETE tests passed`. |

Escenarios: 23/23 cubiertos (R1:4, R2:2, R3:3, R4:3, R5:2, R6:3, R7:2, R8:2, R9:2).

## Task completion (T1–T7 todos `[x]`; sin `- [ ]` de implementación)

`tasks.md`: T1–T7 marcados `[x]`; el único `- [ ]` restante es **T8 — Post-apply
(`sdd-owner: parent`)**, gate de review acotado dueño del parent, no tarea de
implementación. **Líneas `- [ ]` exactas restantes:**

- `- [ ] T8 — Bounded review post-apply del PR único (~370 líneas) y gate de lifecycle correspondiente. <!-- sdd-owner: parent -->`

Ninguna tarea de implementación queda abierta. Archive requiere que el parent
resuelva T8 y la decisión de estrategia de entrega (ver Review Workload).

## Structured status y actionContext

- `openspec/config.yaml`: `strict_tdd: true` → verificación TDD estricta aplicada.
- Baseline revertido vs HEAD (spec N8 / proposal R6): el `git diff --stat` global
  está contaminado (74 archivos, ~14k líneas preexistentes); la medición se hizo
  aislada por archivo (ver Review Workload). Ningún archivo fuera de los 4 del
  cambio + 2 nuevos fue tocado por este change.
- Desviación documentada en apply-progress (`failedStep: 'payments' |
  'registration'`): mínima y justificada — el `catch` único del design no
  distinguía qué DELETE falló y la tabla §3 exige dos toasts distintos. Sin
  cambios de comportamiento fuera de ese mapeo. Aceptada (no es defecto).

## Test/validation commands (re-corridos en verify, todos exit 0)

1. `npx vitest run src/lib/rbac/__tests__/guards.test.ts` → **47 passed** (hash sha256:9bc4bb61…).
2. `npx tsc --noEmit` → **exit 0** (salida vacía, hash del vacío e3b0c442…).
3. SQL S1–S8: `docker exec -i supabase_db_MD_CC_ATTENDANCE_AND_CAPTURE psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/retreat_delete.test.sql` (psql vía contenedor; no existe en host) → **9 NOTICEs PASS + `All retreat DELETE tests passed` + ROLLBACK**, exit 0 (hash sha256:768c569c…).
4. Regresión `supabase/tests/retreat_rls.test.sql` → `All retreat RLS/RPC/status tests passed`, exit 0 (021 no rompe nada).
5. `npx next lint` → **No ESLint warnings or errors**, exit 0.

## Strict TDD compliance (activo: config + prompt padre, runner `npx vitest run`)

1. Tabla `TDD Cycle Evidence` en `apply-progress.md`: **presente** (RED/GREEN por task con comandos).
2. Archivos de test reportados existen: `src/lib/rbac/__tests__/guards.test.ts` ✓, `supabase/tests/retreat_delete.test.sql` ✓ (hermano nuevo, formato permitido por el spec).
3. GREEN re-confirmado: vitest 47/47 ✓, SQL S1–S8 PASS ✓ (re-corridos hoy).
4. Calidad de asserts: guard tests con asserts booleanos reales sobre el union completo (`super_admin|leader|server`; la lista negativa solo-`server` es correcta — `member`/`viewer` del ejemplo del design no existen en `AppRole`); SQL con `ROW_COUNT`, checks de `status`, existencia en `audit_log` y violación FK esperada. **Sin tautologías, ghost loops, asserts solo-de-tipo ni smoke-only.** PASS.
5. Evidencia RED pre-021 documentada (S1 FAIL por gap, S3/S4/S5 PASS como denegados). Completa.

## Assertion quality

Sin hallazgos: asserts de paridad de roles, conteos de filas afectadas, transiciones de `status` y presencia de auditoría son todos semánticos y estrictos (`<>` con `RAISE EXCEPTION 'FAIL: …'`, `IS DISTINCT FROM`). No hay asserts de detalle de implementación CSS ni matchers vacíos.

## Review workload / PR boundary

Forecast: PR único ~370 líneas, `Chained PRs: No`, riesgo Low, `Decision needed: No`.
Realidad (medición aislada, apply-progress §Presupuesto): **~800 líneas** —
`021` 107 (exacto), `page.tsx` ~240, guards +13, suite SQL **455 vs 80
estimadas** (cada caso necesita seed owner + switch de rol + asserts; el guard
`BEFORE INSERT` obliga a setear total válido). Ni el split R8 (PR1 ≈ 562)
cabe en 400. **WARNING (no CRITICAL, no defecto de código): el parent debe
elegir `size:exception` (1 PR ≈ 800) o re-split en 3 antes de abrir el PR.**
No se abrió ningún PR; no hay scope creep (solo los 4 archivos + 2 nuevos del plan).

## Blockers

Ninguno. Pendiente no-bloqueante dueño del parent: decisión de entrega (WARNING
arriba) + T8 (review acotado post-apply).
