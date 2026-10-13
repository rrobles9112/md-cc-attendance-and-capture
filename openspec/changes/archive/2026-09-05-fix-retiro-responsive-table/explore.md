# Explore — fix-retiro-responsive-table

> Fase: sdd-explore (solo lectura, sin código de producto). Strict TDD activo
> (`openspec/config.yaml`: `npx vitest`, `npx playwright test`, `npx tsc --noEmit`),
> pero esta fase no implementa: solo investiga y fija el baseline para proposal.

## 1. Baseline recomendado

**BASE = HEAD (747 líneas, tabla completa) + columna/díalogo Eliminar de
`delete-retreat-preinscriptions` (T4/T5).**

- El working tree actual de `src/app/(dashboard)/retreat-registrations/page.tsx`
  está **simplificado (~300 líneas)**: conserva Nombre / Email / Teléfono /
  Estado / Pagado / Saldo / Registrar pago (`w-56`, solo Monto + botón) /
  Acciones-Eliminar, más el Card de costo y el diálogo de borrado T4/T5.
- **Falta respecto a HEAD** (según contexto vinculante del change + T4/T5):
  toolbar completa (tabs Todos/Preinscritos/Inscritos, search avanzada,
  selector 20/pág, botones Nueva/Exportar/Imprimir), columnas `% Pagado`,
  `Último abono`, celda `Registrar pago w-64` completa (Monto/Registrar/
  Completar saldo/barra de progreso), columna `Transferir w-40`, paginación.
- **Regresión a evitar**: tomar el working tree como punto de partida
  perpetuaría la pérdida de transfer/export/paginación/search avanzada.
  `sdd-apply` debe restaurar HEAD primero y reaplicar encima solo los
  cambios responsivos + la columna Eliminar. Fase read-only: **no se ejecutó
  ningún `git checkout/restore`**; la restauración es tarea de apply.
- **Limitación de esta fase**: el executor no dispone de herramienta shell,
  por lo que no se pudo ejecutar `git show HEAD:...` ni `git diff --stat`.
  El inventario HEAD (§2–§3) se reconstruye desde el contexto vinculante del
  change (747 líneas, 10–11 columnas, anchos `w-64`/`w-40`), verificado
  parcialmente contra el working tree leído y contra `payments.ts`. El
  proposal debe re-confirmar el inventario exacto contra HEAD antes de
  congelar el spec.

## 2. Patrón de referencia: Miembros (`members/page.tsx`)

Lectura directa completa. Elementos a reutilizar:

| Elemento | Miembros | Valor para Retiro |
| --- | --- | --- |
| Wrapper tabla | `<div className="rounded-lg border">` + `<Table>` (shadcn, que ya trae `<div class="relative w-full overflow-auto">` interno) | Mantener mismo wrapper; el scroll-x ya existe vía `Table`, no añadir scrollbars paralelos |
| Ocultamiento progresivo | `Nombre` siempre visible; `Teléfono hidden sm:table-cell`; `Email hidden md:table-cell`; `WhatsApp hidden lg:table-cell` | Aplicar la misma escalera sm/md/lg a las columnas secundarias de retiro |
| Search row | `flex items-center gap-3` + `Input max-w-sm` + `Badge outline` con conteo | Ya existe el patrón; fuera de alcance retocarlo (constraint §5), solo no romperlo al restaurar la toolbar HEAD |
| Acciones | `w-24`, dos icon-buttons `ghost size="icon"` (Eye/Trash2) | Retiro necesita más ancho (Registrar pago + Transferir + Eliminar son botones con texto, no iconos); no copiar `w-24` literal, solo el principio "acciones con ancho fijo conocido" |
| Tabs + Badge | `TabsList` con `Badge secondary ml-2` por tab | La toolbar HEAD de retiro ya tiene tabs Todos/Preinscritos/Inscritos; mantener |

## 3. Causas raíz del overflow (por columna/celda)

Inventario HEAD reconstruido (10–11 columnas):
`Nombre | Email (hidden md) | Teléfono (hidden sm) | Estado | Pagado |
Saldo | % Pagado | Último abono | Registrar pago (w-64) | Transferir (w-40) |
[Acciones/Eliminar T4/T5]`.

