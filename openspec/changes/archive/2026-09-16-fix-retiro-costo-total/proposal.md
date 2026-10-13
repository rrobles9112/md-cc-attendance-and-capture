# Proposal — fix-retiro-costo-total

> Change: `fix-retiro-costo-total` (store: openspec)
> Upstream requerido: `openspec/changes/fix-retiro-costo-total/explore.md` (leído antes de redactar)
> Tracker padre ODD: `odd/tasks/fix-retiro-costo-y-tabla.md` (T1/T2/T3)
> Hermano: `fix-retiro-responsive-table` (T2 en profundidad — no duplicar)
> Modo TDD: estricto (`openspec/config.yaml`: `npx vitest`, `npx playwright test`, `npx tsc --noEmit`)
> Estrategia de entrega: `ask-on-risk` · Presupuesto: 400 líneas cambiadas

## 1. Intent

Arreglar la causa raíz de T1: guardar costo total `480000` como `super_admin` en
"Preinscripciones — Un Corazón Nuevo" (`src/app/(dashboard)/retreat-registrations/page.tsx`)
falla con "Error al guardar el costo total" y la tabla conserva Saldo `400.000,00`.

Decisión de esta proposal: **opción (c) — ambas**:
migración `FOR INSERT TO authenticated WITH CHECK (user_role()='super_admin')`
sobre `app_settings` **+** `onConflict: 'key'` explícito en `setSetting` **+**
mensajes de error por código **+** guard anti-doble-clic.
Se mantiene `upsert` (no se reescribe a update-first como path principal).

## 2. Business / product angle (breve)

- **Bloqueo operativo:** sin costo guardado, `isRetreatPaymentBlocked('')` es `true`,
  los pagos quedan bloqueados en UI, saldos/% se calculan sobre el valor viejo
  (`400000`) y la transferencia a Valientes falla con `missing_total`
  (`retreat.youth.total_cost is missing or empty`, guards 011 l.226-262 + RPC 014/022).
- **Roles de staff:** solo `super_admin` escribe el costo (tarjeta gated por
  `canManageUsers(role)`); `leader`/`server` solo leen (`app_settings_select`).
  El fix no cambia el modelo de roles, lo hace cumplir de extremo a extremo
  (UI gate + policy SQL + mensajes claros).
- **Alcance producto del primer slice:** que el guardado 480000 funcione y que un
  fallo futuro diga *por qué* (42501 vs red vs no-autenticado) en vez del
  genérico actual.

## 3. Scope

### In (T1, este change)

- `src/lib/settings/app-settings.ts`: `setSetting` con `onConflict: 'key'`
  explícito + errores tipados por código.
- Nueva migración: policy `FOR INSERT` sobre `app_settings` (solo `authenticated`,
  solo `super_admin`).
- `src/app/(dashboard)/retreat-registrations/page.tsx` `handleSaveCost`:
  mensajes específicos + guard anti-doble-clic (ref sincrónica, sin cambio de layout).
- Tests RED (definidos aquí, implementados en fase tasks/implement):
  unit `onConflict` + test de policy INSERT.
- Verificación previa obligatoria: salida de `supabase/diagnose_user_role.sql`
  en el entorno donde se reproduzca (ver §7 riesgo 1).

### Related context only (T2, NO implementar aquí)

- Overflow horizontal de la tabla (12 columnas). Lo cubre en profundidad el change
  hermano `fix-retiro-responsive-table` (`openspec/changes/fix-retiro-responsive-table/explore.md`
  §1-§7). Este change **no toca clases/layout de tabla**
  (`overflow-x-clip`, `sticky`, `hidden sm/md/lg:table-cell`, `w-56 md:w-64`).
  Solo se referencia como contexto porque el síntoma "Saldo no cambia" se observa
  en esa misma tabla.

### Non-goals (explícitos)

- Formulario público `/retiro` (sin cambios).
- Borrado masivo / bulk delete (fuera; solo policies 022 existentes).
- Conversión a members (fuera).
- Soft-delete (fuera).
- Reescritura completa de `setSetting` a update-first como único fix (rechazado
  como path principal — ver matriz; solo como fallback documentado).
- Cambios de roles/RBAC (`guards.ts`, `useRole.ts` sin cambios de semántica).

## 4. Affected areas

