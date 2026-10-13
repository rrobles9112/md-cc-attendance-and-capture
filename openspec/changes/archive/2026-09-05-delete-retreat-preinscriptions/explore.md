# Explore — delete-retreat-preinscriptions

## 1. Objetivo (handoff pre-proposal CONFIRMADO)

Agregar eliminación de preinscritos del retiro (`retreat_registrations`):

- Roles autorizados: `super_admin` + `leader` (NO `server`).
- La interfaz debe dejar claras TRES opciones:
  - (a) eliminar ambos — preinscripción + pagos;
  - (b) eliminar solo pagos — conserva la preinscripción;
  - (c) si la persona no tiene pagos, eliminar solo su información de preinscripción.

## 2. Baseline (verificado por orquestador, confirmado en explore)

1. Árbol de trabajo REVERTIDO respecto a HEAD `1c2cd28`:
   `git diff HEAD --stat` ≈ 74 archivos, +233/−14352.
   En disco las migraciones llegan hasta `012d`; en HEAD existen `013`–`020`
   (incluye `019_role_access_updates.sql` que abre el módulo retiro a `server`
   en lectura y `014_retreat_valientes_transfer.sql`).
2. Ni HEAD ni el árbol tienen borrado de preinscritos
   (`.../retreat-registrations/page.tsx | grep -i delete` vacío en HEAD).
3. Baseline de implementación = ÁRBOL DE TRABAJO:
   RLS de retiro = solo `011` (SELECT/INSERT pagos y SELECT registros para
   super_admin+leader; página visible a leader+ vía
   `canManageRetreatRegistrations = canCreate`).
4. Para evitar colisión con `013`/`014` de HEAD, la nueva migración DEBE
   numerarse `021_*` y depender solo de tablas de `011`
   (`retreat_registrations`, `retreat_payments`).
5. `canDeleteRetreatRegistration` (leader+) es compatible con ambos baselines:
   en HEAD futuro `server` ve el módulo pero el botón Eliminar seguirá oculto.

## 3. Estado ya existente en la sesión (verificado, no rehecho)

- `src/lib/rbac/guards.ts` ya tiene
  `canDeleteRetreatRegistration(role) = super_admin || leader` (líneas ~19-21).
- `src/lib/rbac/__tests__/guards.test.ts` ya importa ese guard (línea 14)
  pero NO tiene bloque de tests — trabajo de spec/apply, no de explore.
- Confirmado por explore: el guard no se usa en ningún otro archivo
  (solo definición + import sin uso); la página no tiene UI de borrado.

## 4. Mapa de código actual

| Archivo | Rol en este cambio |
| --- | --- |
| `src/app/(dashboard)/retreat-registrations/page.tsx` | Client component. Tabla con columnas Nombre/Email/Teléfono/Estado/Pagado/Saldo/Registrar pago. Sin columna de acciones ni `delete`. Inserta pagos vía `supabase.from('retreat_payments').insert(...)`. Punto de inserción de la UI: nueva columna "Acciones" + `Dialog` de confirmación con las 3 opciones. |
| `src/lib/rbac/guards.ts` + `types.ts` | `canDeleteRetreatRegistration` existe (comparación directa de rol, NO pasa por `PermissionMap` — igual que `canViewPastoreo`). `canManageRetreatRegistrations = canCreate` controla visibilidad de la página. El botón Eliminar se gatea con el nuevo guard. |
| `src/lib/retreat/payments.ts` + `constants.ts` | Helpers puros: `sumPaidByRegistration`, `remainingBalance`, `retreatStatusLabel`, `RETREAT_EVENT_KEY`. La opción (b)/(c) necesita saber si hay pagos: ya existe `paidByRegistration.get(id) ?? 0` en la página — reutilizar para decidir qué opciones mostrar. |
| `src/components/ui/dialog.tsx` | Radix `Dialog` + `DialogContent/Header/Footer/Title/Description` ya disponible. Sin uso actual en la página de retiro; patrón a seguir para el diálogo de confirmación con radio de 3 opciones. |
| `supabase/migrations/011_youth_retreat_preregistration.sql` | Modelo de seguridad: RLS habilitado, sin policies anon; `authenticated`: SELECT en ambas tablas + INSERT en pagos (solo leader/super_admin vía `user_role()`). Triggers: `retreat_payments_before_insert` (guard total), `retreat_payments_after_insert` (status machine), `audit_retreat_*` (AFTER INSERT/UPDATE/DELETE → `log_mutation()`), `set_updated_at`. **NO hay policies DELETE ni GRANT DELETE.** |
| `supabase/tests/retreat_rls.test.sql` | Patrón: bloques `SET LOCAL ROLE anon/authenticated + JWT claims`, `RAISE NOTICE 'PASS...'` / `RAISE EXCEPTION 'FAIL...'` dentro de transacción con `ROLLBACK`. Ya cubre que anon DELETE afecta 0 filas. Extender con casos DELETE por rol (spec/apply). |

