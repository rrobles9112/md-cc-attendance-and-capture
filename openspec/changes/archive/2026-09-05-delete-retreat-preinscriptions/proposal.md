# Proposal — delete-retreat-preinscriptions

## Intent

Agregar eliminación de preinscritos del retiro (`retreat_registrations` +
`retreat_payments`) para staff autorizado, cubriendo el vacío actual: hoy no
existe ninguna vía (UI ni SQL con RLS) para borrar una preinscripción ni sus
pagos. La página `retreat-registrations` solo lista e inserta pagos; no hay
policies/GRANTs DELETE y el botón de borrado no existe.

El cambio permite a `super_admin` y `leader` corregir preinscripciones
erróneas/duplicadas y atender solicitudes de eliminación de datos personales,
con tres opciones explícitas en UI y auditoría automática vía los triggers
`audit_retreat_*` existentes.

## Scope

**Base de implementación:** árbol de trabajo actual (RLS de retiro = solo
migración `011`; migraciones en disco hasta `012d`). La nueva migración
depende únicamente de tablas creadas en `011`.

**Incluye:**

1. **Migración `021_retreat_registration_deletes.sql`:**
   - `GRANT DELETE ON retreat_registrations, retreat_payments TO authenticated`.
   - Dos policies `FOR DELETE TO authenticated USING (user_role() IN
     ('super_admin','leader'))` (una por tabla).
   - Trigger owner-side `AFTER DELETE ON retreat_payments` que recalcula /
     resetea `status` de la `retreat_registrations` remanente
     (p. ej. `inscrito` con 0 pagos → `preinscrito`), cubriendo la opción (b)
     sin abrir UPDATE al cliente.
2. **UI en `src/app/(dashboard)/retreat-registrations/page.tsx`:**
   - Nueva columna "Acciones" con botón Eliminar, visible solo si
     `canDeleteRetreatRegistration(role)` es true.
   - `Dialog` de confirmación (Radix, ya disponible en
     `src/components/ui/dialog.tsx`) con tres opciones explícitas:
     - (a) eliminar preinscripción + pagos (dos DELETEs secuenciales:
       pagos primero, luego registro — orden obligatorio por FK sin cascada);
     - (b) eliminar solo pagos conservando la preinscripción (solo DELETE
       de pagos; el trigger resetea `status`);
     - (c) sin pagos registrados, eliminar solo la información de
       preinscripción (solo DELETE del registro).
   - La opción mostrada se deriva del pago acumulado existente
     (`paidByRegistration.get(id) ?? 0`): con pagos > 0 se ofrecen (a)/(b);
     con 0 se ofrece (c). Doble confirmación para (a).
   - Manejo de "0 filas afectadas" como denegado (RLS fail-closed) con toast
     de error; `loadData()` post-borrado en éxito.
3. **Reutilización sin cambios:** `canDeleteRetreatRegistration` existente en
   `src/lib/rbac/guards.ts`; helpers `sumPaidByRegistration` /
   `remainingBalance` en `src/lib/retreat/payments.ts`; triggers de auditoría
   `audit_retreat_* → log_mutation()` (ya cubren DELETE, sin trabajo extra).
4. **Tests:**
   - Bloque `canDeleteRetreatRegistration` en
     `src/lib/rbac/__tests__/guards.test.ts` (super_admin/leader true,
     server/otros false).
   - Extensión de `supabase/tests/retreat_rls.test.sql`: leader/super_admin
     pueden borrar (en orden pagos → registro), server/anon denegados
     (0 filas), violación FK si se invierte el orden, `status` reseteado tras
     opción (b), fila en `audit_log` tras DELETE.

## Non-goals

- **N1 — Conversión a members:** no se crea ni vincula `members` desde una
  preinscripción; fuera de alcance.
- **N2 — Edición de datos de preinscripción:** solo borrado; no se agregan
  formularios de edición de nombre/email/teléfono/estado.
- **N3 — Borrado masivo / selección múltiple:** solo borrado unitario por
  fila con confirmación; sin checkbox masivo ni purga por evento.
- **N4 — Cambios al flujo anónimo `/retiro`:** el formulario público de
  preinscripción no se toca (sin policies anon nuevas, sin cambios de UX).
- **N5 — Sin RPC `SECURITY DEFINER`:** no se crea ninguna función
  privilegiada de borrado.
- **N6 — Sin soft-delete (`deleted_at`):** no se agrega columna, backfill ni
  filtros globales; hard delete + `audit_log` existente.
- **N7 — Sin cambios a migraciones `013`–`020` de HEAD ni a `014`/`019`:**
  la migración `021` solo depende de `011`.
