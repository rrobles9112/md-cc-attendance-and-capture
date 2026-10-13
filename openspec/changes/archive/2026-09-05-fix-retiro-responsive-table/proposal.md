# Proposal — fix-retiro-responsive-table

> Fase: sdd-proposal (solo propuesta, sin código). Strict TDD activo
> (`openspec/config.yaml`: `npx vitest`, `npx playwright test`, `npx tsc --noEmit`).
> Research: no seleccionado. Baseline: `openspec/changes/fix-retiro-responsive-table/explore.md` (leído completo).

## 1. Intent

La tabla de `src/app/(dashboard)/retreat-registrations/page.tsx` hace overflow
y corta columnas a la derecha en desktop angosto y en móvil, volviéndola
inutilizable sin referencia de fila. La tabla de Miembros (`members/page.tsx`)
resuelve el mismo problema con ocultamiento progresivo (`hidden sm/md/lg`),
scroll-x limpio vía el `overflow-auto` interno de shadcn `Table` y una primera
columna siempre visible.

**Intención:** aplicar el patrón Miembros a la tabla de retiro —solo tabla—
restaurando primero la funcionalidad completa HEAD (747 líneas) + Eliminar
T4/T5, y luego breakpoints por columna + `sticky left-0` en Nombre +
compactación de la celda Registrar pago, sin tocar toolbar, card de costo,
paginación ni lógica de negocio. El working tree actual (~300 líneas,
8 columnas) es una regresión a evitar, no la base.

## 2. Scope

### In (solo tabla — 11 columnas + contenedor)

1. Las 11 columnas HEAD + T4/T5: Nombre, Email, Teléfono, Estado, Pagado,
   Saldo, % Pagado, Último abono, Registrar pago, Transferir, Acciones/Eliminar.
2. Breakpoints `hidden sm/md/lg:table-cell` por columna según §4.
3. `sticky left-0` + fondo opaco + `z-10` en la columna Nombre
   (`TableHead` + `TableCell`), sin modificar `src/components/ui/table.tsx`.
4. Compactación responsive de la celda Registrar pago (HEAD `w-64` completa
   con Monto/Registrar/Completar-saldo/barra → `w-56` + `flex-col` en xs/sm,
   `w-64` HEAD intacta en md+). Solo clases/layout interno, misma lógica.
5. `colSpan` del empty-state adaptativo a columnas visibles / `canDelete`
   (preservar T4/T5: `canDelete ? 8 : 7` como mínimo, ajustado al conteo final
   de columnas HEAD restauradas).
6. Anchos fijos conocidos en celdas de acción (principio Miembros `w-24`,
   no el valor literal): Registrar pago `w-56/w-64`, Transferir `w-40`,
   Acciones mínimo fijo.
7. Tests de regresión responsiva (playwright breakpoints/scroll-x/sticky si el
   harness lo permite + `npx tsc --noEmit`; vitest solo si se toca un helper).

### Out (explícito — no tocar)

- Toolbar HEAD (tabs Todos/Preinscritos/Inscritos, search avanzada, selector
  20/pág, botones Nueva/Exportar/Imprimir): restaurar, no rediseñar.
- Card de costo total del retiro.
- Paginación.
- Lógica de pagos (`handleRecordPayment`, `amountDrafts`, Completar-saldo,
  barra de progreso, `paymentsBlocked`), lógica de transferir, lógica de
  eliminar (`handleConfirmDelete`, `deleteMode/deleteConfirmed/deleting`,
  `paymentCountsByRegistration`, toasts de design §3 de
  `delete-retreat-preinscriptions`).
- `src/components/ui/table.tsx` (solo consumir su `overflow-auto` interno;
  prohibido anidar otro scroll o editar el componente).
- RPC, migraciones, policies RLS, triggers, cambios de BD.
- `src/lib/retreat/queries.ts` no existe (verificado por explore vía grep:
  solo `payments.ts`, `constants.ts`, `submit-adapter.ts` + tests);
  paginación/search viven en el propio `page.tsx`: no proponer módulos nuevos.

## 3. Decisiones — respuestas a las 7 preguntas del explore §7

