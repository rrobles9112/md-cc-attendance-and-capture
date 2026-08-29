# Retreat Valientes Transfer Specification

## Purpose

When a pre-registered youth (`retreat_registrations`, `event_key='retiro-juvenil-octubre-2026'`) has completed the full retreat payment (`SUM(retreat_payments) >= retreat.youth.total_cost`, `status='inscrito'`) and has lived the retreat, staff SHALL be able to transfer that person — as a future attendee — into the members directory as `members.pastoral_group='Valientes'`. The transfer MUST be manual, idempotent, auditable under Ley 1581, and gated by payment state. The retreat module MUST expose a paginated, indexed, tabbed table with real-time payment aggregates and on-demand Excel/print reports. No automatic trigger, no bulk transfer, and no server-side export SHALL be introduced in V1.

## Requirements

### Requirement: Transfer Eligibility Gate

The system MUST allow transfer to Valientes only when ALL of the following hold for a given `retreat_registrations` row and session:

- `SUM(retreat_payments.amount WHERE registration_id = :id) >= CAST(app_settings.value AS numeric) WHERE key='retreat.youth.total_cost'` (positive numeric, else blocked) — i.e. derived `status='inscrito'`.
- `retreat_registrations.transferred_at IS NULL` (idempotency guard).
- The acting user has checked the explicit Ley 1581 checkbox **"Acepto que mis datos se traten para mi incorporación al grupo Valientes (Ley 1581) — pdtp-v1.0-2026-07-17"** in the confirmation dialog (link to `/privacidad`). The `Transferir` button MUST remain disabled until checked.
- The UI button `Transferir a Valientes` MUST be enabled IFF `status='inscrito' && transferred_at IS NULL && canTransferRetreatToValientes(role) && navigator.onLine && hasSession`; otherwise it MUST be disabled with an explanatory tooltip.

Attempts that violate the gate MUST be rejected with stable `ERRCODE` (`23514 not_inscrito` for payment/status, `23505 already_transferred` for idempotency, `23514 missing_total` for missing/empty/non-numeric/<=0 total) and MUST NOT create or mutate a `members` row.

#### Scenario: Happy — inscrito with full payment and explicit consent transfers

- GIVEN `retreat.youth.total_cost = '400000'` and a registration `R` with `status='inscrito'` (`SUM=400000`) and `transferred_at IS NULL`
- AND an authenticated `leader` who has checked the explicit Ley 1581 transfer checkbox
- WHEN that leader clicks `Transferir a Valientes` and confirms
- THEN the system SHALL invoke `transfer_retreat_to_valientes(R.id)` and, on success, set `retreat_registrations.transferred_at=now()`, `transferred_member_id`, `transferred_by=auth.uid()`, create or update a `members` row with `pastoral_group='Valientes'`, show toast `Transferido a Valientes` with action `Ver miembro`, and render badge `Transferido ✓` with date

#### Scenario: Not inscrito blocked

- GIVEN `R` with `status='preinscrito'` (`SUM=0`) or `status='pagos_parciales'` (`0 < SUM < 400000`)
- WHEN a `leader` attempts to transfer `R` (or calls the RPC directly)
- THEN the system SHALL reject with `23514 not_inscrito` (message contains `not_inscrito`)
- AND no `members` row SHALL be created and `transferred_at` SHALL remain `NULL`

#### Scenario: Missing or invalid total_cost blocked

- GIVEN `app_settings.retreat.youth.total_cost` is `NULL`, `''`, `'abc'`, `'0'` or `'-10'`
- WHEN transfer is attempted for any `R`
- THEN the system SHALL reject with `23514 missing_total`
- AND no mutation SHALL persist

#### Scenario: Explicit consent checkbox required

- GIVEN `R` is `inscrito` and `transferred_at IS NULL` and a `leader` opens the transfer dialog
- AND the Ley 1581 checkbox is unchecked
- WHEN the dialog is rendered
- THEN the `Transferir` confirm button SHALL be disabled
- AND checking the box SHALL enable it, unchecking SHALL disable it again

---

### Requirement: Idempotent Transfer RPC with Concurrency Safety

