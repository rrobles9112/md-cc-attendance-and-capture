# Design — fix-retiro-costo-total (option c)

> Store: `openspec` · Change: `fix-retiro-costo-total`
> Upstream (read): `openspec/changes/fix-retiro-costo-total/proposal.md` §1–§13,
> `openspec/changes/fix-retiro-costo-total/specs/youth-retreat-payments/spec.md` (ADDED + MODIFIED),
> `openspec/changes/fix-retiro-costo-total/explore.md` §2–§9.
> Skills applied: `supabase` (RLS / TO-clause / advisors / security checklist §6),
> `supabase-postgres-best-practices` (`INSERT ... ON CONFLICT` requires `FOR INSERT` policy).
> Scope: design only — no implementation in this phase.
> Sibling boundary: `fix-retiro-responsive-table` owns T2 table overflow; this design has zero table-layout changes.

## 1. Decision recap (option c, from proposal §6)

Implement **all three together** — migration + explicit `onConflict` + coded errors + anti-double-click guard —
keeping `upsert` as the write path (no update-first rewrite as primary; documented only as deploy-window fallback):

1. Additive SQL migration: `FOR INSERT TO authenticated WITH CHECK (super_admin)` on `public.app_settings`.
2. `src/lib/settings/app-settings.ts`: `upsert(..., { onConflict: 'key' })` + typed error mapping, public signatures unchanged.
3. `handleSaveCost` in `src/app/(dashboard)/retreat-registrations/page.tsx`: sync ref guard + coded toasts, no layout change.
4. RED tests first (vitest unit + SQL policy test), then GREEN.

Why not (a) or (b) alone: (a) alone leaves fragile inferred conflict target and generic errors (fails ODD coded-message
criterion); (b) alone still needs the INSERT policy for first-write of new keys and adds an update/insert race.
Combined cost is ~120–180 lines, inside the 400-line `ask-on-risk` budget.

## 2. Data flow (target state)

```text
Cost card (super_admin only, gated by canManageUsers(role))
  └─ handleSaveCost: normalize → validate → ref-guard → setRetreatTotalCost(normalized)
       └─ setSetting(key, value): getSession (else 'Not authenticated')
            └─ supabase.from('app_settings').upsert(payload, { onConflict: 'key' })
                 └─ PostgREST → INSERT ... ON CONFLICT (key) DO UPDATE
                      ├─ RLS FOR INSERT TO authenticated WITH CHECK (user_role()='super_admin')  ← NEW
                      ├─ existing app_settings_select (super_admin read) + app_settings_update (super_admin) — untouched
                      └─ error → typed code → coded toast; success → toast + loadData() → Saldo/% from 480000
```

Current code baseline (verified): `app-settings.ts` calls single-arg `upsert({...})` and `throw error` raw;
`handleSaveCost` (page.tsx l.366–382) uses only `savingCost` state + generic `"Error al guardar el costo total"`;
no `FOR INSERT` policy exists on `app_settings` in migrations `001`–`023` (only SELECT in 001, UPDATE in 001/006);
`003` grants table-level DML to `anon`/`authenticated` (API access, not RLS). Reference pattern for the fix:
`scripts/retreat/seed-cohort.ts:93` already uses `upsert({...}, { onConflict: 'key' })`.

## 3. File change 1 — additive SQL migration

### 3.1 New migration file

- Path: `supabase/migrations/0XX_app_settings_insert_super_admin.sql` (number assigned via `supabase migration new`
  under the imperative workflow; never hand-invent the timestamp prefix — create with the CLI, then fill in).
- Nature: **additive only**. No `ALTER TABLE`, no changes to existing SELECT/UPDATE policies, no seed/backfill change
  (`011` intact), RLS stays enabled (from `001`).

### 3.2 Canonical statement

```sql
-- 0XX_app_settings_insert_super_admin.sql
-- Fix T1: allow client upsert (INSERT ... ON CONFLICT DO UPDATE) for super_admin.
-- PostgREST upsert evaluates the INSERT branch first, so it requires a FOR INSERT
-- policy even when the row already exists. Existing SELECT/UPDATE policies untouched.
CREATE POLICY "app_settings_insert_super_admin"
ON public.app_settings
FOR INSERT
TO authenticated
WITH CHECK ((SELECT public.user_role()) = 'super_admin');
```