| Área | Archivo(s) | Cambio |
| --- | --- | --- |
| Settings client | `src/lib/settings/app-settings.ts` l.16-36 | `upsert(..., { onConflict: 'key' })` + error mapping |
| Cost card | `src/app/(dashboard)/retreat-registrations/page.tsx` l.367-382 | mensajes por código + guard anti-doble-clic |
| DPO email (regresión) | `src/app/(dashboard)/admin/page.tsx` `handleSaveDpoEmail` | sin cambio de código; cubierto por el mismo `setSetting` + test regresión |
| DB policies | `supabase/migrations/0XX_app_settings_insert_super_admin.sql` (nueva) | `FOR INSERT TO authenticated WITH CHECK` |
| Tests unit | `src/lib/settings/__tests__/app-settings.test.ts` | RED: asertar `onConflict`, simular 42501/PGRST116/red |
| Tests SQL | `supabase/tests/app_settings_insert.test.sql` (nuevo) | RED: INSERT permitido/denegado por rol vía `INSERT ... ON CONFLICT` |
| Diagnóstico | `supabase/diagnose_user_role.sql` (existente, solo ejecutar) | salida requerida pre-fix |

## 5. Root cause (resumen del explore, no nueva investigación)

1. `setSetting` hace `upsert({key, value, ...})` **sin `onConflict`**. PostgREST lo
   traduce a `INSERT ... ON CONFLICT DO UPDATE`.
2. Regla Postgres/RLS: esa sentencia **exige policy `FOR INSERT` aunque la fila
   exista**. En todo el historial (`001`, `006`, `011`, `017`, `022`) **no existe**
   `CREATE POLICY ... ON app_settings FOR INSERT` → denegación `42501` antes de
   llegar al `DO UPDATE`.
3. `GRANT` de `003` a `anon`/`authenticated` es acceso tabla/API, **no sustituye RLS**.
4. Los tests enmascaran el bug: SQL usa `UPDATE` directo (solo necesita
   SELECT+UPDATE, que sí existen); unit mockea `upsert` con `{ error: null }`
   sin asertar `onConflict` ni simular 42501.
5. Hipótesis secundaria abierta: desync `user_role()` (profiles vs JWT
   `app_metadata`) — si es real, ni la policy INSERT basta. Ver §7.
6. Doble toast: causa más probable, doble invocación por doble clic
   (`setSavingCost(true)` async-state no deshabilita a tiempo). Sin Toaster duplicado.

## 6. Decision matrix: (a) vs (b) vs (c)

| Criterio | (a) Solo migración INSERT, mantener `upsert` | (b) Solo reescribir `setSetting` a update-first + insert-on-PGRST116, cero migración | (c) Ambas + `onConflict` + errores + anti-doble-clic **(recomendada)** |
| --- | --- | --- | --- |
| Arregla 42501 en `INSERT ... ON CONFLICT` | ✅ Sí (policy faltante era la causa) | ⚠️ Parcial: el path `UPDATE` funciona hoy (SELECT+UPDATE existen), pero el fallback `INSERT` seguiría denegado sin policy → el primer guardado de una key nueva fallaría igual | ✅ Sí |
| Primer guardado de key inexistente | ✅ Sí | ❌ No sin migración | ✅ Sí |
| Robustez PostgREST (`onConflict` inferido vs explícito) | ⚠️ Queda implícito (funciona por PK `key TEXT`, pero frágil) | ✅ Explícito en el nuevo path | ✅ Explícito (`seed-cohort.ts:93` ya es el patrón de referencia) |
| Afecta a `admin/page.tsx` DPO email | ✅ Sí (mismo `setSetting`) | ✅ Sí | ✅ Sí |
| Mensajes específicos 42501/red (criterio ODD) | ❌ No por sí sola | ⚠️ Solo si se añade mapping (mismo costo que en (c)) | ✅ Incluido |
| Doble toast | ❌ No lo arregla | ❌ No lo arregla | ✅ Guard anti-doble-clic incluido |
| Riesgo migración / despliegue | Bajo (una policy aditiva) pero requiere `supabase db pull` + advisors | Cero migración, pero dos round-trips y condición de carrera update/insert concurrente | Igual que (a); el código extra es unit-testeable y cabe en 400 líneas |
| Seguridad (`003` abre DML a `anon`) | ✅ Seguro si `TO authenticated` + `WITH CHECK super_admin` | ✅ Sin superficie SQL nueva | ✅ Igual que (a) con checklist §7 |
| Líneas estimadas | ~30 (migración + test SQL) | ~60 (cliente + unit) | ~120-180 total (migración + cliente + ambos tests + mensajes + guard) — dentro de 400 |

**Decisión: (c).** La migración es necesaria (sin policy INSERT ningún `upsert`/`insert`
pasará RLS); el `onConflict:'key'` explícito elimina la inferencia frágil; los
mensajes por código cumplen el criterio ODD; el guard cierra el doble toast.
La opción (b) sola se documenta únicamente como fallback si una ventana de
despliegue prohibiera migrar (en ese caso el primer guardado de keys nuevas
seguiría roto — limitación conocida).

## 7. Risks (del explore) + mitigations