## 5. Hallazgos técnicos clave (verificados en explore)

- **FK sin cascada**: `retreat_payments.registration_id REFERENCES
  public.retreat_registrations(id)` **sin `ON DELETE`** (línea 42 de `011`) →
  `ON DELETE NO ACTION` por defecto. Borrar un registro con pagos falla con
  violación FK salvo que se borren **primero los pagos**.
- **Sin policy DELETE**: no existe `CREATE POLICY ... FOR DELETE` en ninguna
  tabla de retiro, ni `GRANT DELETE`. Con RLS habilitado, `DELETE` devuelve
  0 filas sin error — el cliente debe manejar "0 filas" como denegado.
- **Sin trigger AFTER DELETE de status**: solo hay `AFTER INSERT` que recalcula
  `status`. Al borrar pagos, el `status` de la fila restante queda obsoleto
  (ej. `inscrito` con 0 pagos). Si la opción (b) conserva la preinscripción,
  hay que resetear `status='preinscrito'` explícitamente (requiere policy
  UPDATE o hacerlo en el mismo orden de operaciones con UPDATE permitido).
  OJO: hoy tampoco hay policy UPDATE en tablas de retiro — verificar si el
  trigger `AFTER INSERT` (SECURITY DEFINER, owner) basta para sus writes
  (sí: corre como owner, bypasea RLS), pero un UPDATE emitido por el cliente
  necesitaría policy propia.
- **Auditoría ya cubre DELETE**: `audit_retreat_registrations` y
  `audit_retreat_payments` son `AFTER INSERT OR UPDATE OR DELETE` →
  `log_mutation()`. El borrado queda registrado en `audit_log` sin trabajo
  extra (verificar en spec qué columnas guarda `log_mutation` para DELETE).
- **UPDATE de status vía trigger es SECURITY DEFINER**: funciona sin policies
  del cliente; no es precedente para dar DELETE vía RPC (ver §6).

## 6. Enfoques comparados

### A. Borrado directo con dos DELETEs secuenciales (cliente + RLS) — RECOMENDADO

- Cliente emite, en orden: `DELETE FROM retreat_payments WHERE registration_id=…`
  y luego `DELETE FROM retreat_registrations WHERE id=…` (opción a);
  solo el primero (opción b); solo el segundo cuando no hay pagos (opción c).
- Migración `021_*`: `GRANT DELETE ON ambas tablas TO authenticated` +
  `CREATE POLICY ... FOR DELETE TO authenticated USING (user_role() IN
  ('super_admin','leader'))` en cada tabla.
- Para opción (b): además `GRANT UPDATE(status)` o policy UPDATE acotada, o
  un pequeño trigger `AFTER DELETE ON retreat_payments` (owner) que resetee
  `status='preinscrito'` cuando el remanente sea 0 — preferible trigger para
  no abrir UPDATE general al cliente.
- Pros: sin superficie privilegiada nueva; mismo patrón que el INSERT actual;
  RLS niega por defecto a `server`/anon; auditable vía triggers existentes;
  diff pequeño.
- Contras: 2 roundtrips (aceptable para acción destructiva esporádica);
  necesita manejar "0 filas" como denegado.

### B. RPC `SECURITY DEFINER` que borra ambos

- Pros: una llamada atómica; orden FK garantizado en servidor.
- Contras: `SECURITY DEFINER` bypasea RLS (la skill Supabase lo desaconseja
  salvo necesidad real); `EXECUTE` por defecto a `PUBLIC` — hay que revocar
  y re-otorgar con cuidado; chequeo de rol dentro del cuerpo duplica la
  lógica del guard y puede divergir; más código que auditar; innecesario
  porque RLS por policies ya resuelve el caso.
