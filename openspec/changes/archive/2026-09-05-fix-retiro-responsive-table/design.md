# Design — fix-retiro-responsive-table

> Fase: sdd-design (solo diseño, sin código de producto).
> Vinculante: `proposal.md` (intent + 7 decisiones) y `specs/retiro-responsive-table/spec.md` (R1–R8).
> Baseline: HEAD 747 líneas (toolbar + 10 columnas + celda `w-64` completa + Transferir `w-40` + paginación + card costo) + Eliminar T4/T5.
> Stack: Next.js 15 + React 19 + Tailwind 4.1.8 + shadcn `Table` + Radix `Dialog`. Strict TDD (`npx tsc --noEmit`, `npx playwright test`, `npx vitest` solo si hay helper).

## 1. Decisión principal + fallback: celda Registrar pago

### 1.1 Principal (híbrido por breakpoint — decisión proposal §3.1, spec R4)

- **xs/sm (`<768px`): `w-56` + `flex-col` apilado.**
- **md+ (`≥768px`): `w-64` HEAD intacta (layout horizontal + `flex-wrap` interno).**

Solo cambian clases y dirección flex del contenedor interno. Lógica intacta:
`handleRecordPayment`, `amountDrafts`, validación `monto > 0`, Completar-saldo,
barra de progreso, `paymentsBlocked`, toasts (`"Pago registrado"` /
`"El monto de la cuota debe ser mayor que cero"`).

Clases exactas (aplicar sobre la celda restaurada HEAD, no sobre la `w-56`
simplificada del working tree):

```tsx
{/* Head */}
<TableHead className="w-56 md:w-64">Registrar pago</TableHead>

{/* Cell */}
<TableCell className="w-56 md:w-64">
  {paymentsBlocked ? (
    <span className="text-xs text-muted-foreground">Pagos bloqueados</span>
  ) : (
    <div className="flex flex-col gap-2">
      {/* Fila Monto + Registrar: apilada en xs/sm, horizontal HEAD en md+ */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-2">
        <Input
          /* props HEAD intactas: type/min/step/value/onChange/placeholder/aria-label */
          className="w-full md:min-w-0 md:flex-1"
        />
        <Button
          /* props HEAD intactas: size="sm", disabled, onClick */
          className="w-full md:w-auto"
        >
          Registrar pago
        </Button>
      </div>
      {/* Completar-saldo + barra HEAD: se apilan debajo en todos los viewports,
          sin cambiar handlers ni validaciones. Clases de layout HEAD + flex-col
          heredado del wrapper; el flex-wrap interno HEAD se conserva tal cual. */}
    </div>
  )}
</TableCell>
```

Notas de diseño:

- `w-56 md:w-64` en **Head y Cell a la vez**: el `w-56` fija el `min-content`
  en xs/sm (~224px en vez de ~300px HEAD) y ahorra ~80px donde más duele;
  `md:w-64` restaura la UX de pago HEAD donde hay espacio.
- `w-full` en Input/Button en xs/sm garantiza apilado a ancho completo sin
  compresión lateral; `md:min-w-0 md:flex-1` en el Input evita que el input
  fuerce overflow dentro de `md:flex-row` (el input es el elemento que más
  `min-content` impone).
- Completar-saldo y barra HEAD **no se reordenan ni se condicionan por
  viewport**: heredan el `flex-col` del wrapper en xs/sm y quedan debajo de la
  fila Monto/Registrar; en md+ el wrapper sigue siendo `flex-col` pero la fila
  interna es horizontal, reproduciendo el layout HEAD (fila horizontal arriba,
  extras debajo).

### 1.2 Fallback explícito (si el apilado rompe la UX de pago)

- **Fallback: mantener `w-64` HEAD en todos los viewports**
  (`<TableHead className="w-64">` / `<TableCell className="w-64">`, sin
  `flex-col`), y asumir scroll-x residual en xs dentro del `overflow-auto`
  interno con Nombre sticky.