Notes (normative for implementer):

- `FOR INSERT` carries **only `WITH CHECK`, no `USING`** (Postgres does not apply `USING` to INSERT).
- Predicate is exactly `user_role() = 'super_admin'`, schema-qualified and SELECT-wrapped
  `((SELECT public.user_role()) = 'super_admin')` per performance/security best practice (init-once per statement,
  consistent with `017` style); semantically identical to the proposal §8.1 form.
- `user_role()` itself is **not** changed in this change (007 version stays: prefers JWT `app_metadata.role`,
  falls back to `profiles.role`; `SECURITY DEFINER SET search_path = ''`).
- **Never**: `TO anon`, `TO public`, `WITH CHECK true`, `USING true`, or `SECURITY DEFINER` helpers to "fix" permissions.
- Do **not** convert existing bare-role policies (001/006) to `TO`-clause form in this change — out of scope, adds diff.

### 3.3 Rollback

```sql
DROP POLICY IF EXISTS "app_settings_insert_super_admin" ON public.app_settings;
```

Effect of rollback: returns to 001/006 state; original symptom returns (upsert denied 42501) but no data loss
(the old row value stays). Code revert is a plain commit revert (2 client files, isolated hunks).

### 3.4 Advisors + security checklist (mandatory before `db pull` commit)

1. `supabase db advisors` (CLI ≥ v2.81.3, else MCP `get_advisors`) — fix any finding; record output in tasks/implement.
2. Skill `supabase` §6 checklist for this migration:
   - RLS enabled on `public.app_settings` (yes, since 001) — do not disable.
   - `TO authenticated` present (new deprecation rule: never `auth.role() = 'authenticated'`; also never bare
     `TO authenticated` without a row predicate — ours has the `super_admin` WITH CHECK, so no BOLA/IDOR).
   - No `SECURITY DEFINER` touched; no views touched (no `security_invoker` concern).
   - UPDATE-still-needs-SELECT invariant holds via existing `app_settings_select` — verified, no action.
   - `003` anon-DML grant acknowledged: the new policy explicitly excludes `anon` (see SQL test §6.2).
3. Commit flow (imperative project): `supabase migration new <name>` → apply/iterate via `execute_sql` or
   `supabase db query` (not `apply_migration` per-iteration) → `supabase db pull <name> --local --yes` →
   `supabase migration list --local` → advisors.

## 4. File change 2 — `src/lib/settings/app-settings.ts`

### 4.1 Upsert with explicit conflict target

Change only the `upsert` call inside `setSetting` (current l.16–36):

```ts
const { error } = await supabase
  .from('app_settings')
  .upsert(
    {
      key,
      value,
      updated_by: session.user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  )
```

- Payload fields unchanged (`key/value/updated_by/updated_at`); PK is `key TEXT` (001), so `onConflict: 'key'`
  matches the `seed-cohort.ts:93` reference pattern and removes PostgREST inference fragility.
- `getSetting` untouched (keeps `PGRST116`-tolerant `null` return; the `PGRST116` mention in proposal §8.2 is
  informational for `get`, not a swallow in `set`).

### 4.2 Typed error mapping (no signature changes)

Public signatures **unchanged**: `setSetting(key: string, value: string): Promise<void>`,
`getSetting`, `setRetreatTotalCost`, `getRetreatTotalCost` keep exact types so
`retreat-registrations/page.tsx` and `admin/page.tsx` compile untouched (`npx tsc --noEmit` green).

Mapping contract for `setSetting` rejection (thrown Error carries a machine-readable `code` property;
message stays human-readable; UI switches on `code`):

| Source error | Typed code | Message hint (ES, UI renders final text) |
| --- | --- | --- |
| `{ code: '42501' }` (RLS denial) | `permission-denied` | role review / re-login (stale JWT after role grant) |
| fetch/network failure, no `code` (`TypeError: fetch failed`, `Failed to fetch`, `NetworkError`) | `network` | connection |
| no session (`getSession()` → null) | `Not authenticated` (existing string, preserved) | session |
| anything else | rethrow original error object unchanged | generic fallback in UI |