The system MUST provide `public.transfer_retreat_to_valientes(p_registration_id UUID) RETURNS UUID` with the following normative contract:

- `LANGUAGE plpgsql SECURITY DEFINER SET search_path=''`; `REVOKE ALL ON FUNCTION ... FROM PUBLIC; GRANT EXECUTE TO authenticated` only; fully qualified `public.*` references; `COMMENT`; `NOTIFY pgrst` after migration.
- Body MUST: (1) gate `IF (SELECT public.user_role()) NOT IN ('leader','super_admin') THEN RAISE ... USING ERRCODE='42501'`; (2) `SELECT * FROM public.retreat_registrations WHERE id=p_registration_id FOR UPDATE` (row lock) — if not found `RAISE ... USING ERRCODE='P0002'`; (3) `IF transferred_at IS NOT NULL THEN RAISE ... already_transferred USING ERRCODE='23505'`; (4) validate `retreat.youth.total_cost` as above; (5) `SELECT COALESCE(SUM(amount),0) ... FROM public.retreat_payments WHERE registration_id=p_registration_id` and reject if `sum < total` or `status <> 'inscrito'` with `23514 not_inscrito`; (6) duplicate pre-check before write; (7) branch on `member_id`; (8) `UPDATE public.retreat_registrations SET transferred_at=now(), transferred_member_id=:new_id, transferred_by=auth.uid() WHERE id=p_registration_id`; (9) `RETURN new_members.id`; (10) `EXCEPTION WHEN unique_violation THEN RAISE ... already_member USING ERRCODE='23505'`.
- Branch A — `member_id IS NOT NULL` (origin 013 link): MUST `UPDATE public.members SET pastoral_group='Valientes' WHERE id = retreat.member_id` (definer bypass; no widening of `members_update` which remains `super_admin`-only). Branch B — `member_id IS NULL`: MUST `INSERT INTO public.members (name, name_normalized, phone, email, birthday, is_minor, legal_rep_name, has_whatsapp, consent_recorded, sensitive_consent_recorded, denomination_encrypted, community_name_encrypted, pastoral_group, created_by)` with transforms: `name=btrim(retreat.name)`, `name_normalized=lower(btrim(retreat.name))`, `email=lower(btrim(retreat.email))`, `phone` digit-strip then `+57` prefix when 10 digits colombian else preserve `+` E164, `birthday/is_minor/legal_rep_name` direct, `has_whatsapp=false`, `duplicate_flag=false`, `consent_recorded=true`, `sensitive_consent_recorded=(retreat.sensitive_consent_accepted_at IS NOT NULL)`, `pastoral_group='Valientes'`, `denomination_encrypted/community_name_encrypted = pgp_sym_encrypt(vault_key)` only when `sensitive_consent IS NOT NULL` (via `vault.decrypted_secrets` key `members_encryption_key`, fallback demo key only when vault empty local/CI), else `NULL`, `created_by=auth.uid()`.
- Duplicate guard: before insert, MUST `IF EXISTS (SELECT 1 FROM public.members WHERE deleted_at IS NULL AND (lower(btrim(email))=v_email OR regexp_replace(phone,'[^0-9]','g')=v_phone)) THEN RAISE ... already_member USING ERRCODE='23505'`; the unique-violation handler MUST map races to the same `already_member 23505`.

The second concurrent caller waiting on `FOR UPDATE` MUST observe `transferred_at IS NOT NULL` and receive `23505 already_transferred` without creating a second member.

#### Scenario: Happy — new member branch inserts Valientes

- GIVEN `R` with `member_id IS NULL`, `status='inscrito'`, `transferred_at IS NULL`, `phone='3001234567'`, `email='ANA@Example.COM '`, `sensitive_consent_accepted_at IS NOT NULL`
- WHEN `leader` calls `transfer_retreat_to_valientes(R.id)` with explicit checkbox checked
- THEN the RPC SHALL `INSERT` one `members` row with `name_normalized='ana'`, `email='ana@example.com'`, `phone='+573001234567'`, `pastoral_group='Valientes'`, `denomination_encrypted=pgp_sym_encrypt(...)`, `consent_recorded=true`, and `UPDATE` `R` with `transferred_at IS NOT NULL` and `transferred_member_id` equal to the new member id

