# Design — delete-retreat-preinscriptions

Responde a `proposal.md` (enfoque A: dos DELETEs secuenciales del cliente vía
RLS + trigger owner-side) y cubre los 9 requirements normativos de
`specs/delete-retreat-preinscriptions/spec.md`.
Baseline: árbol de trabajo (RLS de retiro = solo migración `011`).
La migración `021` depende únicamente de objetos creados en `011`.

Archivos reales citados:

- `src/app/(dashboard)/retreat-registrations/page.tsx` (client component a extender)
- `src/lib/rbac/guards.ts` (`canDeleteRetreatRegistration`, reutilizado sin cambios)
- `src/components/ui/dialog.tsx` (Radix `Dialog`, API existente)
- `src/components/ui/button.tsx` (variante `destructive` existente, tamaño `sm` existente)
- `supabase/migrations/011_youth_retreat_preregistration.sql` (modelo de seguridad a seguir)
- `src/lib/retreat/payments.ts` (`sumPaidByRegistration`, reutilizado sin cambios)

Decisiones de proposal que este diseño fija: D1 (roles `super_admin`+`leader`),
D2 (3 opciones excluyentes), D3 (migración `021`), D4 (trigger owner-side, sin
UPDATE de cliente), D5 (hard delete + `audit_log`), D6 (sin RPC),
D7 (baseline árbol), D8 (reseteo a `preinscrito` siempre en (b); doble
confirmación solo en (a), sin nombre tipeado).

## 1. Migración `supabase/migrations/021_retreat_registration_deletes.sql`

DDL exacto. Estilo consistente con `011`: header con modelo de seguridad,
secciones comentadas, `SECURITY DEFINER SET search_path = ''`, referencias
`public.*` calificadas, `REVOKE ALL ... FROM PUBLIC` tras cada función,
`NOTIFY pgrst, 'reload schema'` al final.

```sql
-- 021_retreat_registration_deletes.sql
-- Youth retreat pre-registration deletes: staff-only DELETE via RLS plus
-- owner-side status recalculation on payment delete.
--
-- Security model (extends 011, same pattern):
--   * No anon policies; fail-closed (RLS denies by default → 0 rows).
--   * Authenticated: DELETE on both tables for leader + super_admin only,
--     via public.user_role(). server and any other role get 0 rows.
--   * No client UPDATE grant/policy (011 has none; this migration adds none).
--     Status recalculation after payment deletes runs as owner
--     (SECURITY DEFINER, like retreat_payments_apply_status).
--   * No SECURITY DEFINER RPC for deletion (proposal D6/N5).
--   * Existing audit_retreat_* triggers keep covering DELETE (no changes).
-- Depends solely on 011 objects. On rebase against HEAD keep after 020
-- and revalidate against 019.

-- =============================================================================
-- GRANTS
-- =============================================================================

GRANT DELETE ON TABLE public.retreat_registrations TO authenticated;
GRANT DELETE ON TABLE public.retreat_payments TO authenticated;

-- =============================================================================
-- RLS DELETE policies (literal role parity with canDeleteRetreatRegistration)
-- =============================================================================

CREATE POLICY retreat_registrations_delete ON public.retreat_registrations
  FOR DELETE
  TO authenticated
  USING ((SELECT public.user_role()) IN ('super_admin', 'leader'));

CREATE POLICY retreat_payments_delete ON public.retreat_payments
  FOR DELETE
  TO authenticated
  USING ((SELECT public.user_role()) IN ('super_admin', 'leader'));

-- =============================================================================
-- Status recalculation on payment delete (owner-side, covers option (b))
-- =============================================================================

CREATE OR REPLACE FUNCTION public.retreat_payments_apply_status_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_raw text;
  v_total numeric;
  v_sum numeric;
  v_status text;
BEGIN
  SELECT COALESCE(SUM(p.amount), 0) INTO v_sum
  FROM public.retreat_payments p
  WHERE p.registration_id = OLD.registration_id;

  IF v_sum = 0 THEN
    UPDATE public.retreat_registrations
    SET status = 'preinscrito'
    WHERE id = OLD.registration_id;
    RETURN OLD;
  END IF;

  SELECT s.value INTO v_raw
  FROM public.app_settings s
  WHERE s.key = 'retreat.youth.total_cost';

  -- Total missing/empty: leave the surviving row untouched (spec).
  IF v_raw IS NULL OR btrim(v_raw) = '' THEN
    RETURN OLD;
  END IF;

  BEGIN
    v_total := btrim(v_raw)::numeric;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RETURN OLD;
  END;

  -- Total non-numeric or non-positive: leave the row untouched (spec).
  IF v_total IS NULL OR v_total <= 0 THEN
    RETURN OLD;
  END IF;

  -- Same threshold semantics as retreat_payments_apply_status (011).
  IF v_sum < v_total THEN
    v_status := 'pagos_parciales';
  ELSE
    v_status := 'inscrito';
  END IF;

  UPDATE public.retreat_registrations
  SET status = v_status
  WHERE id = OLD.registration_id;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.retreat_payments_apply_status_on_delete() FROM PUBLIC;

CREATE TRIGGER retreat_payments_after_delete
  AFTER DELETE ON public.retreat_payments
  FOR EACH ROW EXECUTE FUNCTION public.retreat_payments_apply_status_on_delete();

NOTIFY pgrst, 'reload schema';
```