- **Criterio de activación (cualquiera basta):**
  1. La verificación visual/playwright en 360px muestra Completar-saldo o la
     barra cortados, solapados o ilegibles con el apilado; o
  2. El apilado exige tocar handlers/validaciones para verse bien (prohibido
     por R8); o
  3. `npx tsc --noEmit` o los tests de regresión de pago fallan por el cambio
     de clases del wrapper.
- **Efecto:** se pierde el ahorro de ~80px en xs/sm (vuelve el scroll-x mayor
  en xs), pero se conserva el 100% de la UX HEAD y el slice sigue cumpliendo
  R7 (scroll-x residual permitido en xs/sm con sticky). La decisión se registra
  en `apply-progress` y no requiere re-spec: el propio proposal §6 ya la prevé.

### 1.3 Alternativas rechazadas

- `w-56` fijo en todos los viewports: recorta la UX HEAD en md/lg (constraint:
  no tocar lógica/UX de pago) — rechazado.
- Fusionar Transferir bajo Registrar pago en móvil (celda de acciones
  combinada): duplica el `min-content` de la celda más crítica, mezcla dos
  lógicas distintas y complica `colSpan`/T4-T5 (non-goal N9) — rechazado.

## 2. Clases Tailwind exactas por columna

Convención: cada breakpoint se aplica **en el `TableHead` y en su `TableCell`
correspondiente** (si solo se pone en uno, la columna se desincroniza porque
shadcn no propaga visibilidad). Todas las clases van vía `className`; ningún
componente `ui/*` se edita (R3/R8).

| # | Columna | Head | Cell | Notas |
| --- | --------- | ------ | ------ | ------- |
| 1 | Nombre (siempre visible + sticky) | `sticky left-0 z-10 bg-background` | `sticky left-0 z-10 bg-background font-medium` | `font-medium` ya existe en working tree; se conserva. Sin `hidden` en ningún viewport. Ver §3 para el porqué de cada token |
| 2 | Teléfono | `hidden sm:table-cell` | `hidden sm:table-cell whitespace-nowrap` | Escalera existente (Miembros + working tree); `whitespace-nowrap` evita que el número se parta en sm |
| 3 | Estado | `hidden sm:table-cell` | `hidden sm:table-cell` | NUEVO breakpoint. Badge interno intacto (`statusBadgeVariant` + `retreatStatusLabel`); sin badge compacto en Nombre (non-goal N8) |
| 4 | Email | `hidden md:table-cell` | `hidden md:table-cell max-w-[200px] truncate` | Escalera existente + bound de `min-content`: el email largo es el que más estira md; `truncate` es solo clase, no toca lógica |
| 5 | Pagado (siempre visible) | `whitespace-nowrap` (sin `hidden`) | `whitespace-nowrap` | Formato `es-CO` intacto; nunca se oculta (decisión proposal §3.3). `whitespace-nowrap` impide compresión que rompa alineación (R7-a) |
| 6 | Saldo | `hidden md:table-cell` | `hidden md:table-cell whitespace-nowrap` | NUEVO breakpoint; `—` cuando `remaining === null` intacto; `whitespace-nowrap` por R7-a |
| 7 | % Pagado | `hidden lg:table-cell` | `hidden lg:table-cell whitespace-nowrap` | NUEVO; dato derivado solo en desktop amplio (análogo a WhatsApp `lg` en Miembros) |
| 8 | Último abono | `hidden lg:table-cell` | `hidden lg:table-cell whitespace-nowrap` | NUEVO; fecha `es-CO` intacta |
| 9 | Registrar pago (siempre visible) | `w-56 md:w-64` | `w-56 md:w-64` | Híbrido §1; contenido interno según §1.1 |
| 10 | Transferir | `hidden md:table-cell w-40` | `hidden md:table-cell w-40` | NUEVO breakpoint; `w-40` HEAD intacto en md+. Acción secundaria oculta en xs/sm (decisión proposal §3.2) |
| 11 | Acciones/Eliminar (si `canDelete`) | — (siempre visible, sin `hidden`) | `whitespace-nowrap` | Ancho mínimo fijo vía contenido (botón `destructive sm` intacto T4); no se copia `w-24` literal de Miembros (son icon-buttons, aquí es botón con texto). `aria-label` por fila intacto |