#### Scenario: Happy — existing member branch updates pastoral_group

- GIVEN `R` with `member_id = M.id` (013 link), `M.pastoral_group IS NULL`, `R.status='inscrito'`
- WHEN `leader` transfers `R`
- THEN the RPC SHALL NOT insert a new `members` row
- AND it SHALL `UPDATE members SET pastoral_group='Valientes' WHERE id=M.id`
- AND `R.transferred_member_id` SHALL equal `M.id`

#### Scenario: Idempotency — already_transferred

- GIVEN `R` already has `transferred_at='2026-08-27T10:00:00Z'` and `transferred_member_id=M.id`
- WHEN any `leader` or `super_admin` calls `transfer_retreat_to_valientes(R.id)` again
- THEN the RPC SHALL `RAISE EXCEPTION 'already_transferred: ...' USING ERRCODE='23505'`
- AND no second `members` row SHALL be created and `transferred_at` SHALL be unchanged

#### Scenario: Duplicate already_member and concurrency isolation

- GIVEN `R` is `inscrito` but `public.members` already contains `M2` with `deleted_at IS NULL` and `lower(btrim(email))='ana@example.com'`
- WHEN `leader` attempts to transfer `R` whose email normalizes to `ana@example.com`
- THEN the RPC SHALL `RAISE already_member USING ERRCODE='23505'` with message `Ya existe miembro` (client maps to `Ver miembro`)
- AND concurrent duplicate via `unique_violation` on a race SHALL map to the same `23505 already_member`
- AND concurrent double-transfer on the same `R` (two leaders `FOR UPDATE`) SHALL serialize, second SHALL receive `already_transferred 23505`

---

### Requirement: Valientes Pastoral Group Field

The system MUST add `public.members.pastoral_group TEXT` as `NULL` until transfer, with `CHECK (pastoral_group IS NULL OR char_length(btrim(pastoral_group)) > 0)` (open, not `IN ('Valientes')` to allow extension without migration), `COMMENT ON COLUMN ... 'Pastoral group; Valientes for retreat graduates. NULL until transfer. G1; G2 junction deferred.'`, and a partial index `CREATE INDEX IF NOT EXISTS members_pastoral_group_idx ON public.members(pastoral_group) WHERE pastoral_group IS NOT NULL`. All pre-existing member rows MUST have `pastoral_group IS NULL` (no backfill, no `NOT NULL`, no `UNIQUE`). No `groups` table or `member_groups` junction SHALL be created in V1. The pastoral group MUST be set only via the transfer RPC (definer) — direct PostgREST `UPDATE members SET pastoral_group` remains `super_admin`-only per existing `members_update` policy.

#### Scenario: Migration creates nullable column and partial index

- GIVEN no `pastoral_group` column exists
- WHEN migration `014_retreat_valientes_transfer` runs
- THEN `members.pastoral_group` SHALL be `TEXT NULL CHECK (...)`
- AND `members_pastoral_group_idx WHERE pastoral_group IS NOT NULL` SHALL exist
- AND every pre-existing row SHALL have `pastoral_group IS NULL`

#### Scenario: Filtering Valientes members

- GIVEN members `M1` with `pastoral_group='Valientes'` and `M2` with `pastoral_group IS NULL`
- WHEN client queries `supabase.from('members').select('id').eq('pastoral_group','Valientes')`
- THEN `M1` SHALL be returned and `M2` SHALL NOT
- AND the query plan SHOULD use `members_pastoral_group_idx`

#### Scenario: Overwrite documents single-group G1 semantics

- GIVEN `M` with `pastoral_group='Valientes'`
- WHEN `M` is transferred again via a different registration (should be blocked by `already_transferred`) or future G2 migration
- THEN current V1 semantics SHALL treat `pastoral_group` as single-valued; transfer of a different identity to the same `M` via `already_member` is rejected, not silently overwritten

---

### Requirement: Paginated Indexed Retreat Table

The retreat registrations staff page `src/app/(dashboard)/retreat-registrations/page.tsx` MUST replace the current unpaginated `select(...).order('name')` load with server-side pagination, tabbed status filters, and indexed search:

