# Apply Progress — delete-retreat-preinscriptions (batch 1: T1–T7)

No había apply-progress previo (primer batch): sin merge necesario.
T8 es `parent-owned` y NO se tocó (ni se listará como completada).

Estado estructurado consumido: `openspec/config.yaml` (`strict_tdd: true`) +
prompt padre (`STRICT TDD MODE IS ACTIVE`, runners `npx vitest run` / `npx tsc --noEmit` /
`npx next lint` / SQL contra Supabase local). Review Workload Forecast de `tasks.md`:
`Decision needed before apply: No`, `Chained PRs: No`, `400-line budget risk: Low`,
estimado ~370 → se procedió con implementación directa (sin subagentes).
Metodología: RED → GREEN → TRIANGULATE → REFACTOR por work unit (ver tabla TDD).

## TDD Cycle Evidence

| Task | RED | GREEN | Resultado comandos |
| ---- | --- | ----- | ------------------ |
| T1 vitest `canDeleteRetreatRegistration` | Bloque `describe` nuevo en `guards.test.ts`; lista negativa solo `server` (union real `AppRole` en `types.ts`: `super_admin\|leader\|server` — corrección obligatoria del ejemplo del design que citaba `member`/`viewer` inexistentes). RED trivialmente satisfecho como pin de regresión (guard pre-existía). | Sin cambios prod (guard ya existía, solo lectura de `guards.ts`). | `npx vitest run src/lib/rbac/__tests__/guards.test.ts` → **47 passed** (44 previos + 3 nuevos). |
| T2 SQL S1–S8 | Archivo NUEVO `supabase/tests/retreat_delete.test.sql` (aislado en vez de extender `retreat_rls.test.sql`; avisar al ledger). Patrón del repo: transacción + `SET LOCAL ROLE` + claims JWT + `PASS/FAIL` + `ROLLBACK` final, orden S3,S4,S5,S1,S2,S6,S7,S8. Pre-021: **S3/S4/S5 PASS como denegados, S1 FAIL** (`FAIL: S1 leader DELETE denied (no GRANT/policy — pre-021 gap)`, aborta con `ON_ERROR_STOP=1`). S2/S6/S8 fallan por el mismo mecanismo (cero capacidad DELETE staff). | — | `docker exec supabase_db_… psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/retreat_delete.test.sql` (psql NO existe en el host; fallback verificado: `psql` dentro del contenedor `supabase_db_MD_CC_ATTENDANCE_AND_CAPTURE`). RED observado tal cual lo pedía la task. |
| T3 migración 021 | — | `supabase/migrations/021_retreat_registration_deletes.sql` creado con el **DDL EXACTO de design §1** (sin refactorizar): 2 `GRANT DELETE`, 2 policies `FOR DELETE TO authenticated USING ((SELECT public.user_role()) IN ('super_admin','leader'))`, función `…_on_delete()` `SECURITY DEFINER SET search_path = ''` + `REVOKE … FROM PUBLIC`, trigger `AFTER DELETE … FOR EACH ROW`, `NOTIFY pgrst`. Solo objetos de `011`; nada de `013`–`020`. Aplicada con `supabase db reset --yes` **sin errores** (021 aplicada + seed OK). Re-run T2 post-021: **los 8 PASS**. Dos fixes de setup del test (NO relajación de asserts): S7 `RETURNING id INTO` escalar con INSERT multi-fila → 2 INSERTs separados; S8 `record_id` del pago es el UUID del pago (no del registro) → se captura `v_pay1`. | `supabase db reset --yes` → Finished OK. SQL post-021 → **9 NOTICEs PASS (S1–S8) + `All retreat DELETE tests passed`**. |
| T4 UI estructura (`page.tsx`) | — | Import `canDeleteRetreatRegistration` + Dialog Radix; `const canDelete` tras el gate (sin tocar `canManageRetreatRegistrations`); columna `Acciones` + botón `Eliminar` (`destructive`/`sm`/`aria-label` por fila) solo si `canDelete`; `colSpan` `7` → `{canDelete ? 8 : 7}`; helper `countPaidByRegistration` + estado `paymentCountsByRegistration` poblado en `loadData()`; estados `deleteTarget/deleteMode/deleteConfirmed/deleting`; `Dialog` con opciones derivadas de `paidByRegistration.get(id) ?? 0` (`>0` → radio (a)/(b); `===0` → solo (c) sin radio); doble confirmación (checkbox) SOLO (a); cierre bloqueado con `!deleting`. | `npx tsc --noEmit` → exit 0. Lint del editor limpio tras agregar columna+Dialog (los `unused` intermedios se resolvieron en el edit siguiente). |
| T5 UI secuencia + toasts | — | `handleConfirmDelete` según design §2.4: orden pagos→registro en (a), solo pagos en (b) sin UPDATE de cliente, solo registro en (c); cada DELETE con `.select('id')` (0 filas → toast ES de permiso, sin éxito, sin `loadData()`, diálogo abierto); chequeo borrado parcial vía `paymentCountsByRegistration` (`El borrado fue parcial, revise los pagos restantes` + `loadData()`, diálogo abierto); los 9 toasts exactos de design §3; éxito → cerrar + `loadData()`. **Desviación mínima documentada**: el `catch` único del design no distinguía qué DELETE falló y la tabla §3 exige dos toasts distintos (`…los pagos` vs `…la preinscripción`); se agregó `failedStep: 'payments' \| 'registration'` (se fija a `'registration'` antes del 2º DELETE). Sin cambios de comportamiento fuera de ese mapeo. | `npx tsc --noEmit` → exit 0. Flujo manual pendiente de verificación en `sdd-verify` (22: render leader/server + 3 opciones). |
| T6 TRIANGULATE post-021 | — | Re-run suite T2: **S1–S8 todos PASS** (foco verificado: S5 FK sin cascada → `foreign_key_violation`; S6 `inscrito` + DELETE pagos → `preinscrito` vía trigger owner-side sin UPDATE de cliente; S7 total `''` + remanente → `status` intacto; S8 `audit_log` con filas DELETE de ambas tablas vía `audit_retreat_* → log_mutation()` sin alterar triggers). Regresión: `retreat_rls.test.sql` existente → `All retreat RLS/RPC/status tests passed` (021 no rompe nada). | SQL T2 → 9 PASS + final. SQL regresión → PASS completo. |
| T7 REFACTOR + final | Sin refactors (DDL exacto intocable; UI sin duplicación que lo pida). | (a) N/A; (b) `tsc` 0, `vitest` completo **29 files / 252 tests passed**, `next lint` **No warnings/errors**, SQL re-run PASS; (c) presupuesto: **EXCEDIDO — ver §Presupuesto**. | Ver comandos arriba; `git diff --stat` global contaminado por el árbol revertido preexistente (R6/N8) → medición aislada en §Presupuesto. |

