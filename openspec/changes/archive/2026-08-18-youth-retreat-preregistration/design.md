# Design: Youth Retreat Pre-registration

## Technical Approach

Dedicated `retreat_*` tables, not `members`. `/retiro` reuses `CaptureForm` via optional `variant` + `submitAdapter` (online RPC). `/capture` stays Dexie/enqueue. Anon table DML+SELECT denied; insert is SECURITY DEFINER RPC. Payment INSERT trigger owns status. Migration `011`.

## Requirement → Decision

| Spec requirement | AD |
|---|---|
| Public Retreat Form | AD-PublicRoute |
| General Consent; Minor Legal Representative; Required Identity Fields | AD-Validation |
| RPC Pre-registration Persistence | AD-RpcInsert |
| Authenticated Capture Adapter Unchanged | AD-CaptureFormAdapter |
| Sensitive Religious Data Consent | AD-SensitiveFields |
| Anonymous PostgREST Isolation; Anonymous Payment Isolation | AD-AnonIsolation |
| Duplicate Contact Uniqueness | AD-Uniqueness |
| Configured Positive Total Required | AD-MoneyAndTotal |
| Super Admin Sets Total; Staff List; Consecutive Payments; Server Denied; Staff Page Without AdminPage | AD-StaffRbac |
| Payment Status Machine; Overpayment Allowed; Positive Payment Amount | AD-StatusTrigger |

Cross-cutting: AD-EventKey, AD-Migration011, AD-NoRealtimeHydration.

## Architecture Decisions

| ID | Option / tradeoff | Decision |
|---|---|---|
| AD-PublicRoute | Dashboard route (layout redirects unauth; no middleware) | `src/app/retiro/page.tsx` outside `(dashboard)`. Unauth GET: Spanish pre-registration + `RETREAT_PRIVACY_NOTICE_ES`. No login redirect. No money fields. |
| AD-CaptureFormAdapter | Fork drifts; omit adapter Dexie-writes | Optional `variant` default `member`; `submitAdapter?`. Default Dexie+enqueue+`consent_records` unchanged. `/retiro` MUST pass RPC adapter. `/capture` passes none. |
| AD-Validation | Client-only is bypassable | Reuse existing consent/minor validators (age<18). Trim name/phone/email. RPC re-checks; no row on fail. |
| AD-RpcInsert | Direct INSERT (003 grants anon DML) | RPC `register_retreat_preinscription` `SECURITY DEFINER SET search_path=''`. Force `preinscrito`+event_key. Consent at+`POLICY_VERSION` on row, not `consent_records`. No `members`. REVOKE EXECUTE FROM PUBLIC; GRANT EXECUTE TO anon only. |
| AD-SensitiveFields | Capture collects but does not persist | RPC stores denomination/community TEXT iff sensitive consent; else NULL. Record sensitive at+policy when accepted. |
| AD-AnonIsolation | RLS-only; 003 default-grants anon ALL | ENABLE RLS; no anon policies. REVOKE table DML+SELECT from anon/PUBLIC. Auth: registrations SELECT; payments SELECT+INSERT. RPC/trigger UPDATE as owner. |
| AD-Uniqueness | Raw unique allows case/punct dupes | Unique `(event_key, lower(btrim(email)))` and `(event_key, regexp_replace(btrim(phone),'[^0-9]','','g'))`. RPC stores those. No E.164 folding. |
| AD-EventKey | Spec placeholder `youth-retreat-2026-10` | Constant `retiro-juvenil-octubre-2026`. RPC ignores client key. |
| AD-MoneyAndTotal | Integer cents vs float | `amount numeric(12,2)` CHECK `>0`. Total key `retreat.youth.total_cost` TEXT. Seed `''` (not a numeric default). Trigger `value::numeric`; refuse missing/empty/non-numeric/`<=0`. |
| AD-StatusTrigger | Staff dropdown | AFTER INSERT: `0→preinscrito`, `0<sum<total→pagos_parciales`, `sum>=total→inscrito` (overpay OK). BEFORE: amount>0 and total positive. No `members` insert. |
| AD-StaffRbac | AdminPage (leaders blocked) | `src/app/(dashboard)/retreat-registrations/page.tsx`. Nav `canCreate`. Deny `server` like capture. Cost editor `canManageUsers`. Payment INSERT RLS: leader+super_admin. |
| AD-NoRealtimeHydration | Add to 010 publication/Dexie | Do not add `retreat_*` to `supabase_realtime`, `RealtimeManager`, Dexie, or hydrate. Staff refetch. |
| AD-Migration011 | Latest is `010_*` | `011_youth_retreat_preregistration.sql`. UUID PKs. Index payments FK. Audit `log_mutation`. |

## Data Flow

```
Visitor → /retiro CaptureForm → rpc register_retreat_preinscription
       → retreat_registrations (preinscrito + consent)
       ↛ members, consent_records, Dexie, sync_queue
Leader → INSERT retreat_payments → BEFORE refuse bad total/amount
       → AFTER status from sum vs total
```

## File Changes

Create: `011_youth_retreat_preregistration.sql`; `src/app/retiro/page.tsx`; `src/lib/retreat/{constants,submit-adapter}.ts`; staff page; adapter + e2e tests.

Modify: `rls.test.sql`; `CaptureForm.tsx`; `privacy-notice.ts`; `app-settings.ts`; layout nav; `guards.test.ts`.

No deletes. Skip AdminPage, Dexie, realtime, hydrate.

## Interfaces / Contracts

```ts
type CaptureFormVariant = 'member' | 'retreat'
type CaptureSubmitPayload = {
  name: string; phone: string; email: string; birthday: string
  isMinor: boolean; legalRepName: string; generalConsent: boolean
  sensitiveConsent: boolean; denomination: string; communityName: string
}
type CaptureFormProps = {
  onSuccess?: () => void
  variant?: CaptureFormVariant
  submitAdapter?: (p: CaptureSubmitPayload) => Promise<void>
}
```

RPC `register_retreat_preinscription(...) RETURNS uuid`. COP pesos `numeric(12,2)`, not cents.

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | Adapter vs default; cost; RBAC | Vitest |
| Integration | Anon deny; RPC; unique; refuse; status; server INSERT fail | `rls.test.sql` |
| E2E | Unauth `/retiro`; `/capture` unchanged; leader vs server | Playwright |

RED first (`strict_tdd`): adapter + SQL deny/status before production.

## Threat Matrix

| Boundary | Applicability | Design response | Planned RED tests |
|---|---|---|---|
| Documentation-like paths | N/A: App Router `page.tsx` | — | none |
| Git repository selection | N/A | — | none |
| Commit state | N/A | — | none |
| Push state | N/A | — | none |
| PR commands | N/A | — | none |

Safe: `/retiro` renders with no session. Failure: dashboard still requires session. RED: unauth GET `/retiro` shows form; staff route hides payments without leader+.

## Migration / Rollout

Apply `011`; `NOTIFY pgrst`. Seed total `''`. Super_admin sets positive total before payments. Rollback: revert deploy; drop `011` or non-prod `db reset`; `REVOKE EXECUTE` from anon. `/capture` unchanged. auto-chain: schema → public form → staff UI.

## Open Questions

None.
