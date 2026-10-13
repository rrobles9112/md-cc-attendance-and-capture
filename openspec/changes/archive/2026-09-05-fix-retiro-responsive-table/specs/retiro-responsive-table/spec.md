# Retiro Responsive Table Specification

## Purpose

La tabla de `src/app/(dashboard)/retreat-registrations/page.tsx` MUST presentar las 11 columnas funcionales HEAD + Eliminar sin overflow inutilizable en xs/sm/md/lg, con ocultamiento progresivo tipo-Miembros, primera columna sticky y celda de pago compactada por viewport, sin regresión funcional ni cambios fuera de la tabla.

Baseline vinculante: HEAD 747 líneas (toolbar + 10 columnas + celda `w-64` completa + Transferir `w-40` + paginación + card de costo) + columna/diálogo Eliminar T4/T5 de `delete-retreat-preinscriptions`. El working tree simplificado (~300 líneas, 8 columnas) es regresión, no base.

## Requirements

### Requirement: R1 — Inventario de 11 columnas restaurado

La tabla MUST contener exactamente las 11 columnas funcionales tras restaurar HEAD y reaplicar T4/T5, en este orden: Nombre, Email, Teléfono, Estado, Pagado, Saldo, % Pagado, Último abono, Registrar pago, Transferir, Acciones/Eliminar (condicional a `canDelete`).

#### Scenario: Inventario completo en lg

- GIVEN la página de preinscripciones al retiro con sesión autorizada (`canManageRetreatRegistrations`)
- WHEN se renderiza a viewport lg 1280px
- THEN las 11 columnas SHALL estar presentes en el orden fijado
- AND Registrar pago SHALL contener Monto + Registrar + Completar-saldo + barra de progreso HEAD
- AND Transferir SHALL estar presente con ancho `w-40`

#### Scenario: Working tree simplificado rechazado como base

- GIVEN el inventario de columnas renderizado
- WHEN se compara contra el working tree de 8 columnas con celda `w-56` simplificada (solo Monto + botón)
- THEN la tabla SHALL exponer % Pagado y Último abono
- AND la celda Registrar pago SHALL exponer la composición HEAD completa en md+

### Requirement: R2 — Breakpoints finales por columna

Cada columna MUST aplicar su clase de visibilidad final vía `className` en `TableHead` y su `TableCell` correspondiente, sin modificar `src/components/ui/table.tsx`:

| Columna | Clase final |
| --- | --- |
| Nombre | siempre visible |
| Teléfono | `hidden sm:table-cell` |
| Estado | `hidden sm:table-cell` |
| Email | `hidden md:table-cell` |
| Saldo | `hidden md:table-cell` |
| Transferir | `hidden md:table-cell` + `w-40` |
| Pagado | siempre visible + `whitespace-nowrap`, formato `es-CO` intacto |
| % Pagado | `hidden lg:table-cell` |
| Último abono | `hidden lg:table-cell` |
| Registrar pago | siempre visible, `w-56` en xs/sm → `w-64` en md+ |
| Acciones/Eliminar | siempre visible cuando `canDelete`, ancho mínimo fijo |

#### Scenario: Columnas ocultas por breakpoint

- GIVEN la tabla con el inventario R1
- WHEN se inspecciona a 360px (xs)
- THEN Teléfono, Estado, Email, Saldo, Transferir, % Pagado y Último abono SHALL estar ocultas (`display: none` por `hidden`)
- AND Nombre, Pagado, Registrar pago y Acciones/Eliminar (si `canDelete`) SHALL ser visibles

#### Scenario: Escalera progresiva sm/md/lg

- GIVEN la tabla con el inventario R1
- WHEN se inspecciona a 640px (sm)
- THEN Teléfono y Estado SHALL volverse visibles manteniendo ocultas Email, Saldo, Transferir, % Pagado y Último abono
- WHEN se inspecciona a 768px (md)
- THEN Email, Saldo y Transferir SHALL volverse visibles manteniendo ocultas % Pagado y Último abono
- WHEN se inspecciona a 1280px (lg)
- THEN las 11 columnas SHALL ser visibles

#### Scenario: Pagado nunca se oculta

- GIVEN cualquier viewport xs/sm/md/lg
- WHEN se renderiza la tabla
- THEN la columna Pagado SHALL ser visible con su monto formateado `es-CO`
- AND Saldo SHALL estar oculta en xs/sm y visible en md+

### Requirement: R3 — Columna Nombre sticky izquierda

La columna Nombre (`TableHead` + cada `TableCell` de la columna) MUST aplicar `sticky left-0` + fondo opaco (`bg-background`) + `z-10`. El sistema MUST NOT aplicar `sticky right-0` en acciones. El sistema MUST NOT modificar `src/components/ui/table.tsx` ni anidar un contenedor de scroll paralelo; el scroll-x vive solo en el `overflow-auto` interno de shadcn `Table`.

#### Scenario: Nombre permanece visible durante scroll-x en xs