- **N8 — Reconciliación del árbol revertido con HEAD:** el árbol de trabajo
  está revertido respecto a HEAD `1c2cd28` (~74 archivos). Reconciliarlo es
  dependencia externa, no parte de este cambio (ver Riesgos R6).
- **N9 — Sin exportación de datos:** no se agrega export CSV ni reporte de
  borrados (la evidencia queda en `audit_log`).

## Approach

**Enfoque A — dos DELETEs secuenciales del cliente vía RLS + trigger
owner-side (seleccionado).**

Secuencia por opción:

- (a) `DELETE FROM retreat_payments WHERE registration_id = X` →
  `DELETE FROM retreat_registrations WHERE id = X`.
- (b) Solo `DELETE FROM retreat_payments WHERE registration_id = X`; el
  trigger `AFTER DELETE` recalcula `status`.
- (c) Solo `DELETE FROM retreat_registrations WHERE id = X` (precondición:
  sin pagos; si aparecen pagos concurrentes, el FK bloquea y la UI reporta
  error).

Migración `021`:

```sql
GRANT DELETE ON public.retreat_registrations TO authenticated;
GRANT DELETE ON public.retreat_payments TO authenticated;

CREATE POLICY retreat_registrations_delete_staff ON public.retreat_registrations
  FOR DELETE TO authenticated
  USING (public.user_role() IN ('super_admin','leader'));

CREATE POLICY retreat_payments_delete_staff ON public.retreat_payments
  FOR DELETE TO authenticated
  USING (public.user_role() IN ('super_admin','leader'));

-- trigger AFTER DELETE ON retreat_payments (owner) → recalcula status
```

Por qué este enfoque:

- No crea superficie privilegiada nueva; mismo patrón que el INSERT actual
  de pagos desde el cliente.
- RLS niega por defecto a `server`/anon (fail-closed → 0 filas).
- Auditoría automática sin código extra.
- El trigger owner-side evita abrir UPDATE general al cliente solo para
  resetear `status` (hoy no existe policy UPDATE en tablas de retiro).
- Costo esporádico: 2 roundtrips aceptables para una acción destructiva
  infrecuente.

## Alternatives considered

| # | Alternativa | Veredicto |
|---|-------------|-----------|
| B | RPC `SECURITY DEFINER` que borra registro + pagos en una llamada atómica | **Rechazada.** Bypasea RLS; `EXECUTE` por defecto a `PUBLIC` exige revoke/re-grant cuidadoso; el chequeo de rol en el cuerpo duplica la lógica del guard y puede divergir; más código privilegiado que auditar para un borrado esporádico de staff. Privilegio excesivo e innecesario porque las policies RLS ya resuelven el caso. |
| C | Soft-delete con columna `deleted_at` | **Rechazada.** Columna nueva + backfill; CHECK de `status` e índices únicos parciales por `(event_key, email/phone)` chocan con filas "borradas"; todos los triggers de pagos y queries de la página tendrían que filtrar `deleted_at IS NULL`; contradice la semántica pedida ("eliminar su información", minimización de datos) mientras `audit_log` ya conserva evidencia. Migración y diff mucho mayores. |

## Risks

| ID | Riesgo | Severidad | Mitigación |
| ---- | -------- | ----------- | ------------ |
| R1 | FK `retreat_payments.registration_id` sin `ON DELETE CASCADE`: borrar el registro antes que los pagos falla con violación FK | Alta | Orden obligatorio pagos → registro en UI/secuencia; test SQL que verifica la violación si se invierte el orden |
| R2 | Sin policies/GRANTs DELETE hoy (RLS fail-closed → 0 filas sin error) | Alta | Migración `021` los crea; UI trata "0 filas" como denegado con toast de error |
| R3 | `status` obsoleto tras opción (b) (`inscrito` con 0 pagos) | Media | Trigger `AFTER DELETE` owner-side que resetea a `preinscrito`; test de regresión `inscrito → preinscrito` |
| R4 | Divergencia guard-cliente vs policy-SQL (botón visible pero DELETE denegado o viceversa) | Media | Spec exige paridad literal de roles en `canDeleteRetreatRegistration` y en `USING (user_role() IN (...))`; tests en ambos niveles (vitest + SQL) |
| R5 | `server` verá el módulo en HEAD futuro (`019`) pero no debe borrar | Baja | Botón gateado por guard; policies SQL lo niegan aunque la UI fallara; test `server-denied` en SQL |
| R6 | Árbol revertido vs HEAD (`013`–`020` existen solo en HEAD): colisión de numeración o semántica al reintegrar | Media | **Dependencia externa, no parte del cambio.** `021` depende solo de `011`; documentar en spec que el rebase/merge debe conservar `021` después de `020` y revalidar policies contra `019` |
| R7 | `log_mutation()` podría guardar contexto insuficiente en DELETE (fila OLD) | Baja | Verificar definición en `001` durante spec; test SQL que lee `audit_log` tras DELETE |
| R8 | Presupuesto de review (400 líneas): migración (~40-60) + UI columna/diálogo (~120-180) + tests guard (~30) + tests SQL (~60-80) podría exceder | Media | Si excede, partir en 2 PRs: (1) migración + policies + tests SQL, (2) UI + tests vitest |
| R9 | Preguntas abiertas de UX (¿reseteo de `status` siempre vs conservar? ¿doble confirmación simple vs nombre tipeado en opción a?) | Baja | Defaults propuestos: reseteo a `preinscrito` siempre; diálogo con radio + botón destructivo + segunda confirmación para (a). Spec fija el comportamiento final |

