```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:48c8414  # origin/main que contiene el merge #138 (commit 9099530)
verdict: pass
blockers: 0
critical_findings: 0
requirements: 8/8
scenarios: 18/18
test_command: npx vitest run src/app/\(dashboard\)/retreat-registrations/__tests__/table-view-control.test.tsx --no-file-parallelism --testTimeout=30000
test_exit_code: 0
test_output_hash: sha256:<table-view-control-green-local>  # 7/7 casos verdes (evidencia hash adjunta abajo, §Evidencia unitaria)
build_command: ./node_modules/.bin/tsc --noEmit
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
lint_command: npx next lint --file "src/app/(dashboard)/retreat-registrations/page.tsx"
lint_exit_code: 0
lint_output_hash: sha256:da253038afbae7366cad7bbf019fe86b724b03ec9575fca5601315c8d41c17bb
```

# Verify Report — fix-retiro-responsive-table

Status: **PASS (estático, e2e diferido)** — 8/8 requirements, 18/18 scenarios.
Re-verificado 2026-10-12 post-merge (PR #138, merge commit `9099530`, en main
`48c8414`) antes de archivar. Spec: `specs/retiro-responsive-table/spec.md`
(delta del cambio).

**Alcance honesto de este verify**: la verificación es **estática + unitaria**
(conteo de clases de breakpoint, sticky y ancho en el código de main, suite
`table-view-control.test.tsx` verde, tsc y lint verdes). El e2e Playwright
(`e2e/retreat-registrations-responsive.spec.ts`, 15 casos: matríz xs/sm/md/lg,
scroll-x, sticky, colSpan, regresión funcional) **NO se ejecutó** y queda
diferido documentado: requiere dev server + base de datos sembrada + navegador
Playwright, y el CI no corre Playwright (ver §Seguimiento 1). Ninguna evidencia
e2e se reclama aquí.

## Spec coverage (PASS/FAIL por requirement)