Verificación previa con lectura directa (esta fase): `members/page.tsx`
(escalera `hidden sm/md/lg` + wrapper `rounded-lg border` + `w-24` acciones),
working tree `retreat-registrations/page.tsx` (8 columnas, `w-56` solo
Monto+botón, T4/T5 Eliminar presente con `countPaidByRegistration`,
`deleteTarget/deleteMode/deleteConfirmed/deleting` y `Dialog` de 3 opciones),
`src/components/ui/table.tsx` (`<div className="relative w-full overflow-auto">`
interno confirmado; `TableHead h-10 px-2`, `TableCell p-2` — breakpoints vía
`className`), `delete-retreat-preinscriptions/tasks.md` (T4 estructura +
T5 secuencia/toasts exactos, ambos `[x]` — preservar intactos),
`openspec/config.yaml` (strict TDD + comandos + presupuesto de facto 400).

1. **Registrar pago `w-56` vs `w-64` + layout móvil → DECISIÓN: ambos,
   por viewport.** En `xs/sm`: `w-56` con contenido interno `flex-col`
   (Input Monto full-width + Button Registrar full-width apilados;
   Completar-saldo y barra HEAD se apilan debajo, misma lógica, solo
   dirección flex). En `md+`: `w-64` HEAD completa intacta (Monto/Registrar
   horizontal + Completar-saldo + barra con su `flex-wrap` interno).
   Justificación: `w-64` + 5 columnas fijas sin breakpoint es la causa #6 del
   overflow; pero recortar a `w-56` fijo rompería la UX de pago HEAD
   (constraint: no tocar lógica). El híbrido por breakpoint conserva la
   funcionalidad y elimina ~80–100px de `min-content` donde más duele (xs/sm).
2. **Transferir en móvil: ocultar vs apilar → DECISIÓN: ocultar
   (`hidden md:table-cell`, mantiene `w-40` en md+).** No apilar bajo
   Registrar pago. Justificación: apilar fusiona dos celdas con lógicas
   distintas en una sola columna de acción, duplica el `min-content` de la
   celda más crítica y complica el `colSpan`/T4-T5. Acción secundaria: en
   móvil queda fuera de vista (reaparece en md+); futura vista-detalle fuera
   de este slice (non-goal N1).
3. **Pagado visible en xs → DECISIÓN: sí, Pagado siempre visible;
   Saldo `hidden md:table-cell`.** Al menos un dato financiero core sobrevive
   en móvil y es Pagado (lo que ya se cobró), no el remanente. Saldo duplica
   Pagado+total en pantallas chicas y reaparece en md+.
4. **Estado en xs: ocultar vs badge compacto en Nombre → DECISIÓN: ocultar
   (`hidden sm:table-cell`), sin badge compacto en este slice.**
   Justificación: los tabs Todos/Preinscritos/Inscritos ya dan contexto de
   estado en móvil; el badge compacto (punto/color en la celda Nombre sticky)
   añade diseño nuevo y riesgo visual por poco valor. Se registra como
   refinamiento futuro, no bloquea aceptación.
5. **Sticky izquierda vs también derecha → DECISIÓN: solo izquierda
   (Nombre `sticky left-0`).** Sin `sticky right-0` en acciones.
   Justificación: doble sticky sobre el `overflow-auto` interno de shadcn
   crea conflictos de `z-index`/fondo con el `Dialog` de Eliminar y con los
   bordes `rounded-lg`; el problema reportado es perder la referencia de fila,
   que resuelve el sticky izquierdo solo.
6. **Criterio de aceptación visual → DECISIÓN: basta con "comportamiento
   tipo-Miembros + scroll-x limpio + sticky" concretado en la matriz medible
   del §5.** No existe captura objetivo ni spec visual; no bloquear el slice
   por ello. La matriz xs/sm/md/lg (§5) es el contrato verificable
   (playwright donde el harness lo permita + verificación manual).
7. **Inventario HEAD re-confirmado sin shell → DECISIÓN: se re-confirma desde
   el contexto vinculante + lecturas directas de esta fase; `sdd-spec` debe
   congelarlo contra `git show HEAD:...` antes de diseñar.**
   Inventario vinculante: toolbar (tabs Todos/Preinscritos/Inscritos, search
   avanzada, selector 20/pág, botones Nueva/Exportar/Imprimir), 10 columnas
   funcionales (Nombre, Email, Teléfono, Estado, Pagado, Saldo, % Pagado,
   Último abono, Registrar pago `w-64` completa, Transferir `w-40`),
   - columna Acciones/Eliminar T4/T5 = 11 columnas, + paginación + card de
   costo. Evidencia directa de esta fase: el working tree leído tiene 8
   columnas con `w-56` simplificado y T4/T5 ya aplicado (confirma por
   diferencia qué falta: `% Pagado`, `Último abono`, celda `w-64` completa,
   `Transferir w-40`, toolbar, paginación). `sdd-apply` restaura HEAD primero
   (tarea explícita, no ejecutada en esta fase read-only: sin `git checkout`
   aquí).