- Query MUST use `supabase.from('retreat_registrations').select('id,name,email,phone,birthday,is_minor,legal_rep_name,status,created_at,transferred_at,transferred_member_id,member_id', {count:'exact'}).eq('event_key', RETREAT_EVENT_KEY).order('name').range(from, to)` where `from=(page-1)*pageSize`, `to=from+pageSize-1`, `pageSize` in `{20,50}` (default `20`), `order('name')` stable.
- Filters: tabs `Todos / Preinscritos / Inscritos` mapping `Todos→no filter, Preinscritos→status IN ('preinscrito','pagos_parciales')?` but V1 lock: `Preinscritos→ status='preinscrito'` and `pagos_parciales` under separate handling OR `Inscritos→ status='inscrito'`; tabs MUST translate to `eq('status',tab)` when `tab !== 'todos'`. Exact tab mapping MUST be documented and tested; default `Todos`.
- Search: debounced (≥300ms) `Input` that, when trimmed non-empty, adds `.or('name.ilike.%search%,email.ilike.%search%,phone.ilike.%search%')`. The search MUST be backed by migration indexes: `CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE INDEX retreat_registrations_search_trgm_idx ON retreat_registrations USING gin ((lower(name)||' '||lower(email)||' '||phone) gin_trgm_ops); CREATE INDEX retreat_registrations_status_idx ON retreat_registrations(status); CREATE INDEX retreat_registrations_event_status_idx ON retreat_registrations(event_key,status); CREATE INDEX retreat_registrations_created_at_idx ON retreat_registrations(created_at); CREATE INDEX retreat_payments_registration_id_created_at_idx ON retreat_payments(registration_id, created_at DESC);` All indexes `IF NOT EXISTS`.
- Columns rendered: `Nombre, Email, Teléfono, Estado (badge), Pagado, Saldo, % Pagado, Último abono, Acciones`. `Pagado/Saldo/%/Último` derived from `retreat_payments` visible-ids only: `SELECT registration_id, amount, created_at FROM retreat_payments WHERE registration_id IN (:visibleIds)` then `sumPaidByRegistration` map; `remaining=total-sum`, `percent=sum/total*100`, `last=MAX(created_at)`. Table MUST show footer `Mostrando X-Y de N` and `Página X de Y` with `Prev/Next` pagination controls.
- Payments fetch MUST NOT load the whole `retreat_payments` table (no full scan). `canManageRetreatRegistrations` gate (`leader`/`super_admin`) MUST guard the page; unauthenticated or unauthorized SHALL see access denied.
- Optional view `retreat_registration_with_payments` `WITH (security_invoker=true)` `SELECT rr.*, COALESCE(SUM(p.amount),0) total_paid, COUNT(p.id) payment_count, MAX(p.created_at) last_payment_at LEFT JOIN` MAY exist but MUST NOT bypass RLS. Offline (`navigator.onLine===false` or no session) MUST disable pagination/search actions that require network.

#### Scenario: Server-side pagination with exact count

- GIVEN 45 registrations for `event_key='retiro-juvenil-octubre-2026'` and `pageSize=20`, `page=2`, `tab='todos'`, no search
- WHEN the page loads
- THEN the client SHALL issue `range(20,39)` with `count:'exact'`
- AND the UI SHALL display `Mostrando 21-40 de 45` and `Página 2 de 3`
- AND no more than `20` rows SHALL be rendered on that page

#### Scenario: Tabs filter by status

- GIVEN rows with `status='preinscrito'`, `'pagos_parciales'`, `'inscrito'`
- WHEN the user selects tab `Inscritos`
- THEN the query SHALL add `.eq('status','inscrito')` and `count` SHALL reflect only `inscrito` rows
- AND switching to `Todos` SHALL remove the status filter

#### Scenario: Debounced indexed search

- GIVEN `GIN pg_trgm` index exists on `(lower(name)||' '||lower(email)||' '||phone)`
- WHEN the user types `ana` in the search input
- THEN after debounce, the query SHALL add `.or('name.ilike.%ana%,email.ilike.%ana%,phone.ilike.%ana%')`
- AND results SHALL include rows matching name/email/phone case-insensitively
- AND `EXPLAIN` on the underlying SQL SHOULD indicate index usage for `ILIKE %substr%` when dataset is large

