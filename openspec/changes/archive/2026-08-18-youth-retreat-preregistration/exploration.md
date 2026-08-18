## Exploration: youth-retreat-preregistration

### Current State

The app is a Next.js 15 App Router + React 19 attendance platform. Authenticated staff capture members through `CaptureForm`; persistence is Dexie-first, then a sync queue upserts into Supabase. There is **no payment/installment domain**, **no public data-entry route**, and **no middleware.ts**.

**Capture submit path today** (`src/components/forms/CaptureForm.tsx`):

1. Client-side validation: required name/phone/email, `validateGeneralConsent`, `validateMinorFields` when `checkMinorStatus` marks a minor.
2. `supabase.auth.getSession()` → `created_by: session?.user?.id ?? ''` (empty string locally, `null` in the queued payload).
3. `findDuplicateMembers` against Dexie **and** remote `members` (authenticated SELECT).
4. `db.members.add` + `enqueue('members', …, 'insert', …)`.
5. Optional `whatsapp_numbers` / `social_media` Dexie + enqueue.
6. `logGeneralConsent` / `logSensitiveConsent` insert into `consent_records` (online only; errors are logged, not thrown).
7. Toast + `resetForm` + `onSuccess?()`.

`CaptureFormProps` is only `{ onSuccess?: () => void }`. There is **no submit adapter, no variant, and no CaptureForm unit tests**. UI copy is Spanish. Sensitive fields `denomination` / `communityName` are collected in the UI but **never persisted** (members stores `denomination_encrypted` / `community_name_encrypted` BYTEA; the form never writes them).

**Auth / routing:**

- `/` is the login page (`src/app/page.tsx`). `(auth)/login` only redirects to `/`.
- `(dashboard)/layout.tsx` requires a session + role and redirects to `/` if missing. Sidebar + RBAC live here.
- `(dashboard)/capture/page.tsx` additionally requires `canCreate` (super_admin, leader). Comment in that page already documents that `members_insert` RLS would otherwise 42501-fail the sync queue.
- Root `layout.tsx` only wraps HTML + Sonner + service worker registration. SW (`public/sw.js`) does background sync notify only — it does not cache navigations, so `/retiro` is safe as a public URL.
- No `src/app/api/**` route handlers exist.

**RLS (verified in `001` + `006`):**

| Table | INSERT | SELECT | Notes |
| --- | --- | --- | --- |
| `members` | super_admin, leader | all app roles (non-deleted) | Anon/server cannot insert |
| `consent_records` | super_admin, leader | all app roles | FK `member_id → members(id)` NOT NULL |
| `social_media` / `whatsapp_numbers` | super_admin, leader | all app roles | FK to members |
| `audit_log` | authenticated INSERT (defensive); trigger via SECURITY DEFINER | super_admin | No anon insert policy |
| `app_settings` | none (seed/upsert via authenticated super_admin) | super_admin, leader, server | Anon cannot read settings |

`003_grant_authenticated_table_access.sql` grants SELECT/INSERT/UPDATE/DELETE on **all public tables to `anon`**. RLS is the only authorization boundary. `ALTER DEFAULT PRIVILEGES` means **new tables inherit the same GRANT** — policies must be complete on day one.

`consent_records` cannot be reused for public pre-registration without a `members` row. `logConsentEvent` would also fail RLS for anon.

**Config / admin:**

- `app_settings` is a key/value table; only `dpo_contact_email` is used. `getSetting` / `setSetting` exist. Settings UI is an Admin tab; **AdminPage hard-requires `canManageUsers` (super_admin only)** at the top of the component, so leaders cannot record payments there.
- Retreat total cost is unspecified. Do not invent a price; store it in `app_settings` (staff-configured).

**Tests / CI:**

- Consent validation is covered in `src/lib/consent/__tests__/validation.test.ts` (Spanish error strings).
- RLS assertions live in `supabase/tests/rls.test.sql` (SET ROLE authenticated + JWT `sub`; denies server INSERT members).
- CI (`ci.yml`): lint, tsc, vitest, local `supabase db reset` + SQL tests, Next build.
- Preview: Vercel preview + local migration validate. Production: vitest/build → `supabase db push --linked` → `vercel --prod`.