Notas de diseño SQL:

- El trigger es `FOR EACH ROW`: en un borrado multi-fila (opciones (a)/(b)
  borran todos los pagos del registro) cada disparo recalcula sobre el
  remanente visible; el estado final converge al valor correcto porque el
  último disparo ve suma 0 (borrado total) o el remanente real (borrado
  parcial). Idempotente.
- En la opción (a) el trigger actualiza un registro que será borrado
  inmediatamente después: write harmless, sin efecto observable.
- La función NUNCA eleva excepción por total inválido (difiere de
  `retreat_payments_guard_total`, que sí valida en INSERT): en DELETE el
  borrado ya ocurrió y el trigger `AFTER` no debe revertirlo; solo decide si
  toca o no el `status` remanente. `RETURN OLD` sin tocar = fila intacta.
- `REVOKE ALL ... FROM PUBLIC` sigue el patrón de `011` (las funciones
  trigger no necesitan `EXECUTE` público; solo las invoca el trigger owner).
- Sin `GRANT UPDATE` / policy UPDATE: el `UPDATE` dentro de la función corre
  como owner (`SECURITY DEFINER`), bypasea RLS igual que
  `retreat_payments_apply_status` en `011` (verificado en explore §5).

## 2. UI en `src/app/(dashboard)/retreat-registrations/page.tsx`

### 2.1. Conteo y suma de pagos por registro (sin queries extra por fila)

`loadData()` ya trae todos los pagos en una sola query y construye
`paidByRegistration: Map<string, number>` vía `sumPaidByRegistration`
(`src/lib/retreat/payments.ts`). Extender en el mismo paso, sobre el mismo
array `payments` ya cargado, sin queries adicionales:

```ts
function countPaidByRegistration(
  payments: Array<{ registration_id: string }>,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const payment of payments) {
    counts.set(payment.registration_id, (counts.get(payment.registration_id) ?? 0) + 1)
  }
  return counts
}
```

Nuevo estado junto al existente:

```ts
const [paymentCountsByRegistration, setPaymentCountsByRegistration] =
  useState<Map<string, number>>(new Map())
```

En `loadData()`, después de `setPaidByRegistration(...)`:

```ts
setPaymentCountsByRegistration(countPaidByRegistration(payments))
```

Derivación por fila (costo O(1), sin I/O):

```ts
const sumPaid = paidByRegistration.get(registration.id) ?? 0
const hasPayments = sumPaid > 0
```