1. **Desync de rol (`user_role()` NULL aunque UI muestre `super_admin`).**
   Mitigación: **ejecutar `supabase/diagnose_user_role.sql` primero** en el
   entorno de repro y adjuntar salida (def de `user_role()`, JWT con/sin
   `app_metadata`, `profiles.role` vs `raw_app_meta_data`, migraciones aplicadas).
   Si hay desync (perfil sin fila / token viejo), re-sincronizar rol
   (refresh de JWT tras asignación) antes de validar el fix. Sin esto, ni (a) ni (c)
   arreglarían el guardado. No cambiar `user_role()` en este change.
2. **`003` otorga DML a `anon` a nivel tabla — nunca abrir INSERT a `anon`.**
   Mitigación: policy exactamente `FOR INSERT TO authenticated USING` (no aplica;
   INSERT solo lleva `WITH CHECK`) `WITH CHECK (user_role() = 'super_admin')`.
   Sin `TO anon`, sin `USING true`, sin `WITH CHECK true`. Pasar
   `supabase db advisors` + checklist de seguridad (skill supabase §6).
3. **`admin/page.tsx` comparte `setSetting` (email DPO).**
   Mitigación: el fix lo arregla también; incluir su path en regresión
   (test unit del mapping de errores + smoke manual de guardado DPO). No cambiar
   su UI.
4. **Presupuesto 400 líneas (`ask-on-risk`).**
   Mitigación: migración + `app-settings.ts` + tests unit + mensajes caben;
   si al medir `git diff --stat` el guard anti-doble-clic + e2e lo exceden,
   **pausar y preguntar** (no inventar chain ni excepción) conforme preflight.
5. **`upsert` sin `onConflict` + PK `key TEXT`.**
   Mitigación: no asumir que `onConflict:'key'` solo arregla — va **con**
   migración. El test RED debe fallar si `upsert` se llama sin la opción.
6. **UPDATE requiere SELECT (checklist supabase).**
   Ya existe `app_settings_select` para `super_admin` — verificado, sin acción.
   No usar `SECURITY DEFINER` para "arreglar" permisos; no tocar `user_role()`.
7. **T2 entrelazado.** Riesgo de tocar la tabla por accidente.
   Mitigación: prohibición explícita de cambios de layout en este change;
   cualquier overflow se deriva al hermano.

## 8. Proposed design (primer slice)

### 8.1 Migración (nueva, aditiva)

```sql
-- 0XX_app_settings_insert_super_admin.sql
CREATE POLICY "app_settings_insert_super_admin"
ON public.app_settings
FOR INSERT
TO authenticated
WITH CHECK (user_role() = 'super_admin');
```

- Sin tocar policies SELECT/UPDATE existentes. RLS ya habilitado (001).
- Generar vía flujo imperativo (`supabase migration new` + `supabase db pull`),
  luego `supabase db advisors` y `supabase migration list --local`.
- Rollback: `DROP POLICY IF EXISTS "app_settings_insert_super_admin" ON public.app_settings;`

### 8.2 `src/lib/settings/app-settings.ts`

- `upsert({ key, value, updated_by, updated_at }, { onConflict: 'key' })`.
- Mapear errores a códigos consumibles por UI (no solo `throw error` crudo):
  - `42501` → permiso denegado (sugerir revisar rol / re-login por JWT viejo).
  - `PGRST116` → fila ausente (informativo para `getSetting`; no debe tragarse en `set`).
  - red/fetch-failure → conexión.
  - `Not authenticated` (sin sesión) se conserva.
- No cambiar firmas públicas (`setSetting`, `getSetting`, `setRetreatTotalCost`,
  `getRetreatTotalCost`) para no romper `admin/page.tsx`.

### 8.3 `handleSaveCost` (page.tsx)

- Guard sincrónico anti-doble-invocación (`if (savingCostRef.current) return;`
  con ref, además del `disabled={savingCost}` existente) — sin cambios visuales.
- `toast` específico por código en vez del genérico único:
  - 42501 → "Sin permisos para guardar el costo (requiere super_admin)…".
  - red → "Sin conexión…".
  - éxito conserva "Costo total del retiro actualizado" + `await loadData()`.
- Criterio ODD "Fallos RLS/red muestran mensaje específico" se cumple aquí.

### 8.4 First-slice boundary (done cuando)

- Guardar `480000` como `super_admin` persiste `retreat.youth.total_cost='480000'`,
  toast de éxito, Saldo/% recalculados (ya no `400.000,00` viejo).
- Fallo 42501 simulado muestra mensaje de permisos; fallo de red muestra mensaje
  de conexión (verificable en tests + manual con red cortada).
- Un doble clic rápido emite **una** sola escritura (o un solo toast de error),
  sin cambio visual de la tabla.

