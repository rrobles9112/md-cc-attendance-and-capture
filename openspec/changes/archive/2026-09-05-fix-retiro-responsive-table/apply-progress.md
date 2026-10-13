# Apply progress — fix-retiro-responsive-table (reintento acotado T1–T3)

> Alcance del reintento: T1–T3, TDD estricto, sin dev servers, sin suite completa.
> Decisión de entrega del parent (vinculante): 3 PRs apilados, chain stacked-to-main
> (PR1 spec RED solo tests → PR2 restore HEAD + Eliminar T4/T5 → PR3 responsivo).
> Si `git diff --stat` supera 400 en algún PR: registrarlo y seguir sin abrir PR.

## Estado final del reintento: BLOQUEADO en T2 (baseline HEAD no compilable en este árbol)

- T1 (spec RED existente): reutilizado y verificado estáticamente + `tsc` verde + `playwright --list` OK.
  Ejecución completa del spec diferida a sdd-verify (requiere dev server con DB sembrada;
  prohibido por la orden: "Sin dev servers").
- T2 (restore HEAD 747 + Eliminar T4/T5): INTENTADO y REVERTIDO. El volcado HEAD no compila
  en este árbol (5 errores tsc por 3 módulos borrados + 2 guards ausentes, fuera de superficies
  permitidas). `page.tsx` revertido al backup, `tsc` de nuevo en verde. Cero cambios netos.
- T3 (responsivo): NO INICIADO (depende de T2; design exige aplicar sobre el restaurado HEAD,
  explícitamente "NO sobre el `w-56` simplificado del working tree").

## TDD Cycle Evidence

| Tarea | Fase | Evidencia | Resultado |
| --- | --- | --- | --- |
| T1 RED | RED estático | `grep` working tree 558 líneas: 0× `sticky left-0`, Estado/Saldo sin `hidden`, 0× `% Pagado`/`Último abono`/`Transferir`, Registrar `w-56` sin `md:w-64`, `colSpan={canDelete ? 8 : 7}` — cada assert del spec falla contra este DOM | RED confirmado (estático) |
| T1 | Baseline tipos | `npx tsc --noEmit` pre-restore | VERDE (exit 0) |
| T1 | Carga del spec | `npx playwright test e2e/retreat-registrations-responsive.spec.ts --project=chromium --list` | 7/7 tests listados, exit 0 |
| T1 | Ejecución RED | NO ejecutada: `playwright.config.ts` `webServer.command: npm run dev` bootearía dev server (prohibido) con timeout 120s > presupuesto 90s | DIFERIDA a verify (harness-blocked, sin PASS inventado) |
| T2 | Backup | `cp page.tsx /tmp/retreat-page-pre-restore.tsx` | OK (558 líneas) |
| T2 | Restore | `git show HEAD:page.tsx` → `page.tsx` (747 líneas) + 11 ediciones Eliminar T4/T5 (import, helpers, estados, `loadData`, `canDelete`, diálogos, columna Acciones, `colSpan 11/10`) | Aplicado |
| T2 | GREEN tipos | `npx tsc --noEmit` post-restore | ROJO: 5 errores (ver §Bloqueo) → REVERT al backup |
| T2 post-revert | GREEN tipos | `npx tsc --noEmit` | VERDE (exit 0) |
| T3 | — | No iniciado (bloqueado por T2) | — |

## Bloqueo T2 — evidencia exacta

`npx tsc --noEmit` post-restore (exit 2), 5 errores, todos por dependencias HEAD
borradas en el árbol actual (verificado con `ls`: no existen en disco):

1. `page.tsx(17,87): TS2305 'canRecordRetreatPayments'` — ausente en `src/lib/rbac/guards.ts`
   (solo exporta `canCreate/canManageRetreatRegistrations/canDeleteRetreatRegistration/canModify/canDelete/canHardDelete/canMarkAttendance/canManageUsers/canViewAudit/canExport/canManageARCO/canViewPastoreo/canManageWhatsappSettings`).
2. `page.tsx(17,113): TS2305 'canTransferRetreatToValientes'` — ausente (mismo archivo).
3. `page.tsx(19,45): TS2307 '@/components/retreat/RetreatPreinscriptionCreate'` — archivo borrado (`D` en `git status`).
4. `page.tsx(20,70): TS2307 '@/lib/retreat/export'` — archivo borrado.
5. `page.tsx(34,8): TS2307 '@/lib/retreat/queries'` — archivo borrado.

Restaurar esos módulos queda FUERA de las superficies permitidas
(solo `page.tsx` + spec + apply-progress + tasks; prohibido tocar `src/lib/retreat/*`
y crear/restaurar fuera de raíces). Por el guard de edit-authority: STOP antes que editar
fuera de raíces. Revertir esos borrados (pertenecen a otro trabajo en el árbol) sin
autorización corrompería trabajo ajeno.

## Archivos tocados (neto)