| # | Columna/celda | Causa exacta |
| --- | --- | --- |
| 1 | `Estado` (Badge, sin breakpoint) | Siempre visible; texto largo ("Pagos parciales") + padding de Badge suma ~120–140px fijos en todos los viewports |
| 2 | `Pagado` (monto `es-CO`, sin breakpoint) | Siempre visible; formato `150.000,00` ~110px, no colapsa |
| 3 | `Saldo` (monto o `—`, sin breakpoint) | Siempre visible; ~110px fijos |
| 4 | `% Pagado` (sin breakpoint) | Siempre visible en HEAD; ~80px fijos |
| 5 | `Último abono` (fecha, sin breakpoint) | Siempre visible en HEAD; fecha `es-CO` ~110px fijos |
| 6 | `Registrar pago w-64` | La más ancha: `w-64` (256px) + `flex items-center gap-2` interno con `Input` (Monto) + `Button` (Registrar) y en HEAD además Completar-saldo + barra de progreso con `flex-wrap` interno. El contenido interno no puede encogerse bajo ~300px; con 5 columnas fijas anteriores el `min-content` total supera ~950–1050px |
| 7 | `Transferir w-40` (HEAD) | 160px fijos siempre visibles; segunda celda de acción con botones de texto |
| 8 | Ausencia de `overflow-x-auto` + `min-w` explícitos | El `overflow-auto` interno de shadcn `Table` existe (`src/components/ui/table.tsx`: `<div className="relative w-full overflow-auto">`), pero sin `min-w` en la tabla ni `whitespace-nowrap`/`max-w` en celdas de monto, el navegador comprime celdas hasta romper alineación en vez de activar scroll limpio; en la captura se ve la tabla "cortada a la derecha" en lugar de scroll |
| 9 | Ausencia de sticky | Sin `sticky left-0` en la primera columna, al hacer scroll-x se pierde la referencia de fila (quién es quién), lo que convierte un overflow manejable en una tabla inutilizable en móvil |

Conclusión: el overflow no lo causa una sola columna sino la **suma de 5
columnas numéricas/badge sin breakpoint + dos celdas de acción anchas
(`w-64` + `w-40`)** sobre un contenedor sin estrategia de scroll/sticky.
En móvil (<640px) solo Nombre + Teléfono(parcial) cabrían; en desktop
<1280px las 10–11 columnas no caben sin scroll.

Working tree actual (8 columnas, `w-56` en Registrar pago) reproduce el mismo
problema a menor escala: Estado/Pagado/Saldo siguen sin breakpoint y la celda
`flex` Input+Button impone su propio mínimo.

## 4. Mapeo de breakpoints propuesto (tipo-miembros)

Propuesta para que el proposal la confirme; **solo tabla**, sin tocar toolbar,
card de costo, paginación ni lógica de pagos/transfer/eliminar:

| Columna HEAD | Propuesta | Justificación |
| --- | --- | --- |
| `Nombre` | Siempre visible + `sticky left-0 bg-background` (primera columna) | Referencia de fila durante scroll-x; patrón pedido por el usuario |
| `Teléfono` | `hidden sm:table-cell` (conservar, igual que Miembros y que HEAD/working tree) | Escalera sm existente |
| `Email` | `hidden md:table-cell` (conservar) | Escalera md existente |
| `Estado` | `hidden sm:table-cell` (NUEVO breakpoint) | Badge de texto largo; en móvil el tab Todos/Preinscritos/Inscritos ya da el contexto de estado |
| `Pagado` | Siempre visible en `sm+`; en `xs` evaluar `hidden` o formato compacto (decisión proposal) | Es el dato financiero core junto a Saldo; al menos uno de los dos debe quedar visible en móvil |
| `Saldo` | `hidden md:table-cell` (NUEVO) | Duplica información de Pagado+% en pantallas chicas; reaparece en md+ |
| `% Pagado` | `hidden lg:table-cell` (NUEVO) | Dato derivado; solo desktop amplio, análogo a WhatsApp `lg` en Miembros |
| `Último abono` | `hidden lg:table-cell` (NUEVO) | Fecha secundaria; solo desktop amplio |
| `Registrar pago` | Siempre visible, ancho fijo reducido (`w-56` working tree vs `w-64` HEAD a decidir en proposal), contenido interno con `flex-col` en móvil o `min-w-0 + truncate` | Celda de acción primaria; no se puede ocultar, hay que compactarla |
| `Transferir` | `hidden md:table-cell` + `w-40` (NUEVO breakpoint) | Acción secundaria; en móvil se accede vía vista detalle o se apila (proposal decide) |
| `Acciones/Eliminar` (T4/T5) | Siempre visible, ancho fijo mínimo | Preservar T4/T5 intacto: columna condicional `canDelete`, `aria-label` por fila, `colSpan` adaptativo |

Resultado esperado por viewport: `xs` (~4 cols: Nombre, Pagado, Registrar
pago, Eliminar), `sm` (+Teléfono, +Estado), `md` (+Email, +Saldo, +Transferir),
`lg` (tabla completa +%, +Último abono). Scroll-x residual solo en `xs/sm`
con primera columna sticky.