Resultado por viewport (matriz R7):

- **xs 360px → 4 visibles:** Nombre, Pagado, Registrar pago (`w-56` apilada), Acciones (si `canDelete`).
- **sm 640px → 6:** xs + Teléfono + Estado.
- **md 768px → 9:** sm + Email + Saldo + Transferir (Registrar pago vuelve a `w-64` horizontal).
- **lg 1280px → 11:** tabla completa (+ % Pagado + Último abono), sin scroll-x.

### Por qué `hidden {bp}:table-cell` y no `hidden {bp}:block`

Las celdas `th`/`td` tienen `display: table-cell` por defecto del user-agent.
`{bp}:block` las sacaría del modelo de tabla (rompe alineación de columnas).
`{bp}:table-cell` restaura exactamente el display de tabla — es el patrón que
ya usan `members/page.tsx` y el working tree, y shadcn lo soporta vía
`className` porque `TableHead`/`TableCell` hacen `cn(base, className)`.

## 3. Sticky izquierda: diseño exacto

```tsx
<TableHead className="sticky left-0 z-10 bg-background">Nombre</TableHead>
// ...
<TableCell className="sticky left-0 z-10 bg-background font-medium">
  {registration.name}
</TableCell>
```

- `sticky left-0`: fija Nombre al borde izquierdo durante el scroll-x del
  contenedor. Funciona porque el scroll ocurre en el ancestro
  `div.relative.w-full.overflow-auto` interno de shadcn `Table` — `sticky` se
  adhiere dentro del scroll-container ancestro más cercano, sin necesidad de
  tocar `table.tsx`.
- `bg-background`: fondo opaco obligatorio. Sin él, el contenido desplazado se
  filtra por detrás de la celda fija (las celdas son transparentes por
  defecto). Se usa el token `bg-background` (no un color literal) para respetar
  light/dark.
- `z-10`: eleva la columna fija sobre las celdas desplazadas. `z-10` basta
  (las celdas no tienen stacking propio); queda muy por debajo del overlay del
  `Dialog` de Eliminar (Radix portal con z muy superior), luego no hay
  conflicto con T4/T5.
- **Sin `sticky right-0` en Acciones** (decisión proposal §3.5): el doble sticky
  crea conflictos de `z-index`/fondo con el `Dialog` y con los bordes
  `rounded-lg` del wrapper; el problema reportado es perder la referencia de
  fila, que resuelve el sticky izquierdo solo (non-goal N9).
- Esquinas `rounded-lg border`: el wrapper `div.rounded-lg.border` (patrón
  Miembros, ya presente en working tree) se conserva tal cual; verificación
  visual en xs de que la celda sticky no pinta sobre el borde redondeado
  (riesgo baja severidad, mitigación: nada que cambiar salvo que la inspección
  muestre filtrado — en tal caso añadir `left-[1px]` queda prohibido sin
  re-diseño; reportar como hallazgo de apply).
- Tuning knob permitido sin re-spec (solo si md 820px muestra scroll-x por
  nombres extremos): envolver el texto en
  `<span className="block max-w-[140px] truncate sm:max-w-[180px] lg:max-w-none">`.
  Principal: **sin truncate** (paridad HEAD); el knob solo se activa con
  evidencia de overflow por nombres largos.

## 4. `colSpan` del empty-state: estrategia adaptativa sin JS

Estado actual (working tree, T4): `colSpan={canDelete ? 8 : 7}` para 8 columnas.
Tras la restauración HEAD el total es **11 con `canDelete`, 10 sin él**.

**Diseño: `colSpan` estático igual al total de columnas.**

```tsx
<TableCell colSpan={canDelete ? 11 : 10} className="text-center text-muted-foreground">
  No hay preinscripciones registradas
</TableCell>
```

