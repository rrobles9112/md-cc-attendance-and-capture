# Explore — fix-retiro-costo-total

> Fase: sdd-explore. Solo lectura, sin cambios de código de producto.
> TDD estricto activo (`openspec/config.yaml`: `npx vitest`, `npx playwright test`, `npx tsc --noEmit`), pero esta fase no implementa nada.
> Change padre ODD: `odd/tasks/fix-retiro-costo-y-tabla.md` (T1/T2/T3). Este SDD cubre la causa raíz del costo total (T1); T2-tabla solo como contexto relacionado (change hermano `fix-retiro-responsive-table` ya lo cubre en profundidad — no duplicar).

## 1. Evidencia original (cadenas exactas)

- Módulo: "Preinscripciones — Un Corazón Nuevo" (`src/app/(dashboard)/retreat-registrations/page.tsx`).
- Acción: Guardar `480000` como `super_admin`.
- Síntoma 1: doble toast "Error al guardar el costo total".
- Síntoma 2: la tabla sigue mostrando Saldo `400.000,00` (valor viejo, no el nuevo 480000).
- La tarjeta de costo solo se muestra con `canManageUsers(role)` (= `super_admin` únicamente en la práctica).

## 2. Cadena de llamada exacta (verificada por lectura)

```text
page.tsx handleSaveCost (l.367-382)
  -> normalizeRetreatCostInput(costDraft)      [src/lib/retreat/payments.ts l.3-14]
  -> parsePositiveTotal(normalized)            [payments.ts l.16-24]  (guard; toast "El costo debe ser un número positivo")
  -> setRetreatTotalCost(normalized)           [src/lib/settings/app-settings.ts l.45-47]
    -> setSetting(RETREAT_TOTAL_COST_KEY, value) [app-settings.ts l.16-36]
      -> supabase.auth.getSession() (throw 'Not authenticated' si no hay sesión)
      -> supabase.from('app_settings').upsert({ key, value, updated_by, updated_at })
         // SIN opción onConflict explícita
      -> if (error) throw error  -> catch en handleSaveCost -> toast "Error al guardar el costo total"
  -> éxito: toast "Costo total del retiro actualizado" + await loadData()
```

- `RETREAT_TOTAL_COST_KEY = 'retreat.youth.total_cost'` (`app-settings.ts` l.39).
- `getRetreatTotalCost()` = `getSetting(KEY)` → `.select('value').eq('key',key).single()`; `loadData()` lo usa para `storedTotal`/`costDraft` y de ahí `parsedTotal`, `remainingBalance`, `%`, `paymentsBlocked`.
- Trazabilidad del síntoma 2: con el upsert denegado, `storedTotal` sigue siendo el valor viejo (`400000` → `formatAmount` → `400.000,00` en `es-CO`), por eso Saldo/% no cambian.
- Flujo de validación para `"480000"`: `normalizeRetreatCostInput('480000')` → sin coma y sin patrón `/^\d{1,3}(\.\d{3})+$/` → devuelve `'480000'` intacto; `parsePositiveTotal` → `480000` (>0, finito) → pasa el guard. **El fallo no es validación local, es Supabase.**
- Mismo `setSetting` defectuoso lo usa `src/app/(dashboard)/admin/page.tsx` `handleSaveDpoEmail` (`setSetting('dpo_contact_email', ...)`) → el bug afecta también al guardado del email DPO (no solo retiro).
- Contraste positivo: `scripts/retreat/seed-cohort.ts:93` sí usa `upsert({...}, { onConflict: 'key' })` explícito — el único call-site con `onConflict` en el repo (grep `onConflict` solo lo encuentra ahí). Patrón correcto ya existe como referencia.

## 3. Hipótesis primaria: upsert sin INSERT policy → 42501 (SOSTENIDA, pendiente de verificación runtime)

- `setSetting` hace `upsert({key, value, updated_by, updated_at})` sin `onConflict`. PostgREST traduce a `INSERT ... ON CONFLICT DO UPDATE`.
- Regla Postgres/RLS (verificada en skills supabase + postgres-best-practices): **`INSERT ... ON CONFLICT DO UPDATE` exige policy `FOR INSERT` aunque la fila exista** — la rama INSERT se evalúa primero y sin policy INSERT la sentencia es denegada con `42501`, nunca llega al `DO UPDATE`.
- Estado de policies `app_settings` por migración (lectura completa de archivos):