## 9. Strict TDD — RED tests (definidos, NO implementados en esta fase)

Implementa la fase `tasks`/implement; aquí solo el contrato RED (deben fallar
contra el código actual):

1. **Unit `onConflict` explícito** (`src/lib/settings/__tests__/app-settings.test.ts`,
   `npx vitest`):
   - `setSetting('retreat.youth.total_cost','480000')` debe llamar
     `upsert(payload, { onConflict: 'key' })`. RED hoy: llamado con un solo arg.
   - Payload conserva `key/value/updated_by` (regresión del test existente l.63-82).
2. **Unit error mapping** (mismo archivo):
   - `upsert` → `{ code: '42501' }` ⇒ `setSetting` rechaza con error tipado
     `permission-denied` (UI lo traduce al mensaje específico).
   - `upsert` → error de red (`TypeError: fetch failed` / `message` sin code) ⇒
     `network`.
   - `getSession` sin sesión ⇒ `Not authenticated` (sin cambios).
3. **SQL policy test** (`supabase/tests/app_settings_insert.test.sql`, harness
   existente `SET LOCAL ROLE authenticated` + JWT claims como
   `retreat_rls.test.sql` l.1329 / `retreat_valientes_transfer.test.sql` l.55):
   - Como `super_admin`: `INSERT INTO app_settings(key,value) VALUES ('__t1','480000')
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value` ⇒ éxito.
   - Como `leader` (o sin claim): mismo statement ⇒ `42501`.
   - Como `anon`: ⇒ denegado (prueba la restricción de §7.2).
   - RED hoy: el caso `super_admin` falla (no hay policy INSERT).
4. **E2E diferido (solo si cabe en 400 líneas, si no se pregunta):**
   `e2e/retreat-cost.spec.ts` (playwright, chromium): login `super_admin`,
   fijar `480000`, asertar toast éxito + Saldo recalculado; con RLS denegado
   simulado, asertar mensaje específico. No implementado en primer slice salvo
   presupuesto confirmado.

- Comandos de verificación: `npx vitest`, `npx tsc --noEmit`,
  `npx playwright test` (el e2e solo cuando exista), `supabase db advisors`.

## 10. Verification plan (orden)

1. Salida de `supabase/diagnose_user_role.sql` (bloqueante para validar).
2. Repro manual pre-fix: login `super_admin` → fijar `480000` → confirmar toast
   error + Saldo `400.000,00` (línea base del explore).
3. RED tests (fallan) → implement → GREEN → `npx tsc --noEmit`.
4. Post-fix manual: `480000` persiste; recarga muestra Saldo/% nuevos;
   pagos desbloqueados; transferencia Valientes ya no da `missing_total`
   (hasta el valor que corresponda al fixture).
5. Regresión DPO email (`admin/page.tsx`) smoke.
6. `git diff --stat` vs 400 líneas → si excede, `ask-on-risk` pausa y pregunta.

## 11. Rollback

- Código: revert del commit (cambios aditivos y aislados en 2 archivos cliente).
- DB: `DROP POLICY` de §8.1 (vuelve al estado 001/006; el síntoma original
  retorna pero sin pérdida de datos — el valor viejo sigue en la fila).
- Sin migraciones destructivas, sin backfill, sin cambios de seed (`011` intacto).

## 12. Success criteria

- [ ] `480000` guardado como `super_admin` persiste y recarga Saldo/% correctos.
- [ ] Error 42501 muestra mensaje de permisos; error de red muestra mensaje de red.
- [ ] Doble clic no produce doble toast de error.
- [ ] `npx vitest` + `npx tsc --noEmit` en verde; test SQL INSERT super_admin en verde,
      leader/anon denegados.
- [ ] `git diff --stat` ≤ 400 líneas o decisión `ask-on-risk` registrada.
- [ ] Sin cambios de layout de tabla (cero diff en clases responsivas).
- [ ] Email DPO (`admin/page.tsx`) sigue guardando (regresión).

## 13. Trazabilidad

- Explore: `openspec/changes/fix-retiro-costo-total/explore.md` §2 (cadena),
  §3 (hipótesis 42501 + tabla migraciones), §4 (desync + diagnose script),
  §5 (tests que enmascaran), §6 (doble toast), §7 (seed/downstream),
  §8 (baseline T2 hermano), §9 (riesgos).
- ODD: `odd/tasks/fix-retiro-costo-y-tabla.md` T1 (este change), T2 (hermano),
  T3 (fuera de este slice).
- Skills: supabase (RLS/TO-clause/`UPDATE`-necesita-`SELECT`/advisors),
  supabase-postgres-best-practices (`INSERT ... ON CONFLICT` exige policy INSERT).