Implementation sketch (design intent, not final code):

```ts
// after upsert:
if (error) {
  const code = (error as { code?: string }).code
  if (code === '42501') throw Object.assign(new Error('permission-denied: super_admin required (re-login if role was just granted)'), { code: 'permission-denied', cause: error })
  throw error // non-42501 DB errors pass through raw
}
// network failures surface as thrown TypeError from the client — catch, detect, rethrow typed:
catch (e) {
  if (e is fetch/network failure without code) throw Object.assign(new Error('network'), { code: 'network', cause: e })
  throw e
}
```

Rules: (i) `42501` detection is strictly by `code === '42501'`, never by message substring;
(ii) network detection is absence-of-code + fetch-like name/message (`TypeError`, `/fetch|network|Failed to fetch|Load failed/i`);
(iii) never swallow `PGRST116` in `set` path; (iv) `cause` chains the original for logs.

### 4.3 Shared-path regression (`admin/page.tsx` DPO email)

`handleSaveDpoEmail` (`setSetting('dpo_contact_email', ...)`) gets **zero code changes**; it inherits
`onConflict:'key'` + typed errors automatically. Its generic `toast.error('Error al guardar')` stays as-is
(no UI change there — spec requires only that the save path keeps working under the same behavior).
Regression is covered by unit mapping tests (§6.1) + manual DPO smoke (§7 step 6).

## 5. File change 3 — `handleSaveCost` (page.tsx l.366–382)

### 5.1 Sync ref anti-double-click guard

Root cause (proposal §5.6): `setSavingCost(true)` is async React state — a second click before re-render
re-enters `handleSaveCost` and fires a second write → double error toast. Fix: a synchronous ref checked-and-set
before any `await`, in addition to the existing `disabled={savingCost}`.

Design (additive, ~10 lines, no visual/layout change):

```tsx
// imports: add useRef to the existing react import (line 3 area)
import { useCallback, useEffect, useRef, useState } from "react";
// inside component, next to `const [savingCost, setSavingCost] = useState(false)` (l.192):
const savingCostRef = useRef(false);

async function handleSaveCost() {
  if (savingCostRef.current) return;          // sync guard — second activation is a no-op
  const normalized = normalizeRetreatCostInput(costDraft);
  if (parsePositiveTotal(normalized) === null) {
    toast.error("El costo debe ser un número positivo");
    return;
  }
  savingCostRef.current = true;               // set BEFORE first await
  setSavingCost(true);
  try {
    await setRetreatTotalCost(normalized);
    toast.success("Costo total del retiro actualizado");
    await loadData();
  } catch (e) { /* coded toasts §5.2 */ }
  finally {
    savingCostRef.current = false;            // reset AFTER completion
    setSavingCost(false);
  }
}
```

Constraints: validation-failure early return happens **before** setting the ref (so a later valid click still works);
`finally` always resets (no stuck-disabled state); `Button` keeps `onClick={() => void handleSaveCost()}`
and `disabled={savingCost}` exactly as today.

### 5.2 Coded toasts

Replace the single generic `toast.error("Error al guardar el costo total")` with a code switch on the typed
error from §4.2 (read `(e as { code?: string }).code`):

- `permission-denied` → `toast.error("Sin permisos para guardar el costo (requiere super_admin). Verifique su rol o vuelva a iniciar sesión.")`
- `network` → `toast.error("Sin conexión. Verifique su red e intente de nuevo.")`
- `Not authenticated` (message match, preserved string) → `toast.error("No hay una sesión activa")`
  (consistent with `recordPayment` l.400 wording in the same file).
- default → `toast.error("Error al guardar el costo total")` (existing generic kept as fallback).
- Success path verbatim: `toast.success("Costo total del retiro actualizado")` + `await loadData()`.

### 5.3 Explicit non-changes (T2 boundary, normative)