Texto y estilo intactos (R5). Por qué esto satisface R5 ("abarcar exactamente
las visibles en cada viewport") sin JavaScript:

- Las columnas ocultas usan `display: none` (`hidden`), que consume **cero
  ancho**. Una celda con `colSpan={11}` en xs (7 columnas ocultas) pinta
  visualmente sobre las 4 visibles — ni más ni menos. En lg pinta sobre las 11.
  El atributo es estático pero la cobertura visual es adaptativa por
  construcción CSS.
- Precedente: `members/page.tsx` usa `colSpan={5}` estático con 3 columnas con
  breakpoint — mismo mecanismo, sin quejas.
- Alternativa rechazada (hook `useMediaQuery` + helper `visibleColumnCount` +
  vitest): añade módulo nuevo (prohibido por R8 salvo autorización de tasks),
  riesgo de hidratación SSR/cliente, y cero ganancia visual frente al estático.
  Solo se reconsidera si verify demuestra con playwright que algún navegador
  reserva ancho para columnas `display: none` dentro de un `colSpan` mayor
  (comportamiento no estándar; no esperado).

## 5. Qué NO se toca y por qué

| Área | Prohibición | Fundamento |
| ------ | ------------- | ------------ |
| `src/components/ui/table.tsx` | No editar; solo consumir su `overflow-auto` interno | El componente ya provee `<div className="relative w-full overflow-auto">` (verificado por lectura directa). Editarlo afectaría a todas las tablas (Miembros incluida). Breakpoints y sticky entran vía `className` gracias a `cn(base, className)`. Prohibido anidar otro contenedor de scroll (scrollbar paralelo, R3) |
| Toolbar HEAD (tabs Todos/Preinscritos/Inscritos, search avanzada, selector 20/pág, botones Nueva/Exportar/Imprimir) | Restaurar, no rediseñar | R8 + non-goal N2. La regresión del working tree la eliminó; apply la recupera byte-idéntica de HEAD y solo verifica que filtra/pagina/opera |
| Card de costo total | No tocar | R8 + N3. Su `flex gap-2` propio no participa del overflow de la tabla |
| Paginación | No tocar | R8 + N4 |
| Lógica pagos / transferir / eliminar | Solo clases/layout; handlers, validaciones, `Dialog`, toasts intactos | R8 + N5. `handleRecordPayment`, `amountDrafts`, Completar-saldo, barra, `paymentsBlocked`, `handleConfirmDelete`, `deleteMode/deleteConfirmed/deleting`, `paymentCountsByRegistration`, toasts exactos design §3 de `delete-retreat-preinscriptions` |
| RPC / migraciones / RLS / triggers / BD | Nada | R8 + N7; este change no crea migración |
| `src/lib/retreat/queries.ts` o módulos nuevos | No crear | Verificado inexistente por explore (grep: solo `payments.ts`, `constants.ts`, `submit-adapter.ts`). Paginación/search viven en `page.tsx` |
| Badge compacto de Estado en Nombre (xs) | No en este slice | Non-goal N8; refinamiento futuro. Los tabs mitigan la falta de Estado en xs |
| `sticky right-0` / apilar Transferir bajo Registrar | No | Non-goal N9; ver §1.3 |

## 6. Plan de restauración HEAD + reaplicación T4/T5 (paso 0 de apply)

`design` no ejecuta git (fase sin shell/código). `apply` MUST seguir este
orden exacto; cada paso es verificable y reversible por separado:

1. **Paso 0a — Restaurar HEAD.** `git show HEAD:src/app/(dashboard)/retreat-registrations/page.tsx`
   → volcar a `page.tsx` (747 líneas: toolbar + 10 columnas + celda `w-64`
   completa + Transferir `w-40` + paginación + card costo). Verificar con
   `git diff --stat` que el archivo vuelve a tamaño HEAD y con `npx tsc --noEmit`
   en verde antes de seguir.
2. **Paso 0b — Reaplicar Eliminar T4/T5 idéntico** (fuente normativa:
   `delete-retreat-preinscriptions/tasks.md` T4/T5, ambos `[x]`): import
   `canDeleteRetreatRegistration`; `const canDelete` tras el gate
   `canManageRetreatRegistrations`; columna `Acciones` + botón `Eliminar`
   (`destructive`/`sm`/`aria-label` por fila) solo si `canDelete`; `colSpan`
   base; helper `countPaidByRegistration` + `paymentCountsByRegistration` en
   `loadData()`; estados `deleteTarget/deleteMode/deleteConfirmed/deleting`;
   `Dialog` 3 opciones derivadas de `sumPaid > 0`; doble confirmación solo para
   (a); orden pagos→registro; `.select('id')` + chequeo borrado parcial +
   toasts exactos. **Sin cambios de comportamiento.** Verificar `tsc` + render
   manual (leader ve columna/botón; server no).
3. **Paso 1 — Breakpoints** (§2): solo `className` en `TableHead`/`TableCell`.
   Verificar `tsc`.
4. **Paso 2 — Sticky** (§3): `sticky left-0 z-10 bg-background` en Head+Cells
   de Nombre. Verificación visual xs con scroll-x al extremo derecho.
5. **Paso 3 — Compactación Registrar pago** (§1.1): `w-56 md:w-64` + wrapper
   `flex-col` + fila interna `flex-col md:flex-row`. Sin tocar handlers.
6. **Paso 4 — `colSpan`** (§4): `canDelete ? 11 : 10`.
7. **Paso 5 — Verificación final:** `npx tsc --noEmit` en verde +
   `git diff --stat` (additions + deletions) **≤ 400 líneas** o detener y
   re-consultar estrategia (`delivery_strategy: ask-on-risk`) antes del PR.
   Cero archivos fuera de `page.tsx` (+ tests nuevos autorizados por tasks).

Estimación de diff: la restauración HEAD por sí sola puede acercarse al
presupuesto (working tree ~300 → HEAD 747 + T4/T5 + breakpoints). Si el conteo
real supera 400, apply se detiene y el parent decide (split, excepción o
recorte) — nunca se abre PR por encima del presupuesto sin re-consulta.

Rollback (sin migraciones ni datos): revertir `page.tsx` a HEAD + T4/T5
(funcional pre-cambio). Tests nuevos se revierten con sus archivos. Post-merge:
revert-commit del PR.

## 7. Estrategia de tests TDD

Strict TDD activo (`openspec/config.yaml`): `npx vitest` · `npx playwright test`
· `npx tsc --noEmit`. Presupuesto 400 líneas compartido con el diff de producto.

### 7.1 Playwright por viewport (núcleo de la verificación, R7)

Archivo nuevo bajo `e2e/` (nombre exacto lo fija `tasks`, p. ej.
`e2e/retreat-registrations-responsive.spec.ts`). Matriz mínima, cada caso con
datos sembrados (≥1 fila) y sesión con permiso:

| Viewport | Ancho | Aserciones |
| ---------- | ------- | ------------ |
| xs | 360px | Teléfono/Estado/Email/Saldo/Transferir/%/Último abono ocultas (`not.toBeVisible()`); Nombre/Pagado/Registrar pago/Acciones visibles; celda Registrar pago `w-56` + dirección `flex-col`; scroll-x solo dentro del contenedor `overflow-auto` (page no desborda: `document.documentElement.scrollWidth <= 360`); Nombre sticky (`position: sticky`, `left: 0px`, fondo opaco) visible tras `scrollTo(right)` |
| sm | 640px | xs + Teléfono y Estado visibles; Email/Saldo/Transferir/%/Último abono ocultas; montos sin compresión rota |
| md | 768–820px | Email/Saldo/Transferir visibles; %/Último abono ocultas; Registrar pago `w-64` horizontal; Transferir operativo; sin scroll-x a 820px salvo nombres extremos (si aparece: limpio + sticky) |
| lg | 1280px | 11 columnas visibles; **sin scroll-x**; paridad HEAD+Eliminar (toolbar tabs/search/20-pág/Nueva/Exportar/Imprimir, celda `w-64` completa, Transferir `w-40`, paginación, card costo) |
| Transversal | todos | Registrar pago registra (válido → `toast.success("Pago registrado")`; `<= 0` → `toast.error("El monto de la cuota debe ser mayor que cero")` sin fila); Eliminar abre `Dialog`, 3 opciones/toasts T4-T5 intactos; tabs/search/paginación sin regresión |

Si el harness no permite chromium/firefox o sesión sembrada, los casos se
ejecutan donde sea posible y el resto se cubre con verificación manual guiada
por esta misma matriz (criterio proposal §3.6: la matriz es el contrato, no una
captura).

### 7.2 `tsc` (obligatorio)

`npx tsc --noEmit` en verde tras cada paso del §6 y como gate final. Cualquier
error bloquea el PR.

### 7.3 Vitest (condicional — solo si se toca helper)

- **Principal (colSpan estático §4): no se toca ningún helper → sin vitest
  nuevo.** Se reutilizan sin cambios `sumPaidByRegistration`,
  `remainingBalance`, `parsePositiveTotal`, `isRetreatPaymentBlocked`.
- **Solo si** apply introduce un helper (p. ej. `visibleColumnCount` porque el
  fallback de §4 se activara, u otro cómputo extraído): test RED en
  `src/**/__tests__/**/*.test.{ts,tsx}` fijando el contrato antes del GREEN,
  patrón `guards.test.ts` existente. Tasks lo autorizará explícitamente; sin
  helper nuevo no hay archivo vitest nuevo (evita gastar presupuesto).

## 8. Riesgos residuales y mitigaciones

| Riesgo | Severidad | Mitigación en este diseño |
| -------- | ----------- | --------------------------- |
| Restauración HEAD diverge del inventario reconstruido (sin `git show` en explore/proposal/design) | Media | Paso 0a verifica tamaño/contenido contra HEAD antes de seguir; si difiere, se ajusta apply sin re-spec siempre que sean solo columnas/anchos/toolbar/paginación equivalentes |
| `w-64` HEAD no compacta limpio a `w-56` apilado | Media | Fallback §1.2 con criterio medible; riesgo aislado a xs/sm |
| Sticky + `overflow-auto` + `rounded-lg border` filtra fondo en esquinas | Baja | `bg-background z-10`; verificación visual xs (§7.1) |
| Estado oculto en xs confunde | Baja | Tabs por estado mitigan; N8 como futuro |
| Presupuesto 400 con restauración + responsividad + tests | Media | Gate `git diff --stat` + `ask-on-risk` (§6 paso 5) |
| Regresión T4/T5 al restaurar HEAD | Media | Paso 0b idéntico a T4/T5 + tests Eliminar en §7.1 |

## 9. Cambios de archivos y contratos

- **Producto (1 archivo):** `src/app/(dashboard)/retreat-registrations/page.tsx`
  — columnas/breakpoints/sticky/compactación/`colSpan` según §1–§4, tras pasos
  §6. Ningún otro archivo de producto.
- **Tests (nuevos, tasks fija nombres):** 1 spec playwright (§7.1); 0 archivos
  vitest salvo helper nuevo (§7.3).
- **Contratos intactos:** `Table`/`TableHead`/`TableCell` API sin cambios;
  `payments.ts` (`sumPaidByRegistration`, `remainingBalance`,
  `parsePositiveTotal`, `isRetreatPaymentBlocked`, `retreatStatusLabel`);
  `guards.ts` (`canManageRetreatRegistrations`, `canDeleteRetreatRegistration`);
  `app-settings.ts` (`getRetreatTotalCost`/`setRetreatTotalCost`); esquema
  `retreat_registrations`/`retreat_payments`; toasts T4/T5.
- **Data flow:** sin cambios — `loadData()` (registrations + payments + total) →
  estados → render. El diseño solo altera visibilidad/disposición, nunca el
  flujo de datos.