- GIVEN la tabla a 360px con scroll-x activo dentro del `overflow-auto` interno
- WHEN el usuario desplaza horizontalmente hasta el extremo derecho
- THEN la celda Nombre de cada fila SHALL permanecer visible en el borde izquierdo
- AND su fondo SHALL ser opaco (ningún contenido desplazado se filtra por detrás)

#### Scenario: Sin sticky derecho ni scroll paralelo

- GIVEN la tabla renderizada en cualquier viewport
- WHEN se inspecciona el DOM y estilos computados
- THEN ninguna celda de Acciones/Eliminar SHALL tener `sticky right-0`
- AND SHALL existir un único contenedor con `overflow-auto` para la tabla (el interno de shadcn)

### Requirement: R4 — Compactación responsive de Registrar pago sin cambiar lógica

La celda Registrar pago MUST estar siempre visible con ancho `w-56` en xs/sm y `w-64` en md+. En xs/sm su contenedor interno MUST apilarse en `flex-col` (Input Monto full-width + Button Registrar full-width; Completar-saldo y barra HEAD apilados debajo). En md+ MUST conservar el layout HEAD (`w-64` horizontal con su `flex-wrap` interno). Solo clases/layout interno MAY cambiar; handlers (`handleRecordPayment`, `amountDrafts`, validación monto > 0, Completar-saldo, barra de progreso, `paymentsBlocked`) MUST permanecer intactos.

#### Scenario: Celda apilada en xs

- GIVEN viewport 360px con pagos habilitados
- WHEN se observa la celda Registrar pago de cualquier fila
- THEN su contenedor SHALL tener ancho `w-56` y dirección `flex-col`
- AND el Input Monto y el botón Registrar SHALL estar apilados a ancho completo

#### Scenario: Celda HEAD intacta en md+

- GIVEN viewport 768px o superior con pagos habilitados
- WHEN se observa la celda Registrar pago
- THEN su contenedor SHALL tener ancho `w-64` con el layout horizontal HEAD
- AND Completar-saldo y la barra de progreso SHALL estar presentes con su comportamiento HEAD

#### Scenario: Lógica de pago sin regresión

- GIVEN la celda compactada en xs y en md+
- WHEN se registra un monto válido y un monto `<= 0`
- THEN el monto válido SHALL persistir el pago y recargar (`toast.success("Pago registrado")`)
- AND el monto inválido SHALL rechazarse con `toast.error("El monto de la cuota debe ser mayor que cero")` sin crear fila

### Requirement: R5 — Empty-state con colSpan adaptativo

La fila de estado vacío ("No hay preinscripciones registradas") MUST usar un `colSpan` igual al número de columnas visibles según viewport y `canDelete`, recalculado sobre la base T4/T5 (`canDelete ? 8 : 7` del working tree de 8 columnas) escalada al conteo final de 11 columnas restauradas. El texto y el estilo (`text-center text-muted-foreground`) MUST conservarse.

#### Scenario: Empty-state cubre todo el ancho en xs y lg

- GIVEN cero registros y `canDelete = true`
- WHEN se renderiza a 360px
- THEN la celda de empty-state SHALL abarcar exactamente las 4 columnas visibles (Nombre, Pagado, Registrar pago, Acciones)
- WHEN se renderiza a 1280px
- THEN la celda SHALL abarcar las 11 columnas

#### Scenario: Empty-state respeta canDelete

- GIVEN cero registros y `canDelete = false`
- WHEN se renderiza en cualquier viewport
- THEN el `colSpan` SHALL excluir la columna Acciones (una menos que con `canDelete = true`)
- AND el texto SHALL seguir siendo "No hay preinscripciones registradas"

### Requirement: R6 — Preservación Eliminar T4/T5

La columna Acciones/Eliminar y su flujo MUST preservar intactos T4 (estructura) y T5 (secuencia + toasts): columna `Acciones` + botón `Eliminar` (`variant="destructive"`, `size="sm"`, `aria-label` por fila `Eliminar preinscripción de {nombre}`) solo si `canDeleteRetreatRegistration(role)`; helper `countPaidByRegistration` + estado `paymentCountsByRegistration` poblado en `loadData()`; estados `deleteTarget/deleteMode/deleteConfirmed/deleting`; `Dialog` Radix con las 3 opciones derivadas de `sumPaid > 0` y doble confirmación solo para (a); orden pagos→registro en (a); `.select('id')` para detectar denegación RLS; chequeo de borrado parcial; toasts exactos de design §3.

#### Scenario: Estructura Eliminar intacta

- GIVEN sesión con rol que puede eliminar (`canDelete = true`)
- WHEN se renderiza cualquier fila
- THEN SHALL existir un botón `Eliminar` con `aria-label` que incluye el nombre de la fila
- AND con rol sin permiso (`canDelete = false`) la columna Acciones SHALL no renderizarse

#### Scenario: Secuencia y toasts Eliminar intactos