#### Scenario: Payments limited to visible ids (no full scan)

- GIVEN paginated page shows ids `[R1,R2,R3]`
- WHEN payments are fetched
- THEN the query SHALL be `.in('registration_id', ['R1','R2','R3'])`
- AND it SHALL NOT issue `select * from retreat_payments` without a filter

---

### Requirement: Excel Exports and Print

The system MUST provide `src/lib/retreat/export.ts` pure helpers and toolbar actions for two on-demand Excel exports plus print, reusing the existing SheetJS pattern (`XLSX.utils.json_to_sheet → XLSX.utils.book_new → XLSX.utils.book_append_sheet → XLSX.write({bookType:'xlsx',type:'array'}) → Blob → downloadBlob`):

- Type `RetreatReportRow` with columns normative order: `Nombre | Teléfono | Email | FechaNacimiento | EsMenor | RepresentanteLegal | Estado | Pagado COP | Saldo COP | PorcentajePagado | TotalRetiro COP | CantidadAbonos | ÚltimoAbono | TransferidoAValientes (Sí/No) | FechaTransferencia`.
- Helpers: `buildReportRows(registrations, payments, totalCost): RetreatReportRow[]` (pure, derives `Pagado=SUM`, `Saldo=total-Pagado`, `%=Pagado/total*100`, `Cantidad=COUNT`, `Último=MAX(created_at)`, `Transferido=transferred_at IS NOT NULL ? 'Sí':'No'`, formats `FechaNacimiento/ÚltimoAbono/FechaTransferencia` as `es-CO` date; empty total → rows still built with `TotalRetiro=''`), `exportRetreatToXLSX(rows, filename)`, `exportRetreatToCSV(rows, filename)`.
- Toolbar buttons `Exportar estado de pago (todos)` and `Exportar inscritos` and `Imprimir` in `retreat-registrations/page.tsx`; each export MUST respect current filters (`tab` + `search`) — (a) Estado de pago exports the filtered set without `range` (all matching rows), (b) Inscritos forces `status='inscrito'` regardless of tab. Filenames MUST be `retiro-estado-pago-YYYY-MM-DD.xlsx` and `retiro-inscritos-YYYY-MM-DD.xlsx` with header row `Evento: retiro-juvenil-octubre-2026 | Generado: es-CO <now-dd-MM-yyyy>` at top of sheet (first row or sheet header).
- Chunked fetch: exports MUST loop `range(page*1000, (page+1)*1000-1)` (chunk size `1000`) until `data.length < 1000` to avoid PostgREST `max_rows` truncation; client still writes a single workbook concatenating chunks.
- Print: `Imprimir` calls `window.print()`; page MUST include `@media print { nav, .no-print {display:none} tr{break-inside:avoid} @page{margin:1cm} }` and a printed header `Confidencial Ley 1581 — Uso interno MD CC — Evento: retiro-juvenil-octubre-2026 — Generado: <es-CO>` visible only in print.
- Offline or unauthenticated MUST disable export/print buttons with `disabled title="Requiere conexión"` and MUST NOT attempt a fetch. Exports MUST be gated by `canManageRetreatRegistrations` and by RLS (authenticated `leader`/`super_admin` only).

#### Scenario: Happy — estado de pago export respects filters

- GIVEN `tab='todos'`, search `''`, `RETREAT_EVENT_KEY='retiro-juvenil-octubre-2026'`, and 3 registrations with varying `status`
- WHEN the user clicks `Exportar estado de pago (todos)`
- THEN the client SHALL fetch `retreat_registrations` with `eq('event_key', RETREAT_EVENT_KEY)` (no `range`, chunked 1000) and `retreat_payments` for those ids
- AND `buildReportRows` SHALL compute `Pagado/Saldo/%/Cantidad/Último` per row
- AND `exportRetreatToXLSX` SHALL download `retiro-estado-pago-YYYY-MM-DD.xlsx` with header `Evento: retiro-juvenil-octubre-2026` and columns in normative order