**Implication for a naive reuse:** pointing the public form at the existing submit path would write a local Dexie member on a stranger’s browser, enqueue an insert that RLS permanently fails (42501), and never create a server row. Duplicate checks against `members` would also fail for anon SELECT.

### Affected Areas

- `src/components/forms/CaptureForm.tsx` — add optional `variant` + `submitAdapter` (or equivalent) without forking the field UI; Spanish copy overrides for retreat.
- `src/app/retiro/page.tsx` (new, outside `(dashboard)`) — public unauthenticated page; short shareable URL.
- `src/app/(dashboard)/layout.tsx` — add staff nav item for retreat payment management (leader+).
- New authenticated staff page (recommended `/retreat-registrations` or `/retiro-pagos`) — list pre-registrations, record installments, show remaining balance / status. Do **not** bury this only in AdminPage (leaders cannot enter).
- `src/app/(dashboard)/admin/page.tsx` — optional: super_admin setting for retreat total cost (or put cost editor on the staff retreat page for super_admin only).
- `src/lib/settings/app-settings.ts` — typed helpers for `retreat.youth.total_cost` (string numeric; no default price).
- New lib: payload type, status machine `sum(payments) >= total`, RPC client wrapper (online-only).
- `supabase/migrations/011_*.sql` (next number after `010`) — `retreat_registrations`, `retreat_payments`, consent columns on registration, RPC, RLS, trigger.
- `supabase/tests/rls.test.sql` — anon cannot write `members`; anon cannot SELECT registrations; RPC as anon succeeds; staff payments; status transition.
- Vitest: adapter does not call Dexie/enqueue; status helper; CaptureForm variant copy (new tests — none exist today).
- `.github/workflows/*` — no workflow edits expected; new SQL tests run automatically in `db-integration`.

Out of scope unless later specified: converting a completed retreat inscription into a `members` attendance row; collecting money on the public form; inventing an installment calendar.

### Approaches

1. **Dedicated `retreat_registrations` + `retreat_payments` + SECURITY DEFINER RPC (recommended)** — Public form submits via `supabase.rpc(...)` with the anon key. RPC (owner, `search_path = ''`) inserts a pre-registration with forced `status = 'preinscrito'`, stores Ley 1581 consent evidence on the registration row (not `consent_records`), and optionally child WhatsApp/social rows. Staff (super_admin/leader) SELECT registrations and INSERT payments. A trigger or SECURITY DEFINER function recomputes status: `preinscrito` → `pagos_parciales` when `0 < sum < total` → `inscrito` when `sum(payments) >= total_cost`. Total cost from `app_settings` (empty until staff sets it; payment recording should refuse until cost is configured).
   - Pros: Does not open `members` to anonymous writes; keeps retreat PII off the attendance roster until a future conversion; RPC can reject forged `status`/`created_by`; atomic parent+children+consent; matches “pre-registration ≠ complete inscription”; payments are a new domain anyway.
   - Cons: New tables + RPC + RLS tests; cannot reuse `consent_records` FK; public form is online-only (correct); GRANT-to-anon on new tables requires explicit “no anon SELECT/UPDATE/INSERT policies” (RPC only).
   - Effort: Medium (schema + adapter + two pages + tests). Likely to exceed the 400-line PR review budget — `delivery_strategy: auto-chain` should split (1) schema/RPC/RLS tests (2) CaptureForm adapter + `/retiro` (3) staff payments UI.

2. **`members` with a status column + SECURITY DEFINER RPC into `members`** — Add `registration_status` (or similar) on `members`. Public RPC inserts a member as `preinscrito` without widening `members_insert` RLS.
   - Pros: Reuses `consent_records` FK, Dexie member shape, duplicate helper against the same table; fewer new entities.
   - Cons: Pollutes attendance (`members/page.tsx` lists every non-deleted member with no status filter); anon still causes a members write (constraint was “do not open anonymous writes” — RPC bypasses RLS but still writes the table); `created_by` is NOT NULL-ish in Dexie and FK to `profiles`; attendance/export/hydrate/realtime all assume members are congregants; high blast radius (`Member` has 22+ callers).
   - Effort: High (filter every members consumer + payment tables still needed).

