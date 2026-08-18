# Proposal: Youth Retreat Pre-registration

## Proposal question round

Locked from exploration:

1. **Who / why?** Oct 2026 youth (and legal reps) need public form; leaders track installments off asistencia. **Yes.**
2. **Complete when?** `preinscrito` → `pagos_parciales` → `inscrito` at sum ≥ total. No public money or calendar. **Yes.**
3. **PII / staff / form?** Dedicated registrations; Ley 1581 on row. `/retiro` public; leader+ dashboard (not AdminPage); super_admin sets total. CaptureForm adapter; `/capture` unchanged. **Yes.**

## Intent

Public Spanish pre-registration plus staff installments for Oct 2026 youth retreat, without anonymous `members` writes.

## Scope

### In Scope
- Public `/retiro` outside `(dashboard)`
- CaptureForm `variant` + `submitAdapter` (default = Dexie/enqueue)
- `retreat_registrations` + SECURITY DEFINER RPC; consent on the row
- `retreat_payments`, status machine, `app_settings` `retreat.youth.total_cost`
- Leader+ dashboard; super_admin cost editor

### Out of Scope
- Convert `inscrito` into `members`
- Public payments, CAPTCHA, rate-limit, installment calendar
- Anon writes on `members`; AdminPage-only payments; inventing a price

## Capabilities

### New Capabilities
- `youth-retreat-preregistration`: public form, RPC, registration persistence, consent on the registration row
- `youth-retreat-payments`: installment recording, status machine, configurable total, staff UI

### Modified Capabilities
- None (`attendance-grid-search`, `attendance-grid-pagination`, `attendance-counter-consistency`)

## Approach

Dedicated tables. Anon inserts via owner RPC (`search_path = ''`) forcing `preinscrito` and storing consent. RLS denies anon DML/SELECT on `retreat_*`. Staff SELECT registrations and INSERT payments. Trigger: `preinscrito` → `pagos_parciales` (0 < sum < total) → `inscrito` (sum ≥ total). Refuse payment until total is positive. Sensitive fields persist with sensitive consent. `delivery_strategy` is auto-chain: schema/RPC/RLS, public form, staff payments.

## Affected Areas

- `src/components/forms/CaptureForm.tsx` (Modified): variant + submitAdapter
- `src/app/retiro/page.tsx` (New): public form
- `src/app/(dashboard)/layout.tsx` (Modified): leader+ nav
- `src/app/(dashboard)/retreat-registrations/page.tsx` (New): list, payments, cost
- `src/lib/settings/app-settings.ts` (Modified): total-cost helpers
- `supabase/migrations/011_*.sql` (New): tables, RPC, RLS, trigger
- `supabase/tests/rls.test.sql` (Modified): anon deny, RPC, status

## Risks

- GRANT-to-anon + missing RLS (High): deny anon DML/SELECT; RPC EXECUTE only; SQL tests
- Public spam, no CAPTCHA (Med): unique (event_key, email/phone); CAPTCHA later
- Adapter omitted on `/retiro` (Med): tests never Dexie/enqueue
- Unconfigured cost (Med): refuse payment until positive total
- Attendance-only privacy copy (Med): retreat Ley 1581 notice

## Rollback Plan

Revert deploy; drop `011` or non-prod `db reset`; revoke RPC `EXECUTE` from `anon` if needed. `/capture` unchanged.

## Dependencies

- `app_settings`, `canCreate`, Ley 1581 validators; super_admin sets total before installments

## Success Criteria

- [ ] Anon `/retiro` creates `preinscrito` via RPC with consent; no `members` or Dexie write
- [ ] `/capture` unchanged
- [ ] Anon cannot DML/SELECT `retreat_*`; RPC EXECUTE works
- [ ] Payments → `pagos_parciales` then `inscrito` at sum ≥ total; refused until cost set
- [ ] Super_admin sets total; leaders reach staff page without AdminPage