| Migración | Efecto en `app_settings` |
| --- | --- |
| `001_initial_schema.sql` l.120-128, l.397-407 | Crea tabla (`key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by UUID, updated_at`); seed `dpo_contact_email=''`; `ENABLE RLS`; policies `app_settings_select FOR SELECT USING (user_role() IN ('super_admin','leader','server'))` y `app_settings_update FOR UPDATE USING (user_role()='super_admin')` (sin `WITH CHECK` en 001). `user_role()` v1 = `(auth.jwt()->>'role')::app_role` (claim `role` de PostgREST, no app role). |
| `006_fix_rls_write_policies_and_user_role.sql` l.22-36, l.100-105 | Reescribe `user_role()` robusto: `COALESCE((SELECT role FROM profiles WHERE id=auth.uid()), (auth.jwt()->'app_metadata'->>'role'))`, `SECURITY DEFINER SET search_path=''`. Recrea `app_settings_update FOR UPDATE USING (user_role()='super_admin') WITH CHECK (user_role()='super_admin')`. **No crea ninguna policy `FOR INSERT`.** |
| `011_youth_retreat_preregistration.sql` l.308-313 | Seed `INSERT INTO app_settings (key,value) VALUES ('retreat.youth.total_cost','') ON CONFLICT DO NOTHING` (valor `''` vacío — sin default numérico; comentario: "Owner insert: no INSERT policy"). Como owner bypass RLS, funciona en migración aunque no haya policy INSERT. |
| `017_whatsapp_pastoreo_rls.sql` (cabecera interna dice `012c_...`, deriva de numeración) l.29-33 | Solo comentario: `whatsapp_* UPDATE` sigue cubierto por `app_settings_update` de 001/006; **ninguna policy nueva sobre `app_settings`**. |
| `022_restrict_retreat_member_mutations_super_admin.sql` | Solo toca `retreat_payments` INSERT/DELETE, `retreat_registrations` DELETE/UPDATE + RPCs; **ningún cambio en `app_settings`**. |
| `003_grant_authenticated_table_access.sql` | `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO anon,authenticated,service_role` + default privileges. Esto es acceso a nivel tabla/API, **no sustituye RLS**: sin policy `FOR INSERT`, el upsert sigue denegado (42501). |

- Conclusión: en todo el historial **no existe `CREATE POLICY ... ON app_settings FOR INSERT`** (grep `FOR INSERT` + `app_settings` sin resultados; solo `audit_log_insert` en 006). La hipótesis primaria queda sostenida por lectura y apunta a dos fixes alternativos para proposal: (a) migración con policy `FOR INSERT TO authenticated WITH CHECK (user_role()='super_admin')` manteniendo `upsert`, o (b) cambiar `setSetting` a `update`-primero + `insert`-si-`PGRST116`, o `upsert` con `onConflict:'key'` + policy INSERT de todos modos (el `onConflict` solo no basta sin policy).
- Nota de seguridad (skill supabase checklist): `UPDATE` además requiere policy `SELECT` — existe (`app_settings_select` incluye `super_admin`), por lo que el path `UPDATE` directo funciona; solo falta `INSERT`.

## 4. Hipótesis secundaria: desync `user_role()` (profiles.role vs JWT app_metadata.role) (ABIERTA, no descartada)