3. **Anon INSERT RLS on `members` (or on a dedicated table without RPC)** — Add a policy `TO anon WITH CHECK (...)`.
   - Pros: No RPC; client `from('…').insert()`.
   - Cons: Directly contradicts “do not open members to anonymous writes” if applied to `members`; even on a dedicated table, GRANT INSERT already exists for anon, so a loose WITH CHECK lets attackers set `status = 'inscrito'` or inject payments; harder to insert parent+children atomically; no server-side consent enforcement.
   - Effort: Low-Medium, but unsafe.

4. **Next.js Route Handler + service role** — First API route; server validates and writes.
   - Pros: Easy CAPTCHA/rate-limit later; hides RPC.
   - Cons: Introduces a new persistence style (no API routes today); service-role secret in Vercel; still needs the same tables; more moving parts than RPC + anon key (already on the client).
   - Effort: Medium-High. Defer unless spam protection is in-scope.

**CaptureForm reuse (orthogonal, required by all viable approaches):** extract submit from UI via an optional adapter. Default adapter = current Dexie+enqueue path (authenticated capture unchanged). Retreat page passes an adapter that calls the RPC and never touches Dexie/queue/session. Variant/copy props for Spanish titles (`Preinscripción al retiro`, `Enviar preinscripción`) and a notice that payments are later and this is not a complete inscription. **Do not duplicate the form fields.**

**Staff payments UI:** new dashboard page visible to `canCreate` (leader + super_admin), not Admin-only. Super_admin configures total cost (`app_settings`). Leaders record successive installment amounts. Status is derived from the sum, not a manual dropdown (manual override is a later concern).

**Status machine:**

```
submit (public)           → preinscrito
first payment, sum < total → pagos_parciales
sum(payments) >= total     → inscrito   // "inscripción completa"
```

“Consecutive” is interpreted as successive staff-recorded installments that accumulate; no installment calendar was specified. Do not invent due dates or a required installment count.

### Recommendation

Use **Approach 1**: dedicated retreat tables, public `SECURITY DEFINER` RPC, CaptureForm **adapter + variant** (no UI fork), public route **`/retiro` outside `(dashboard)`**, staff payment page for leader+, total cost in **`app_settings` with no invented price**.

Keep completed inscriptions **off `members` in this change**. “Inscrito completo” is a retreat status after payments cover the configured total, not an attendance-member insert. Conversion to `members` can be a later change if staff need those people in the asistencia grid.

Public submit must be **online-only** and must **not** use Dexie/enqueue. Authenticated `/capture` stays offline-first.

Ready for `sdd-propose`.

### Risks

- **GRANT to anon on all tables** (migration 003 + default privileges): a missing RLS policy on new tables is a PII leak or write hole. Tests must assert anon SELECT/INSERT/UPDATE/DELETE on `retreat_*` fail, and only RPC EXECUTE is granted to anon.
- **Spam / duplicate public inserts**: no CAPTCHA or rate limit exists. Mitigate with unique `(event_key, email)` and/or `(event_key, phone)` and Spanish duplicate error; rate-limit is out of scope unless requested.
- **Minors + Ley 1581 on a public URL**: reuse existing consent + legal-rep validation; store `policy_version` + acceptance timestamps on the registration. Privacy notice copy should mention retreat pre-registration purpose (propose/spec should extend `PRIVACY_NOTICE_ES` or pass a retreat-specific notice — do not silently reuse attendance-only purpose text without review).
- **Unconfigured total cost**: if staff record payments before setting cost, status cannot complete. Refuse payment insert until `retreat.youth.total_cost` is a positive number.
- **AdminPage access**: leaders cannot use Admin; payments must not live only there.
- **CaptureForm coupling**: forgetting the adapter on `/retiro` would enqueue doomed `members` inserts on visitors’ devices.
- **PR size**: schema + RPC + two UIs + tests likely > 400 authored lines; chain PRs under existing `auto-chain`.
- **Sensitive religious fields**: still collected and not persisted in member capture; decide in propose whether retreat stores them (plaintext on registration vs skip). Default: persist only if sensitive consent is checked, as optional text columns (encryption is unused in the current form).

### Ready for Proposal

Yes. Orchestrator should tell the user: exploration recommends a dedicated retreat domain (not `members`), public `/retiro` reusing `CaptureForm` via a submit adapter, payments recorded later by staff against a configurable total in `app_settings`, and chained PRs because of review-budget risk. No product-price decision is required before proposal; staff will set the amount in settings before collecting installments.