#### Scenario: Inscritos export forces inscrito filter

- GIVEN current tab `Todos` but user clicks `Exportar inscritos`
- WHEN export runs
- THEN the fetch SHALL add `eq('status','inscrito')` (overriding tab) and only `inscrito` rows SHALL appear in the workbook
- AND filename SHALL be `retiro-inscritos-YYYY-MM-DD.xlsx`

#### Scenario: Chunked fetch for max_rows 1000

- GIVEN `1500` filtered registrations exist
- WHEN any export is triggered
- THEN the client SHALL issue two paginated fetches `range(0,999)` and `range(1000,1999)` (second returns `500` rows) and concatenate before `json_to_sheet`
- AND the resulting Excel SHALL contain `1500` data rows

#### Scenario: Print and offline disabled

- GIVEN an authenticated `leader` with `navigator.onLine === true`
- WHEN `Imprimir` is clicked
- THEN `window.print()` SHALL be invoked and print CSS SHALL hide nav/actions and show `Confidencial Ley 1581`
- AND when `navigator.onLine === false`, export and print buttons SHALL be `disabled` with `title="Requiere conexión"` and no network request SHALL be issued

---

### Requirement: Abonos Real-Time Aggregated Report

The system MUST display a real-time abonos report in the same retreat section (either as expanded columns in the paginated table or a dedicated tab `Reporte de abonos`), derived live from `retreat_payments` — no materialized view in V1:

- Per-row aggregates: `total_paid = COALESCE(SUM(amount),0)`, `remaining = CASE WHEN total IS NULL THEN NULL ELSE total - total_paid END`, `percent = CASE WHEN total IS NULL OR total=0 THEN NULL ELSE total_paid/total*100 END`, `payment_count = COUNT(id)`, `last_payment_at = MAX(created_at)` grouped by `registration_id`. Data source is either client `sumPaidByRegistration` over the visible-ids payments fetch or optional view `retreat_registration_with_payments WITH (security_invoker=true)` (normative: if view exists it MUST be `WITH (security_invoker=true)` and `GROUP BY rr.id`).
- Footer aggregates: `Total preinscritos = COUNT(*)`, `Inscritos = COUNT WHERE status='inscrito'`, `Suma abonos = SUM(total_paid)`, `Pendiente = SUM(remaining)` (or `COUNT * total - Suma`).
- The report MUST update immediately after each successful `retreat_payments` insert (trigger `retreat_payments_apply_status` updates `status`, and fresh `SUM` is read); no cache or stale aggregate SHALL be shown after insert.
- View (if created) MUST be read-only, MUST NOT have separate RLS bypass, and MUST respect `retreat_registrations_select` / `retreat_payments_select` via `security_invoker`.

#### Scenario: Happy — aggregates compute correctly

- GIVEN `totalCost=400000` and registration `R` with payments `200000 + 100000`
- WHEN the report row for `R` is rendered
- THEN `Pagado` SHALL be `300000`, `Saldo` `100000`, `%` `75`, `Cantidad` `2`, `Último` the later `created_at`
- AND footer SHALL include `R` in `Total preinscritos` and not yet in `Inscritos`

#### Scenario: Real-time after each abono

- GIVEN `R` currently `pagos_parciales` with `SUM=300000`
- WHEN staff records an additional payment `100000`
- THEN on next page fetch (or re-query) `R.status` SHALL become `inscrito` and `Pagado` `400000`, `Saldo` `0`, `%` `100`

#### Scenario: Null total shows without remaining/percent

- GIVEN `retreat.youth.total_cost` is `NULL` (payments blocked)
- WHEN the report is rendered
- THEN `Pagado`, `Cantidad`, `Último` SHALL still be shown, `Saldo` and `%` SHALL be empty/`—`, and view (if exists) SHALL NOT throw

---

### Requirement: RBAC and Audit under Ley 1581

The transfer and reporting surface MUST enforce role-based access and Ley 1581 audit:

- RBAC: `src/lib/rbac/guards.ts` MUST export `canTransferRetreatToValientes(role) = canCreate(role)` i.e. `role IN ('leader','super_admin')` (same gate as `canManageRetreatRegistrations`); `REVOKE ALL ON FUNCTION transfer_retreat_to_valientes FROM PUBLIC; GRANT EXECUTE TO authenticated` — `anon` MUST have no execute (direct `RET` `42501` via no grant), `server` MUST fail inside RPC `user_role()` check `42501`, double gate UI + RPC. No new policy SHALL widen `anon`/`server` on `retreat_registrations` or `retreat_payments` or `members`; existing `SELECT`/`INSERT` policies remain (`retreat SELECT` leader/super_admin, `payments INSERT` leader/super_admin, `members UPDATE` super_admin-only — transfer updates via definer only).
- Offline: transfer, exports, and print MUST be `disabled title="Requiere conexión"` when `!navigator.onLine` or no Supabase session; no Dexie `retreat_*` store, no `sync_queue` entry, no `supabase_realtime` subscription for retreat.
- Audit: existing triggers `audit_retreat_registrations` / `audit_members` (`public.log_mutation()`) MUST fire on transfer; `audit_log` rows MUST capture `old_value`/`new_value` JSONB containing `pastoral_group` diff on `members` and `transferred_at/transferred_member_id/transferred_by` on `retreat_registrations`. The transfer dialog MUST show purpose note `Se creará un miembro en Valientes con los datos del retiro. Esta acción es irreversible. Ley 1581` and the explicit checkbox linked to `/privacidad` (policy `pdtp-v1.0-2026-07-17`).
- Sensitive data: `retreat_registrations.denomination/community_name` plain TEXT vs `members.denomination_encrypted/community_name_encrypted` `BYTEA pgp_sym_encrypt(vault_key)`; encryption MUST use `vault.decrypted_secrets WHERE name='members_encryption_key'` inside definer; client MUST NOT receive the key; exports/prints MUST show header `Confidencial Ley 1581` and be gated behind the same RBAC.
- No mutation of `retreat_payments` `guard_total`/`apply_status` triggers, no change to `anon` RPC `register_retreat_preinscription`, no change to `RETREAT_EVENT_KEY`.

#### Scenario: Leader and super_admin can transfer, anon and server cannot

- GIVEN an authenticated `leader` and an authenticated `server` and an `anon` key
- WHEN `leader` calls `transfer_retreat_to_valientes(R.id)` for an `inscrito` `R`
- THEN it SHALL succeed
- AND when `server` calls it (even with JWT) it SHALL `RAISE insufficient permissions USING ERRCODE='42501'`
- AND when `anon` calls it it SHALL fail with `permission denied` (no `GRANT EXECUTE`)

#### Scenario: Offline transfer disabled

- GIVEN `navigator.onLine === false` while a `leader` views `/(dashboard)/retreat-registrations`
- WHEN the transfer button is rendered for an `inscrito` row
- THEN it SHALL be `disabled` with `title="Requiere conexión"`
- AND clicking SHALL NOT invoke the RPC and SHALL NOT write Dexie or enqueue

#### Scenario: Audit log captures pastoral_group and transferred_* (Ley 1581)

- GIVEN a successful transfer of `R` creating `M` with `pastoral_group='Valientes'`
- WHEN `public.audit_log` is inspected for `table_name IN ('members','retreat_registrations') AND record_id IN (M.id, R.id)` ordered by `created_at DESC`
- THEN at least one `members` audit row SHALL have `new_value->>'pastoral_group'='Valientes'`
- AND at least one `retreat_registrations` audit row SHALL have `new_value->>'transferred_member_id'=M.id::text` and `new_value->>'transferred_by'=auth.uid()::text`
- AND the transfer dialog SHALL have shown the Ley 1581 explicit checkbox before the RPC was invoked

#### Scenario: Isolation — retreat mutations do not widen members RLS

- GIVEN `leader` can execute the transfer RPC
- WHEN `leader` attempts direct `supabase.from('members').update({pastoral_group:'Valientes'}).eq('id', M.id)` via PostgREST
- THEN the operation SHALL fail under `members_update` policy (`super_admin` only)
- AND only the definer RPC SHALL be able to set `pastoral_group`