- `src/app/(dashboard)/retreat-registrations/page.tsx`: restaurado → editado → REVERTIDO a
  backup byte-idéntico (558 líneas). Neto: sin cambios (`git diff` del archivo = divergencia
  preexistente working-tree vs HEAD, no de este change).
- `e2e/retreat-registrations-responsive.spec.ts`: NO modificado (reutilizado tal cual, 216 líneas).
  Corrección evaluada y NO necesaria: aserciones `w-56`/`md:w-64`/sticky/scroll-x/toolbar/
  toasts/Eliminar coinciden con spec R2–R7 y design §7.1. Riesgo anotado: `Costo total del
  retiro` `toHaveCount(0)` como leader asume `canManageUsers(leader) === false` (matriz
  `getPermissions` no verificada aquí; confirmar en verify).
- `openspec/changes/fix-retiro-responsive-table/apply-progress.md`: creado (este archivo).
- `tasks.md`: checkoffs SIN cambios (ninguna tarea T1–T3 completada según contrato estricto).

## Conteos diff por PR (stacked-to-main)

- PR1 (spec RED solo tests): `e2e/retreat-registrations-responsive.spec.ts` untracked,
  216 líneas → additions + deletions = **216 ≤ 400** ✓ (cero cambios de producto).
- PR2 (restore HEAD + Eliminar T4/T5): checkpoint intermedio **219 insertions + 6 deletions
  = 225 ≤ 400** ✓ pero con `tsc` ROJO → revertido. Estado actual PR2: **0** (bloqueado).
- PR3 (responsivo design §2–§4): no iniciado. Estimado tasks ~40–60 líneas sobre PR2.
- Divergencia preexistente (NO atribuible a este change): `page.tsx` working-tree vs HEAD =
  416 insertions + 605 deletions ≈ 1021 (regresión 8 columnas + borrados de otro trabajo).
  Ningún PR debe cargarse con ese número: PR2/PR3 se miden contra el árbol de trabajo,
  no contra HEAD.

## Desviaciones del diseño

- T2 no pudo seguir design §6 paso 0a/0b al pie (HEAD no compilable). Ajuste aplicado:
  revert en vez de "adaptar sin re-spec": adaptar habría significado reimplementar
  Transferir/export/paginación con guards recortados = cambio de lógica prohibido por R8.
- Skills cargadas (`frontend-design`, `chained-pr`): su empuje estético/compositivo NO se
  aplicó al producto por restricción superior (R8: solo `className`/layout, prohibido
  rediseñar toolbar/card/paginación). `chained-pr` sí gobernó la medición por PR.

## Tareas restantes (todas `- [ ]`, sin marcar)

- [ ] T1 — RED playwright por viewport + baseline `tsc` (falta ejecución RED con servidor; spec ya existe y carga).
- [ ] T2 — GREEN paso 0a/0b (restaurar HEAD + reaplicar Eliminar T4/T5 idéntico) — BLOQUEADO, ver decisión requerida.
- [ ] T3 — GREEN responsivo (breakpoints + sticky + compactación + colSpan) — depende de T2.
- [ ] T4 — TRIANGULATE (dueño implementation, fuera de este reintento T1–T3).
- [ ] T5 — REFACTOR mínimo + medición final (dueño implementation, fuera de este reintento).
- [ ] T6 — Bounded review post-apply (dueño: parent).

## Decisión requerida al parent (exacta, una basta)

1. **Autorizar restauración de dependencias HEAD** (`src/lib/retreat/queries.ts`,
   `src/lib/retreat/export.ts`, `src/components/retreat/RetreatPreinscriptionCreate.tsx`,
   guards `canRecordRetreatPayments`/`canTransferRetreatToValientes`) como prerequisito de
   T2 — o —
2. **Re-alcanzar R1**: redefinir el inventario sobre el árbol actual (8 columnas + Eliminar,
   sin Transferir/export/paginación-HEAD) con re-spec explícito — o —
3. **Congelar este change** hasta que el trabajo que borró esos módulos se resuelva
   (los `D` en `git status` pertenecen a otro esfuerzo).

Sin una de estas tres, T2/T3 no pueden avanzar sin violar superficies o R8.

## Status estructurado consumido

- Tasks `Review Workload Forecast`: `Decision needed before apply: Yes` /
  `Chained PRs recommended: Yes` / `Chain strategy: pending` / `400-line budget risk: High`.
  Gate resuelto por la orden del parent (delivery split 3 PRs, `stacked-to-main`,
  seguir sin abrir PR si > 400). `skill_resolution` real: `paths-injected`
  (ambos `SKILL.md` leídos antes del trabajo).
- `actionContext`: modo acotado T1–T3 con raíces de escritura explícitas; cumplido
  (ninguna escritura fuera de raíces; restore revertido deja neto cero).
- Strict TDD (`openspec/config.yaml` + orden): RED→GREEN intentado; GREEN falló por causa
  ambiental (no por producto), con evidencia y rollback registrados arriba.