Zero hunks touching: table markup/classes (`overflow-x-clip`, `sticky`, `hidden sm/md/lg:table-cell`, `w-56/md:w-64`),
`colSpan`/`mutationColSpan`, `src/components/ui/table.tsx`, toolbar/tabs/pagination/search, payment/transfer/delete
logic, `loadData` query shape, cost-card copy/layout (`CardContent className="space-y-2"`, `flex flex-col gap-2 sm:flex-row`).
Verification: table-class grep over the diff must return empty (§7 step 7).

## 6. RED test design (strict TDD — specified here, implemented in tasks/implement)

All RED tests MUST fail on current code and pass after the fix. Runners from `openspec/config.yaml`:
`npx vitest`, `npx tsc --noEmit`, `npx playwright test` (e2e deferred, §6.3).

### 6.1 Vitest unit — `src/lib/settings/__tests__/app-settings.test.ts` (extend, keep existing l.63–82 assertion)

Setup reuse: existing `mockFrom`/`mockGetSession`/`mockUpsert` harness; `mockFrom.mockReturnValue({ upsert: mockUpsert })`.

- **T-UNIT-1 `onConflict` explicit (RED today: single-arg upsert call):**
  `await setRetreatTotalCost('480000')` (or `setSetting('retreat.youth.total_cost','480000')`) with authed session
  → assert `mockUpsert` called with `(expect.objectContaining({ key, value: '480000', updated_by: 'user-1' }), { onConflict: 'key' })`
  — i.e. assert the **second argument** equals `{ onConflict: 'key' }`. Keep payload assertion (regression).
- **T-UNIT-2 `42501 → permission-denied`:** `mockUpsert.mockResolvedValue({ error: { code: '42501', message: 'new row violates row-level security policy' } })`
  → `await expect(setSetting(...)).rejects.toMatchObject({ code: 'permission-denied' })`.
- **T-UNIT-3 `network → network`:** `mockUpsert.mockRejectedValue(new TypeError('fetch failed'))`
  (plus a `Failed to fetch` DOMException-style case) → rejects `toMatchObject({ code: 'network' })`.
- **T-UNIT-4 `no session preserved`:** `mockGetSession.mockResolvedValue({ data: { session: null } })`
  → rejects `Not authenticated`; assert `mockUpsert` **not** called.
- **T-UNIT-5 (regression, GREEN both sides):** DPO key path `setSetting('dpo_contact_email','x@y.z')` uses same
  `onConflict:'key'` + same mapping (one 42501 case through the DPO key suffices; no admin-page UI test).

Guard-note: the ref guard itself is intentionally **not** unit-tested at `app-settings` level (it lives in the page
component); its contract is covered by the scenario in spec §"Single Write on Double Activation" and verified
manually/by deferred e2e — keeps unit file small for the 400-line budget.

### 6.2 SQL policy test — `supabase/tests/app_settings_insert.test.sql` (new)

Harness: follow `supabase/tests/retreat_rls.test.sql` l.1329 / `retreat_valientes_transfer.test.sql` l.55
(`SET LOCAL ROLE authenticated` + `SET LOCAL request.jwt.claims` with `app_metadata.role`).
Statement under test (client-equivalent):
`INSERT INTO public.app_settings(key,value) VALUES ('__t1','480000') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`
(use `__t`-prefixed keys + cleanup `DELETE` so the test is idempotent and never touches `retreat.youth.total_cost`).

- **T-SQL-1 `super_admin` succeeds (RED today — no FOR INSERT policy → 42501; GREEN after migration).**
  claims: `{"sub":"...","role":"authenticated","app_metadata":{"role":"super_admin"}}`.
- **T-SQL-2 `leader` denied 42501, value unchanged** (claims `app_metadata.role = leader`; assert `SQLSTATE 42501`
  via `EXPECT`/`ASSERT` per repo harness idiom and re-select old value).
- **T-SQL-3 `anon` denied** (`SET LOCAL ROLE anon`; same statement → denied; value unchanged — proves §3.4 checklist item).
- **T-SQL-4 (optional, cheap) no-claim authenticated denied:** JWT without `app_metadata` → denied (documents the
  desync-sensitive path; passes regardless of `profiles` fallback for a `__t` key owned by nobody).