- `user_role()` (006) = `COALESCE(profiles.role por auth.uid(), jwt app_metadata.role)`. Si `profiles` no tiene fila para el uid (signup sin `handle_new_user`, perfil borrado) **y** el JWT no trae `app_metadata.role` (token viejo sin refresh tras asignación de rol, o tests RLS sin claims), retorna `NULL` → `USING (NULL='super_admin')` → NULL → denegado.
- `src/hooks/useRole.ts`: prefiere `session.user.app_metadata?.role` si es rol válido; si no, cae a `profiles.role`. O sea, **el UI puede mostrar `super_admin` (vía profiles) mientras `user_role()` SQL ve otro/NULL (vía JWT)**, o viceversa: la tarjeta de costo (`canManageUsers`) se renderiza pero la policy SQL deniega. Desync UI↔SQL posible en ambas direcciones.
- `src/lib/rbac/guards.ts`: `canManageUsers` = permiso genérico (no idéntico a `canMutateRetreatPreinscriptions`); la tarjeta de costo depende de `canManageUsers`, mientras pagos/transfer dependen de `canMutateRetreatPreinscriptions`/`canRecordRetreatPayments`/`canTransferRetreatToValientes` (todos `super_admin`-only, espejo de las policies + RPC gate 42501 en 022).
- `supabase/diagnose_user_role.sql` existe y cubre exactamente esto (def de `user_role()`, JWT con/sin `app_metadata`, `profiles.role` vs `auth.users.raw_app_meta_data`, migraciones aplicadas) — el proposal debe pedir su salida en staging/prod antes de elegir fix.
- Interacción con H-primaria: si el desync existe, ni siquiera una policy INSERT arreglaría el guardado (el `USING/WITH CHECK` seguiría NULL). Por eso el plan de verificación debe comprobar rol efectivo SQL primero.

## 5. Por qué los tests enmascaran el bug

- SQL (`supabase/tests/retreat_rls.test.sql`, `retreat_valientes_transfer.test.sql`, `retreat_delete.test.sql`): usan **`UPDATE app_settings SET value=... WHERE key=...`** directo con `SET LOCAL ROLE authenticated` + JWT claims (`l.1329`, `l.55`, `l.46`...). `UPDATE` solo necesita policies SELECT+UPDATE → pasan. **Ningún test SQL ejerce `INSERT ... ON CONFLICT` sobre `app_settings`.**
- Unit (`src/lib/settings/__tests__/app-settings.test.ts` l.63-82): mockea `from().upsert` con `{ error: null }` y solo aserta el payload (`key/value/updated_by`). **Nunca simula el 42501 ni aserta `onConflict`**, así que pasa con el código defectuoso.
- Cobertura ausente: no hay test del path real cliente `upsert`-sin-`onConflict` contra RLS (requeriría e2e/supabase local con policies). El proposal debe añadir RED: unit que falle si `upsert` se llama sin `{ onConflict: 'key' }` (o que fuerce el nuevo path update-then-insert) + migración con test de policy INSERT.

## 6. Por qué doble toast (hipótesis, no confirmado)

- Un solo `<Toaster position="top-right" richColors />` en `app/layout.tsx:27` — no hay Toaster duplicado.
- `handleSaveCost` emite **un** `toast.error` por invocación fallida. Doble toast idéntico implica **doble invocación** del handler. Causa más probable: **doble clic en "Guardar"** — `setSavingCost(true)` es async-state (el `disabled={savingCost}` no se aplica hasta el re-render), así que dos clics rápidos lanzan dos `setRetreatTotalCost` concurrentes, ambas fallan con 42501 → dos toasts. Alternativas menos probables: StrictMode dev re-ejecución (no aplica a event handlers, solo efectos), o reintento del usuario tras ver el primer toast.
- El fix (proposal): deshabilitar el botón sincrónicamente / guard `if (savingCost) return` con ref, o `toast.dismiss()` antes de mostrar error; además mensajes de error específicos por código (42501 → "Sin permisos...", red → "Requiere conexión...") en vez del genérico actual. Esto también cubre el criterio ODD "Fallos RLS/red muestran mensaje específico".

## 7. Seed y downstream bloqueado (contexto)

- Seed `011`: `retreat.youth.total_cost = ''` (vacío, no numérico). `isRetreatPaymentBlocked('')` → `parsePositiveTotal('')` → `null` → `true`.
- Guards SQL (`retreat_payments_guard_total`, 011 l.226-262; transfer RPC 014/022): `missing/empty → EXCEPTION 'retreat.youth.total_cost is missing or empty'`, `not numeric`, `must be positive`. Sin costo guardado: pagos bloqueados en UI, saldos/% sobre valor viejo, transferencia falla `missing_total`. Coherente con el "Why" del ODD.

## 8. Tabla overflow — solo baseline breve (NO duplicar al hermano)