## Archivos tocados

- Editado: `src/lib/rbac/__tests__/guards.test.ts` (bloque nuevo +13 líneas; import ya existía, sin duplicar).
- Creado: `supabase/tests/retreat_delete.test.sql` (455 líneas; **archivo nuevo** — avisar al ledger).
- Creado: `supabase/migrations/021_retreat_registration_deletes.sql` (107 líneas, DDL exacto design §1).
- Editado: `src/app/(dashboard)/retreat-registrations/page.tsx` (T4+T5: columna, estados, Dialog, secuencia, toasts).
- Leídos sin cambios: `src/lib/rbac/guards.ts`, `src/lib/rbac/types.ts`, `src/lib/retreat/payments.ts`,
  `src/components/ui/dialog.tsx`, `src/components/ui/button.tsx`, `src/hooks/useRole.ts`,
  `supabase/migrations/011_youth_retreat_preregistration.sql`, `supabase/tests/retreat_rls.test.sql`.
- NO tocados: `013`–`020`, formulario `/retiro`, `PermissionMap`, triggers de auditoría.

## Comandos y resultados (resumen)

1. `npx vitest run src/lib/rbac/__tests__/guards.test.ts` → 47 passed.
2. SQL RED pre-021 → S3/S4/S5 PASS, S1 FAIL (gap demostrado, aborta).
3. `supabase db reset --yes` → OK (021 aplicada, seed completo).
4. SQL post-021 (tras 2 fixes de setup) → S1–S8 PASS + final.
5. `npx tsc --noEmit` → exit 0 (dos corridas: post-T4/T5 y final).
6. SQL regresión `retreat_rls.test.sql` → PASS completo.
7. `npx vitest run` (completo) → 29 files / 252 tests passed.
8. `npx next lint` → No ESLint warnings or errors.

## Presupuesto (T7c) — EXCEDIDO, decisión pendiente

- Archivos nuevos (exacto `wc -l`): 021 = **107**, `retreat_delete.test.sql` = **455** → 562.
- Archivos trackeados, delta de sesión (contadores globales `git diff`, nada más tocó el árbol):
  inserciones 233→431 (**+198**), más ~40 líneas reemplazadas → **~240**.
- **Total estimado del cambio: ~800 líneas vs presupuesto 400 → excedido ~2x.**
- Driver: suite SQL 455 real vs 80 estimada (cada caso S1–S8 necesita seed owner + switch de rol +
  asserts; además el guard `BEFORE INSERT` obliga a setear `app_settings.total` válido para sembrar).
  `page.tsx` ~240 vs 150 (dentro de lo razonable); 021 107 vs 110 (exacto); guards 13 vs 30 (bajo).
- El `git diff --stat` global NO sirve como medidor (árbol revertido preexistente R6/N8: 74 archivos,
  ~14k líneas vs HEAD antes de empezar).
- **ACCIÓN TOMADA**: no se abre PR ni se continúa a verify-PR; se persiste todo y se devuelve
  `blocked` con la decisión exacta pendiente (ver Risks). Incluso el split R8 sugerido
  (PR1 = migración + tests SQL ≈ 562) supera 400 por sí solo → las opciones son
  `size:exception` (1 PR ≈ 800) o re-split en 3 (p. ej. 021+smoke / suite completa / UI+vitest).

## Remaining

- [ ] T8 — Bounded review post-apply del PR único (~370 líneas) y gate de lifecycle correspondiente. <!-- sdd-owner: parent -->

`verify` de código queda listo para correr cuando el parent resuelva la estrategia de entrega
(los comandos ya están en verde; solo falta el flujo manual UI como leader/server y las 3 opciones).