La derivación usa la **suma** (`paidByRegistration`), no el conteo: la spec
exige `paidByRegistration.get(id) ?? 0` como fuente. El mapa de conteos
existe para verificar filas afectadas en la secuencia de DELETEs (§2.4).

### 2.2. Columna `Acciones` + botón `Eliminar`

- Importar `canDeleteRetreatRegistration` de `@/lib/rbac/guards` (ya existe,
  sin cambios).
- `const canDelete = canDeleteRetreatRegistration(role)` tras el gate de
  página (`canManageRetreatRegistrations` no se toca).
- Nueva columna solo si `canDelete`:

```tsx
{canDelete && <TableHead>Acciones</TableHead>}
```

```tsx
{canDelete && (
  <TableCell>
    <Button
      variant="destructive"
      size="sm"
      aria-label={`Eliminar preinscripción de ${registration.name}`}
      onClick={() => void openDeleteDialog(registration)}
    >
      Eliminar
    </Button>
  </TableCell>
)}
```

(`variant="destructive"` y `size="sm"` existen en
`src/components/ui/button.tsx`; no se crea variante nueva.)

- `colSpan` del estado vacío pasa de `7` a `{canDelete ? 8 : 7}`.
- `openDeleteDialog(registration)` fija `deleteTarget` y el `deleteMode`
  inicial: `hasPayments ? 'both' : 'registration-only'`, resetea
  `deleteConfirmed` a `false`.

### 2.3. `Dialog` de confirmación

API Radix existente (`Dialog`, `DialogContent`, `DialogHeader`,
`DialogTitle`, `DialogDescription`, `DialogFooter` de
`src/components/ui/dialog.tsx`). Estado:

```ts
type DeleteMode = 'both' | 'payments-only' | 'registration-only'

const [deleteTarget, setDeleteTarget] = useState<RetreatRegistrationRow | null>(null)
const [deleteMode, setDeleteMode] = useState<DeleteMode>('both')
const [deleteConfirmed, setDeleteConfirmed] = useState(false) // 2ª confirmación, solo (a)
const [deleting, setDeleting] = useState(false)
```

(`deleteMode` cubre `'both' | 'payments-only'` del caso con pagos más
`'registration-only'` para la opción (c); valor inicial derivado de la suma.)

Opciones (radio explícito, mutuamente excluyentes, derivadas de la suma):

- Si `sumPaid > 0`: radio con exactamente (a) y (b). Nunca (c).
  - (a) `Eliminar preinscripción y pagos` (`value="both"`).
  - (b) `Eliminar solo los pagos, conservar la preinscripción` (`value="payments-only"`).
- Si `sumPaid === 0`: solo (c), sin radio (texto fijo + confirmación simple).
  - (c) `Eliminar la información de preinscripción` (`value="registration-only"`).

Doble confirmación solo para (a): con `deleteMode === 'both'`, el botón
destructivo principal queda deshabilitado hasta marcar un checkbox explícito
(`deleteConfirmed`), p. ej. "Entiendo que esta acción elimina la
preinscripción y sus pagos y no se puede deshacer". Alternativa aceptada por
la spec: segundo paso explícito (segundo diálogo). No se exige nombre
tipeado (D8). Opciones (b) y (c): confirmación simple, sin checkbox.

Cierre: `onOpenChange` cierra solo si `!deleting` (bloquea cierre accidental
durante la secuencia); al cerrar se limpian `deleteTarget`/`deleteMode`/
`deleteConfirmed`/`deleting`.

### 2.4. Secuencia de DELETEs + denegación silenciosa RLS

Cliente Supabase (`createClient()`), mismo patrón que `handleRecordPayment`.
Cada DELETE lleva `.select('id')` para detectar la denegación silenciosa RLS
(0 filas sin error):