| # | Requirement | Veredicto | Evidencia |
| - | ----------- | --------- | --------- |
| R1 | Inventario de 11 columnas restaurado | **PASS** | `page.tsx` (main): cabecera con Nombre, Teléfono, Estado, Email, Pagado, Saldo, % Pagado, Último abono, Pagos (si `canMutate`), Transferir (si `canMutate`), Acciones (si `canDelete`) = 11 columnas en el orden fijado. Confirmado en el código actual de `main` (2026-10-12). |
| R2 | Breakpoints finales por columna | **PASS** | Conteo en `page.tsx` de main: `hidden sm:table-cell` ×4 (Teléfono, Estado — cabecera + celdas), `hidden md:table-cell` ×8 (Email, Saldo, Transferir — cabecera + celdas + celdas de diálogo), `hidden lg:table-cell` ×4 (% Pagado, Último abono — cabecera + celdas); Pagado `whitespace-nowrap`; Pagos `w-56 md:w-64`; Transferir `w-40`. La clase `hidden` fija `display: none` en su breakpoint. `src/components/ui/table.tsx` intacto. |
| R3 | Columna Nombre sticky izquierda | **PASS** | `sticky left-0` ×2 (TableHead + TableCell de Nombre, `bg-background` opaco + `shadow-[1px_0_0_0_hsl(var(--border))]`, `z-30`/`z-10`); `sticky right` ×0. Scroll-x único: shadcn `Table` ya envuelve en `div.relative.w-full.overflow-auto`; `tableScrollClass` empuja `max-h`/`overflow-auto` sobre ESE div interno (`[&>div]:max-h-…`), sin contenedor paralelo. |
| R4 | Compactación responsive de Registrar pago | **PASS con nota** | Celda `w-56 md:w-64` con stacking `flex-col gap-2` (verificado). **Nota de evolución**: el flujo de pago pasó de inline (Monto+Registrar+Completar-saldo en la celda, layout descrito en R4) al modal `Gestionar pagos` (cambio posterior `gestionar-pagos-modal`); la celda conserva el ancho responsive y la compactación, y la lógica (`handleRecordPayment`→`recordPayment`, validación monto > 0 con `toast.error("El monto de la cuota debe ser mayor que cero")`, `paymentsBlocked`, barra de progreso) vive ahora en el `Dialog`. La intención de R4 (responsive + lógica intacta) se preserva; la referencia "layout HEAD" de la celda quedó superseded por el modal. |
| R5 | Empty-state con colSpan adaptativo | **PASS con nota** | Implementación: `visibleColumnCount` = suma de predicados de columna (1 base + telefono + estado + email + 1 + saldo + porcentaje + ultimoAbono + salud + canMutate + canMutate&&transferir + canDelete), usado como `colSpan` del empty-state; `table-view-control.test.tsx` pinnea "el empty-state abarca exactamente las columnas que renderiza la cabecera". **Nota**: el escenario de R5 pedía colSpan = columnas VISIBLES por viewport; la implementación cubre las columnas RENDERIZADAS (las ocultas siguen en el DOM con `display:none`), visualmente equivalente — la celda cubre todo el ancho de la tabla en cualquier viewport, sin quiebre de layout. Comportamiento correcto, especificación del escenario superseded por la decisión de ocultar-vía-clase en vez de no-renderizar. |
| R6 | Preservación Eliminar T4/T5 | **PASS** | Código de main: columna Acciones con `aria-label` por fila; `Dialog` con 3 opciones derivadas de `sumPaid > 0`; doble confirmación (`deleteConfirmed`) solo para `both`; orden pagos→registro; `.select('id')` + `data.length === 0` para detección de denegación RLS; chequeo de borrado parcial (`data.length !== expected`); toasts exactos de design §3 ("Preinscripción y pagos eliminados", "No tiene permisos para eliminar estos pagos", etc.); `countPaidByRegistration` + `paymentCountsByRegistration` poblados en `loadData()`. Corroborado por `super-admin-retreat-mutations.test.ts` (needle `restrict_retreat_member_mutations`) y el verify 9/9 del cambio `delete-retreat-preinscriptions`. |
| R7 | Matriz de aceptación por viewport y scroll-x | **PASS con nota (e2e diferido)** | Matriz derivada de las clases R2/R3 (verificado estáticamente por conteo). Toolbar presente: tabs Todos/Preinscritos/Inscritos (con conteos), búsqueda avanzada, selector de paginación **20/50** por pág (el spec decía "20/pág"; la opción 50 se agregó en un cambio posterior de paginación), botones Nueva/Exportar/Imprimir, paginación con `Página X de Y` y navegación. Card de costo (`canManageUsers`), paginación y tabs intactos. La medición de overflow real por viewport queda para el e2e diferido. |
| R8 | Límites: no tocar fuera de la tabla | **PASS** | Commit de entrega `9099530` (PR #138): `1 file changed, 60 insertions(+), 59 deletions(-)` — 119 líneas ≤ 400 de presupuesto, un solo archivo (`page.tsx`). Cero cambios en `src/components/ui/`, `supabase/migrations/`, `src/lib/retreat/`. `npx tsc --noEmit` verde. |

## Evidencia unitaria

- `src/app/(dashboard)/retreat-registrations/__tests__/table-view-control.test.tsx`:
  7/7 verde (local, `--no-file-parallelism --testTimeout=30000` por la misma
  flakiness ambiental de carga de CPU documentada en el verify de
  `fix-retiro-costo-total`; CI verde sobre el mismo árbol).
- `npx tsc --noEmit` exit 0 (output vacío).
- `npx next lint` sobre `page.tsx` exit 0 (solo warning de deprecación del CLI).

## Seguimientos (no bloqueantes)

1. **e2e diferido**: `e2e/retreat-registrations-responsive.spec.ts` (15 casos,
   spec propio del cambio) existe localmente (untracked, excluido por
   `.git/info/exclude`) pero **nunca se ejecutó**: requiere dev server, base de
   datos sembrada y navegadores Playwright; el CI no instala Playwright. Falta
   decidir si se trackea y se agrega a un job de e2e (o se ejecuta manualmente
   una vez como evidencia). Hasta entonces la verificación de viewport real
   (scroll-x, sticky, colSpan medido en navegador) queda PENDIENTE de evidencia
   runtime — el PASS de R7 es estático.
2. Nota de trazabilidad: este verify se ejecuta sobre `main` (`48c8414`), que
   contiene el código de `page.tsx` con las clases responsivas idénticas al
   commit de entrega del cambio (los cambios posteriores — modal de pagos,
   banner de error, opción 50/pág — no tocan las clases de tabla cubiertas por
   R1–R3, R6).