## 4. Approach

1. **Paso 0 — Restaurar HEAD (primera tarea de apply, no de esta fase):**
   recuperar `page.tsx` HEAD de 747 líneas (toolbar + 10 columnas + celda
   `w-64` completa + Transferir `w-40` + paginación) vía `git show HEAD:...`.
2. **Paso 1 — Reaplicar Eliminar T4/T5 encima:** columna Acciones condicional
   a `canDeleteRetreatRegistration`, botón `destructive sm` con `aria-label`
   por fila, `countPaidByRegistration` + `paymentCountsByRegistration`,
   estados `deleteTarget/deleteMode/deleteConfirmed/deleting`, `Dialog` de
   3 opciones y toasts exactos. Sin cambios de comportamiento.
3. **Paso 2 — Breakpoints (solo `className` en `TableHead`/`TableCell`):**

   | Columna | Clase final |
   | --- | --- |
   | Nombre | siempre visible + `sticky left-0 bg-background z-10` |
   | Teléfono | `hidden sm:table-cell` (conservar) |
   | Estado | `hidden sm:table-cell` (NUEVO) |
   | Email | `hidden md:table-cell` (conservar) |
   | Saldo | `hidden md:table-cell` (NUEVO) |
   | Transferir | `hidden md:table-cell` + `w-40` (NUEVO breakpoint) |
   | Pagado | siempre visible (`whitespace-nowrap`, formato `es-CO` intacto) |
   | % Pagado | `hidden lg:table-cell` (NUEVO) |
   | Último abono | `hidden lg:table-cell` (NUEVO) |
   | Registrar pago | siempre visible, `w-56` en xs/sm → `w-64` en md+ |
   | Acciones/Eliminar | siempre visible (si `canDelete`), ancho mínimo fijo |

4. **Paso 3 — Sticky:** `sticky left-0 bg-background z-10` en el `TableHead`
   y cada `TableCell` de Nombre; nada en `ui/table.tsx`; verificar que el
   fondo no filtre contenido al hacer scroll (esquinas `rounded-lg border`).
5. **Paso 4 — Compactar Registrar pago:** en xs/sm el contenedor interno pasa
   a `flex-col` (`w-56`); en md+ conserva el layout HEAD (`w-64`). Sin tocar
   handlers, validaciones, ni barra de progreso.
6. **Paso 5 — `colSpan` adaptativo** del empty-state al conteo final de
   columnas (base T4/T5 `canDelete ? 8 : 7`, recalculado tras la restauración
   HEAD de 11 columnas).
7. **Paso 6 — Verificación TDD:** `npx tsc --noEmit` + tests playwright de
   breakpoints/scroll-x/sticky (si el harness lo permite) + verificación
   manual por viewport según §5; medir `git diff --stat` contra el presupuesto
   400 (`delivery_strategy: ask-on-risk` se hereda a tasks/apply).

## 5. Criterios de éxito medibles por viewport

Anchos de referencia: `xs` 360–639px · `sm` 640–767px · `md` 768–1023px ·
`lg` ≥1024px (aceptación plena a 1280px). Todos se verifican con la toolbar,
card de costo y paginación intactas y funcionales (sin regresión).

