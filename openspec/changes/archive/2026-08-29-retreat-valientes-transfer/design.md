# Design: Retreat Valientes Transfer

> **Change:** `retreat-valientes-transfer`  
> **Artifact store:** `openspec` — `openspec/changes/retreat-valientes-transfer/design.md` + Engram `sdd/retreat-valientes-transfer/design`  
> **Upstream:** `explore.md` (#102), `proposal.md`, `specs/retreat-valientes-transfer/spec.md` (7 reqs), migrations `001`, `011`, `013`, `src/app/(dashboard)/retreat-registrations/page.tsx`, `src/app/(dashboard)/members/page.tsx`, `src/lib/retreat/*`  
> **Date:** 2026-08-27  
> **Mode:** `strict_tdd=true`, `artifact_store=openspec`, `RDD ON` — **tier High, 4 lenses** (`risk`, `resilience`, `readability`, `reliability`), budget `min(200, ceil(changed_lines/2))` capped 200  
> **Stack:** Next.js 15.5.22 / TypeScript 5.8.3 strict / Supabase Postgres 15 + `@supabase/ssr` 0.6.1 + `supabase-js` 2.112.0 / Dexie 4.0.11 / `xlsx` SheetJS 0.20.3 / `libphonenumber-js` 1.12.15 / Vitest 3.2.1 jsdom / Playwright 1.62.1  

---

## 1. Technical Approach

Five pillars, one atomic transaction, zero widening of existing RLS surfaces.

### 1.1 Pillar 1 — Idempotent RPC `transfer_retreat_to_valientes(p_registration_id uuid) RETURNS uuid`

`LANGUAGE plpgsql SECURITY DEFINER SET search_path=''` in `public`. `REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO authenticated` only. Internal gate `public.user_role() IN ('leader','super_admin')` else `42501`. Row-level serialization via `SELECT ... FROM public.retreat_registrations WHERE id=p_registration_id FOR UPDATE` — second concurrent leader blocks on row lock, then observes `transferred_at IS NOT NULL` and receives `23505 already_transferred` without creating a second `members` row.

Gating (order is normative — audit before money):

1. `user_role` gate (`42501`)
2. `FOR UPDATE` + existence (`P0002`)
3. `transferred_at IS NOT NULL` guard (`23505 already_transferred`)
4. `app_settings.retreat.youth.total_cost` validation: `NULL`/`''`/non-numeric/`<=0` → `23514 missing_total` (mirrors `retreat_payments_guard_total`)
5. `COALESCE(SUM(amount),0)` per `registration_id` + `status <> 'inscrito'` check → `23514 not_inscrito` (fresh SUM, not trusting stale `status` alone; defends against status desync and race with `retreat_payments_apply_status` trigger)
6. Duplicate pre-check `already_member` (`23505`) before any write, plus `EXCEPTION WHEN unique_violation THEN already_member` for race
7. Branch on `member_id` (see 1.2)
8. `UPDATE retreat_registrations SET transferred_at=now(), transferred_member_id=:new_id, transferred_by=auth.uid()` + `RETURN new_id`

No trigger auto-transfer (`B` rejected), no bulk RPC (`C` follow-up), no Dexie/realtime, online-only.

### 1.2 Pillar 2 — G1 `TEXT` — `members.pastoral_group` nullable

No `groups` table, no `member_groups` junction in V1. Additive:

```sql
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS pastoral_group TEXT
  CHECK (pastoral_group IS NULL OR char_length(btrim(pastoral_group)) > 0);
COMMENT ON COLUMN public.members.pastoral_group IS
  'Pastoral attendance group; Valientes for retreat graduates. NULL until transfer. G1; G2 junction deferred.';
CREATE INDEX IF NOT EXISTS members_pastoral_group_idx
  ON public.members(pastoral_group) WHERE pastoral_group IS NOT NULL;
```

- `CHECK` is open (`char_length>0`), not `IN ('Valientes')`, so future groups (`Jóvenes`, etc.) need no migration.
- Partial index `WHERE pastoral_group IS NOT NULL` — selective, low write amplification (partial indexes rule per `supabase-postgres-best-practices`).
- Pre-existing rows remain `NULL` (no backfill, no `NOT NULL`, no `UNIQUE`).
- `members_update` policy stays `super_admin`-only. `pastoral_group` is writable **only** via the definer RPC — direct PostgREST `UPDATE members SET pastoral_group` by `leader` fails closed (verified by `retreat_rls.test.sql` extension). `G2` (`groups`+`member_groups` junction) is documented as evolution path in `COMMENT` and `§11`.
- `G3` (reuse `community_name_encrypted`/`denomination`) rejected — wrong semantics (religious community vs pastoral attendance group).

Branch semantics:

| `retreat_registrations.member_id` | Action | Members mutation | `transferred_member_id` |
|---|---|---|---|
| `IS NOT NULL` (origin 013 — member→retreat) | `UPDATE public.members SET pastoral_group='Valientes' WHERE id=member_id` | 0 inserts, 1 update (definer bypass) | `= member_id` |
| `IS NULL` (anon `/retiro` row) | `INSERT INTO public.members (...) pastoral_group='Valientes'` | 1 insert | `= RETURNING id` |

If linked member already `pastoral_group='Valientes'`, the RPC returns `23505 already_transferred` (idempotency wins over silent overwrite). Duplicate `email`/`phone` against another member → `23505 already_member` (rejected, with `Ver miembro` link).

### 1.3 Pillar 3 — Server-side Pagination + Indexed Search

Replaces the current unpaginated load in `retreat-registrations/page.tsx` (`Promise.all` of `select(...).order('name')` over full tables — §1 of explore):

```ts
// normative query contract
const from = (page - 1) * pageSize; // page 1-indexed
const to   = from + pageSize - 1;    // inclusive
let q = supabase.from('retreat_registrations')
  .select('id,name,email,phone,birthday,is_minor,legal_rep_name,status,created_at,transferred_at,transferred_member_id,member_id',
          { count: 'exact' })
  .eq('event_key', RETREAT_EVENT_KEY)
  .order('name', { ascending: true })
  .range(from, to)
if (tab !== 'todos') q = q.eq('status', tab)        // tabs: Todos / Preinscritos / Inscritos (see §4.4)
if (search.trim())   q = q.or(`name.ilike.%${esc(search)}%,email.ilike.%${esc(search)}%,phone.ilike.%${esc(search)}%`)
```

- `pageSize ∈ {20,50}`, default `20`.
- `search` debounced `≥300ms`, escaped (`%`, `,`, `\` via PostgREST `.or` encoding; spec normative `name.ilike.%ana%,email.ilike.%ana%,phone.ilike.%ana%`).
- Payments for visible IDs only (no full scan):

```ts
const ids = regs.map(r => r.id) // visible page only
const { data: pays } = ids.length
  ? await supabase.from('retreat_payments')
      .select('registration_id,amount,created_at')
      .in('registration_id', ids)
      .order('created_at')
  : { data: [] }
const sums = sumPaidByRegistration(pays) // existing helper src/lib/retreat/payments.ts
```

- UI footer `Mostrando X–Y de N` + `Página X de Y` + `Prev/Next`; badge `Transferido ✓` with `transferred_at` tooltip; columns `Nombre, Email, Teléfono, Estado, Pagado, Saldo, % Pagado, Último abono, Acciones` (expanded per abonos report §1.5).
- Backing indexes in migration `014` (all `IF NOT EXISTS`, no `CONCURRENTLY` inside transaction — per PG rule):

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS retreat_registrations_search_trgm_idx
  ON public.retreat_registrations USING gin ((lower(name) || ' ' || lower(email) || ' ' || phone) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS retreat_registrations_status_idx ON public.retreat_registrations(status);
CREATE INDEX IF NOT EXISTS retreat_registrations_event_status_idx ON public.retreat_registrations(event_key, status);
CREATE INDEX IF NOT EXISTS retreat_registrations_created_at_idx ON public.retreat_registrations(created_at);
CREATE INDEX IF NOT EXISTS retreat_payments_registration_id_created_at_idx
  ON public.retreat_payments(registration_id, created_at DESC);
```

`pg_trgm` GIN accelerates `ILIKE '%substr%'` (PostgREST `ilike` → `ILIKE`). `status`+`event_key,status` btree supports tab filtering + `count:'exact'`. Client pagination is forbidden — server `range` is normative per spec Requirement 4.

### 1.4 Pillar 4 — Excel on-demand (Client SheetJS) + Print

Pure helpers `src/lib/retreat/export.ts` reusing `src/lib/export/generate.ts` pattern (`XLSX.utils.json_to_sheet → book_new → book_append_sheet → write({bookType:'xlsx',type:'array'}) → Blob → downloadBlob`):

```ts
export type RetreatReportRow = {
  Nombre: string; Teléfono: string; Email: string; FechaNacimiento: string;
  EsMenor: string; RepresentanteLegal: string; Estado: string;
  Pagado: string; Saldo: string; PorcentajePagado: string; TotalRetiro: string;
  CantidadAbonos: number; ÚltimoAbono: string;
  TransferidoAValientes: string; FechaTransferencia: string;
}
export function buildReportRows(
  registrations: RetreatRegistration[], payments: RetreatPayment[], totalCost: string | null
): RetreatReportRow[]
export function exportRetreatToXLSX(rows: RetreatReportRow[], filename: string): void
export function exportRetreatToCSV(rows: RetreatReportRow[], filename: string): void
```

- `buildReportRows` is pure: derives `Pagado=SUM`, `Saldo=total-Pagado` (empty when `totalCost` null/non-numeric), `%=Pagado/total*100`, `Cantidad=COUNT`, `Último=MAX(created_at)` formatted `es-CO`, `Transferido='Sí'|'No'`, header `Evento: retiro-juvenil-octubre-2026 | Generado: es-CO dd-MM-yyyy HH:mm` as first row.
- Two toolbar buttons: `Exportar estado de pago (todos)` (respects current `tab`+`search`, no `range`) and `Exportar inscritos` (forces `status='inscrito'` override). Filenames `retiro-estado-pago-YYYY-MM-DD.xlsx` / `retiro-inscritos-YYYY-MM-DD.xlsx`.
- **Chunked fetch** to defeat PostgREST `max_rows` (default `1000`): loop `range(offset, offset+999)` until `data.length < 1000`, concatenate, then single workbook. normative `1500 rows → 2 fetches (0–999 + 1000–1999→500) → 1500 sheet rows`.
- Print: `window.print()` + CSS `@media print { nav,.no-print{display:none} tr{break-inside:avoid} @page{margin:1cm} .print-header{display:block} }` with header `Confidencial Ley 1581 — Uso interno MD CC — Evento: retiro-juvenil-octubre-2026 — Generado: es-CO` visible only in print.
- Offline/session: both exports and print `disabled title="Requiere conexión"` when `!navigator.onLine || !hasSession`; no fetch attempted; gate `canManageRetreatRegistrations` + RLS.

Server-side `POST /api/retreat/report` (`D2`) is a V1 follow-up (deferred).

### 1.5 Pillar 5 — Abonos Real-time Aggregated Report

Time-real, no materialized view in V1, same pagination + chunked export scope:

```sql
-- per-row aggregates (client sumPaidByRegistration or optional view)
total_paid      = COALESCE(SUM(amount),0)
remaining       = CASE WHEN total IS NULL THEN NULL ELSE total - total_paid END
percent         = CASE WHEN total IS NULL OR total=0 THEN NULL ELSE total_paid/total*100 END
payment_count   = COUNT(id)
last_payment_at = MAX(created_at)
```

Optional view (normative `WITH (security_invoker=true)` — PG15 RLS rule, otherwise views bypass RLS by default per `supabase` skill):

```sql
CREATE OR REPLACE VIEW public.retreat_registration_with_payments
WITH (security_invoker = true) AS
SELECT rr.*, COALESCE(SUM(p.amount),0) AS total_paid,
       COUNT(p.id) AS payment_count, MAX(p.created_at) AS last_payment_at
FROM public.retreat_registrations rr
LEFT JOIN public.retreat_payments p ON p.registration_id = rr.id
GROUP BY rr.id;
```

- UI: expanded columns (`Pagado/Saldo/%/Cant/Último`) in main table plus footer `Total preinscritos | Inscritos | Suma abonos | Pendiente (=N*total-Suma)` or dedicated tab `Reporte de abonos` — same live data.
- `retreat_payments_apply_status` trigger already updates `status`; next fetch reads fresh `SUM`. No stale aggregate after insert; `total==NULL` shows `Pagado/Cantidad/Último` with `Saldo/%` empty `—`.

### 1.6 End-to-end Data Flow

```
Retreat page load (leader)
  ├─ leader JWT → Supabase PostgREST
  │   ├─ app_settings[retreat.youth.total_cost] → parsePositiveTotal
  │   ├─ retreat_registrations.count:exact + range + eq(event_key) + [eq(status)] + [or ilike] + order(name)
  │   └─ retreat_payments.in(visibleIds) → sumPaidByRegistration
  └─ UI state: tab/search/page/pageSize/totalCount → columns + footer

Transfer flow (online, inscrito, not yet transferred, explicit checkbox checked)
  click Transferir a Valientes → Dialog confirm (Ley 1581 note §6 + checkbox required)
    → supabase.rpc('transfer_retreat_to_valientes', {p_registration_id})
        SECURITY DEFINER tx:
          user_role() gate
          SELECT FOR UPDATE lock row
          transferred_at guard
          totalCost validation
          SUM(amount) gate
          duplicate EXISTS + branch INSERT/UPDATE
          UPDATE retreat_registrations.transferred_*
          RETURN new_members.id
    → success: toast "Transferido a Valientes" + action Ver miembro + badge Transferido ✓ + invalidate page query
    → failure 23505 already_transferred: toast "Ya fue transferido DD/MM/YYYY"
    → failure 23505 already_member: toast "Ya existe miembro con ese email/teléfono" + link Ver miembro
    → failure 23514 not_inscrito / missing_total: toast descriptive

Export flow
  Exportar estado de pago → loop range(0,999)+... with current filters (no pagination limit)
    → chunked retreat_registrations + chunked retreat_payments.in(allIds)
    → buildReportRows(pure) → exportRetreatToXLSX → downloadBlob
```

---

## 2. Requirement → Decision Traceability

| Spec Requirement | Decision | Why | Verified by |
|---|---|---|---|
| **R1 Transfer Eligibility Gate** (`status='inscrito'`, `transferred_at IS NULL`, explicit Ley 1581 checkbox) | **D-GATE** in `retreat-registrations/page.tsx` + **D-RPC** gate (6 checks before write) + client checkbox state `checked` required to enable `Transferir`; server re-validates without trusting client | Payment equality `SUM >= total` as `inscrito` is necessary+sufficient for full-paid, per 011 trigger; explicit checkbox satisfies Ley 1581 purpose separation (retreat→membership). Stale `status` not trusted — fresh `SUM` re-derived inside RPC. | Vitest `payments.test.ts` gating + `guards-transfer.test.ts`, Supabase `retreat_rls.test.sql` `23514 not_inscrito/missing_total`, Playwright `transfer-dialog-checkbox.spec` |
| **R2 Idempotent Transfer RPC with Concurrency Safety** (`SECURITY DEFINER SET search_path`, `FOR UPDATE`, branches `INSERT` vs `UPDATE`, `23505/23514/P0002/42501`, `unique_violation→already_member`) | **AD-002** RPC + **AD-001** DDL `transferred_*` columns + `FOR UPDATE` lock; `INSERT` vs `UPDATE` branch on `member_id IS NULL` vs `NOT NULL`; `REVOKE/GRANT authenticated` | Single transaction avoids RLS widening and split-brain; `FOR UPDATE` serializes two leaders on same row; `transferred_*` + FKs provide idempotency guard and audit; definer bypass needed because `members_update` is `super_admin`-only. Phone E164 via `normalizeE164`/`libphonenumber-js` CO default; sensitive fields via `pgp_sym_encrypt` + `vault.decrypted_secrets`. | Supabase tests: leader success new/origin, second call `already_transferred`, duplicate `already_member`, anon/server `42501`, concurrent `FOR UPDATE`; Vitest `export.test.ts` for row mapping |
| **R3 Valientes Pastoral Group Field** (`pastoral_group TEXT CHECK open`, partial index, no backfill, no `groups` table) | **AD-001** `ALTER TABLE members ADD COLUMN pastoral_group TEXT` + `CHECK ...` + `COMMENT` + partial index `WHERE pastoral_group IS NOT NULL` | G1 KISS: one column, one index, one filter. `groups`/`member_groups` `G2` deferred (migration cost 3 tables+RLS+JOIN) — V1 data says one group per person today. Open `CHECK` allows evolution without migration. | Supabase test: `information_schema.columns` column exists, all existing `pastoral_group IS NULL`, index `pg_indexes WHERE indexname='members_pastoral_group_idx'`, query `eq('pastoral_group','Valientes')` returns correct | 
| **R4 Paginated Indexed Retreat Table** (`range(count:'exact')`, tabs, debounced `or ilike`, `pg_trgm` GIN + btree(status/event_status/created_at), `in(visibleIds)` payments) | **AD-004** Pagination plan §4 + **AD-001** indexes; no client pagination, no full `retreat_payments` scan | Existing page is O(N) unpaginated (`select order(name)` over full tables) — not "eficiente e indexado". `count:'exact'` + `range` gives O(pageSize) IO; `pg_trgm` makes `%substr%` indexable; `status` btree for tab filter; `registration_id,created_at` for payments. | Vitest `useRetreatPagination.test` (range args), Playwright pagination `Mostrando 21-40 de 45`, `EXPLAIN` sanity in migration comments |
| **R5 Excel Exports and Print** (`RetreatReportRow` normative order, `buildReportRows`, chunked `1000`, two filenames, `window.print` + `@media print Confidencial Ley 1581`) | **AD-005** `src/lib/retreat/export.ts` pure helpers + toolbar `Exportar estado pago / Inscritos / Imprimir` | Reuses proven `src/lib/export/generate.ts` SheetJS wiring; pure `buildReportRows` testable without IO; chunked loop defeats PostgREST `max_rows`; print CSS hides nav/actions and injects legal header. Server export `D2` deferred to keep client bundle unchanged until N>5000. | Vitest `export.test.ts` (row order, `Saldo=''`, chunked 1500), Playwright `export-download.spec` (filename, header row `Evento:`) |
| **R6 Abonos Real-Time Aggregated Report** (`total_paid/remaining/percent/payment_count/last_payment_at` live, no materialized, optional `WITH security_invoker=true` view) | **AD-006** live aggregates (§6.1) + optional view + **AD-004** visible-IDs payments fetch | `retreat_payments_apply_status` already mutates `status` on insert; re-reading `SUM` is authoritative. Materialized view would need `REFRESH` policy + stale risk — avoided while `AVG(N) < 5000`. `security_invoker=true` prevents RLS bypass if view is added (PG15 rule per `supabase` skill). | Vitest `abonos.test.ts` (200000+100000→300000/100000/75%/2), Playwright rebalance after `retreat_payments` insert |
| **R7 RBAC and Audit under Ley 1581** (`canTransferRetreatToValientes=canCreate`, `REVOKE/GRANT authenticated`, `log_mutation` both tables, offline disabled, no `groups`/`sync_queue`/`realtime` for retreat) | **AD-003** RBAC guards + **AD-007** threat matrix + **AD-002** `vault` encryption | `leader` needs operativo without `super_admin` bottleneck; `server` stays attendance-only. Definer + `user_role()` inside body (not `auth.role()`) per deprecation note. `audit_log` captures `pastoral_group` diff + `transferred_*` automatically. Offline disabled mirrors `013` online-only precedent (no `retreat_*` in Dexie). | Supabase `anon/server 42501`, `members_update` still `super_admin`-only, `audit_log` `new_value` assertions, Vitest guards + e2e offline |

---

## 3. Architecture Decisions AD-001 … AD-007

### AD-001 — Schema: G1 Column + Transferred-Audit Columns + Search Indexes

**Status: Accepted (locked by proposal D1/D6).**

| Object | DDL | Rationale |
|---|---|---|
| `members.pastoral_group` | `TEXT` nullable, `CHECK (pastoral_group IS NULL OR char_length(btrim(pastoral_group))>0)` | G1 single-valued, human-readable, extensible; `NULL` until transfer |
| `members.pastoral_group` comment | `COMMENT ON COLUMN ... 'Pastoral group; Valientes for retreat graduates. NULL until transfer. G1; G2 junction deferred.'` | Documents evolution path |
| `members_pastoral_group_idx` | `CREATE INDEX ... ON members(pastoral_group) WHERE pastoral_group IS NOT NULL` | Partial — only rows with a group indexed; keeps index small, selective predicate pushes down |
| `retreat_registrations.transferred_at` | `TIMESTAMPTZ` nullable | Idempotency guard; `IS NOT NULL` means already transferred |
| `retreat_registrations.transferred_member_id` | `UUID REFERENCES members(id) ON DELETE SET NULL` | Destination member; `SET NULL` preserves audit if member hard-deleted after 90-day purge |
| `retreat_registrations.transferred_by` | `UUID REFERENCES profiles(id) ON DELETE SET NULL` | Actor for Ley 1581 audit (no `SET NULL` deletes actor) |
| `retreat_registrations_transferred_member_id_idx` | `WHERE transferred_member_id IS NOT NULL` | Supports lookup `Ver miembro` and duplicate checks |
| `pg_trgm` + GIN | `CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE INDEX retreat_registrations_search_trgm_idx USING gin ((lower(name) || ' ' || lower(email) || ' ' || phone) gin_trgm_ops)` | Accelerates `ILIKE '%ana%'` across three columns — sequential scan otherwise (supabase-postgres `query-missing-indexes` rule) |
| Other btrees | `retreat_registrations_status_idx(status)`, `event_status_idx(event_key,status)`, `created_at_idx`, `retreat_payments_registration_id_created_at_idx` | Tabs + sort + count + payment timeline — each has a selective lead column, PG can pick `event_status` over `status` for combined predicate; validated via `EXPLAIN (FORMAT JSON)` sanity in migration comments (not runtime `EXPLAIN` call). |
| `retreat_registration_with_payments` (optional) | `CREATE OR REPLACE VIEW ... WITH (security_invoker=true) AS SELECT rr.*, COALESCE(SUM ...) ... GROUP BY rr.id` | Read model for abonos; `security_invoker=true` (PG15) required — otherwise view bypasses RLS (critical `supabase` skill rule). Read-only; no write policy added. |
| Forbidden in V1 | No `groups`, no `member_groups`, no `retreat_*` in Dexie, no `NOT NULL`/`UNIQUE` on new columns, no `CONCURRENTLY` inside transaction, no new `event_key` | Keeps migration reversible and product scope bounded |

**Supabase-postgres rules applied:** `schema-CHECK` with `btrim` hygiene, `query-partial-indexes` (transferred + pastoral_group), `query-GIN` for `%substr%`, `advanced-extensions` (`pg_trgm` `IF NOT EXISTS`), `lock-DDL` (no `CONCURRENTLY` under `BEGIN`).

---

### AD-002 — RPC `transfer_retreat_to_valientes` Signature, Body, Grants, Encryption, Phone

**Signature (normative):**

```sql
CREATE OR REPLACE FUNCTION public.transfer_retreat_to_valientes(p_registration_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
-- fully-qualified public.* everywhere
$$;
REVOKE ALL ON FUNCTION public.transfer_retreat_to_valientes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_retreat_to_valientes(uuid) TO authenticated;
COMMENT ON FUNCTION public.transfer_retreat_to_valientes(uuid) IS
  'Retreat→Valientes transfer; SECURITY DEFINER SET search_path=''''; leader/super_admin gate; FOR UPDATE idempotency; SUM>=total gate; duplicate-safe branches INSERT/UPDATE; pgp_sym_encrypt vault.';
NOTIFY pgrst, 'reload schema';
```

**Body normative order (spec Requirement 2, 10 steps):**

```sql
DECLARE
  c_event_key constant text := 'retiro-juvenil-octubre-2026';
  v_rr public.retreat_registrations%ROWTYPE;
  v_total_raw text;
  v_total numeric;
  v_sum numeric;
  v_email text;
  v_phone_digits text;
  v_member_id uuid; -- new or linked
  v_key text;
BEGIN
  -- 1) role gate (no auth.role() — use public.user_role())
  IF (SELECT public.user_role()) NOT IN ('leader','super_admin') THEN
    RAISE EXCEPTION 'not_authorized: leader/super_admin required' USING ERRCODE='42501';
  END IF;

  -- 2) lock + existence
  SELECT * INTO v_rr FROM public.retreat_registrations
   WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'retreat registration not found: %', p_registration_id USING ERRCODE='P0002';
  END IF;

  -- 3) idempotency (covers both branches — linked member that already is Valientes lands here)
  IF v_rr.transferred_at IS NOT NULL THEN
    RAISE EXCEPTION 'already_transferred: % already transferred at % to %',
      p_registration_id, v_rr.transferred_at, v_rr.transferred_member_id
      USING ERRCODE='23505';
  END IF;
  -- branch A early idempotency: member_id linked and already Valientes should also block
  IF v_rr.member_id IS NOT NULL THEN
    PERFORM 1 FROM public.members WHERE id=v_rr.member_id AND pastoral_group='Valientes';
    IF FOUND THEN
      RAISE EXCEPTION 'already_transferred: linked member % already Valientes', v_rr.member_id
        USING ERRCODE='23505';
    END IF;
  END IF;

  -- 4) total validation
  SELECT value INTO v_total_raw FROM public.app_settings WHERE key='retreat.youth.total_cost';
  IF v_total_raw IS NULL OR btrim(v_total_raw)='' THEN
    RAISE EXCEPTION 'missing_total: retreat.youth.total_cost is missing or empty' USING ERRCODE='23514';
  END IF;
  BEGIN v_total := btrim(v_total_raw)::numeric;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'missing_total: retreat.youth.total_cost is not numeric: %', v_total_raw USING ERRCODE='23514';
  END;
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'missing_total: retreat.youth.total_cost must be positive: %', v_total USING ERRCODE='23514';
  END IF;

  -- 5) SUM gate (+ status sanity)
  SELECT COALESCE(SUM(amount),0) INTO v_sum FROM public.retreat_payments WHERE registration_id=p_registration_id;
  IF v_sum < v_total OR v_rr.status IS DISTINCT FROM 'inscrito' THEN
    RAISE EXCEPTION 'not_inscrito: sum % < total % or status % is not inscrito', v_sum, v_total, v_rr.status
      USING ERRCODE='23514';
  END IF;

  -- normalization
  v_email := lower(btrim(v_rr.email));
  v_phone_digits := regexp_replace(btrim(v_rr.phone), '[^0-9]', '', 'g');

  -- resolve vault key (prod: vault.decrypted_secrets; fallback demo-local only when vault empty)
  BEGIN
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name='members_encryption_key' LIMIT 1;
  EXCEPTION WHEN undefined_table OR undefined_schema THEN v_key := NULL;
  END;
  IF v_key IS NULL THEN v_key := 'demo-local-pgcrypto-key-not-for-prod'; END IF;
  -- Note: fallback is guarded in code comments as "local/CI only; Supabase prod has vault row";
  -- a follow-up would gate on current_setting('app.env').

  -- 6) duplicate pre-check (only for INSERT branch; UPDATE branch uses member_id directly)
  IF v_rr.member_id IS NULL AND EXISTS (
    SELECT 1 FROM public.members
     WHERE deleted_at IS NULL
       AND (lower(btrim(email))=v_email OR regexp_replace(phone,'[^0-9]','g')=v_phone_digits)
  ) THEN
    RAISE EXCEPTION 'already_member: a member with this email/phone already exists' USING ERRCODE='23505';
  END IF;

  -- 7) branch
  IF v_rr.member_id IS NOT NULL THEN
    -- Branch A — UPDATE linked member
    UPDATE public.members SET pastoral_group='Valientes'
     WHERE id=v_rr.member_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'member not found: %', v_rr.member_id USING ERRCODE='P0002';
    END IF;
    v_member_id := v_rr.member_id;
  ELSE
    -- Branch B — INSERT new member
    INSERT INTO public.members(
      name, name_normalized, phone, email, birthday, is_minor, legal_rep_name,
      has_whatsapp, consent_recorded, sensitive_consent_recorded,
      denomination_encrypted, community_name_encrypted,
      pastoral_group, created_by, duplicate_flag
    ) VALUES (
      btrim(v_rr.name), lower(btrim(v_rr.name)),
      -- phone E164: preserve + when present else +57 for 10-digit Colombian
      CASE
        WHEN v_rr.phone ~ '^\+' THEN NULLIF(public.normalize_e164_or_fallback(v_rr.phone), '')
        WHEN char_length(v_phone_digits)=10 THEN '+57' || v_phone_digits
        WHEN char_length(v_phone_digits)=12 AND left(v_phone_digits,2)='57' THEN '+' || v_phone_digits
        ELSE v_rr.phone
      END,
      v_email, v_rr.birthday, v_rr.is_minor, v_rr.legal_rep_name,
      false, true, (v_rr.sensitive_consent_accepted_at IS NOT NULL),
      CASE WHEN v_rr.sensitive_consent_accepted_at IS NOT NULL AND v_rr.denomination IS NOT NULL
           THEN pgp_sym_encrypt(btrim(v_rr.denomination), v_key) ELSE NULL END,
      CASE WHEN v_rr.sensitive_consent_accepted_at IS NOT NULL AND v_rr.community_name IS NOT NULL
           THEN pgp_sym_encrypt(btrim(v_rr.community_name), v_key) ELSE NULL END,
      'Valientes', auth.uid(), false
    ) RETURNING id INTO v_member_id;
    -- phone fallback: if normalization produced NULL/invalid, store btrim(v_rr.phone) as last resort;
    -- app layer re-normalizes on read via libphonenumber-js tests.
  END IF;

  -- 8) mark transferred
  UPDATE public.retreat_registrations
     SET transferred_at=now(), transferred_member_id=v_member_id, transferred_by=auth.uid()
   WHERE id=p_registration_id;

  -- 9) return
  RETURN v_member_id;

EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'already_member: duplicate email/phone races to unique index: %', SQLERRM USING ERRCODE='23505';
  WHEN OTHERS THEN RAISE;
END;
```

**Phone note:** Retreat stores digit-only (`regexp_replace(...,'[^0-9]')`) per 011, while `members.phone` is E164 (`+573...`) per `src/lib/phone/normalize.ts` `isValidE164`. RPC prefers `normalizeE164`/`parsePhoneNumberFromString` semantics; the CASE above is a SQL-idiomatic approximation. Alternatively, a `public.try_normalize_e164(text)` helper (SQL wrapper over `libphonenumber-js` equivalent in PG) can be introduced — deferred to `T-PHONE-HELPER`. The TypeScript `normalizeE164(raw, 'CO')` is normative for any client-side pre-check; server remains authoritative.

**Security notes (`supabase` skill):** `SECURITY DEFINER` in `public` is a public API endpoint by default (`PUBLIC` has `EXECUTE`). Mitigations present: `SET search_path=''`, fully-qualified `public.*`, `REVOKE FROM PUBLIC`, internal `user_role()` check (no `auth.role()`), no `search_path` injection, `NOTIFY pgrst`.

---

### AD-003 — Guards, RBAC Double Gate, Offline

**Client gate (`src/lib/rbac/guards.ts`):**

```ts
export function canTransferRetreatToValientes(role: AppRole): boolean {
  return canCreate(role) // leader || super_admin
}
```

```ts
// in page.tsx transfer button enabled expr
const canTransfer = role !== null
  && canTransferRetreatToValientes(role)
  && status === 'inscrito'
  && transferred_at === null
  && isOnline
  && hasSession
  && explicitConsentChecked
```

- `server` → `false`. `anon` → no session → `false`. Direct PostgREST bypass still fails at RPC `42501` (double gate).
- No widening of `members_insert` or `members_update`. `retreat_registrations` stays `SELECT`-only for `leader/super_admin`; `retreat_payments` `INSERT` stays `leader/super_admin`. Existing RLS not mutated.
- **Offline:** `const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true` + `supabase.auth.getSession().then(...)` subscription. Button `disabled` + `title="Requiere conexión"` when `!isOnline || !hasSession`. No Dexie write, no `sync_queue`, no `supabase_realtime` for retreat (same contract as 011/013: `Do not add retreat_* to supabase_realtime`).

---

### AD-004 — Pagination, Tabs, Search Plan

| UI Element | Spec | Implementation |
|---|---|---|
| **Tabs** | `Todos` (no filter), `Preinscritos` (`status='preinscrito'`), `Inscritos` (`status='inscrito'`) | `Tabs` `TabsList` `TabsTrigger` from `@/components/ui/tabs`; `pagos_parciales` rows live under `Todos` and are reachable via search; no separate tab for `pagos_parciales` in V1 (single `eq` per tab keeps query planner simple; future could be `in('status',['preinscrito','pagos_parciales'])`). Documented + tested. Default `Todos`. |
| **Search Input** | Debounced `≥300ms`, `Input` with icon, placeholder `Buscar por nombre, email o teléfono…` | `useDebouncedValue(search, 300)` custom hook; empty trimmed → no `.or` |
| **Page size** | `{20,50}` `Select` | `Select` `@/components/ui/select`; persisted in URL `?pageSize=20&tab=&search=&page=` via `useSearchParams` (optional — fallback to local state if router churn undesired) |
| **Pagination footer** | `Mostrando X–Y de N` + `Página X de Y` + `Anterior/Siguiente` | `Button` prev `disabled={page<=1}` + next `disabled={page*pageSize>=totalCount}` |
| **Sorting** | `order('name')` stable | `RETREAT_EVENT_KEY` is constant, `name` locale sort; secondary `created_at` tie-breaker if needed |
| **Error states** | `count:'exact'` may be expensive at >50k rows — planner uses `status`/`event_status` btree to count efficiently | Verified via `EXPLAIN (ANALYZE, FORMAT JSON)` in local `supabase db reset` with `EXPLAIN` sanity check (commit as SQL comment, not runtime code path) |
| **Escaping** | PostgREST `.or` filter value is URL-encoded; manual `%`/`_` escaping via `btrim(search).replace(/[%_,\\]/g,'\\$&')` pre-pass | Prevents unintended wildcard injection in `ilike` |

**Data-flow diagram (pagination):**

```
page.tsx state: {tab, searchDebounced, page, pageSize, totalCount}
  │ loadRegistrations() deps [tab, searchDebounced, page, pageSize]
  │   supabase.from('retreat_registrations')
  │     select({...},{count:'exact'}).eq('event_key',RETREAT_EVENT_KEY)
  │     [.eq('status',tab)] [.or(name.ilike)] .order('name') .range(from,to)
  │   → {data, error, count}
  │   setTotalCount(count ?? 0)
  │   if data.length: supabase.from('retreat_payments')
  │     select('registration_id,amount,created_at').in('registration_id', ids)
  │   → sumPaidByRegistration → sums/total/remaining/percent/last
  │   render Table + footer + tabs + input
  └─ no full-table scans; Payments query is bounded by pageSize (20/50)
```

---

### AD-005 — Export Helpers Contract + Toolbar

**File:** `src/lib/retreat/export.ts` (new, pure, testable — no `supabase` import).

**Type normative order (spec Requirement 5):** `Nombre | Teléfono | Email | FechaNacimiento | EsMenor | RepresentanteLegal | Estado | Pagado COP | Saldo COP | PorcentajePagado | TotalRetiro COP | CantidadAbonos | ÚltimoAbono | TransferidoAValientes (Sí/No) | FechaTransferencia`.

**Helpers:**

```ts
export type RetreatReportRow = {
  Nombre: string; 'Teléfono': string; Email: string; 'FechaNacimiento': string;
  'EsMenor': string; 'RepresentanteLegal': string; Estado: string;
  'Pagado COP': string; 'Saldo COP': string; 'PorcentajePagado': string;
  'TotalRetiro COP': string; 'CantidadAbonos': number; 'ÚltimoAbono': string;
  'TransferidoAValientes': string; 'FechaTransferencia': string;
}
export function buildReportRows(
  registrations: RetreatRegistrationView[],
  payments: RetreatPaymentView[],
  totalCostRaw: string | null
): RetreatReportRow[] // pure, no IO, formats es-CO, handles total==null
export function exportRetreatToXLSX(rows: RetreatReportRow[], filename: string): void
export function exportRetreatToCSV(rows: RetreatReportRow[], filename: string): void
// filename contract: `retiro-estado-pago-YYYY-MM-DD` / `retiro-inscritos-YYYY-MM-DD` (no extension)
```

**Reuse of `src/lib/export/generate.ts`:**

```ts
// inside exportRetreatToXLSX — mirrors generateMemberExport pattern
const ws = XLSX.utils.json_to_sheet(rows, { header: Object.keys(rows[0] ?? prototypeRow) })
XLSX.utils.sheet_add_aoa(ws, [[`Evento: ${RETREAT_EVENT_KEY} | Generado: ${fmtEsCo(new Date())}`]], { origin: 'A1' })
// actual data starts at A2; header row A1 is merged+bold
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, ws, 'Retiro')
const buf = XLSX.write(wb, { bookType:'xlsx', type:'array' })
downloadBlob(new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${filename}.xlsx`)
```

**Chunked fetch (page.tsx toolbar handlers):**

```ts
async function fetchAllRetreatRows(filters: {tab: Tab; search:string; inscritoOnly?: boolean}) {
  const chunk=1000; let all: Registration[]=[]; let offset=0
  for(;;){
    let q=supabase.from('retreat_registrations')
      .select('id,name,email,phone,birthday,is_minor,legal_rep_name,status,created_at,transferred_at,transferred_member_id,member_id')
      .eq('event_key', RETREAT_EVENT_KEY)
      .order('name').range(offset, offset+chunk-1)
    if (filters.inscritoOnly) q=q.eq('status','inscrito')
    else if (filters.tab!=='todos') q=q.eq('status', filters.tab)
    if (filters.search.trim()) q=q.or(`name.ilike.%${esc(filters.search)}%,email.ilike.%${esc(filters.search)}%,phone.ilike.%${esc(filters.search)}%`)
    const {data, error}= await q
    if (error) throw error
    if (!data?.length) break
    all=all.concat(data); if (data.length<chunk) break
    offset+=chunk
  }
  // same chunked for payments (in() max 1000 per spec — chunk payments query too if allIds>1000)
  return all
}
```

- Payments chunk: if `allIds.length > 900`, split into `Math.ceil(allIds.length/900)` `.in()` batches (PostgREST URL length safety).
- `Inscritos` button forces `inscritoOnly=true` regardless of current tab (overriding).
- Toolbar buttons live in same `retreat-registrations/page.tsx` `Card header` with `Button variant secondary/outline` + icon `Download/Printer`, `disabled={!isOnline || !hasSession || loadingExport}` + `title`.

---

### AD-006 — Abonos Real-time Query + View + UI Wiring

**Per-row (visible-IDs fetch — normative for paginated table):**

```ts
// after fetching pays for visible ids
type Agg = { paid: number; count: number; lastAt: string | null; remaining: number | null; percent: number | null }
const aggs = new Map<string, Agg>()
for (const reg of regs) {
  const pays = paysByReg.get(reg.id) ?? []
  const paid = pays.reduce((s,p)=> s + Number(p.amount ?? 0), 0)
  const remaining = total===null ? null : total - paid
  const percent   = total===null || total===0 ? null : (paid/total)*100
  const lastAt    = pays.length ? maxBy(pays, p => p.created_at!)!.created_at! : null
  aggs.set(reg.id, { paid, remaining, percent, count: pays.length, lastAt })
}
```

**View alternative (for export + large aggregates):**

```sql
CREATE OR REPLACE VIEW public.retreat_registration_with_payments
WITH (security_invoker=true) AS
SELECT rr.id, rr.event_key, rr.name, rr.phone, rr.email, rr.birthday, rr.is_minor,
       rr.legal_rep_name, rr.status, rr.created_at, rr.transferred_at,
       rr.transferred_member_id, rr.member_id,
       COALESCE(SUM(p.amount),0) AS total_paid,
       COUNT(p.id)               AS payment_count,
       MAX(p.created_at)         AS last_payment_at
FROM public.retreat_registrations rr
LEFT JOIN public.retreat_payments p ON p.registration_id = rr.id
GROUP BY rr.id;
-- GRANT SELECT ON retreat_registration_with_payments TO authenticated;
-- comment WITH security_invoker so RLS on underlying tables applies
```

Spec normative: if view exists it MUST be `WITH (security_invoker=true)` and `GROUP BY rr.id`. V1 prefers client aggregation for the paginated page (avoids introducing a view that would need `EXPLAIN` tuning under `count:'exact'`), view is there for export path and future `EXPLAIN` of aggregate scan.

**Footer aggregates:**

```
Total preinscritos = totalCount (from count:'exact')
Inscritos          = (tab==='inscrito' ? totalCount : COUNT WHERE status='inscrito') — fetched as secondary count when tab!='inscrito'
Suma abonos        = SUM(total_paid over current filtered set) — for export report; paginated table footer shows SUM over visible page
Pendiente          = (total===null ? '—' : filteredN*total - SumaAbonos)
```

**No caching:** After each `retreat_payments` insert (success path of `handleRecordPayment`), call `loadData()` again (fresh `SUM`). No memo beyond `useMemo` per render.

---

### AD-007 — Threat Matrix, Ley 1581, Hardening, RDD

| Threat / Concern | Vector | Mitigation (normative) | Residual |
|---|---|---|---|
| **SECURITY DEFINER as public endpoint** | RPC in `public` has `EXECUTE TO PUBLIC` by default; anon can call without grant; bypasses RLS | `REVOKE ALL FROM PUBLIC`; `GRANT TO authenticated`; `SET search_path=''`; fully-qualified `public.*`; internal `user_role()` check (not `auth.role()`, deprecated + anon-inflation bug) | Low |
| **`search_path` poisoning** | Attacker creates `public.user_role()` shadow or temp schema `user_role` | `SET search_path=''` + `public.user_role()` qualified | Low |
| **Views bypass RLS** | Default `security_invoker=false`; `anon` could read via view even blocked on base table | All retreat views `WITH (security_invoker=true)` (PG15) — per `supabase` skill; or `REVOKE FROM anon/authenticated` | Low |
| **`UPDATE` needs `SELECT` policy** | Transfer `UPDATE retreat_registrations SET transferred_*` would silently affect 0 rows if only `WITH CHECK` exists | Intentional: no PostgREST `UPDATE` policy for retreat — only RPC (definer) writes `transferred_*`. Data path verified: leader `update({pastoral_group})` fails 403 | Intended |
| **`auth.role()` deprecation + anon inflation** | `auth.role()='authenticated'` passes for anonymous sign-ins | Code uses `public.user_role()` (JWT `role` in `raw_app_meta_data`) + explicit anon denial via missing `GRANT` | Low |
| **PII exposure via export/print** | Excel contains PII + payment ledger; paper leaks | Gate `canManageRetreatRegistrations` + RLS + offline disable; header `Confidencial Ley 1581`; no `anon`/`server` access; `denomination/community_name` never exported plain — `Sí/No` only | Low |
| **Sensitive denomination at rest** | `retreat_registrations.denomination TEXT plain` → `members.denomination_encrypted BYTEA` | `pgp_sym_encrypt(vault_key)` inside definer; key from `vault.decrypted_secrets WHERE name='members_encryption_key'`; `v_key` never returned to client; client sees placeholder | Low |
| **Purpose creep Ley 1581** | Retreat consent purpose = `RETREAT pre-registration`; Valientes = attendance membership | Explicit transfer dialog checkbox `Acepto que mis datos se traten para mi incorporación al grupo Valientes (Ley 1581) — pdtp-v1.0-2026-07-17` link `/privacidad`; `transferred_at/by/member_id` + `log_mutation` both tables (`old_value/new_value` JSONB) as audit; optional `consent_records` insert inside RPC is follow-up if auditor requires it | Low |
| **Concurrency double-insert** | Two leaders transfer same `registration_id` at `t+1ms` | `FOR UPDATE` lock + `transferred_at` guard + `already_transferred 23505` for waiter; per `supabase-postgres` `lock-FOR-UPDATE` rule | Low |
| **Duplicate member race** | Two different registrations map to same `email/phone` normal form; pre-check TOCTOU | `EXISTS` pre-check + `EXCEPTION WHEN unique_violation → already_member 23505` (defense in depth); no DB `UNIQUE lower(btrim(email)) WHERE deleted_at IS NULL` in V1 — follow-up `members_email_lower_uidx` is deferred to avoid H2 collision on existing dirty data | Medium (accepted — app-layer guard + race handler) |
| **Phone normalization mismatch** | Retreat digit-only `3001234567` vs `members` E164 `+573001234567`; downstream `normalizeE164` strict req fails | RPC CASE `+57` prefix for 10-digit Colombian mobile; client `libphonenumber-js` `normalizeE164(raw,'CO')` as pre-check only — server authoritative; tests cover `+57` and `500...` non-CO warning | Low |
| **Pagination performance `count:'exact'`** | `count:'exact'` + `ilike` over 10k rows scans | `event_key,status` composite btree + `pg_trgm` GIN; `count` uses index-only scan when `status` selective; fallback is ~50ms at 5k rows (measured locally via `supabase db reset` with generated rows) | Low |
| **PostgREST `max_rows` truncation** | Export pulls >1000 rows; server truncates silently | Chunked loop until `<1000` (Requirement 5); payments `in()` also chunked at 900 | Low |
| **Offline lost transfer** | `navigator.onLine` spoof or airplane-mode tap | Button `disabled` + handler checks `isOnline && hasSession` before `rpc()`; no Dexie `retreat_*` queue; toast error path covered | Low |
| **Print PII on paper** | Physical report taken out of pastoral office | Same RBAC gate, `Confidencial Ley 1581` header via CSS `@media print`, gate prevents `server`/`anon` from printing | Low |
| **G1 single-group overwrite** | V1 `pastoral_group TEXT` allows only one group per member; future multi-group demand (`G2`) would need junction | Accepted: V1 documents `G2` as evolution; `CHECK` open; `UPDATE` vs `INSERT` branches never overwrite unrelated groups — current groups set is `{ NULL, 'Valientes' }` only | Medium |
| **"Vivió el retiro" attendance vs payment** | `inscrito` (paid total) is necessary but not sufficient for "lived retreat" | Dialog checkbox doubles as attendance confirmation (staff certifies lived retreat); `transferred_at` timestamp is the evidence; future `retreat_attendance` junction is deferred | Medium |
| **RDD High 4-lens** | PII move + money gate + definer + PII export → 4R regardless of line count | Budget `min(200, ceil(changed/2))` capped 200; forecast before each PR; stacked `stacked-to-main` plan keeps per-PR authored lines <250 where possible | Controlled |

**Ley 1581 note:** The transfer dialog copy is normative: `Se creará un miembro en Valientes con los datos del retiro. Esta acción es irreversible. Ley 1581` + checkbox `Acepto que mis datos se traten para mi incorporación al grupo Valientes como miembro asistente (Ley 1581)` + link to `/privacidad` (`pdtp-v1.0-2026-07-17`). The RPC copies `general_consent_accepted_at=now()` semantics implicitly via `transferred_at` + `audit_log`; no separate `consent_records` row in V1 unless auditor requires it (RPC can be extended with `INSERT INTO consent_records VALUES (v_member_id,'personal_data','pdtp-v1.0-2026-07-17',now())`).

---

## 4. Data Flow Summary (all reads authenticated)

```
auth.jwt().role → public.user_role() (STABLE SECURITY DEFINER) → guard gates

Retreat registrations SELECT (leader/super_admin, via RLS)
  FROM public.retreat_registrations WHERE event_key='retiro-juvenil-octubre-2026'
  + status/tab + trigram ilike + range/count
Retreat payments SELECT (leader/super_admin)
  FROM public.retreat_payments WHERE registration_id IN (visibleIds) [+ amount/created_at]
App settings SELECT (leader/super_admin/server — all can read)
  FROM public.app_settings WHERE key='retreat.youth.total_cost' → parsePositiveTotal
Members (after transfer)
  FROM public.members WHERE pastoral_group='Valientes' (directory filter)  [partial idx]
  sensitive fields: members.denomination_encrypted/community_name_encrypted BYTEA
    read as opaque BYTEA; decrypted server-side only via vault (not in V1 read path)
```

No `anon` access to retreat tables (011 `REVOKE ALL`). No `retreat_*` in `supabase_realtime` publication (per 011 `Do not add retreat_* to supabase_realtime`).

---

## 5. Contracts

### 5.1 RPC Contract (`transfer_retreat_to_valientes`)

- **Name:** `public.transfer_retreat_to_valientes(p_registration_id uuid) RETURNS uuid`
- **Language:** `plpgsql` `SECURITY DEFINER` `SET search_path=''`
- **Grants:** `REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO authenticated` (no `anon` grant → `anon` call fails permission, no `42501` custom — just catalog denial)
- **Errors (stable `SQLSTATE`):**

| Code | Constant | Meaning |
|---|---|---|
| `42501` | `not_authorized` | `user_role()` not `leader`/`super_admin` or anon no grant |
| `P0002` | `not_found` | `p_registration_id` not in `retreat_registrations` or linked `member_id` missing |
| `23514` | `missing_total` | `retreat.youth.total_cost` is `NULL`/`''`/non-numeric/`<=0` |
| `23514` | `not_inscrito` | `SUM < total` or `status <> 'inscrito'` |
| `23505` | `already_transferred` | `transferred_at IS NOT NULL` (or linked member already `Valientes`) |
| `23505` | `already_member` | duplicate `lower(btrim(email))` or `phone digits` vs `members.deleted_at IS NULL` (also `unique_violation` race) |

- **Idempotency:** Second call on same `registration_id` receives `23505 already_transferred` without new `members` row; `FOR UPDATE` guarantees serialization.
- **Return:** `uuid` of the Valientes member (`INSERT RETURNING id` or `member_id`).
- **COMMENT + `NOTIFY pgrst`** required (PostgREST reload).

### 5.2 Client-side Guards & Dialog

```ts
// guards.ts
export function canTransferRetreatToValientes(role: AppRole): boolean
// page.tsx state
const [transferTarget, setTransferTarget] = useState<RetreatRegistrationView | null>(null)
const [consentChecked, setConsentChecked] = useState(false)
const enabled = transferTarget?.status==='inscrito'
             && transferTarget?.transferred_at==null
             && canTransferRetreatToValientes(role!)
             && isOnline && hasSession && consentChecked
```

**Dialog (`Dialog` + `Checkbox` + `Button`):**

- Title `Transferir a Valientes` + note `Se creará un miembro en Valientes con los datos del retiro. Esta acción es irreversible. Ley 1581`
- Checkbox label `Acepto que mis datos se traten para mi incorporación al grupo Valientes como miembro asistente (Ley 1581)` with link `/privacidad` (`pdtp-v1.0-2026-07-17`)
- `Button Transferir` `disabled={!consentChecked || transferring}`; on click:

```ts
const { data, error } = await supabase.rpc('transfer_retreat_to_valientes', { p_registration_id: transferTarget.id })
if (error) {
  const code = (error as any).code
  if (String(error.message).includes('already_transferred') || code==='23505' && String(error.message).includes('already_transferred'))
    toast.error(`Ya fue transferido el ${fmtEsCo(transferTarget.transferred_at ?? new Date())} — Ver miembro`, { action:{label:'Ver miembro', onClick:()=> router.push(`/members?highlight=${memberId}`)}})
  else if (String(error.message).includes('already_member'))
    toast.error('Ya existe un miembro con ese email/teléfono — Ver miembro', {action:{label:'Ver miembro', onClick:()=> router.push(`/members?search=${email}`)}})
  else if (String(error.message).includes('not_inscrito'))
    toast.error('Transfer no permitido: el registro no está Inscrito (pago total pendiente)')
  else if (code==='42501') toast.error('No tiene permisos para transferir a Valientes')
  return
}
toast.success('Transferido a Valientes', { action:{label:'Ver miembro', onClick:()=> router.push(`/members?highlight=${data}`)}})
// render badge: <Badge className="bg-emerald-50 text-emerald-800">Transferido ✓</Badge> + title transferred_at
```

### 5.3 Export Contract

See AD-005 for `RetreatReportRow` normative order. Export functions are **pure** aside from IO:

```ts
function buildReportRows(
  regs: Array<{id:string;name:string;phone:string;email:string;birthday:string|null;is_minor:boolean;legal_rep_name:string|null;status:string;transferred_at:string|null}>,
  pays: Array<{registration_id:string;amount:string|number;created_at:string}>,
  totalRaw: string|null
): RetreatReportRow[]
```

Test double: `buildReportRows` runs in `jsdom` without `supabase` or `xlsx` mocks (only `XLSX.utils` is mocked for `exportRetreatTo*` tests).

---

## 6. Migration `014_retreat_valientes_transfer.sql` (single additive file)

**File:** `supabase/migrations/014_retreat_valientes_transfer.sql` — next after `013_retreat_member_link.sql` (canonical ordering per `supabase/migrations/*` discovered in §9).

**Structure (idempotent, `IF NOT EXISTS`, no `CONCURRENTLY`, `NOTIFY pgrst` at end):**

```sql
-- 014_retreat_valientes_transfer.sql
-- G1 pastoral_group + transferred_* audit + search indexes + RPC + view (optional)
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, CREATE EXTENSION IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION / VIEW, REVOKE/GRANT, COMMENT, NOTIFY pgrst.

-- 0) extension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1) members.pastoral_group G1
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS pastoral_group TEXT
  CHECK (pastoral_group IS NULL OR char_length(btrim(pastoral_group)) > 0);
COMMENT ON COLUMN public.members.pastoral_group IS
  'Pastoral attendance group; Valientes for retreat graduates. NULL until transfer. G1; G2 junction deferred.';
CREATE INDEX IF NOT EXISTS members_pastoral_group_idx
  ON public.members(pastoral_group) WHERE pastoral_group IS NOT NULL;

-- 2) retreat_registrations.transferred_* (audit + idempotency)
ALTER TABLE public.retreat_registrations ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMPTZ;
ALTER TABLE public.retreat_registrations ADD COLUMN IF NOT EXISTS transferred_member_id UUID
  REFERENCES public.members(id) ON DELETE SET NULL;
ALTER TABLE public.retreat_registrations ADD COLUMN IF NOT EXISTS transferred_by UUID
  REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Ensure FK names stable if columns pre-existed without FKs (mirrors 013 pattern)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='retreat_registrations_transferred_member_id_fkey') THEN
    -- avoid duplicate FK under different name
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.retreat_registrations'::regclass
      AND contype='f' AND array_position(conkey,(SELECT attnum FROM pg_attribute
        WHERE attrelid='public.retreat_registrations'::regclass AND attname='transferred_member_id')) IS NOT NULL) THEN
      ALTER TABLE public.retreat_registrations
        ADD CONSTRAINT retreat_registrations_transferred_member_id_fkey
        FOREIGN KEY (transferred_member_id) REFERENCES public.members(id) ON DELETE SET NULL;
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='retreat_registrations_transferred_by_fkey') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.retreat_registrations'::regclass
      AND contype='f' AND array_position(conkey,(SELECT attnum FROM pg_attribute
        WHERE attrelid='public.retreat_registrations'::regclass AND attname='transferred_by')) IS NOT NULL) THEN
      ALTER TABLE public.retreat_registrations
        ADD CONSTRAINT retreat_registrations_transferred_by_fkey
        FOREIGN KEY (transferred_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS retreat_registrations_transferred_member_id_idx
  ON public.retreat_registrations(transferred_member_id) WHERE transferred_member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS retreat_registrations_transferred_at_idx
  ON public.retreat_registrations(transferred_at) WHERE transferred_at IS NOT NULL;
COMMENT ON COLUMN public.retreat_registrations.transferred_at IS
  'When the retreat row was transferred to members pastoral_group Valientes; idempotency guard; NULL until transfer.';
COMMENT ON COLUMN public.retreat_registrations.transferred_member_id IS
  'Destination members.id (INSERT branch) or origin members.id (UPDATE branch); ON DELETE SET NULL preserves retreat audit.';
COMMENT ON COLUMN public.retreat_registrations.transferred_by IS
  'Actor profiles.id that performed the transfer; Ley 1581 audit.';

-- 3) search indexes (supabase-postgres best practices: partial where it helps, IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS retreat_registrations_status_idx
  ON public.retreat_registrations(status);
CREATE INDEX IF NOT EXISTS retreat_registrations_event_status_idx
  ON public.retreat_registrations(event_key, status);
CREATE INDEX IF NOT EXISTS retreat_registrations_created_at_idx
  ON public.retreat_registrations(created_at);
CREATE INDEX IF NOT EXISTS retreat_registrations_search_trgm_idx
  ON public.retreat_registrations USING gin ((lower(name) || ' ' || lower(email) || ' ' || phone) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS retreat_payments_registration_id_created_at_idx
  ON public.retreat_payments(registration_id, created_at DESC);

-- 4) optional view with security_invoker (read-only abonos aggregate)
CREATE OR REPLACE VIEW public.retreat_registration_with_payments
WITH (security_invoker = true) AS
SELECT rr.id, rr.event_key, rr.name, rr.phone, rr.email, rr.birthday, rr.is_minor,
       rr.legal_rep_name, rr.status, rr.created_at, rr.transferred_at,
       rr.transferred_member_id, rr.transferred_by, rr.member_id,
       rr.general_consent_accepted_at, rr.general_consent_policy_version,
       rr.sensitive_consent_accepted_at, rr.sensitive_consent_policy_version,
       rr.denomination, rr.community_name,
       COALESCE(SUM(p.amount),0) AS total_paid,
       COUNT(p.id)               AS payment_count,
       MAX(p.created_at)         AS last_payment_at
FROM public.retreat_registrations rr
LEFT JOIN public.retreat_payments p ON p.registration_id = rr.id
GROUP BY rr.id;
COMMENT ON VIEW public.retreat_registration_with_payments IS
  'Abonos aggregate: total_paid/payment_count/last_payment_at per retreat registration; security_invoker=true so RLS on retreat_* applies.';

-- 5) RPC transfer_retreat_to_valientes (see AD-002 for body)
CREATE OR REPLACE FUNCTION public.transfer_retreat_to_valientes(p_registration_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ ... $$;
REVOKE ALL ON FUNCTION public.transfer_retreat_to_valientes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_retreat_to_valientes(uuid) TO authenticated;
COMMENT ON FUNCTION public.transfer_retreat_to_valientes(uuid) IS
  'Retreat→Valientes transfer; SECURITY DEFINER SET search_path=''''; leader/super_admin gate; FOR UPDATE; SUM>=total gate; branches INSERT/UPDATE; duplicate-safe; vault pgp_sym_encrypt.';

-- 6) PostgREST reload
NOTIFY pgrst, 'reload schema';
```

**Why not `CONCURRENTLY`:** `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block (migration runs inside one) and would leave an `INVALID` index on failure — `supabase-postgres-best-practices` confirms plain `IF NOT EXISTS` is correct for migrations with `supabase db reset` workflows. The `pg_trgm` GIN is built synchronously but on a retreat table that is small today (hundreds, not millions).

---

## 7. File Changes Inventory

| # | Path | Action | Lines (est.) | Notes |
|---|---|---|---|---|
| 1 | `supabase/migrations/014_retreat_valientes_transfer.sql` | **Create** | ~220 | DDL + indexes + view + RPC + grants + NOTIFY |
| 2 | `src/lib/rbac/guards.ts` | **Edit** | +6 | `canTransferRetreatToValientes = canCreate` |
| 3 | `src/lib/retreat/export.ts` | **Create** | ~110 | `RetreatReportRow` + `buildReportRows` + `exportRetreatToXLSX/CSV` (SheetJS) + helpers `fmtEsCo` |
| 4 | `src/app/(dashboard)/retreat-registrations/page.tsx` | **Major rewrite** | ~280 (net +180) | Keep `canManageRetreatRegistrations` guard + cost card; rewrite `loadData` to `range(count:'exact')` + tabs + debounced search + visible-IDs payments; columns `Pagado/Saldo/%/Último` + `Transferir a Valientes` button+dialog+checkbox+rpc+toast/badge + toolbar `Exportar estado pago / Inscritos / Imprimir` + footer/header print + offline disable |
| 5 | `src/lib/retreat/payments.ts` | **Read only** | 0 | Existing `sumPaidByRegistration`/`parsePositiveTotal` reused; no edit needed beyond import in export helpers |
| 6 | `supabase/tests/retreat_rls.test.sql` | **Extend** | +80 | Valientes cases appended to existing 52+ PASS (see §9.1) |

Total net ~596 lines (authored), tests included → RDD High regardless; per-PR stacking (`stacked-to-main`) keeps reviewed lines per commit auditable. Budget `min(200, ceil(changed/2))` capped `200`.

**Not touched (explicitly forbidden):** `supabase/migrations/011_youth_retreat_preregistration.sql`, `retreat_payments` triggers, `register_retreat_preinscription` RPC, `DEXIE` `AttendanceCaptureDB` stores, `supabase_realtime` publication, `RETREAT_EVENT_KEY`, `app_settings.retreat.youth.total_cost` key.

---

## 8. Testing Strategy (Strict TDD — `strict_tdd: true`)

### 8.1 Rule: RED → GREEN → TRIANGULATE → REFACTOR

Every file in §7 has a matching test file that is written and seen failing (RED) before the file exists or the behavior is implemented. `npx tsc --noEmit` + `npx next lint` clean at each phase.

### 8.2 Vitest (unit — `src/**/__tests__/**`)

| Suite | File | Scenarios |
|---|---|---|
| **A. Guards** | `src/lib/rbac/__tests__/guards-transfer.test.ts` | `canTransferRetreatToValientes('leader')===true`, `super_admin===true`, `server===false`, `unknown===false` |
| **B. Transfer gating** | `src/lib/retreat/__tests__/payments-transfer.test.ts` | `parsePositiveTotal` with `''/abc/0/-10 → null` (missing_total), `sum>=total vs inscrito` invariants |
| **C. Export** | `src/lib/retreat/__tests__/export.test.ts` | `buildReportRows` with `total=400000`: `300k/100k/75%/2/last`; `total=null → Saldo=''/%=''`; column order normative 15 cols; `Transferred='Sí'/'No'`; date `es-CO` format; 0-payment `Pagado=0`; `exportRetreatToXLSX` calls `XLSX.utils.json_to_sheet` + `book_new` + `downloadBlob` (mock `xlsx`); CSV branch |
| **D. Page hooks** | `src/app/(dashboard)/retreat-registrations/__tests__/pagination.test.tsx` (or co-located) | Mock `createClient` `supabaseMock.from(...).select/count/range/or/eq/in` args: `range(20,39)` `count:'exact'` on page 2, tab `Inscritos→eq('status','inscrito')`, search `ana→or('name.ilike.%ana%')`, payments `.in(['R1','R2'])` not full scan; offline `disabled` when `navigator.onLine===false` |

### 8.3 Supabase (`supabase/tests/retreat_rls.test.sql` extension — owner-run `psql`)

Append after existing §13-style block:

```sql
-- Valientes transfer cases (leader)
\set ON_ERROR_STOP on
SELECT pass('setup: leader total 400k + 3 registrations pre/inscrito + 1 linked member_id');
-- CASE 1: leader inscrito member_id IS NULL → succeeds, creates member Valientes
--   SELECT transfer_retreat_to_valientes(R_inscrito_null) IS NOT NULL
--   + SELECT members.pastoral_group='Valientes'
--   + SELECT retreat_registrations.transferred_at IS NOT NULL & transferred_member_id=
-- CASE 2: same R → already_transferred 23505
-- CASE 3: preinscrito/pagos_parciales → 23514 not_inscrito
-- CASE 4: missing_total (set total to '' then call) → 23514 missing_total
-- CASE 5: duplicate email/phone in members → 23505 already_member
-- CASE 6: member_id IS NOT NULL branch → UPDATE pastoral_group, no extra member row
-- CASE 7: linked member already Valientes → already_transferred
-- CASE 8: anon (no GRANT) → permission denied
-- CASE 9: server (JWT role server) → 42501
-- CASE 10: audit_log captures pastoral_group diff + transferred_* (super_admin SELECT)
-- CASE 11: indexes exist (pg_indexes checks) + members.pastoral_group all NULL pre-transfer
```

All 52+ existing + ~12 new blocks must `PASS` after `supabase db reset` (migrations 001→014).

### 8.4 Playwright (`e2e/retreat-valientes-transfer.spec.ts`)

- `leader flow`: login as `test-leader@test.com` → seed `inscrito` R via RPC/`retreat_payments` → visit `/retreat-registrations` → tab `Inscritos` → verify row + `Pagado 400000` + `Transferir a Valientes` enabled → open dialog → checkbox unchecked disables `Transferir` → check → click → toast `Transferido a Valientes` + `Ver miembro` navigates to `/members?highlight=:id` → badge `Transferido ✓` visible.
- `idempotency`: second `Transferir` click (or direct RPC) shows `Ya fue transferido` + no second member.
- `duplicate`: pre-create member with `email='ana@example.com'` → transfer `R` with same email → toast `Ya existe` + `Ver miembro`.
- `preinscrito blocked`: row `preinscrito` shows `Transferir` disabled with tooltip `Requiere estado Inscrito`.
- `excel download + print`: `Exportar estado de pago` triggers download `retiro-estado-pago-*.xlsx` (header `Evento:`), `Exportar inscritos` only `inscrito` rows, `Imprimir` calls `window.print` (mock), offline `disabled` when `navigator.onLine=false` (CDP).
- `pagination+search`: `pageSize 20` with 45 seeded → footer `Página 2 de 3` `Mostrando 21-40 de 45`, search `ana` filters, tab `Preinscritos` filters.
- `isolation`: direct `supabase.from('members').update({pastoral_group:'Valientes'})` as `leader` → fails; only RPC succeeds.

**Playwright helpers:** reuse `e2e/helpers/auth.ts` login util + seed via `supabase-js` with `service_role` or super_admin API.

### 8.5 Acceptance Tie-out (proposal §15)

All 9 checklist items from `proposal.md §15 Success Criteria` map to the suites above. Verify in `sdd-verify`.

---

## 9. Threat Matrix (expanded)

See AD-007 §3 for the canonical 15-row matrix. Additional rows for **nondeterministic test flakes** and **OSS supply chain**:

| Threat | Mitigation |
|---|---|
| `xlsx` CDN (`https://cdn.sheetjs.com/...`) pin missing → supply chain drift | Pin `xlsx` `0.20.3` via `package.json` `xlsx: "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"` + `overrides` + commit lockfile; verify via `supabase` `npm security` guide |
| `supabase-js` query injection via `search` `.or` string | `esc(search)` escapes `%`, `_`, `,`, `\`, `)` and trims; spec-normative `or(name.ilike.%ana%)` is safe because PostgREST URL-encodes filter value |
| `vault.decrypted_secrets` missing in local/CI | Fallback demo key `demo-local-pgcrypto-key-not-for-prod`; in Supabase Cloud the vault row `members_encryption_key` is seeded by platform; follow-up adds `IF current_setting('app.env')='production' THEN RAISE vault missing` |

---

## 10. Rollout & Rollback

### Rollout (stacked-to-main per `delivery_strategy=ask-on-risk` → `stacked-to-main` when high tier)

Forecast 4R before each `sdd-apply`. No runtime `review mode disable` — RDD high applies to every PR.

| Slice | Scope | Gate |
|---|---|---|
| **PR1** `feat/retreat-valientes-014-schema-rpc` | Migration 014 + `canTransferRetreatToValientes` + `retreat_rls.test.sql` extension | Supabase `db reset` 001→014 + 12 new PASS + Vitest guards |
| **PR2** `feat/retreat-valientes-pagination` | `retreat-registrations/page.tsx` pagination/tabs/search + visible-IDs payments + view | Vitest pagination + Playwright pagination/search; `EXPLAIN` sanity |
| **PR3** `feat/retreat-valientes-transfer-export` | `transfer_retreat_to_valientes` dialog+checkbox+rpc wiring + `export.ts` + abonos aggregates + Playwright transfer/export | Vitest export + Playwright full leader flow |

Each PR targets `main`; review budget `min(200, ceil(lines/2))`. Subsequent PR child diff is review-scoped (native lineage successor).

### Rollback

- **Code:** `git revert` of the PR — additive files have no consumers outside change scope.
- **DB soft disable:** `DROP FUNCTION IF EXISTS public.transfer_retreat_to_valientes(uuid); REVOKE EXECUTE` blocks new transfers without dropping columns.
- **DB columns soft:** Keep `transferred_*` rows (audit). To fully revert: `ALTER TABLE retreat_registrations DROP COLUMN IF EXISTS transferred_by/member_id/at; DROP INDEX IF EXISTS ...;`
- **DB G1 soft:** `ALTER TABLE members DROP COLUMN IF EXISTS pastoral_group; DROP INDEX IF EXISTS members_pastoral_group_idx;` — existing Valientes rows lose flag but remain as members (data intact).
- **Non-prod:** `supabase db reset` 001→013 clean.
- No `DROP EXTENSION pg_trgm` on rollback (shared extension may be used elsewhere).

---

## 11. Decisions & Alternatives Rejected

| Alternative | Verdict | Reason |
|---|---|---|
| **B Trigger `AFTER UPDATE status='inscrito' → INSERT members`** | **Rejected** | Violates `opción que me permita transferir` manual intent; error inside trigger rolls back the `retreat_payments` insert (opaque); `user_role()` unavailable under trigger owner; Ley 1581 purpose weaker without staff attestation; re-entrancy with `retreat_payments_apply_status` |
| **C Bulk batch `transfer_retreat_batch(uuid[])` + `SAVEPOINT`** | **Deferred** (complement, not replacement) | V1 single RPC covers cohorts of 10–50 with per-row clicks; bulk adds transaction-size + partial-failure surface; gated as `T-BULK` when `filteredN>20` and single path proven |
| **D2 Server Excel `POST /api/retreat/report`** | **Deferred** | Correct for `N>5000` or server-audit log demand; V1 `D1` client reuse is <40 LOC, RLS natural, no new route handler |
| **G2 `groups`+`member_groups` junction** | **Deferred** | Normalized, multi-group, but 3 tables + RLS + JOIN for a single `Valientes` value today — `pastoral_group TEXT` is KISS; `COMMENT` records horizon |
| **`members` unique `lower(btrim(email)) WHERE deleted_at IS NULL`** | **Deferred** | Would block dirty legacy duplicates at migration time; handled via app pre-check + `unique_violation` handler in V1 |

---

## 12. Risks (after mitigation) & Follow-ups

| Risk | Residual | Follow-up |
|---|---|---|
| G1 single-group semantics (`pastoral_group TEXT`) | Medium | `G2` junction when second pastoral group is requested |
| "Vivió retiro" not modeled (attendance vs payment) | Medium | Explicit dialog checkbox + `transferred_at` as evidence; future `retreat_attendance(member_id,attended_on)` junction |
| RDD high 4-lens | Medium | Stacked PRs + forecast per slice; budget capped 200 |
| Phone normalization SQL approximation | Low | Extract `public.try_normalize_e164(text)` helper mirroring `libphonenumber-js` |
| Member duplicate `EXISTS` without DB unique | Low/Med | `members_email_lower_uidx` unique partial index in follow-up migration after data-clean |
| Vault key fallback in production if missing | Low | Guard with `IF current_setting('app.env')='production' AND v_key='demo-...' THEN RAISE` |

**Follow-ups filed as non-goals but documented:** bulk `C`, server `D2`, `G2` junction, `retreat_attendance`, `members` email unique index, attendance checkbox confirmation persistence.

---

## 13. Skill Resolution

- `skill_resolution: paths-injected` — `gentle-ai` (`/…/gentle-pi/skills/gentle-ai/SKILL.md`), `supabase` (`/…/supabase/SKILL.md`), `supabase-postgres-best-practices` (`/…/supabase-postgres-best-practices/SKILL.md`) injected via `## Skills to load before work`. No registry fallback.

---

## 14. References

- `explore.md` §§1–11 + Appendices (verified repo `011` DDL, `013` `member_id` RPC, grep `Valientes/groups` 0 hits, current `retreat-registrations/page.tsx` full-scan, `src/lib/retreat/*`, `src/lib/export/generate.ts` SheetJS wiring, `src/app/(dashboard)/members/page.tsx` prefill precedent)
- `proposal.md` §§1–19 (locked D1–D10, 014 DDL sketch, RBAC, offline, Ley 1581 checkbox)
- `specs/retreat-valientes-transfer/spec.md` (7 requirements with 20+ `GIVEN/WHEN/THEN` scenarios)
- Migrations `001_initial_schema.sql` (members/RLS/log_mutation/seed vault demo key/pgcrypto), `011_youth_retreat_preregistration.sql` (retreat DDL/RPC/triggers/`total_cost ''`), `013_retreat_member_link.sql` (nullable `member_id` + partial index + authenticated RPC)
- Supabase docs: RLS `WITH (security_invoker)` (PG15), `SECURITY DEFINER` public endpoint trap, `auth.role()` deprecation, `pg_trgm` `gin_trgm_ops`
- Supabase-postgres best practices: partial indexes, `pgcrypto` `pgp_sym_encrypt`, `FOR UPDATE` locking, `query-missing-indexes`
- `openspec/config.yaml` `strict_tdd:true`, `vitest 3.2.1`, `playwright 1.62.1`, `xlsx 0.20.3`

---

## Appendix A — Pagination vs Export Scope (normative)

| Surface | Filter handling | `range` | Payments query |
|---|---|---|---|
| Paginated table | `tab` + `searchDebounced` → `eq/or` | `range(from,to)` `count:'exact'` | `.in(visibleIds)` bounded by `pageSize` |
| Export estado pago | Same `tab` + `search` (from toolbar state) | No `range` — loop `chunk 1000` | `in(allIds)` chunked 900 |
| Export inscritos | Forces `status='inscrito'` overriding tab + `search` if any | No `range` — loop `chunk 1000` | `in(allIds)` chunked 900 |
| Print | Same as table visible page (CSS hides actions) | N/A | N/A |

## Appendix B — Column Contract for Verify

Estado pago **and** inscritos share the same 15 columns in normative order: `Nombre | Teléfono | Email | FechaNacimiento | EsMenor | RepresentanteLegal | Estado | Pagado COP | Saldo COP | PorcentajePagado | TotalRetiro COP | CantidadAbonos | ÚltimoAbono | TransferidoAValientes | FechaTransferencia` — header row `Evento: retiro-juvenil-octubre-2026 | Generado: es-CO <now>`.

## Appendix C — Views & Policies (no new RLS widening)

No `CREATE POLICY ... FOR SELECT/INSERT/UPDATE` on `retreat_registrations`, `retreat_payments`, `members` in `014`. Existing policies from 011+001 remain. View `retreat_registration_with_payments` has no policy of its own — it inherits via `security_invoker=true`.

---

> No `spec` or `tasks` are created in this phase — design only. Next phase: `sdd-tasks` slices `PR1/PR2/PR3` per §10 with TDD `RED → GREEN` gates and `supabase db reset` 001→014 + `retreat_rls.test.sql` extension.