```ts
async function handleConfirmDelete() {
  if (!deleteTarget || deleting) return
  if (deleteMode === 'both' && !deleteConfirmed) return
  setDeleting(true)
  const supabase = createClient()
  try {
    if (deleteMode === 'both' || deleteMode === 'payments-only') {
      const expected = paymentCountsByRegistration.get(deleteTarget.id) ?? 0
      const { data, error } = await supabase
        .from('retreat_payments')
        .delete()
        .eq('registration_id', deleteTarget.id)
        .select('id')
      if (error) throw error
      if (!data || data.length === 0) {
        toast.error('No tiene permisos para eliminar estos pagos')
        return
      }
      if (expected > 0 && data.length !== expected) {
        // Borrado parcial (p. ej. pagos concurrentes): recargar y reportar.
        await loadData()
        toast.error('El borrado fue parcial, revise los pagos restantes')
        return
      }
    }
    if (deleteMode === 'both' || deleteMode === 'registration-only') {
      const { data, error } = await supabase
        .from('retreat_registrations')
        .delete()
        .eq('id', deleteTarget.id)
        .select('id')
      if (error) throw error
      if (!data || data.length === 0) {
        // RLS denegó, o (c) con pagos concurrentes bloqueado por FK→error arriba.
        toast.error('No tiene permisos para eliminar esta preinscripción')
        return
      }
    }
    toast.success(deleteSuccessToast(deleteMode))
    setDeleteTarget(null) // cierra el diálogo
    await loadData()
  } catch {
    toast.error(deleteErrorToast(deleteMode))
  } finally {
    setDeleting(false)
  }
}
```

Orden obligatorio pagos → registro en (a) (FK sin `ON DELETE CASCADE`;
orden invertido = violación FK, verificado por test). En (b) solo DELETE de
pagos, ningún UPDATE del cliente (el trigger §1 recalcula `status`). En (c)
solo DELETE del registro; si aparecen pagos concurrentes el FK rechaza con
error → toast de error, nunca éxito.

## 3. Contratos de error/states

Estados: `deleteTarget` (`null` = diálogo cerrado), `deleteMode`,
`deleteConfirmed` (solo (a)), `deleting` (`true` bloquea cierre y botones).

| Caso | Toast exacto (ES) | `loadData()` | Diálogo |
| ---- | ----------------- | ------------ | ------- |
| (a) éxito | `Preinscripción y pagos eliminados` (success) | Sí | Se cierra |
| (b) éxito | `Pagos eliminados, preinscripción conservada` (success) | Sí | Se cierra |
| (c) éxito | `Preinscripción eliminada` (success) | Sí | Se cierra |
| Pagos: 0 filas (RLS denegó) | `No tiene permisos para eliminar estos pagos` (error) | No | Permanece abierto |
| Registro: 0 filas (RLS denegó) | `No tiene permisos para eliminar esta preinscripción` (error) | No | Permanece abierto |
| (a)/(b) error (red, FK, excepción) | `Error al eliminar los pagos` (error) | No | Permanece abierto |
| (a)/(c) error en DELETE del registro | `Error al eliminar la preinscripción` (error) | No | Permanece abierto |
| (c) bloqueado por pagos concurrentes (FK) | `Error al eliminar la preinscripción` (error) | No | Permanece abierto |
| Borrado parcial de pagos (conteo ≠ esperado) | `El borrado fue parcial, revise los pagos restantes` (error) | Sí | Permanece abierto |

Reglas: éxito + `loadData()` solo cuando las filas esperadas fueron
removidas; 0 filas o error → toast de error, sin éxito, sin presentar datos
como borrados (spec: Silent RLS Denial).

## 4. Matriz de paridad roles cliente ↔ SQL

Paridad literal exigida por spec (proposal R4): mismos dos roles en
`canDeleteRetreatRegistration` y en ambas `USING`.