- El change hermano `fix-retiro-responsive-table` ya investiga el overflow en profundidad: ver `openspec/changes/fix-retiro-responsive-table/explore.md` (§1-§7: inventario 10-11 columnas HEAD, causas por columna, escalera sm/md/lg, constraints de `src/components/ui/table.tsx`, riesgos).
- Estado observado en esta fase (lectura del working tree actual de `page.tsx`, ~700 líneas, tabla completa): el wrapper ya trae `overflow-x-clip`, contenedor `overflow-hidden rounded-lg border`, `Nombre sticky left-0 z-10 bg-background`, `Teléfono/Estado hidden sm:table-cell`, `Email/Saldo/Salud/Transferir hidden md:table-cell`, `% Pagado/Último-abono hidden lg:table-cell`, `Registrar pago w-56 md:w-64`. Es decir, **el working tree ya contiene trabajo responsivo del hermano** — este change no debe tocar clases/layout de tabla.
- Limitación: sin herramienta shell en esta fase no se ejecutó `git diff / git show HEAD`; el baseline HEAD-vs-working-tree se toma del explore hermano (§1). Referenciarlo, no reinventarlo.
- Inventario de columnas (coincide con hermano §3): Nombre | Teléfono | Estado | Email | Pagado | Saldo | % Pagado | Último abono | Salud | Registrar pago | Transferir | Acciones. `mutationColSpan = canMutate ? 12 : 9`.

## 9. Riesgos y preguntas para proposal

1. Si el desync de rol es real en prod (JWT sin `app_metadata.role`), la policy INSERT sola no basta — verificar `diagnose_user_role.sql` primero.
2. `upsert` sin `onConflict` + PK `key TEXT`: PostgREST infiere el conflicto por la PK en la mayoría de versiones, pero la ausencia de policy INSERT es denegación segura; no asumir que añadir `onConflict:'key'` solo arregla sin migración.
3. `003` otorga DML a `anon` a nivel tabla: cualquier policy INSERT nueva debe llevar `TO authenticated WITH CHECK (user_role()='super_admin')`, nunca abrir a `anon`.
4. Presupuesto 400 líneas (`ask-on-risk`): migración + `app-settings.ts` + tests unit + mensajes de error cabe; si se suma doble-clic guard + e2e, medir `git diff --stat` y consultar antes del PR.
5. `admin/page.tsx` comparte `setSetting` — el fix lo arregla también; incluir su path en tests de regresión.
6. Pregunta abierta: ¿fix = policy INSERT (mantener upsert) o reescribir `setSetting` a update-then-insert (cero migración)? Proposal decide con matriz; recomendación inicial: ambas (migración INSERT + `onConflict:'key'` explícito + errores por código) por robustez.

## 10. Archivos leídos (trazabilidad)

- `src/app/(dashboard)/retreat-registrations/page.tsx` (handleSaveCost l.367-382, loadData, tabla, Toaster ausente local)
- `src/lib/settings/app-settings.ts` (setSetting l.16-36, KEY l.39, wrappers l.42-47)
- `src/lib/retreat/payments.ts` (normalize l.3-14, parsePositiveTotal l.16-24, blocked l.30-32)
- `src/hooks/useRole.ts`, `src/lib/rbac/guards.ts`, `src/app/layout.tsx` (Toaster), `src/app/(dashboard)/admin/page.tsx` (handleSaveDpoEmail)
- `supabase/migrations/001_initial_schema.sql` (tabla l.120-128, policies l.397-407), `003_grant_authenticated_table_access.sql`, `006_fix_rls_write_policies_and_user_role.sql`, `011_youth_retreat_preregistration.sql` (seed l.308-313), `017_whatsapp_pastoreo_rls.sql`, `022_restrict_retreat_member_mutations_super_admin.sql`
- `supabase/diagnose_user_role.sql`, `supabase/seed.sql` (l.240-246), `supabase/tests/retreat_rls.test.sql` (l.880-1000, l.1300+), `retreat_valientes_transfer.test.sql`, `retreat_delete.test.sql`
- `src/lib/settings/__tests__/app-settings.test.ts`, `scripts/retreat/seed-cohort.ts:93`
- `odd/tasks/fix-retiro-costo-y-tabla.md`, `openspec/config.yaml`, `openspec/changes/fix-retiro-responsive-table/explore.md`