- GIVEN una fila con pagos (`sumPaid > 0`) y rol con permiso
- WHEN se confirma la opción (a) "preinscripción y pagos" con checkbox aceptado
- THEN el sistema SHALL borrar pagos primero y luego el registro
- AND ante éxito SHALL mostrar `toast.success("Preinscripción y pagos eliminados")`, cerrar el diálogo y recargar
- AND ante denegación RLS en pagos (0 filas) SHALL mostrar `toast.error("No tiene permisos para eliminar estos pagos")` sin cerrar ni recargar

### Requirement: R7 — Matriz de aceptación por viewport y scroll-x

El sistema MUST cumplir la matriz medible (toolbar, card de costo y paginación intactas en todos los casos). Anchos de referencia: xs 360–639px · sm 640–767px · md 768–1023px · lg ≥1024px (plena a 1280px).

| Viewport | Columnas visibles | Scroll-x | Sticky | Regresión funcional |
| --- | --- | --- | --- | --- |
| xs 360px | 4: Nombre, Pagado, Registrar pago (`w-56` apilada), Acciones/Eliminar (si `canDelete`) | Residual permitido SOLO dentro del `overflow-auto` interno; sin corte seco, sin scrollbar paralelo nuevo | Nombre `sticky left-0` visible durante todo el scroll-x, fondo opaco | Registrar pago registra; Eliminar abre `Dialog` y sus 3 opciones/toasts funcionan; tabs/search/paginación intactos |
| sm 640px | 6: xs + Teléfono + Estado | Residual leve aceptable; sin compresión que rompa alineación de montos | Nombre sticky | Igual que xs + Estado con badge correcto |
| md 768px | 9: sm + Email + Saldo + Transferir (Registrar pago vuelve a `w-64` horizontal) | Sin scroll-x a 820px salvo nombres extremadamente largos; si aparece, limpio y con sticky | Nombre sticky | Transferir operativo; Saldo/`—` correcto |
| lg 1280px | 11: tabla completa (+ % Pagado + Último abono) | Sin scroll-x a 1280px | Sticky presente pero inerte | Paridad total HEAD + Eliminar: toolbar (tabs/search/20-pág/Nueva/Exportar/Imprimir), celda `w-64` completa, Transferir `w-40`, paginación, card costo |

Criterios transversales: (a) ningún monto/badge se comprime hasta romper alineación (`whitespace-nowrap` en Pagado/Saldo donde haga falta); (b) `npx tsc --noEmit` en verde; (c) `git diff --stat` ≤ 400 líneas o re-consulta de estrategia antes del PR; (d) cero cambios fuera de `page.tsx` (+ tests nuevos) salvo lo que tasks autorice.

#### Scenario: xs con scroll-x limpio y sticky

- GIVEN 360px con al menos una fila
- WHEN se mide el desbordamiento horizontal de la página
- THEN la página SHALL no desbordar fuera del contenedor de la tabla; el scroll-x SHALL ocurrir solo en el `overflow-auto` interno
- AND la columna Nombre SHALL permanecer visible durante el desplazamiento

#### Scenario: lg sin scroll-x y paridad total

- GIVEN 1280px con datos, pagos habilitados y rol con permiso de eliminar
- WHEN se renderiza la tabla completa
- THEN SHALL no existir scroll-x
- AND toolbar (tabs Todos/Preinscritos/Inscritos, search avanzada, selector 20/pág, botones Nueva/Exportar/Imprimir), paginación, card de costo, celda `w-64` completa y Transferir `w-40` SHALL estar presentes y operativos

### Requirement: R8 — Límites: no tocar fuera de la tabla

El cambio MUST limitarse a `src/app/(dashboard)/retreat-registrations/page.tsx` (columnas, breakpoints, sticky, compactación, `colSpan`) + archivos de tests nuevos que tasks autorice. El sistema MUST NOT modificar: toolbar (solo restaurarla), card de costo total, paginación, lógica de pagos/transferir/eliminar (más allá de clases/layout), `src/components/ui/table.tsx` ni ningún `ui/*` compartido, RPC/migraciones/policies RLS/triggers/BD, ni crear `src/lib/retreat/queries.ts` o módulos nuevos.

#### Scenario: Áreas protegidas intactas

- GIVEN el diff final del change
- WHEN se lista `git diff --stat`
- THEN ningún archivo bajo `src/components/ui/`, `supabase/migrations/`, ni `src/lib/retreat/` (salvo tests autorizados) SHALL aparecer modificado
- AND la toolbar, card de costo y paginación SHALL conservar su comportamiento HEAD (tabs filtran, search filtra, selector 20/pág pagina, botones Nueva/Exportar/Imprimir operan)

#### Scenario: Typecheck y presupuesto en verde

- GIVEN el diff final del change
- WHEN se ejecuta `npx tsc --noEmit`
- THEN SHALL pasar sin errores
- AND `git diff --stat` (additions + deletions) SHALL ser ≤ 400 líneas o la estrategia SHALL haberse re-consultado (`delivery_strategy: ask-on-risk`) antes del PR