## Rollback

- **Antes del merge:** revertir rama / descartar migración `021` (aún no
  aplicada en remoto) + descartar cambios de `page.tsx`. Sin datos afectados.
- **Después del merge sin uso:** revert-commit del PR; si `021` ya aplicó en
  algún entorno, nueva migración `022` de reversión que elimine las dos
  policies DELETE, el trigger `AFTER DELETE` y los `GRANT DELETE`
  (`DROP POLICY IF EXISTS ...`, `DROP TRIGGER IF EXISTS ...`,
  `REVOKE DELETE ...`). La UI revertida oculta el botón; aunque quedara UI
  vieja, sin policies el DELETE devuelve 0 filas (fail-closed).
- **Después de borrados reales:** los datos de `retreat_registrations` /
  `retreat_payments` borrados NO son recuperables por rollback de código; la
  evidencia queda en `audit_log` (vía `log_mutation()`). Restauración solo
  manual desde respaldo o reingreso de la preinscripción. Este riesgo es
  inherente al hard delete aprobado (D5) y se mitiga con la doble
  confirmación de la opción (a).

## Success criteria

1. `super_admin` y `leader` pueden ejecutar las 3 opciones desde la UI con
   toasts de éxito y recarga de la tabla (`loadData()`).
2. `server` y `anon` no ven el botón Eliminar y, a nivel SQL, sus DELETE
   afectan 0 filas (RLS fail-closed verificado en tests).
3. Opción (a) deja cero filas en ambas tablas para ese `registration_id`;
   opción (b) deja el registro con `status = 'preinscrito'` y cero pagos;
   opción (c) elimina el registro sin pagos.
4. Cada DELETE genera su fila correspondiente en `audit_log` (verificado en
   test SQL).
5. `npx tsc --noEmit` (o validación equivalente del repo) pasa; tests
   `guards.test.ts` (nuevo bloque) y `retreat_rls.test.sql` (nuevos casos)
   pasan.
6. Diff total ≤ ~400 líneas o, si excede, dividido en 2 PRs según R8.

## Key decisions

- **D1 — Roles autorizados:** `super_admin` + `leader`; explícitamente NO
  `server` (ni `anon`). Fijado por confirmación de usuario; se refleja en
  guard existente y en policies SQL.
- **D2 — Tres opciones UI explícitas:** (a) eliminar preinscripción + pagos,
  (b) eliminar solo pagos conservando la preinscripción, (c) sin pagos,
  eliminar solo la información de preinscripción. La UI las presenta como
  opciones excluyentes derivadas de si existen pagos.
- **D3 — Número de migración `021`:** `021_retreat_registration_deletes.sql`,
  dependiente solo de tablas de `011`, para evitar colisión con `013`–`020`
  existentes en HEAD.
- **D4 — Trigger `AFTER DELETE` owner-side vs UPDATE de cliente:** el
  recálculo/reseteo de `status` tras la opción (b) se hace en trigger
  owner-side (`SECURITY DEFINER`, como los existentes), NO abriendo
  `GRANT UPDATE` / policy UPDATE general al cliente.
- **D5 — Hard delete con auditoría existente, sin soft-delete:** eliminación
  física; la evidencia queda en `audit_log` vía `audit_retreat_*`. Sin
  columna `deleted_at` (minimización de datos).
- **D6 — Sin RPC `SECURITY DEFINER`:** borrado vía policies RLS + DELETEs
  del cliente; no se crea función privilegiada.
- **D7 — Baseline = árbol de trabajo:** RLS de retiro = `011`; la
  reconciliación con HEAD es dependencia externa documentada (R6), no parte
  del cambio.
- **D8 — Defaults UX pendientes de spec:** reseteo de `status` a
  `preinscrito` siempre en opción (b); doble confirmación para opción (a)
  con radio + botón destructivo (nombre tipeado solo si spec lo eleva).