| Rol | `canDeleteRetreatRegistration(role)` (cliente: botón/columna) | `retreat_registrations_delete` (SQL) | `retreat_payments_delete` (SQL) |
| --- | --- | --- | --- |
| `super_admin` | `true` — ve Eliminar | DELETE permitido | DELETE permitido |
| `leader` | `true` — ve Eliminar | DELETE permitido | DELETE permitido |
| `server` | `false` — sin botón ni columna | 0 filas (denegado) | 0 filas (denegado) |
| `anon` / sin sesión | `false` — sin affordance (página inaccesible) | 0 filas (sin policy anon) | 0 filas (sin policy anon) |
| Cualquier otro rol futuro | `false` (comparación directa, no `PermissionMap`) | 0 filas (`IN` no matchea) | 0 filas (`IN` no matchea) |

## 5. Plan de tests

### 5.1. Vitest — `src/lib/rbac/__tests__/guards.test.ts` (nuevo bloque)

```ts
describe('canDeleteRetreatRegistration', () => {
  it.each(['super_admin', 'leader'] as const)('returns true for %s', (role) => {
    expect(canDeleteRetreatRegistration(role)).toBe(true)
  })
  it.each(['server', 'member', 'viewer'] as const)('returns false for %s', (role) => {
    // + cualquier otro AppRole del union: todos false salvo los dos de arriba
    expect(canDeleteRetreatRegistration(role)).toBe(false)
  })
})
```

Ajustar la lista negativa al union real de `AppRole` en `types.ts` (fija
paridad con la matriz §4).

### 5.2. SQL — `supabase/tests/retreat_rls.test.sql` (extender, mismo patrón)

Mismo patrón existente: transacción + `SET LOCAL ROLE` + claims JWT +
`RAISE NOTICE 'PASS: ...'` / `RAISE EXCEPTION 'FAIL: ...'` + `ROLLBACK`
final, corrida con `ON_ERROR_STOP=1`.

| # | Caso | Setup | Assert |
| - | ---- | ----- | ------ |
| S1 | leader borra en orden pagos → registro | seed registro + 2 pagos como owner | ambos DELETE afectan filas; 0 filas remanentes |
| S2 | super_admin borra en orden pagos → registro | igual que S1 con otro seed | igual que S1 |
| S3 | `server` denegado | seed como owner; `SET LOCAL ROLE authenticated` + claim `server` | ambos DELETE afectan 0 filas |
| S4 | anon denegado | `SET LOCAL ROLE anon` | ambos DELETE afectan 0 filas |
| S5 | orden invertido viola FK | seed con pagos; DELETE del registro primero | excepción FK (`RAISE EXCEPTION` esperada capturada = PASS) |
| S6 | opción (b) resetea `status` | registro `inscrito` + pagos; DELETE solo pagos | registro existe con `status = 'preinscrito'` |
| S7 | total inválido + remanente → intacto | `app_settings retreat.youth.total_cost = ''`; borrado parcial dejando 1 pago | `status` sin cambios |
| S8 | auditoría | DELETE autorizado de pagos + registro | `audit_log` contiene filas de ambos (vía `log_mutation()`) |

S7 usa borrado parcial (un pago de dos) para ejercer la rama
"remanente > 0 + total inválido → RETURN OLD".

## 6. Estimación de líneas (Review Workload Guard)

| Unidad | Estimación |
| ------ | ---------- |
| `021_retreat_registration_deletes.sql` (header + grants + 2 policies + función + trigger + notify) | ~110 |
| `page.tsx` (columna + estados + Dialog + secuencia + toasts) | ~150 |
| `guards.test.ts` (bloque nuevo) | ~30 |
| `retreat_rls.test.sql` (8 casos S1–S8) | ~80 |
| **Total estimado** | **~370 ≤ 400 → UN solo PR** |

Sin partición en 2 PRs (el trigger owner-side evita el UPDATE de cliente y
mantiene el diff bajo el presupuesto; proposal R8 contemplaba partir solo si
excedía).