| Viewport | Columnas visibles | Scroll-x | Sticky | Regresión funcional |
| --- | --- | --- | --- | --- |
| xs (360px) | 4: Nombre, Pagado, Registrar pago (`w-56` apilada), Acciones/Eliminar (si `canDelete`) | Scroll-x residual permitido SOLO dentro del `overflow-auto` interno shadcn; sin corte seco a la derecha, sin scrollbar paralelo nuevo | Nombre `sticky left-0` permanece visible durante todo el scroll-x, con fondo opaco | Registrar pago registra, Eliminar abre `Dialog` y sus 3 opciones/toasts funcionan, tabs/search/paginación intactos |
| sm (640px) | 6: xs + Teléfono + Estado | Scroll-x residual leve aceptable; sin compresión que rompa alineación de montos | Nombre sticky | Igual que xs + Estado con badge correcto |
| md (768px) | 9: sm + Email + Saldo + Transferir (Registrar pago vuelve a `w-64` horizontal) | Sin scroll-x a 820px salvo tablas con nombres extremadamente largos; si aparece, limpio y con sticky | Nombre sticky | Transferir operativo, Saldo/`—` correcto |
| lg (1280px) | 11: tabla completa (+ % Pagado + Último abono) | **Sin scroll-x** a 1280px | Sticky presente pero inerte (sin scroll no se nota) | Paridad total HEAD + Eliminar: toolbar (tabs/search/20-pág/Nueva/Exportar/Imprimir), celda `w-64` completa (Monto/Registrar/Completar-saldo/barra), Transferir `w-40`, paginación, card costo |

Criterios transversales: (a) ningún texto de monto/badge se comprime hasta
romper alineación (`whitespace-nowrap` en Pagado/Saldo donde haga falta);
(b) `npx tsc --noEmit` en verde; (c) `git diff --stat` ≤ 400 líneas o
re-consulta de estrategia antes del PR; (d) cero cambios fuera de `page.tsx`
(+ tests nuevos) salvo lo que tasks autorice.

## 6. Riesgos

| Riesgo | Severidad | Mitigación |
| --- | --- | --- |
| Inventario HEAD reconstruido sin `git show` en explore/proposal (sin shell en estas fases) | Media | Spec congela el inventario contra `git show HEAD:src/app/(dashboard)/retreat-registrations/page.tsx`; si difiere (columnas/anchos/toolbar/paginación), se ajusta spec antes de tasks |
| Celda `w-64` HEAD (Completar-saldo + barra + `flex-wrap`) no compacta limpio a `w-56` apilado | Media | El híbrido por breakpoint aísla el riesgo a xs/sm; si el apilado rompe la UX de pago, fallback: mantener `w-64` en todos los viewports y asumir scroll-x residual en xs (decisión de design) |
| Sticky + `overflow-auto` interno + `rounded-lg border`: fondo/esquinas filtran contenido al hacer scroll | Baja | `bg-background` + `z-10` en celdas sticky; verificación visual playwright/manual en xs |
| Ocultar Estado en xs confunde (fila sin estado) | Baja | Tabs por estado mitigan; badge compacto en Nombre queda como refinamiento futuro, no bloquea |
| Presupuesto 400 líneas con restauración HEAD + responsividad + tests | Media | Tasks mide `git diff --stat`; `ask-on-risk`: si supera 400, detener y re-consultar antes del PR |
| Regresión silenciosa T4/T5 al restaurar HEAD (Eliminar vive en working tree, HEAD no lo tiene) | Media | Paso 1 del approach reaplica T4/T5 explícitamente; verify exige los toasts exactos y el `aria-label` por fila |

## 7. Rollback

- Revertir `src/app/(dashboard)/retreat-registrations/page.tsx` a
  HEAD + Eliminar T4/T5 (el estado funcional pre-cambio). Un solo archivo de
  producto; **sin tocar migraciones, RLS, ni datos** (este change no crea
  migración alguna).
- Tests nuevos se revierten con sus archivos (no hay goldens).
- Post-merge: revert-commit del PR; no requiere migración de reversión.

## 8. Non-goals

- **N1** — Cards apiladas / layout alternativo móvil / vista detalle: solo
  tabla con scroll-x + sticky en este slice.
- **N2** — Cambiar o rediseñar la toolbar (tabs/search/20-pág/botones):
  solo restaurarla.
- **N3** — Tocar la card de costo total.
- **N4** — Tocar la paginación.
- **N5** — Cambiar lógica de pagos, transferir o eliminar (solo
  clases/layout; handlers, validaciones, triggers y toasts intactos).
- **N6** — Modificar `src/components/ui/table.tsx` o cualquier componente
  `ui/*` compartido.
- **N7** — RPC, migraciones, policies, `deleted_at`, o tocar `013`–`020`.
- **N8** — Badge/indicador compacto de Estado dentro de la celda Nombre en
  xs (refinamiento futuro).
- **N9** — `sticky right-0` en acciones y apilado de Transferir bajo
  Registrar pago en móvil.