### 6.3 Deferred e2e — `e2e/retreat-cost.spec.ts` (NOT in first slice unless budget allows)

Playwright chromium: login `super_admin` → set `480000` → assert success toast + recalculated Saldo;
simulated RLS denial → assert specific permission message; rapid double-click → single write assertion.
Per `ask-on-risk`: implement only if `git diff --stat` still ≤ 400 with it; otherwise defer and ask (no invented
chain, no silent `size:exception`).

## 7. Verification plan (strict order — normative)

1. **`supabase/diagnose_user_role.sql` FIRST (blocking).** Run in the repro env (Supabase Dashboard → SQL Editor),
   paste full output: `user_role()` def (007 active?), `user_role()` with super_admin JWT, without `app_metadata`,
   `profiles.role` vs `auth.users.raw_app_meta_data`, applied migrations. If desync (JWT lacks `app_metadata.role`
   or profile row missing/wrong): re-sync role (refresh JWT after grant) and re-run before validating anything —
   without this, neither migration nor code can fix the save. Do **not** change `user_role()` in this change.
2. **Manual repro baseline (pre-fix):** login `super_admin` → set `480000` → confirm generic error toast + Saldo
   still `400.000,00` (explore baseline).
3. **RED:** add tests §6.1–§6.2, run `npx vitest` + SQL harness → confirm T-UNIT-1/2/3 and T-SQL-1 fail as specified.
4. **GREEN:** implement §3–§5 → `npx vitest` green → `npx tsc --noEmit` green.
5. **Post-fix manual:** save `480000` as `super_admin` → persists (`app_settings` row `value='480000'`) → reload shows
   new Saldo/% → payments unblocked (`isRetreatPaymentBlocked` false) → Valientes transfer no longer `missing_total`
   (up to fixture state). Negative checks: simulated 42501 → permission toast; offline → network toast;
   rapid double-click → exactly one write / one toast.
6. **Regression smoke:** `admin/page.tsx` → settings tab → save DPO email → persists via same path.
7. **Advisors + budget gates:** `supabase db advisors` clean; `git diff --stat` vs 400 lines —
   if exceeded, **pause and ask** per `ask-on-risk` preflight (no chain invention, no `exception-ok` inference);
   table-class grep (`overflow-x-clip|sticky|hidden sm:table-cell|hidden md:table-cell|hidden lg:table-cell|w-56|w-64|colSpan`)
   over the diff returns empty.

## 8. Rollout, rollback, success criteria

- **Rollout:** single PR (default `ask-on-risk` posture; chain strategy deferred — not selected).
  Order inside PR: migration first, then client, then tests (tests land with the fix per TDD, RED demonstrated in CI history or task log).
- **Rollback:** code = commit revert; DB = `DROP POLICY` (§3.3). No destructive migrations, no backfill, no seed change.
- **Success criteria (from proposal §12, binding):** 480000 persists + Saldo/% reload; 42501 → permission message;
  network → connection message; double-click → single toast; `vitest` + `tsc` green; SQL super_admin green,
  leader/anon denied; diff ≤ 400 or `ask-on-risk` decision recorded; zero table-layout diff; DPO email still saves.

## 9. Traceability

- Root cause chain: explore §2–§3 (upsert→INSERT-branch→missing FOR INSERT→42501; 003 grant ≠ RLS; UPDATE-path tests mask it).
- Desync guard: explore §4 + proposal §7.1 → verification step 1 here.
- Double toast: explore §6 + proposal §5.6 → §5.1 here.
- Seed/downstream (`missing_total`, guards 011, RPC 014/022): explore §7 → data-flow + verification step 5.
- Spec coverage: every ADDED/MODIFIED requirement in `specs/youth-retreat-payments/spec.md` maps to §3 (INSERT policy),
  §4 (persistence/onConflict/mapping/signatures/DPO), §5 (single-write/coded toasts), §6 (RED contracts), §5.3 (zero-layout).
- Fallback (deploy window forbids migration): update-first + insert-on-PGRST116, documented limitation that first-write
  of new keys stays broken without the policy — needs explicit scope decision, not silent substitution.