## 5. Constraints (vinculantes para proposal/spec/design/tasks)

1. **Alcance = solo tabla**: columnas, overflow, breakpoints, celda Registrar
   pago, Transferir/Acciones. **No tocar** toolbar (tabs/search/20-pág/
   botones Nueva-Exportar-Imprimir), card de costo, paginación, ni lógica de
   pagos/transfer/eliminar.
2. **No regresión HEAD**: restaurar funcionalidad completa HEAD antes de
   aplicar responsividad; el working tree simplificado no es base.
3. **Preservar T4/T5** (`delete-retreat-preinscriptions`): columna Acciones
   condicional a `canDeleteRetreatRegistration`, botón `destructive sm`,
   `aria-label`, helper `countPaidByRegistration` + estado
   `paymentCountsByRegistration`, estados `deleteTarget/deleteMode/
   deleteConfirmed/deleting`, `Dialog` con las 3 opciones y toasts exactos
   de design §3. Verificado presente en el working tree leído.
4. **Constraints de `src/components/ui/table.tsx`**: `Table` ya envuelve en
   `overflow-auto`; no anidar otro scroll paralelo. Sticky debe aplicarse a
   `TableCell`/`TableHead` (`sticky left-0` + fondo opaco `bg-background`)
   porque el scroll ocurre en el div interno. `TableHead` base es
   `h-10 px-2 font-medium text-muted-foreground`; `TableCell` base es
   `p-2 align-middle` — los breakpoints se añaden vía `className`, sin
   modificar el componente ui.
5. **`src/lib/retreat/queries.ts` no existe** (grep sin resultados; solo
   existen `payments.ts`, `constants.ts`, `submit-adapter.ts` + tests): la
   paginación/search de HEAD vive en el propio `page.tsx` (o en otro módulo
   por identificar en proposal). **No proponer cambios fuera de la tabla.**
6. **TDD estricto**: `apply` deberá añadir tests de regresión responsiva
   (vitest para helpers si se tocan; playwright para breakpoints/scroll-x/
   sticky si el harness lo permite) + `npx tsc --noEmit`; presupuesto
   400 líneas (`delivery_strategy: ask-on-risk` se pasa a tasks/apply).

## 6. Riesgos

| Riesgo | Severidad | Mitigación |
| --- | --- | --- |
| Inventario HEAD no verificado byte-a-byte (sin shell en esta fase) | Media | Proposal re-confirma columnas/anchos contra `git show HEAD` antes de congelar spec |
| Celda `w-64` con Completar-saldo + barra de progreso puede no compactarse a `w-56` sin romper UX de pago | Media | Design decide: `flex-col` en móvil vs mantener `w-64` con scroll-x asumido |
| Sticky + `overflow-auto` interno de shadcn + `rounded-lg border`: esquinas y fondo de la celda sticky pueden filtrar contenido al hacer scroll | Baja | `bg-background` + `z-10` en celdas sticky; verificación visual playwright/manual |
| Ocultar `Estado` en `xs` puede confundir (fila sin estado visible) | Baja | Los tabs ya filtran por estado; alternativa: badge compacto en la celda Nombre (proposal decide) |
| Presupuesto 400 líneas con restauración HEAD + responsividad + tests | Media | Tasks mide `git diff --stat`; si supera, re-consultar estrategia antes del PR |

## 7. Preguntas abiertas para proposal

1. ¿`Registrar pago` se compacta a `w-56` (working tree) o se mantiene `w-64`
   HEAD con Completar-saldo + barra? ¿Layout `flex-col` en móvil?
2. ¿`Transferir` en móvil se oculta (`hidden md`) o se apila bajo Registrar
   pago en la misma celda de acciones?
3. ¿`Pagado` queda visible en `xs` o se oculta dejando solo Saldo? (uno de los
   dos debe sobrevivir en móvil).
4. ¿Badge de `Estado` en `xs`: ocultar del todo o versión compacta
   (punto/color) dentro de la celda Nombre sticky?
5. ¿Sticky solo en `Nombre` o también en la columna de acciones derecha
   (`sticky right-0`)? Lo segundo complica el `Dialog` de Eliminar; se
   recomienda solo izquierda.
6. ¿Existe spec visual (captura objetivo) o basta con "comportamiento tipo
   Miembros + scroll-x limpio + sticky" como criterio de aceptación?
7. Confirmar en proposal el inventario exacto HEAD (columnas, anchos,
   toolbar, paginación) vía `git show HEAD:src/app/(dashboard)/
   retreat-registrations/page.tsx` antes de escribir el spec.