- Rechazado: privilegio excesivo para un borrado esporádico de staff.

### C. Soft-delete con `deleted_at`

- Pros: recuperable; no toca FK.
- Contras: columna nueva + backfill; CHECK de `status` y los índices únicos
  por `(event_key, email/phone)` chocan con filas "borradas" (habría que
  parcializar índices o permitir duplicados); triggers de pagos y queries de
  la página tendrían que filtrar `deleted_at IS NULL` en todas partes;
  contradice la semántica pedida ("eliminar su información" — minimización
  de datos; el `audit_log` ya conserva evidencia). Migración y diff mucho
  mayores.
- Rechazado: costo y riesgo desproporcionados; peor privacidad efectiva.

**Recomendación: enfoque A**, con trigger `AFTER DELETE ON retreat_payments`
(owner, SECURITY DEFINER como los existentes) que recalcule/resetee `status`
para cubrir la opción (b), en lugar de abrir UPDATE al cliente.

## 7. Riesgos

| Riesgo | Severidad | Tolerancia / mitigación |
| --- | --- | --- |
| FK sin `ON DELETE CASCADE`: orden de borrado obligatorio (pagos → registro) | Alta | Mitigado por diseño: la UI/secuencia siempre borra pagos primero; test SQL con violación FK esperada si se invierte |
| Ausencia de policies/GRANTS DELETE (RLS fail-closed → 0 filas) | Alta | Migración `021` los crea; UI trata 0 filas como error denegado con toast |
| `status` obsoleto tras borrar solo pagos (opción b) | Media | Trigger AFTER DELETE owner-side que resetea status; test de regresión `inscrito → preinscrito` tras borrar pagos |
| Falta policy UPDATE si se opta por resetear status desde cliente | Media | Evitar: usar trigger owner-side en vez de UPDATE de cliente |
| Divergencia guard-cliente vs policy-SQL (botón visible pero DELETE denegado o viceversa) | Media | Spec debe exigir paridad: mismos roles en `canDeleteRetreatRegistration` y en `USING (user_role() IN (...))`; tests en ambos niveles |
| Auditoría: confirmar que `log_mutation()` guarda suficiente contexto en DELETE (OLD row) | Baja | Verificar definición en `001` durante spec; test SQL que lea `audit_log` tras DELETE |
| `server` ve módulo en HEAD futuro (`019`) pero no debe borrar | Baja | Botón gateado por `canDeleteRetreatRegistration`; policies SQL lo niegan aunque la UI fallara; test server-denied |
| Tamaño de PR / review budget 400 líneas | Media | Mantener el cambio en: migración `021` (~40-60 líneas) + columna/acciones + diálogo (~120-180) + tests guard (~30) + tests SQL (~60-80). Si supera, partir en 2 PRs: (1) migración+policies+tests SQL, (2) UI+tests vitest |

## 8. Alcance sugerido para proposal/spec (no implementar aquí)

- Migración `021_retreat_registration_deletes.sql`: GRANTs + 2 policies DELETE
  - trigger AFTER DELETE de recálculo de status. Solo depende de `011`.
- UI en `page.tsx`: columna Acciones (visible solo con
  `canDeleteRetreatRegistration(role)`), `Dialog` con las 3 opciones y
  doble confirmación para (a); toasts de éxito/error; `loadData()` post-borrado.
- Tests: bloque `canDeleteRetreatRegistration` en `guards.test.ts`;
  extensión de `retreat_rls.test.sql` (leader/super_admin OK, server/anon
  denegados, orden FK, status reseteado, fila en `audit_log`).
- Non-goals: sin RPC, sin soft-delete, sin cambios a `019`/`014` de HEAD,
  sin edición de preinscripciones (solo borrado), sin export.

## 9. Preguntas para proposal (no bloquean explore)

1. ¿La opción (b) debe resetear `status` a `preinscrito` siempre, o conservar
   el último estado? (Explore asume reseteo.)
2. ¿Doble confirmación con nombre tipeado para la opción (a), o basta un
   diálogo con radio + botón destructivo?
