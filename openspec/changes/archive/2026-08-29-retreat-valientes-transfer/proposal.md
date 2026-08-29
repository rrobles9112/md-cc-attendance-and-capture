# Proposal: Retreat Valientes Transfer

> **Change:** `retreat-valientes-transfer`  
> **Artifact store:** `openspec` — `openspec/changes/retreat-valientes-transfer/proposal.md` + Engram `sdd/retreat-valientes-transfer/proposal`  
> **Exploration:** `openspec/changes/retreat-valientes-transfer/explore.md` + Engram `sdd/retreat-valientes-transfer/explore` (#102)  
> **Date:** 2026-08-27  
> **Mode:** `strict_tdd=true`, `artifact_store=openspec`, `RDD ON` (global on, high-tier)  
> **Workspace:** `/Users/richard.robles/PycharmProjects/MD_CC_ATTENDANCE_AND_CAPTURE`  
> **Status:** Proposed — awaiting spec/design  
> **Author:** SDD proposal executor (Muse Spark — Gentle AI)

---

## Executive Summary (rioplatense)

Che, los datos del retiro son parecidos a `members` pero esas personas todavía no son miembros — son futuros asistentes. El pedido pide un mecanismo para cuando hayan vivido el retiro, es decir, cuando después de preinscritas hayan completado el **pago total $400.000 COP** (con **abonos parciales $200.000 COP** que se van consignando en el módulo correspondiente) y pasen al directorio como asistentes del grupo pastoral **Valientes**. Hoy `/(dashboard)/retreat-registrations` es un único `<Table>` sin tabs, sin paginación, sin buscador indexado y sin reportes — carga todo con `select(...).order('name')` y deja a tesorería sin forma de imprimir/exportar el estado de pago por preinscrito ni el listado de inscritos. Esta propuesta lockea una operación atómica e idempotente `transfer_retreat_to_valientes(registration_id UUID)` habilitada solo cuando `SUM(retreat_payments) >= retreat.youth.total_cost` (`status='inscrito'`), que marca `transferred_at / transferred_member_id / transferred_by` con `FOR UPDATE` y crea o actualiza `members.pastoral_group='Valientes'` según `member_id` (013). La tabla pasa a tabulada/paginada server-side `range(count:'exact')` con tabs, buscador `or ilike` + GIN `pg_trgm`, y dos Excels on-demand + print con SheetJS en `src/lib/retreat/export.ts`; el reporte de abonos es agregado tiempo real (`SUM/remaining/%/MAX`) en la misma sección. RBAC `leader+super_admin`, audit `log_mutation`, offline disabled, RDD high 4-lens. Sin trigger auto, sin bulk ni server export en V1.

---

## Proposal Question Round

Per SDD Skill Resolution Contract no se emite question round bloqueante adicional: la exploración ya lockeó Q1–Q10 con defaults verificados (§13 D1–D10). Si se desea modo interactivo, el reviewer corrige aquí o pide segunda ronda.

**Assumptions needing confirmation:**

- Transfer solo `inscrito` (`SUM >= $400k`); idempotente `transferred_at IS NOT NULL → already_transferred 23505`.
- `Valientes` es `members.pastoral_group TEXT` nullable (G1); `groups`/`member_groups` G2 deferred.
- Si `member_id IS NOT NULL` → `UPDATE members SET pastoral_group='Valientes'` en vez de crear duplicado.
- Export client-side SheetJS primario; server route follow-up. Bulk transfer follow-up a single-RPC V1.
- RBAC laxo `leader+super_admin` (endurecer a `super_admin` only es 1 line).
- Checkbox explícito Ley 1581 obligatorio en diálogo de confirmación.

---

## 1. Summary

Transferir preinscritos/inscritos del retiro juvenil de octubre (`event_key='retiro-juvenil-octubre-2026'`) que completan **pago total $400.000 COP** (abonos parciales $200.000 COP, `status` derivado por triggers `retreat_payments_guard_total`/`retreat_payments_apply_status` en 011) a miembros del grupo **Valientes** como futuros asistentes. La operación es un RPC idempotente `transfer_retreat_to_valientes(registration_id UUID)` con `transferred_at/transferred_member_id/transferred_by` FK, `FOR UPDATE` row lock, gate `status='inscrito'` y branches:

- `member_id IS NOT NULL` → `UPDATE members SET pastoral_group='Valientes'` vía definer.
- `member_id IS NULL` → `INSERT members (...) pastoral_group='Valientes'` con `pgp_sym_encrypt` para `denomination/community_name`, `phone` digit-only→E164 `+57`, `name_normalized=lower(btrim)`, `duplicate already_member 23505`.

La **tabla de retiro** pasa a **tabulada/paginada/buscador indexado**: server-side `range(count:'exact')`, tabs `Todos/Preinscritos/Inscritos` (mapeo `preinscrito/pagos_parciales/inscrito`), `Input` búsqueda debounced `or(name.ilike,email.ilike,phone.ilike)` con `GIN pg_trgm ((lower(name)||' '||lower(email)||' '||phone) gin_trgm_ops)` + `btree(status)` + `btree(created_at)` en 014, pagination 20/50, `order('name')`. **Reportes Excel on-demand (dos)**: estado de pago por preinscrito (todos filtrados) y listado de inscritos (fully paid `SUM>=total`) vía `src/lib/retreat/export.ts` (SheetJS `json_to_sheet→book_new→write→Blob→download`), `MAX_ROWS 1000` chunked, más `window.print` + `@media print` header `Confidencial Ley 1581`; server export follow-up opcional. **Reporte abonos tiempo real**: vista agregada por persona (`SUM(amount)`, `remaining=total-sum`, `%=sum/total*100`, `COUNT`, `MAX(created_at)`) en sección Retiro, no materialized. RBAC `leader/super_admin` (`canTransferRetreatToValientes=canCreate`), audit `log_mutation` ambas tablas, offline disabled (`disabled title="Requiere conexión"`), RDD high 4-lens.

---

## 2. Intent

### 2.1 Business Problem
Aunque los datos de preinscripción al retiro son similares a `members`, son futuros miembros. Sin transferencia, el retiro queda huérfano del directorio, se duplican cargas y se pierde trazabilidad `pagos → Valientes` cuando alguien vive el retiro tras consignar abonos ($200k) hasta total ($400k). El equipo pastoral pidió explícitamente **opción que me permita transferir a los preinscritos e inscritos del retiro como asistentes al grupo Valientes en calidad de miembros**.

### 2.2 Target Users & Situations
- **Primary:** `leader` y `super_admin` en `/(dashboard)/retreat-registrations` al momento en que tesorería marca `inscrito` (`SUM>=400k`) y pastoral confirma que la persona vivió el retiro. Urgencia operativa de cierre de campaña Valientes.
- **Secondary:** Tesorería/secretaría para **Excel estado pago por preinscrito / listado inscritos** y **reporte abonos tiempo real** (conciliación/auditoría).
- **Out:** `server` (solo asistencia), `anon` (solo `/retiro`).

### 2.3 Product Outcome
Tabla tabulada/paginada/buscable con `Nombre, Email, Teléfono, Estado, Pagado, Saldo, % Pagado, Último abono, Acciones`; fila `inscrito` no transferida muestra **Transferir a Valientes** habilitado → diálogo con nota Ley 1581 + checkbox explícito **Acepto que mis datos se traten para mi incorporación al grupo Valientes (Ley 1581)** → RPC atómico → toast **Transferido a Valientes + Ver miembro** + badge **Transferido ✓** con fecha; segundo intento → `Ya fue transferido DD/MM/YYYY`. Excels y print on-demand con filtros aplicados; reporte abonos refleja `Pagado/Saldo/%/CantAbonos/ÚltimoAbono` tiempo real. Nuevo valiente filtrable por `pastoral_group='Valientes'` con sensibles cifradas si hubo consentimiento.

### 2.4 Current-State Gap
Verificado `retreat-registrations/page.tsx:60-70`: `Promise.all([select('id,name,email,phone,status').eq('event_key',RETREAT_EVENT_KEY).order('name'), select(payments), getTotalCost])` sin `range/count/ilike/tabs/member_id/birthday/is_minor`, sin botón transfer, sin Excel/print, sin reporte agregado, carga todas las filas — no eficiente/indexado. `grep Valientes/groups/members.group` = 0 hits en migrations/src → no existe `pastoral_group` ni `groups` table. No hay `transferred_*`, `pg_trgm` GIN ni `btree(status)`. `src/lib/export/generate.ts` solo exporta `members` vía Dexie.

---

## 3. Scope

### 3.1 In Scope
- **Schema 014_retreat_valientes_transfer.sql (idempotente, `IF NOT EXISTS`, `DO $$`, `NOTIFY pgrst`):**
  ```sql
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  ALTER TABLE public.members ADD COLUMN IF NOT EXISTS pastoral_group TEXT
    CHECK (pastoral_group IS NULL OR char_length(btrim(pastoral_group))>0);
  CREATE INDEX IF NOT EXISTS members_pastoral_group_idx ON public.members(pastoral_group) WHERE pastoral_group IS NOT NULL;
  ALTER TABLE public.retreat_registrations ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMPTZ;
  ALTER TABLE public.retreat_registrations ADD COLUMN IF NOT EXISTS transferred_member_id UUID REFERENCES public.members(id) ON DELETE SET NULL;
  ALTER TABLE public.retreat_registrations ADD COLUMN IF NOT EXISTS transferred_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS retreat_registrations_transferred_member_id_idx ON public.retreat_registrations(transferred_member_id) WHERE transferred_member_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS retreat_registrations_search_trgm_idx ON public.retreat_registrations USING gin ((lower(name)||' '||lower(email)||' '||phone) gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS retreat_registrations_status_idx ON public.retreat_registrations(status);
  CREATE INDEX IF NOT EXISTS retreat_registrations_event_status_idx ON public.retreat_registrations(event_key,status);
  CREATE INDEX IF NOT EXISTS retreat_payments_registration_id_created_at_idx ON public.retreat_payments(registration_id, created_at DESC);
  COMMENT ON COLUMN public.members.pastoral_group IS 'Pastoral group; Valientes for retreat graduates. NULL until transfer. G1; G2 junction deferred.';
  ```
- **RPC `transfer_retreat_to_valientes(p_registration_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''`** — `REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO authenticated;` Gate `user_role() IN ('leader','super_admin')` else `42501`; `SELECT * FROM retreat_registrations WHERE id=p_registration_id FOR UPDATE`; si `transferred_at IS NOT NULL` → `23505 already_transferred`; `SELECT value FROM app_settings WHERE key='retreat.youth.total_cost'` → `23514 missing_total` si `NULL/''/non-numeric/<=0`; `SELECT COALESCE(SUM(amount),0) FROM retreat_payments` → si `sum < total` o `status!='inscrito'` → `23514 not_inscrito`; duplicate pre-check `EXISTS (SELECT 1 FROM members WHERE deleted_at IS NULL AND (lower(btrim(email))=v_email OR regexp_replace(phone,'[^0-9]','g')=v_phone))` si `member_id IS NULL` → `23505 already_member`; branch `member_id IS NOT NULL` → `UPDATE members SET pastoral_group='Valientes'` (definer bypass `members_update` super_admin-only) else `INSERT members (...) pastoral_group='Valientes', pgp_sym_encrypt(vault_key)` con `phone` normalize `+57` si 10 dígitos, `name_normalized`, `consent_recorded=true`; `UPDATE retreat_registrations SET transferred_at=now(), transferred_member_id, transferred_by=auth.uid()`; `RETURN id`; `EXCEPTION WHEN unique_violation → already_member`.
- **RBAC:** `src/lib/rbac/guards.ts` `canTransferRetreatToValientes = canCreate (leader||super_admin)`; double gate UI+RPC; `anon/server` denied.
- **Retreat page refactor `retreat-registrations/page.tsx`:** `'use client'` + `canManageRetreatRegistrations` guard; state `tab/search(pageSize 20/50)/page/totalCount`; query `supabase.from('retreat_registrations').select('...,transferred_at,transferred_member_id,member_id',{count:'exact'}).eq('event_key',RETREAT_EVENT_KEY)[.eq('status',tab)][.or('name.ilike.%search%,...')].order('name').range(from,to)`; payments solo `visibleIds` via `.in('registration_id',ids)` + `sumPaidByRegistration`; columnas `Nombre/Email/Tel/Estado/Pagado/Saldo/%/ÚltimoAbono/Acciones`; `Registrar pago` keep + `Transferir a Valientes` (secondary `UserPlus`) habilitado IFF `status='inscrito' && transferred_at IS NULL && online && canTransfer`; diálogo confirm Ley 1581 + checkbox requerido → `supabase.rpc('transfer_retreat_to_valientes',{p_registration_id})` → toast + `Ver miembro` + badge `Transferido ✓`; toolbar `Tabs/Input/Search/Select/Pagination` + `Exportar estado pago (todos) / Inscritos / Imprimir`; no Dexie/realtime.
- **Export `src/lib/retreat/export.ts`:** `RetreatReportRow {Nombre,Teléfono,Email,FechaNacimiento,EsMenor,RepresentanteLegal,Estado,Pagado,Saldo,PorcentajePagado,TotalRetiro,CantidadAbonos,ÚltimoAbono,TransferidoAValientes,FechaTransferencia}`; `buildReportRows(regs,payments,total)` + `exportRetreatToXLSX/CSV` (SheetJS `json_to_sheet→book_new→write→Blob→downloadBlob`); filenames `retiro-estado-pago-YYYY-MM-DD.xlsx` / `retiro-inscritos-YYYY-MM-DD.xlsx`; header `Evento: retiro-juvenil-octubre-2026 + Generado es-CO`; chunked fetch 1000 para `max_rows`; `window.print` + `@media print` `Confidencial Ley 1581`.
- **Reporte abonos:** `SUM/remaining/%/COUNT/MAX` por persona en misma sección (columnas expandidas + footer `Total preinscritos/Inscritos/Suma/Pendiente` o tab `Reporte de abonos`); view opcional `retreat_registration_with_payments WITH (security_invoker=true)`; tiempo real, no materialized.
- **Tests strict_tdd:** Vitest `payments-transfer.test.ts`, `export.test.ts`, `guards-transfer.test.ts`; Supabase `retreat_rls.test.sql` extensión Valientes; Playwright `retreat-valientes-transfer.spec.ts` (leader flow, Excel/print, offline, duplicate, idempotency).

### 3.2 Out of Scope (Non-Goals)
- Trigger auto `AFTER UPDATE status='inscrito' → INSERT members` (**B rechazado**: opaco, viola opción manual, rompe Ley 1581, rollback pagos).
- Bulk transfer checkboxes/batch RPC `transfer_retreat_batch(uuid[])` con `SAVEPOINT` (**C follow-up**).
- Server Excel `POST /api/retreat/report` streaming (**D2 follow-up**; primario D1 client).
- `groups` table + `member_groups` junction G2; multi-event catalog; nuevo `event_key`; cobro en `/retiro`; cambio anon RPC; Dexie `retreat_*` store; offline transfer; auto-link duplicado (`p_link_existing` deferred); `supabase_realtime` para retreat; modificar `retreat_payments` triggers; decrypt sensibles.

---

## 4. Approach

### 4.1 Architecture Choice
**A RPC single + G1 TEXT column + D1 client export** (explore §3 matrix). Slice mínimo que cumple literal `opción que me permita transferir` con control manual, audit Ley 1581, sin `groups` table, sin cascada triggers, sin pagar bulk/server en V1. Single txn `SECURITY DEFINER`, sin ensanchar `members_update` RLS (super_admin only), sin tocar 011 triggers.

### 4.2 RPC Idempotente — Contract
```sql
CREATE OR REPLACE FUNCTION public.transfer_retreat_to_valientes(p_registration_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';
REVOKE ALL ON FUNCTION public.transfer_retreat_to_valientes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_retreat_to_valientes(uuid) TO authenticated;
-- Body sketch: user_role gate → SELECT FOR UPDATE → transferred_at guard 23505 → total gate 23514 →
-- SUM>=total gate 23514 → duplicate EXISTS 23505 → branch member_id
-- member_id NOT NULL → UPDATE pastoral_group='Valientes' else INSERT members pastoral_group='Valientes' + pgp_sym_encrypt vault
-- UPDATE retreat transferred_* → RETURN id → EXCEPTION unique_violation→already_member
```
Detalles: `SET search_path=''`, `public.*` qualified, `FOR UPDATE` lock (concurrencia: segundo waiter ve `transferred_at`), `pgp_sym_encrypt` con key `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='members_encryption_key'` (012a vault; fallback demo key solo local/CI guardado), `USING ERRCODE` estables `42501/P0002/23514/23505`, `NOTIFY pgrst`.

### 4.3 Branches
| Branch | Condición | Acción | Idempotencia |
|--------|-----------|--------|--------------|
| Origin | `member_id IS NOT NULL` | `UPDATE members SET pastoral_group='Valientes'` | Si ya Valientes → `already_transferred 23505` |
| New | `member_id IS NULL` | `INSERT members (...) pastoral_group='Valientes'` | `transferred_at` guard + `FOR UPDATE` + `unique_violation→already_member` |
Ambas requieren `SUM>=400k` y `status='inscrito'`.

### 4.4 Pastoral Group G1 vs G2
- **G1 lock V1:** `pastoral_group TEXT CHECK (NULL OR char_length>0)` + `partial index WHERE NOT NULL` + `COMMENT`. KISS, un filtro `WHERE pastoral_group='Valientes'`. Contras: un grupo por persona; si multi-grupo → migrar a `TEXT[]` o G2. `CHECK` abierto (no `IN('Valientes')`) permite extender sin migración.
- **G2 deferred:** `groups`+`member_groups` junction normalizado multi-grupo pero más tablas/RLS/JOIN.
- **G3 rejected:** reusar `community_name_encrypted`/`denomination` — wrong semantics.

### 4.5 Tabla Retiro — Pagination Tabs Search
- **Current:** `select(...).order('name')` sin `range/count/ilike`.
- **Proposed lock:**
```ts
const from=(page-1)*pageSize, to=from+pageSize-1
let q=supabase.from('retreat_registrations')
  .select('id,name,email,phone,birthday,is_minor,legal_rep_name,status,created_at,transferred_at,transferred_member_id,member_id',{count:'exact'})
  .eq('event_key',RETREAT_EVENT_KEY).order('name').range(from,to)
if(tab!=='todos') q=q.eq('status',tab)
if(search.trim()) q=q.or(`name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`)
```
Payments solo visibleIds `in('registration_id',ids)` + `sumPaidByRegistration`. UI `Tabs/Input/Pagination` footer `Mostrando X-Y de N`, `Badge Transferido ✓`, tooltip fecha. Indexes 014: `GIN pg_trgm ((lower(name)||' '||lower(email)||' '||phone))` acelera `ILIKE %substr%`; `btree(status)`, `event_key,status`, `created_at`, `retreat_payments(registration_id,created_at)`. PostgREST `ilike→ILIKE` usa GIN. No client pagination.

### 4.6 Export — D1 Primary + D2 Follow-up
- **D1 V1:** `src/lib/retreat/export.ts` pure helpers reusing `src/lib/export/generate.ts`:
```ts
export type RetreatReportRow = { Nombre:string; Teléfono:string; Email:string; FechaNacimiento:string; EsMenor:string; RepresentanteLegal:string; Estado:string; Pagado:string; Saldo:string; PorcentajePagado:string; TotalRetiro:string; CantidadAbonos:number; ÚltimoAbono:string; TransferidoAValientes:string; FechaTransferencia:string }
export function buildReportRows(regs,pays,total): RetreatReportRow[]
export function exportRetreatToXLSX(rows,filename): void // json_to_sheet→book_new→write→Blob→download
```
Dos Excels on-demand con filtros aplicados: (a) **Estado de pago (todos)** sin `range` (incluye parciales), (b) **Listado inscritos** fuerza `status='inscrito'`. Columnas idénticas (ver Appendix). Chunked fetch: loop `range(page*1000,(page+1)*1000-1)` hasta `<1000` para `max_rows`. `window.print()` + `@media print {nav,.no-print{display:none} tr{break-inside:avoid} @page{margin:1cm}}` + header `Confidencial Ley 1581 Uso interno MD CC Evento: retiro-... Generado: es-CO`. Offline `disabled`.
- **D2 follow-up:** `POST /api/retreat/report` con `createServerClient` RLS, `xlsx` Node `buffer`, `Content-Disposition: attachment`; para datasets 1000+ o log server.

### 4.7 Reporte Abonos — Agregado Tiempo Real
No materialized. `total_paid=COALESCE(SUM,0)`, `remaining=total-total_paid`, `%=total_paid/total*100`, `last_payment_at=MAX(created_at)`, `payment_count=COUNT`. View opcional:
```sql
CREATE OR REPLACE VIEW public.retreat_registration_with_payments WITH (security_invoker=true) AS
SELECT rr.*, COALESCE(SUM(p.amount),0) total_paid, COUNT(p.id) payment_count, MAX(p.created_at) last_payment_at
FROM retreat_registrations rr LEFT JOIN retreat_payments p ON p.registration_id=rr.id GROUP BY rr.id;
```
UI columnas expandidas `Pagado/Saldo/%/Cant/Último` + footer `Total preinscritos/Inscritos/Suma/Pendiente` o tab `Reporte de abonos`. Trigger `retreat_payments_apply_status` ya actualiza `status`; reporte lee `SUM` fresco.

### 4.8 Seguridad
`supabase` checklist: `SECURITY DEFINER` en `public` con `REVOKE ALL FROM PUBLIC; GRANT TO authenticated` only; `SET search_path=''`, `user_role()` inside body (no `auth.role()`), `views WITH security_invoker=true`, `audit_log log_mutation` en ambas tablas (`old/new jsonb` con `pastoral_group` diff). Vault key 012a `vault.decrypted_secrets`; fallback demo solo `IF EXISTS` local/CI. No widen `members_update` (leader `UPDATE` solo vía definer). `REVOKE/GRANT` exacto; RLS 011 stays `SELECT` retreat `leader/super_admin`.

### 4.9 Offline & Concurrencia
Online-only (011/013 `Do not add retreat_* to realtime`, no Dexie). Button `disabled !navigator.onLine||!hasSession title="Requiere conexión"` (013 precedent). Concurrencia: `SELECT FOR UPDATE` serializa dos líderes mismo `registration_id`; segundo ve `transferred_at` → `already_transferred`; `already_member` + `unique_violation` handler previene duplicados `members`.

---

## 5. Schema
Ver §3.1 DDL completo 014 + §4.2 RPC + view opcional §4.7. No `NOT NULL`/`UNIQUE` que rompa existentes (`NULL` until transfer). No `CONCURRENTLY`. `members_pastoral_group_idx` partial para `WHERE pastoral_group='Valientes'`.

---

## 6. Templates / Consent (Ley 1581)
No nuevo form. Diálogo confirm reutiliza `Dialog/Checkbox/Button`. Requiere checkbox **Acepto que mis datos se traten para mi incorporación al grupo Valientes como miembro asistente (Ley 1581) — pdtp-v1.0-2026-07-17** link `/privacidad`; `Transferir` disabled hasta checked. Log implícito vía `transferred_at` + `audit_log` (no `consent_records` per 011 on-row; si auditoria estricta, `INSERT consent_records` dentro RPC definer — design decide, default no). Sensitive: `rr.sensitive_consent_accepted_at` → `sensitive_consent_recorded` + `pgp_sym_encrypt` solo si previo; `NULL` si no. Print/Excel header `Confidencial Ley 1581`.

---

## 7. Pastoreo / Automations
Sin impacto `whatsapp-pastoreo-notifications` 012a-d. `pastoral_group='Valientes'` futuro target `SELECT id FROM members WHERE pastoral_group='Valientes'` server-side; esta slice no crea `notification_log`. No nuevas cron/queue/trigger/realtime; triggers existentes preservados; no `supabase_realtime` para retreat.

---

## 8. Risks (Detailed)

| Risk | Likelihood | Impact | Mitigation | Residual |
|------|------------|--------|------------|----------|
| No `groups` table — Valientes implicit | High | Medium | G1 `pastoral_group TEXT` abierto + partial index + COMMENT G2 deferred | Low |
| Phone mismatch digit-only vs E164 | High | Low | `normalizeE164 +57` si 10 dígitos; `libphonenumber-js` tests | Low |
| Sensitive key management | Medium | High | `vault.decrypted_secrets` definer; fallback demo `IF EXISTS` local | Low |
| Duplicate members email/phone (no DB unique) | High | Medium | `EXISTS` pre-check + `unique_violation→already_member 23505` + toast Ver miembro | Low |
| Transfer preinscrito/pagos_parciales antes inscrito | Medium | High | Gate `SUM>=total` + `status='inscrito'` RPC+UI | Low |
| "Vivió retiro" attendance vs payment | High | Medium | Checkbox confirm vivió retiro implícito en explicit consent; `transferred_at` = confirmation; futuro `retreat_attendance` | Medium |
| Retreat UPDATE RLS missing | Certain | Medium | Intencional: solo definer escribe `transferred_*`; sin `UPDATE` policy | Low |
| Pagination perf `count:'exact'` + `ilike` | Medium | High | `pg_trgm` GIN + `btree(status)` + `event_key,status` + `created_at` | Low |
| Export `max_rows` 1000 truncate | High | Medium | Chunked 1000 loop; D2 server follow-up >5000 | Low |
| Ley 1581 purpose creep | Medium | High | Explicit checkbox + `audit_log`; optional `consent_records` row inside RPC | Low |
| Concurrency two leaders same id | Medium | High | `FOR UPDATE` lock → `already_transferred` | Low |
| RDD high PII+money+DEFINER | Certain | High | 4-lens budget `min(200,ceil(lines/2))` capped 200; stacked PRs | Medium |
| Offline lost transfer | Medium | Low | `disabled Requiere conexión`; no queue | Low |
| Print PII leak | Low | Medium | Gate `leader/super_admin` + header Confidencial Ley 1581 | Low |
| `pastoral_group` overwrite previo grupo | Low | Medium | G1 single-group; doc overwrite; G2 junction future | Medium |

---

## 9. Decisions D1–D10 (Locked)

| Decision | Question | Locked Answer (Q1–10 defaults) |
|----------|----------|--------------------------------|
| **D1** | Q1 — Transferir = crear `members` ya `inscrito`? Campos? | **Sí solo `inscrito` (`SUM>=$400k`) y `transferred_at IS NULL`, idempotente.** Mapeo: `name→name+name_normalized lower(btrim)`, `phone→normalizeE164 +57`, `email→lower(btrim)`, `birthday/is_minor/legal_rep` directo, `denomination/community→pgp_sym_encrypt vault si sensitive else NULL`, `pastoral_group='Valientes'`, `consent_recorded=true`, `duplicate_flag=false`, `created_by=auth.uid()`. Branch `member_id NOT NULL → UPDATE pastoral_group`. |
| **D2** | Q2 — ¿Cuándo habilitar botón? Idempotencia? | **Solo `inscrito` && `transferred_at IS NULL` && `canTransfer` && online.** Segundo click → `already_transferred 23505 Ya fue transferido DD/MM/YYYY Ver miembro`. No preinscrito/pagos_parciales. |
| **D3** | Q3 — ¿Tabla ya tabulada/paginada/buscador? | **No.** Single `<Table>` sin `range/count/ilike`. Falta lock: `range(count:'exact')`, tabs, debounce `or ilike`, `GIN pg_trgm` + `btree(status/created_at)`, 20/50, `order(name)`. |
| **D4** | Q4 — ¿Reportes Excel? Columnas/filtros/demanda? | **Dos on-demand:** (a) Estado pago (todos tab+search) y (b) Inscritos (`inscrito` forzado). Columnas `Nombre,Tel,Email,FN,EsMenor,RepLegal,Estado,Pagado,Saldo,%Pagado,TotalRetiro,CantAbonos,ÚltimoAbono,Transferido,FechaTransferencia`. SheetJS `src/lib/retreat/export.ts`, filenames `retiro-*-YYYY-MM-DD.xlsx`, chunked 1000, print `window.print` + Confidencial. |
| **D5** | Q5 — ¿Reporte abonos vista agregada? Real-time/materialized? | **Tiempo real. No materialized V1.** `total_paid=SUM`, `remaining=total-total_paid`, `%=sum/total*100`, `last_payment_at=MAX`, `payment_count=COUNT`. Columnas expandidas + footer o tab `Reporte de abonos`; view `retreat_registration_with_payments with security_invoker` opcional. |
| **D6** | Q6 — ¿Grupo Valientes valor o tabla `groups`? | **G1 TEXT nullable `members.pastoral_group='Valientes'` + partial index `WHERE NOT NULL`.** No `groups` table; G2 junction deferred. |
| **D7** | Q7 — RBAC quién puede transferir? Auditoría? | **`leader+super_admin` via `canTransferRetreatToValientes=canCreate`** + audit `transferred_at/member_id/by` + `log_mutation` ambas tablas. Endurecer a `super_admin` only es 1 line. |
| **D8** | Q8 — RDD high → 4-lens? | **Sí high.** 4R `risk/resilience/readability/reliability` budget `min(200,ceil(lines/2))`. Por DEFINER/PII/money/export. Forecast antes `sdd-apply`. |
| **D9** | Q9 — Duplicados email/phone ya en `members`? | **Rechazar `already_member 23505` Ver miembro.** `EXISTS` sobre `members deleted_at IS NULL (email lower OR phone digits)`. No `ON CONFLICT DO NOTHING`. Follow-up `p_link_existing`. |
| **D10** | Q10 — Naming change/spec? | **Mantener `retreat-valientes-transfer`.** Alts `retreat-to-valientes`/`youth-retreat-valientes-transfer` rechazadas; no rename sin aviso. Spec `retreat-valientes-transfer/spec.md`. |

---

## 10. Alternatives Discarded

| Alternative | Why discarded |
|-------------|---------------|
| **B Trigger auto `AFTER UPDATE status='inscrito' → INSERT members`** | Viola `opción que me permita transferir` manual; opaco (rollback pagos), bypass `user_role()`, conflata pago con asistencia, Ley 1581 débil, trigger cascada con `retreat_payments_apply_status`. **Rechazado** (maybe flag opt-in follow-up). |
| **C Bulk batch `Select all → Transferir N` / `transfer_retreat_batch(uuid[])` con SAVEPOINT** | Ergonomía para 10–50 pero transaction locks + partial failure. **Complemento a A, no reemplazo.** V1 single; `T-BULK` gated si >20 en prod. |
| **D Export client vs server** D1 client SheetJS (`json_to_sheet→book_new→write`) vs D2 server `POST /api/retreat/report` streaming | **Hybrid lock: D1 primario KISS (<40 LOC, RLS natural) + D2 follow-up** si >1000 rows o log server requerido. |

Matrix completa en `explore.md` §3.

---

## 11. Affected Areas

| Area | Object | Change |
|------|--------|--------|
| `members` G1 | `014` migration | Add `pastoral_group TEXT`, CHECK, COMMENT, `members_pastoral_group_idx WHERE NOT NULL` |
| `retreat_registrations` audit | `014` migration | Add `transferred_at/member_id/by` + FKs + indexes + COMMENT + `NOTIFY` |
| Search indexes | `014` migration | `pg_trgm` + `status/event_status/search_trgm/payments_reg_created_at` |
| RPC | `transfer_retreat_to_valientes(uuid)` | New SECURITY DEFINER SET search_path, REVOKE/GRANT, FOR UPDATE, gates, branches, encrypt vault, COMMENT |
| View optional | `retreat_registration_with_payments` | `WITH security_invoker` GROUP BY SUM/COUNT/MAX |
| RBAC | `src/lib/rbac/guards.ts` | Add `canTransferRetreatToValientes` |
| Retreat page | `retreat-registrations/page.tsx` | Major: tabs, debounced search, `range(count:'exact')`, columns, Registrar pago keep, Transferir button+dialog+checkbox+rpc+toast/badge, toolbar Excel/print, offline disabled |
| Export | `src/lib/retreat/export.ts` | New RetreatReportRow+buildReportRows+exportRetreatToXLSX/CSV+chunked fetch |
| Tests Vitest | `payments-transfer.test.ts`, `export.test.ts`, `guards-transfer.test.ts` | New |
| Tests Supabase | `supabase/tests/retreat_rls.test.sql` | Extended Valientes cases |
| Tests Playwright | `e2e/retreat-valientes-transfer.spec.ts` | New leader flow + Excel/print + offline + isolation |
| Specs | `retreat-valientes-transfer/spec.md` | New 6–8 requirements GIVEN/WHEN/THEN |

---

## 12. Risks (Summary)
Ver §8 matrix completa. Top residual tras mitigación: **G1 single-group overwrite** (doc) + **vivió retiro no modelado** (explicit checkbox accepted) + **RDD high 4-lens** (stacked PRs + forecast). No nueva exposición PII: `transferred_*` solo `leader/super_admin SELECT`; `pastoral_group` solo `members_select`; anon intacto.

---

## 13. Rollback Plan
- **Code:** Revert deploy (additive; sin ruptura).
- **DB RPC soft:** `DROP FUNCTION IF EXISTS public.transfer_retreat_to_valientes(uuid); NOTIFY pgrst;`
- **DB columns soft:** Si hay `transferred_*` rows, no dropear de inmediato; si rollback completo requerido: `ALTER TABLE retreat_registrations DROP COLUMN IF EXISTS transferred_by; DROP COLUMN IF EXISTS transferred_member_id; DROP COLUMN IF EXISTS transferred_at;` + `DROP INDEX IF EXISTS ...`
- **DB G1 soft:** `ALTER TABLE members DROP COLUMN IF EXISTS pastoral_group; DROP INDEX IF EXISTS members_pastoral_group_idx;` (rows valientes persisten sin flag)
- **Indexes:** `DROP INDEX IF EXISTS retreat_registrations_search_trgm_idx; ...` (no `DROP EXTENSION pg_trgm` por defecto)
- **Grants:** `REVOKE EXECUTE` para deshabilitar sin dropear.
- **Data:** Pre-existing rows `NULL` hasta transfer; transferidas permanecen válidas (`inscrito` + valiente). No `members` mutated fuera Valientes.
- **Non-prod:** `supabase db reset` 001→013 clean.

---

## 14. Dependencies
- `user_role()` definer (001) — existe.
- `app_settings.retreat.youth.total_cost` + triggers `retreat_payments_*` + uniques + `RETREAT_EVENT_KEY` (011).
- `members` RLS + `vault` + `supabase_vault.decrypted_secrets` (001+012a).
- `canManageRetreatRegistrations` (leader+super_admin) + `sumPaidByRegistration` + `generate.ts` SheetJS + Dexie v1 (no retreat stores) + `retreat_rls.test.sql` 52+ PASS.

---

## 15. Success Criteria

- [ ] Transfer habilitado solo `inscrito` (`SUM>=400k`) + `transferred_at IS NULL` + `canTransfer` + online + explicit Ley 1581 checkbox; `preinscrito/pagos_parciales` disabled con tooltip.
- [ ] RPC single idempotente: `member_id NULL → INSERT members pastoral_group='Valientes'` (phone E164 +57, pgp_sym_encrypt) o `member_id NOT NULL → UPDATE`; `transferred_*` set; segundo intento `already_transferred 23505` sin segundo member; `FOR UPDATE` evita race.
- [ ] Duplicate guard `already_member 23505 Ya existe miembro Ver miembro`; no segundo member; `unique_violation` mapea igual.
- [ ] `members.pastoral_group` TEXT nullable CHECK + partial index `WHERE NOT NULL`; filter `WHERE pastoral_group='Valientes'` retorna transferidos.
- [ ] Tabla tabulada/paginada/buscador: tabs `Todos/Preinscritos/Inscritos`, search debounced `or ilike`, `range(count:'exact')` 20/50, `order(name)`, footer `Página X de Y Total N`, `GIN pg_trgm` + `btree(status)` en 014 con `EXPLAIN` index.
- [ ] Dos Excels on-demand `src/lib/retreat/export.ts` con columnas `Nombre..FechaTransferencia` + header Evento+Generado, respetan filtros (chip 1000), `Inscritos` fuerza `inscrito`; `window.print` Confidencial Ley 1581; offline disabled.
- [ ] Reporte abonos tiempo real `Pagado/Saldo/%/Cant/Último` por fila + footer `Total preinscritos/Inscritos/Suma/Pendiente`; view `with security_invoker` opcional; no materialized.
- [ ] RBAC `anon`/`server` denied `42501`, `leader/super_admin` pass; `audit_log` en ambas tablas con `transferred_*` + `pastoral_group` diff; offline transfer disabled.
- [ ] No regresión: anon `register_retreat_preinscription` sigue `preinscrito NULL transferred`; 013 RPC; payments gate/status machine; `supabase db reset` 001→014 ok; Vitest+`tsc --noEmit`+`next lint` PASS; paginated query no full scan.

---

## 16. Phases

| Phase | Scope | Depends on |
|-------|-------|------------|
| **0 Prep** | Exploration locked + D1–D10 confirm + verify 011/013 + grep Valientes=0 | — |
| **1 Schema/RPC/RBAC** | 014 migration + RPC + guards + `retreat_rls.test.sql` Valientes cases + Vitest guards/gating | Proposal |
| **2 Paginated Table/Abonos** | Rewrite `retreat-registrations/page.tsx` tabs+search+range+columns + view optional + EXPLAIN verify | Phase 1 |
| **3 Transfer+Export** | Transfer button+dialog+checkbox+rpc+toast/badge + `export.ts`+toolbar Excel/print+offline chunked | Phase 2 |
| **4 Hardening** | Bulk C / server D2 deferred docs + Playwright e2e + `supabase db reset` 52+ new PASS | Phase 3 |

`delivery_strategy` = `stacked-to-main` si high-tier detectado; `auto-chain` → PR1 schema+RPC (<200 lines), PR2 pagination, PR3 transfer+export. Budget `min(200,ceil(lines/2))` capped 200. Forecast 4R antes cada PR high.

---

## 17. Alternatives & Tradeoffs (Pointer)
Matrix A vs B vs C vs D + G1 vs G2 vs G3 y costos en `explore.md` §3 (no duplicada). Selección lock: **A+G1+D1**.

---

## 18. References
- `explore.md` §§1–11 + Appendices + Engram #102.
- `youth-retreat-preregistration` + `youth-retreat-payments` + `retreat-member-preinterest` specs + migrations `011` + `013` + `001` + `supabase/tests/retreat_rls.test.sql` 52+ PASS.
- `retreat-registrations/page.tsx` (no pagination) + `members/page.tsx` Dexie + `CaptureForm` + `submit-adapter` + `retreat/payments.ts` + `rbac/guards.ts` + `export/generate.ts` SheetJS + `sync/db.ts` + `settings/app-settings.ts` + `phone/normalize.ts`.
- `grep Valientes/groups/members.group` 0 hits; `package.json` xlsx 0.20.3, next 15.5.22, supabase-js 2.112.0, vitest 3.2.1, playwright 1.62.1.
- `openspec/config.yaml` `strict_tdd:true`, `persistence.mode:both`.

---

## 19. Next Phase Handoff
- **Spec:** New `retreat-valientes-transfer/spec.md` 6–8 req normativos (Transfer Gate, RPC Idempotent, Members Valientes Field, Paginated Indexed Table, Excel Exports, Abonos Report, RBAC+Audit Ley 1581) GIVEN/WHEN/THEN + delta `youth-retreat-payments`.
- **Design:** Lock `014` filename + RPC sig `transfer_retreat_to_valientes(uuid)` + `pastoral_group` CHECK + `pg_trgm` DDL + `FOR UPDATE` + vault + `retreat_registration_with_payments` view; `export.ts` helpers + print CSS; `retreat-registrations/page.tsx` refactor plan; guards; test extensions.
- **Tasks:** Slice per §16 stacked-to-main; TDD RED→GREEN; `supabase db reset` 001→014 + `retreat_rls.test.sql` new PASS.

> No `spec/design/tasks` are created in this phase — proposal only.

---

## Appendix — Field Mapping (design/verify)

| Retreat | Members | Transform |
|---------|---------|-----------|
| `name` | `name`, `name_normalized` | `btrim`, `lower(btrim)` |
| `phone` digit-only | `phone` | `normalizeE164 +57` if 10 digits colombian |
| `email` lower | `email` | same |
| `birthday/is_minor/legal_rep` | same | direct |
| `denomination/community` TEXT | `*_encrypted BYTEA` | `pgp_sym_encrypt vault_key` if sensitive else NULL |
| — | `pastoral_group='Valientes'` | fixed G1 |
| — | `has_whatsapp=false, duplicate_flag=false, created_by=auth.uid()` | defaults |

> Branch `member_id NOT NULL` → `UPDATE pastoral_group='Valientes'` no duplicate; si ya Valientes → `already_transferred`.

---

## Appendix — Export Column Contract (verify)
Estado pago (todos filtrados): Nombre | Teléfono | Email | FN | EsMenor | RepLegal | Estado | Pagado COP | Saldo COP | % Pagado | TotalRetiro COP | Cant Abonos | Último Abono | Transferido (Sí/No) | FechaTransferencia — header Evento + Generado. Inscritos = same `WHERE status='inscrito'`. Via `src/lib/retreat/export.ts` chunked 1000.

---

## Appendix — RDD Workload Forecast
Tier **High**: PII `pgp_sym_encrypt`, money `SUM>=total $400k`, `SECURITY DEFINER`, PII export. Lenses canonical 4R (risk/resilience/readability/reliability) regardless line count. Budget `min(200,ceil(orig_changed_lines/2))` capped 200 (~500–700 lines → 200). Mitigation stacked PRs; forecast antes cada `sdd-apply`.

---

## Skill Resolution
- `skill_resolution: paths-injected` — `gentle-ai`, `supabase`, `supabase-postgres-best-practices` injected via `## Skills to load before work`. No registry fallback.

