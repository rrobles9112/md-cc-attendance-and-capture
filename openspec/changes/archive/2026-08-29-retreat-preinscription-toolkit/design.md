# Design: retreat-preinscription-toolkit

| Field | Value |
|---|---|
| Change | `retreat-preinscription-toolkit` |
| Inputs | `proposal.md` (validated), `specs/retreat-preinscription-toolkit/spec.md` (5 requirements, 24 scenarios) |
| Status | Designed — ready for `tasks` |
| Delivery | Stacked PRs to main (squash), strict TDD, RDD 4R review per PR |
| Stack facts verified during design | Next.js 15.5.22, supabase-js 2.112.0, Vitest 3.2.1 (alias `@` → `./src`, include `src/**/__tests__/**/*.test.{ts,tsx}`), tsconfig `noEmit: true` + `moduleResolution: bundler`, Node v26.7.0 available (native TS type-stripping) |

---

## 1. Scope summary

Four work units from the proposal, refined by verified code reads:

- **W1 (PR #1)** — classify duplicate-email in `createAuthUser` as `AdminUserStoreError('conflict')` so the existing route mapping returns 409 with the es-CO message. **Smaller than the proposal expected**: `user-api.ts` and `UsersPanel.tsx` need **zero code change** (verified — §2.1).
- **W2 (PR #2)** — `git mv` migrations `012a–012d` → `015–018` (contents unchanged) + update the two test files that assert the old literal paths (plus one `describe` title and one comment that also reference old names).
- **W3 (PR #3a + #3b)** — pure deterministic seed-cohort generator under Vitest + thin Node runner script. **Pre-split into two PRs** (production-line forecast exceeds 200; R8).
- **W4 (PR #4)** — "Nueva preinscripción" button + dialog on the retreat-registrations page mounting the untouched `CaptureForm` (retreat variant + existing adapter + `onSuccess`).

PR stack order: `main ← #1 (W1) ← #2 (W2) ← #3a (generator) ← #3b (runner) ← #4 (W4)`.

---

## 2. Ground-truth deltas found during design (verified reads)

These refine the proposal; each was confirmed by reading the named file.

### 2.1 W1 — the UI/route/service surface already works (code delta = 1 file)

- `src/app/api/admin/users/route.ts` — `storeStatus()` already maps `conflict → 409` and `jsonError()` already serializes `{ error, code }`. **No route change.**
- `src/lib/admin/user-service.ts` — `createManagedUser` does `await store.createAuthUser(input)` with no try/catch; a store rejection propagates unchanged. **No service change.**
- `src/lib/admin/user-api.ts` — `parseError()` already extracts `body.error` from a non-OK JSON response, and `createAdminUser` throws `new Error(that message)`.
- `src/components/admin/UsersPanel.tsx` — `handleCreate` catch already toasts `error.message`. Once the API returns 409 with `"Ya existe una cuenta registrada con ese correo electrónico."`, the panel shows exactly that es-CO toast. **No panel change** — the scenario is pinned by a test extension instead (§8).
- `src/lib/admin/user-policy.ts` — `parseCreateUserInput` rejects passwords `< 8` chars and malformed emails with 400 `invalid_input` **before GoTrue is called**. This is the safety argument for treating a GoTrue 422 at this call site as the duplicate case (AD-1).

### 2.2 W2 — exact set of stale references (repo-wide grep for `012[abcd]`)

- `src/lib/pastoreo/__tests__/explain.test.ts` — **3 references**: `describe("pastoreo EXPLAIN gate — indexes 012b")` title + 2 path literals → `016`.
- `src/__tests__/rls/whatsapp_pastoreo.test.ts` — **4 references**: 3 path literals + comment `// This will fail RED until migration 012c exists.` → `017`.
- Migration headers self-reference old names (`-- 012b_...`, `applies in order 012a→012b→012c`, `Does not depend on RLS (012c)`). **Spec mandates contents unchanged → headers stay as-is** (historical comments; a zero content diff keeps the rename trivially reviewable).
- `openspec/changes/archive/**` contains historical `012a–d` mentions — archived artifacts are immutable history, not tests; the spec constraint ("no test in the repository MAY reference the old paths") is unaffected.
- No source file (`src/lib/pastoreo/queries.ts`, etc.) references the old paths.

### 2.3 W2 — `016` (ex-`012b`) CONCURRENTLY has never actually run through `db reset`

Local `schema_migrations` has 001–011, 013, 014 — the four pastoreo files were *skipped*, so `CREATE INDEX CONCURRENTLY` has never been exercised by the CLI on this machine (the original whatsapp-pastoreo run deferred `db reset` with Docker down; its verify-report left the "no CONCURRENTLY-inside-transaction error" checklist item unchecked). Carried as risk **RK-1** with a decision tree (§10).

### 2.4 W3 — `retreat_registrations` has **no** `recorded_by` column

Verified across migrations 011/013/014: `recorded_by UUID REFERENCES profiles(id)` exists only on `retreat_payments`. The plan-level `recordedBy` (required by spec R3) materializes **on payment rows only**; registrations are inserted without it. No spec conflict: spec R3 says plans must *carry* the injected operator id, and R4 says the runner resolves/injects it.

### 2.5 W3 — schema constraints the generator/runner must satisfy (from 011/013/014)

- Unique indexes: `(event_key, lower(btrim(email)))` and `(event_key, regexp_replace(btrim(phone),'[^0-9]','','g'))`.
- `general_consent_accepted_at TIMESTAMPTZ NOT NULL`, `general_consent_policy_version TEXT NOT NULL`.
- `retreat_payments.amount NUMERIC(12,2) CHECK (amount > 0)`; `retreat_payments.registration_id` FK has **no ON DELETE CASCADE** → `--clean` must delete payments first.
- `retreat_payments_guard_total()` BEFORE INSERT rejects any payment unless `app_settings.'retreat.youth.total_cost'` is a positive number (hosted value currently `""`).
- `retreat_payments_apply_status()` AFTER INSERT computes status (`0 → preinscrito`, `0 < sum < total → pagos_parciales`, `sum ≥ total → inscrito`) — the script must never write `status`.
- RPC `register_retreat_preinscription` is granted to `anon`+`authenticated` only → direct service-role insert is the seed path (D2 confirmed); the RPC remains covered end-to-end by W4's real UI flow.
- Local `supabase/seed.sql` seeds a `super_admin` profile (`a0000000-0000-4000-8000-000000000001`) → the runner's default operator resolution works on a fresh local `db reset`.

### 2.6 W4 — `CaptureForm` contract (read in full) and page refresh mechanism

- `CaptureFormProps` exposes `onSuccess?: () => void`; on the adapter path success runs `toast.success(RETREAT_SUCCESS_MESSAGE)` → `resetForm()` → `onSuccess?.()`; on failure it toasts `RETREAT_ERROR_MESSAGE` and **keeps entered data** (no reset). Zero `CaptureForm` changes (D5 option (a) confirmed).
- Precedent: `src/app/(dashboard)/members/page.tsx` already mounts the retreat-variant `CaptureForm` inside a `Dialog` (`max-w-2xl max-h-[90vh] overflow-y-auto`) with `onSuccess` closing the dialog — W4 mirrors this pattern with the *public* adapter and no wrapper.
- The retreat-registrations page is a client component that owns its data via `loadData` (useCallback over `[page, pageSize, tab, searchDebounced]`). `router.refresh()` would not refresh client-fetched table data; calling `loadData()` re-fetches with the **current** tab/search/page/pageSize → resolves R7 (view state preserved).
- The page already early-returns `No tiene permisos para acceder a esta sección` when `!canManageRetreatRegistrations(role)` → the new button is structurally hidden for unauthorized sessions (spec "hidden or disabled" satisfied by *hidden*).
- Offline/no-session gating precedent: export buttons use `disabled={!isOnline || !hasSession}` + `title="Requiere conexión"` — the new button mirrors it exactly.

---

## 3. Architecture per work unit

### 3.1 W1 — duplicate-email 409 (PR #1)

**Only production file changed:** `src/lib/admin/user-store.ts`.

Add a narrow, exported classifier plus a conflict branch in `createAuthUser`:

```ts
export const CONFLICT_EMAIL_MESSAGE_ES = 'Ya existe una cuenta registrada con ese correo electrónico.'

const DUPLICATE_EMAIL_MESSAGE = /already registered|user_already_exists/i

/**
 * GoTrue admin createUser signals a duplicate email with "User already registered"
 * (HTTP 422). parseCreateUserInput already rejects short passwords / malformed
 * emails (400) before GoTrue is called, so a 422 at this call site is not a
 * password/format validation failure; those phrasings are excluded anyway.
 */
export function isDuplicateEmailAuthError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  const { message, code, status } = error as { message?: unknown; code?: unknown; status?: unknown }
  const messageText = typeof message === 'string' ? message : ''
  if (DUPLICATE_EMAIL_MESSAGE.test(messageText)) return true
  if (code === 'user_already_exists') return true
  if (/password/i.test(messageText)) return false
  return code === '422' || status === 422
}
```

`createAuthUser` error branch becomes:

```ts
if (error || !data.user) {
  if (isDuplicateEmailAuthError(error)) {
    throw new AdminUserStoreError('conflict', CONFLICT_EMAIL_MESSAGE_ES)
  }
  throw new AdminUserStoreError('auth_failed', error?.message ?? 'Could not create auth user')
}
```

End-to-end chain after the change (no other code touched):
`UsersPanel handleCreate → createAdminUser (fetch POST /api/admin/users) → requireSuperAdmin → parseCreateUserInput → createManagedUser → store.createAuthUser → GoTrue "User already registered" → AdminUserStoreError('conflict', es-CO) → route storeStatus('conflict') → 409 { error, code:'conflict' } → user-api parseError → throw Error(message) → UsersPanel catch → toast.error(es-CO message)`.

**Ops (not in the PR):** `vercel env add SUPABASE_SERVICE_ROLE_KEY` (production + preview) with the verified hosted key from local `.env`, redeploy both, smoke-check one create (S1). This is the actual P0 fix; the PR only adds the 409 classification.

### 3.2 W2 — migration renumbering (PR #2)

```
git mv supabase/migrations/012a_whatsapp_pastoreo_core.sql     supabase/migrations/015_whatsapp_pastoreo_core.sql
git mv supabase/migrations/012b_whatsapp_pastoreo_indexes.sql  supabase/migrations/016_whatsapp_pastoreo_indexes.sql
git mv supabase/migrations/012c_whatsapp_pastoreo_rls.sql      supabase/migrations/017_whatsapp_pastoreo_rls.sql
git mv supabase/migrations/012d_whatsapp_pastoreo_cron.sql     supabase/migrations/018_whatsapp_pastoreo_cron.sql
```

Contents byte-identical (including self-referential header comments — §2.2). Test updates in the same PR (strict-TDD cycle: update expected paths → RED while files still hold old names → `git mv` → GREEN):

- `explain.test.ts`: describe title → `indexes 016`; both path literals → `supabase/migrations/016_whatsapp_pastoreo_indexes.sql`.
- `whatsapp_pastoreo.test.ts`: three path literals → `supabase/migrations/017_whatsapp_pastoreo_rls.sql`; the `012c` comment → `017`.

Order safety (verified by reading 012a–d vs 013/014): the pastoreo files touch `members`/`profiles`/`notification_log`/`app_settings`/`sessions`/`attendance` + pg_cron; 013/014 touch `retreat_registrations`/`retreat_payments`/`members.pastoral_group`/pg_trgm/view/RPC. Disjoint object sets, all `IF NOT EXISTS`/`CREATE OR REPLACE` idempotent; internal order preserved (015 core → 016 indexes on objects 15 creates → 017 RLS → 018 cron).

Verification gates: local `supabase db reset` applies 001–018 (S3; Docker must be up); repo grep for `012[abcd]` returns only migration headers + archives; hosted `supabase db push --dry-run` reviewed, then push (S4).

### 3.3 W3 — seed cohort generator + runner (PR #3a + PR #3b)

**PR #3a — pure generator `src/lib/retreat/seed-cohort.ts` (Vitest-tested).**

Module shape (erasable-syntax TS only — no enums/namespaces/parameter properties; Node type-stripping compatible):

```ts
// Relative imports with explicit .ts extensions ONLY (no @/ alias) so Vitest
// (alias-aware) and the Node runner (alias-unaware, type-stripping) load the
// exact same module.
import { RETREAT_EVENT_KEY } from './constants.ts'

export const SEED_MARKER_DOMAIN = '@seed.retiro.test'
export const SEED_CONSENT_POLICY_VERSION = 'pdtp-v1.0-2026-07-17' // mirrors c_policy_version in migrations 011/013

export type SeedBucket = 'preinscrito' | 'pagos_parciales' | 'inscrito'

export interface SeedPaymentPlan { amount: number }
export interface SeedPlan {
  index: number
  bucket: SeedBucket
  name: string            // synthetic combo drawn from PRNG name lists
  email: string           // unique, lowercase, on SEED_MARKER_DOMAIN
  phone: string           // unique, digits-only (12 digits)
  eventKey: string        // RETREAT_EVENT_KEY
  generalConsentAcceptedAt: string   // injected `now` (ISO) — the ONLY `now` use
  generalConsentPolicyVersion: string
  recordedBy: string      // operator profile id; materializes on retreat_payments rows
  payments: SeedPaymentPlan[]        // [] for the preinscrito bucket
}
export interface SeedCohortOptions {
  seed: string       // PRNG seed (non-empty string)
  size: number       // N ≥ 1; default 12 handled by the runner
  totalCost: number  // positive; injected (runner reads/ensures app_settings)
  now: string        // ISO timestamp; affects ONLY consent stamps
  recordedBy: string
}

export function buildSeedCohort(options: SeedCohortOptions): SeedPlan[]
export function summarizeBuckets(plans: SeedPlan[]): Record<SeedBucket, number>
```

Determinism contract (AD-7): `name`, `email`, `phone`, `payments` depend **only** on `seed`, `size`, `totalCost`; `now` affects only `generalConsentAcceptedAt`. No `Math.random`, no `Date.now`, no IO inside the module.

Internals:

- **PRNG**: FNV-1a 32-bit string hash of `seed` → `mulberry32` stream. Fixed draw order (per-plan: first name, last name, then payment splits). `randInt(min,max)` / `randFloat()` derived from the stream.
- **Bucket allocation** (AD-8): `bucket = BUCKETS[i % 3]`, `BUCKETS = ['preinscrito','pagos_parciales','inscrito']` — deterministic, ~N/3 each, all buckets covered for any N ≥ 3 (independent of the PRNG; satisfies R3-scenario "every bucket covered").
- **Payment allocation in integer cents** (avoids float drift; `NUMERIC(12,2)` exact):
  - `preinscrito` → `[]` (sum 0).
  - `pagos_parciales` → target `= clamp(floor(totalCents * f), 1, totalCents - 1)` with `f ∈ [0.2, 0.8]` from the PRNG; split into `k ∈ {1,2}` payments (`k := min(k, target)` so each part ≥ 1 cent); the last payment absorbs the remainder.
  - `inscrito` → `k ∈ {2,3}` payments partitioning **exactly** `totalCents` (proportional cuts, remainder on the last); if `totalCents < k` → a single payment of the full total (sum = total → `inscrito`).
  - Output `amount = cents / 100` (2-decimal values serialize exactly through JSON → Postgres NUMERIC).
- **Identity derivation** (AD-9): `seedTag = fnv1a(seed).toString(16).slice(0,6)`; `email = qa-{seedTag}-{String(i).padStart(3,'0')}@seed.retiro.test`; `phone = '57310' + seedDigits(3) + String(i).padStart(4,'0')` (12 digits; unique within a run by index, unique across seeds by the seed-derived digits → different seeds coexist without `--clean`; re-running the same seed against existing rows fails 23505 with an actionable message).
- **Personas**: synthetic Spanish name combos (FIRST/LAST name arrays drawn from the PRNG); registrations carry `birthday: null`, `is_minor: false`, `legal_rep_name: null`, and null sensitive-optional fields — only the mandatory general-consent stamps (Ley 1581, `pdtp-v1.0-2026-07-17`).
- `summarizeBuckets` is exported so the generator tests and the runner's dry-run/readback print share one implementation.

**PR #3a also modifies `tsconfig.json`**: add `"allowImportingTsExtensions": true` (permitted because `noEmit: true`). Required so `tsc`/`next build` accept the `.ts`-extension relative imports used by this module triad (generator ↔ `constants.ts`, its test, the runner). The generator is **not** imported by any Next.js page, so webpack never bundles it; the flag only relaxes import-specifier type-checking.

**PR #3b — thin runner `scripts/retreat/seed-cohort.ts`** (Node native type-stripping: `node scripts/retreat/seed-cohort.ts …`; fallback `npx tsx scripts/retreat/seed-cohort.ts …` for older Node — both documented in the file header and in docs). Pure logic stays in the lib module; the runner is env/args/IO only:

1. **Arg parsing** (inline, dev-tooling, manually verified — AD-12): `--size <int≥1>` (default 12), `--seed <string>` (default `'1'`), `--ensure-total <number>` (default 400000), `--overwrite-total`, `--confirm-hosted-total`, `--recorded-by <uuid>`, `--url <url>`, `--service-key <key>`, `--clean`, `--dry-run`, `--help`. Unknown flag / bad value → usage error, exit 2.
2. **Target resolution** (AD-10): `url = --url || env.SUPABASE_URL || 'http://127.0.0.1:54321'` (config.toml `[api] port = 54321`); `serviceKey = --service-key || env.SUPABASE_SERVICE_ROLE_KEY` — **required, no default**; the error message points to `supabase status` for the local key and warns that the local `.env` key belongs to the *hosted* project and must not be used against local. `NEXT_PUBLIC_*` env names are deliberately **not** consulted, so an env file cannot silently redirect the default local target to hosted.
3. **`--clean` mode**: select seed registrations `event_key = RETREAT_EVENT_KEY AND email ILIKE '%@seed.retiro.test'` → delete their `retreat_payments` (`.in('registration_id', ids)`) **first** (FK has no CASCADE), then the registrations; print counts; exit (re-seed by running again without `--clean`). Deleting payments first never violates a status invariant (deleting all payments of a row leaves it `preinscrito`, a valid state).
4. **Operator resolution**: `--recorded-by` (verified to exist in `profiles`) else first `super_admin` profile by `created_at` (`select('id').eq('role','super_admin').order('created_at').limit(1)`); abort with guidance if none. For `--dry-run`, an unresolvable operator degrades to a `<unresolved>` placeholder with a warning instead of aborting.
5. **Ensure-total before any payment** (spec order): read `app_settings.'retreat.youth.total_cost'`; reuse `parsePositiveTotal` imported from `../../src/lib/retreat/payments.ts` (pure module, no imports → Node-loadable). If already positive and no `--overwrite-total` → keep unchanged (idempotent) and use it. Else → if the target is **not** local (hostname not `127.0.0.1`/`localhost`/`::1`) and `--confirm-hosted-total` is absent → **abort** with the product-owner-confirmation message (hosted `total_cost` defines the paid-in-full threshold — never a script default). Otherwise upsert `{ key, value: String(ensureTotal), updated_by: operatorId, updated_at: nowIso }` and use `ensureTotal`.
6. **Build cohort**: `buildSeedCohort({ seed, size, totalCost: effectiveTotal, now: new Date().toISOString(), recordedBy })`.
7. **`--dry-run`**: print the plan (per-plan index/bucket/name/email/phone/amounts + `summarizeBuckets` distribution) and the intended actions (ensure-total decision, insert counts) — reads allowed, **zero writes**; if the DB read fails (offline), fall back to `--ensure-total` as the preview total with a warning. Exit 0.
8. **Insert registrations** (single batch POST — atomic in PostgREST; service role bypasses RLS by design, D2): rows carry `event_key, name, phone, email, birthday: null, is_minor: false, legal_rep_name: null, general_consent_accepted_at, general_consent_policy_version` and null sensitive/denomination/community fields — **no `status` column** (DB default `preinscrito`; statuses are trigger-derived only). `.select('id,email')` maps inserted ids to emails.
   - `23505` on this insert → actionable abort: a cohort with this seed already exists — run `--clean` or change `--seed`.
9. **Insert payments** (single batch): `{ registration_id, amount, recorded_by: operatorId }` (created_at DB default). `retreat_payments_guard_total()` validates (total ensured in step 5); `retreat_payments_apply_status()` computes statuses.
10. **Readback**: `select('status').eq('event_key', RETREAT_EVENT_KEY).ilike('email', '%@seed.retiro.test')` → print the status distribution; warn if any bucket count is 0 when size ≥ 3.

Runner imports: `@supabase/supabase-js` (dep present), `../../src/lib/retreat/seed-cohort.ts`, `../../src/lib/retreat/constants.ts`, `../../src/lib/retreat/payments.ts` — all relative with `.ts` extensions, all pure modules. Docs: `docs/retreat-seed-cohort.md` (usage, determinism, clean, hosted confirmation policy).

**Split rationale (R8)**: generator + tests ≈ 150–190 production lines; runner ≈ 150–190; combined ≈ 300–380 > 200 budget → land as #3a (generator + tsconfig + tests) then #3b (runner + docs), preserving stack order. If the implementation lands under budget, the tasks phase may merge them, but the default plan is split.

### 3.4 W4 — "Nueva preinscripción" modal (PR #4)

**New component `src/components/retreat/RetreatPreinscriptionCreate.tsx`** (`'use client'`):

```tsx
export interface RetreatPreinscriptionCreateProps {
  disabled?: boolean      // offline / no-session gate from the page
  disabledTitle?: string  // 'Requiere conexión'
  onSuccess: () => void   // page refresh (loadData)
}
```

- Renders a toolbar `<Button size="sm">` with a `UserPlus` icon, label **"Nueva preinscripción"**, `disabled={disabled}` + `title={disabled ? disabledTitle : undefined}`.
- Owns `open` state; the `Dialog` (`DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"` — mirrors the members-page precedent) mounts:
  `<CaptureForm variant="retreat" submitAdapter={submitRetreatPreinscription} onSuccess={() => { setOpen(false); onSuccess() }} />`
  — the public adapter passed **directly** (D5 option (a); no wrapper, zero `CaptureForm` changes). `CaptureForm` already toasts `RETREAT_SUCCESS_MESSAGE`, resets the form, then calls `onSuccess`; on failure it toasts `RETREAT_ERROR_MESSAGE` and keeps entered data, so the dialog naturally stays open.
- Dialog copy (es-CO): title "Nueva preinscripción"; description "Registre una preinscripción al retiro juvenil. La persona quedará como Preinscrito con sus sellos de consentimiento (Ley 1581 pdtp-v1.0-2026-07-17)."

**Page change `src/app/(dashboard)/retreat-registrations/page.tsx`** (stays thin): import the component and render it as the first child of the existing `no-print` toolbar div, next to the export/print buttons:

```tsx
<RetreatPreinscriptionCreate
  disabled={!isOnline || !hasSession}
  disabledTitle="Requiere conexión"
  onSuccess={() => void loadData()}
/>
```

- `no-print` class → excluded from printed output (spec).
- `loadData()` re-fetches with the current `tab/searchDebounced/page/pageSize` → view state preserved (R7).
- Permission gating: the page's existing early return hides the whole page (including the button) for unauthorized sessions; offline/no-session handled by `disabled` + title. The dialog is never rendered when `disabled` would be true and unauthenticated anyway (RPC is anon-accessible, but the page session gate is the UX contract per spec).

---

## 4. Design decisions

| ID | Decision | Rationale / rejected alternatives |
|---|---|---|
| AD-1 | Duplicate-email classifier: message regex `/already registered\|user_already_exists/i` OR code `user_already_exists` OR (code `'422'`/status 422 AND message does not mention "password") | Message-first survives supabase-js wording changes; the 422 fallback covers other wordings. Password-exclusion honors the spec's non-duplicate example ("Password should be at least 6 characters") — and `user-policy.ts` pre-validation (400) makes non-password 422s at this call site dominated by duplicates. Rejected: matching only the exact string "User already registered" (brittle); classifying all 422s without the password guard (over-broad). |
| AD-2 | Zero changes to route / user-service / user-api / UsersPanel | Verified chain (§2.1) already produces the required 409 + es-CO toast once the store throws `conflict`. Rejected: adding a route-level test with mocked supabase server client — no repo precedent for route tests and heavy mocking; coverage instead via store unit test + panel toast pin + S1 smoke. |
| AD-3 | Migration rename via `git mv`, contents byte-identical including self-referential headers; test literal updates in the same PR | Zero content diff = trivially reviewable rename; spec mandates unchanged contents. Rejected: "fixing" the header comments (spec violation) or leaving tests broken until a later PR (violates stacked-PR green rule). |
| AD-4 | `016` CONCURRENTLY risk handled by a decision tree, not pre-emptive SQL edits (§10 RK-1) | Spec requires unchanged contents. The risk has never materialized locally (file never applied via CLI) but is plausible; the design's verification gate S3 catches it, and the fallbacks stay out-of-band or go through a spec amendment. |
| AD-5 | Generator is pure: `buildSeedCohort(options)` with injected `now`/`recordedBy`/`totalCost`; deterministic PRNG (FNV-1a → mulberry32); integer-cent arithmetic | Purity is what makes the determinism scenario testable in Vitest and keeps Node/Bun parity irrelevant. Integer cents avoid float drift in NUMERIC(12,2). Rejected: `Math.random`-free but `Date.now`-dependent stamps (breaks "now affects only stamps" reasoning), float arithmetic (rounding drift). |
| AD-6 | Bucket allocation `i % 3` (not PRNG) | Guarantees all three buckets are covered for any N ≥ 3 and makes the distribution exactly ⌈N/3⌉-balanced; deterministic without depending on draw order. Rejected: PRNG-assigned buckets (coverage not guaranteed; distribution flaky for small N). |
| AD-7 | Identity derivation: `qa-{seedTag}-{i}@seed.retiro.test`, 12-digit phone `57310 + seedDigits + index` | Unique within a run by construction (index), unique across seeds (seedTag/digits) → cohorts from different seeds can coexist; same-seed re-run collides on the unique index and produces the actionable 23505 message. Email marker domain doubles as the `--clean` filter. |
| AD-8 | Generator + test import via `@/lib/retreat/seed-cohort` (Vitest alias) but internal imports use relative `.ts` specifiers; runner imports the generator via relative `../../src/lib/retreat/seed-cohort.ts` | The same physical module must be loadable by Vitest (alias-aware, bundler) and Node type-stripping (no alias support, ESM requires extensions). Relative-with-extension satisfies both. |
| AD-9 | `tsconfig.json` gains `allowImportingTsExtensions: true` (safe with `noEmit: true`) | Unavoidable for the `.ts`-specifier imports; nothing is emitted, and the script is never bundled by Next. Rejected: excluding `scripts/` from tsconfig (untyped script) and `.mjs` runner (loses types). |
| AD-10 | Runner target: URL defaults to local `http://127.0.0.1:54321`; key **always required** (`--service-key` or `SUPABASE_SERVICE_ROLE_KEY`); never reads `NEXT_PUBLIC_*`; hosted `total_cost` writes gated by `--confirm-hosted-total` | No hardcoded keys (not even the well-known local demo JWT). The local `.env` holds hosted keys — reading `NEXT_PUBLIC_*` would let an env file silently point the "local" default at hosted. Hosted gating encodes "product owner sets the real price" (spec). |
| AD-11 | Batch inserts (registrations with `.select('id,email')`, then payments) in PostgREST single POSTs; no status writes; readback print | Atomic per batch; id mapping via returned ids; statuses stay trigger-derived (spec). Rejected: per-row inserts (partial cohorts on failure) and writing `status` directly (spec-forbidden). |
| AD-12 | CLI arg parsing lives in the runner (manually verified), not in the lib module | Vitest's include pattern (`src/**/__tests__/**`) does not cover `scripts/`; moving arg parsing into `src/lib` would stretch the "pure generator" module into CLI plumbing for marginal test value on dev-only code. The generator API stays a typed options object — fully tested. |
| AD-13 | `--clean` deletes payments first, then registrations, matching only the seed email-marker domain, and exits without seeding | FK has no ON DELETE CASCADE; marker-domain filter can never match a real person (real emails can't end in `@seed.retiro.test`). Clean-as-mode avoids surprise double-seeds; re-seed is an explicit second run. |
| AD-14 | Page refresh on success = `loadData()` (not `router.refresh()`) | The page owns data client-side; `router.refresh()` would not re-fetch it. `loadData` preserves tab/search/page/pageSize (R7). |
| AD-15 | New creation UI is a dedicated thin component (`RetreatPreinscriptionCreate`) mounted by the page, dialog hosting the untouched `CaptureForm` with the public adapter passed directly | Keeps the page thin, mirrors the members-page dialog precedent, and honors D5(a) (zero `CaptureForm` changes). Rejected: inflating the page with dialog state; wrapping the adapter (D5(b)); building a parallel form (duplicated contract, spec-forbidden drift). |
| AD-16 | PR split for W3 (#3a generator, #3b runner) pre-declared; tsconfig change rides #3a | Line forecast ~300–380 > 200 budget (R8). The tsconfig flag is needed by #3a's internal `.ts` imports, so it cannot wait for #3b. Tasks phase may merge if the real forecast lands under budget. |
| AD-17 | **Amendment A1** (owner sign-off 2026-08-29, richard.robles; extended same day to `018`): in `015`, `age_years` `GENERATED ALWAYS` → plain column + `BEFORE INSERT OR UPDATE OF birthday` trigger + backfill `UPDATE`; in `016`, nine `CREATE INDEX CONCURRENTLY` → plain `CREATE INDEX`, header comments updated; in `018`, `DO $$` → `DO $do$` (distinct dollar-quote tags) because identical tags closed the outer body at the cron command's `$$` (42601) | S3 caught three latent defects the CLI skip bug had hidden forever: `age()` is STABLE → 42P17 in any context; the CLI's per-file transaction (proven: 015's statements 1–4 rolled back whole) → 25001 for CONCURRENTLY locally and hosted; and 018's nested identical `$$` tags → 42601 in any context. Trigger keeps exact STORED write-time semantics (both recompute only on row write); backfill closes the ALTER-time population gap for hosted rows. Plain CREATE INDEX is safe: `db reset` targets a fresh empty database and hosted tables are small (sub-second locks). Distinct tags preserve the cron command's `$$` quoting unchanged. Rejected: dropping the column (rewrites pastoreo TS consumers of another cycle), keeping CONCURRENTLY with out-of-band psql (permanent toil; every reset still fails), reverting W2 (numbering bug stays; hosted schema stays missing). |

---

## 5. Contracts

### 5.1 `src/lib/admin/user-store.ts` (W1 — additions)

- `CONFLICT_EMAIL_MESSAGE_ES: string` — exact spec text `Ya existe una cuenta registrada con ese correo electrónico.` (exported so tests pin the same constant — no drift).
- `isDuplicateEmailAuthError(error: unknown): boolean` — pure classifier (AD-1).
- `createAuthUser` behavior change: duplicate-email GoTrue failures throw `AdminUserStoreError('conflict', CONFLICT_EMAIL_MESSAGE_ES)`; all other failures keep `auth_failed` with the upstream message.

### 5.2 `src/lib/retreat/seed-cohort.ts` (W3a — new)

As specified in §3.3: `SEED_MARKER_DOMAIN`, `SEED_CONSENT_POLICY_VERSION`, `SeedBucket`, `SeedPaymentPlan`, `SeedPlan`, `SeedCohortOptions`, `buildSeedCohort`, `summarizeBuckets`. Determinism contract documented in-module. Validation: non-empty `seed`, integer `size ≥ 1`, positive finite `totalCost`, ISO-parsable `now`, non-empty `recordedBy` → `RangeError`/`TypeError` with clear messages (invalid input throws; no defaults hidden inside the builder).

### 5.3 `scripts/retreat/seed-cohort.ts` (W3b — new, dev tooling)

CLI contract in §3.3 steps 1–10. Exit codes: 0 success/dry-run, 1 operational abort (missing key, hosted-gate, 23505, missing operator, insert failure), 2 usage error. Output in English (operator/dev tooling); user-facing API copy remains es-CO.

### 5.4 `src/components/retreat/RetreatPreinscriptionCreate.tsx` (W4 — new)

`RetreatPreinscriptionCreateProps` in §3.4. Behavior: click opens dialog; `CaptureForm` handles submit/toasts/reset (zero modification); success → dialog closes + `onSuccess()`; failure → dialog stays open with retained data (CaptureForm behavior). Disabled button shows `disabledTitle` tooltip.

### 5.5 Unchanged contracts (pinned by tests)

- `CaptureForm` public API and behavior (existing adapter + initialValues suites must pass unmodified; `git diff` empty for the file).
- API route error envelope `{ error, code }` + status mapping (pre-existing, exercised by the new store/panel tests).
- `submitRetreatPreinscription` / `register_retreat_preinscription` RPC (covered end-to-end by the W4 dialog flow).

---

## 6. File changes per PR

| PR | Production changes | Test changes | Notes |
|---|---|---|---|
| #1 (W1) | MOD `src/lib/admin/user-store.ts` (+~25 lines) | NEW `src/lib/admin/__tests__/user-store.test.ts`; MOD `src/components/admin/__tests__/UsersPanel.test.tsx` (expose sonner toast spies + conflict case); optional pin add in `src/lib/admin/__tests__/user-service.test.ts` | Ops runbook action (Vercel env var) lands outside the PR |
| #2 (W2) | RENAME 4 files under `supabase/migrations/` (012a→015, 012b→016, 012c→017, 012d→018; contents unchanged, 0 content lines) | MOD `src/lib/pastoreo/__tests__/explain.test.ts` (3 refs); MOD `src/__tests__/rls/whatsapp_pastoreo.test.ts` (4 refs) | Strict-TDD: RED on updated literals → rename → GREEN |
| #3a (W3 gen) | NEW `src/lib/retreat/seed-cohort.ts` (~150–190); MOD `tsconfig.json` (+1 flag) | NEW `src/lib/retreat/__tests__/seed-cohort.test.ts` | Pure module; no DB usage |
| #3b (W3 runner) | NEW `scripts/retreat/seed-cohort.ts` (~150–190); NEW `docs/retreat-seed-cohort.md` | none (manual verification matrix in docs) | Stacks on #3a |
| #4 (W4) | NEW `src/components/retreat/RetreatPreinscriptionCreate.tsx` (~60–80); MOD `src/app/(dashboard)/retreat-registrations/page.tsx` (+~8) | NEW `src/components/retreat/__tests__/RetreatPreinscriptionCreate.test.tsx`; NEW `src/app/(dashboard)/retreat-registrations/__tests__/create-preinscription-gate.test.tsx` | Zero `CaptureForm` changes |

All test files match the Vitest include pattern `src/**/__tests__/**/*.test.{ts,tsx}`.

---

## 7. Test plan (strict TDD)

RED → GREEN per unit; tests written first and shown failing against current code (or against the not-yet-renamed files), then made to pass by the production change.

### 7.1 NEW `src/lib/admin/__tests__/user-store.test.ts` (PR #1)

Pattern: `vi.mock('@supabase/supabase-js', ...)` + `stubEnv` (mirrors `user-service.test.ts`).

1. **duplicate message → conflict + es-CO**: mocked `auth.admin.createUser` rejects `{ message: 'User already registered' }` → `createAuthUser` rejects with `AdminUserStoreError` `kind 'conflict'`, message `CONFLICT_EMAIL_MESSAGE_ES` (imported constant).
2. **code `user_already_exists` → conflict** (message wording variant, e.g. `'AuthApiError: ...'`).
3. **422 without password mention → conflict**: `{ code: '422', message: 'Signup requires a valid email' }`-style case and `{ status: 422, message: '' }`.
4. **password 422 stays auth_failed**: `{ status: 422, message: 'Password should be at least 6 characters.' }` → `kind 'auth_failed'`, message preserved.
5. **unrelated failure stays auth_failed**: `{ message: 'Email not confirmed' }` (no 422/code match) → `auth_failed` + upstream message.
6. **classifier unit cases**: `isDuplicateEmailAuthError` direct truth table (null, string, `{}`, GoTrue shapes, non-422 statuses like 500 → false).
7. **success path**: resolves with the created user id (guards against regressions in the happy path).

### 7.2 MOD `src/components/admin/__tests__/UsersPanel.test.tsx` (PR #1)

Restructure the existing `vi.mock('sonner')` to hoisted spies so assertions are possible, then add:

- **conflict toast**: `createAdminUser` rejects `Error('Ya existe una cuenta registrada con ese correo electrónico.')` → submit → `toast.error` called with exactly that message, **not** the generic `Error al crear el usuario`; dialog stays open with the email retained; `onChanged` not called. (Pins the AD-2 zero-code-change claim at the UI layer.)

### 7.3 Optional pin — `user-service.test.ts` (PR #1)

One characterization test: a store `conflict` rejection propagates unchanged out of `createManagedUser`. Cheap; include if it does not require new mocks beyond the existing file's.

### 7.4 MOD pastoreo tests (PR #2)

Update the 7 references (§2.2) → RED against old filenames → `git mv` → GREEN. Existing assertions stay untouched otherwise.

### 7.5 NEW `src/lib/retreat/__tests__/seed-cohort.test.ts` (PR #3a)

- **determinism**: same options → deep-equal plans; changing only `now` changes only `generalConsentAcceptedAt`; changing `seed` changes identities/amounts; changing `totalCost` changes amounts only.
- **bucket coverage**: N=12 → 4/4/4 exactly; N=5 → all buckets ≥ 1; N=1 → exactly one plan, bucket `preinscrito` (i=0).
- **identity invariants**: emails lowercase, match `/^qa-[0-9a-f]{6}-\d{3}@seed\.retiro\.test$/`, unique in cohort; phones `/^\d{12}$/`, unique; both unique across two different seeds.
- **payment invariants**: every amount > 0, 2-decimal exact (`amount * 100` integral); `pagos_parciales` sums strictly between 0 and total; `inscrito` sums exactly to total; payments count 1–3; cents arithmetic edge cases (total = `0.01`, `0.02`, `3.00`, odd cents like `333.33`).
- **consent stamps**: every plan has `generalConsentAcceptedAt === now` and `generalConsentPolicyVersion === SEED_CONSENT_POLICY_VERSION === 'pdtp-v1.0-2026-07-17'`.
- **options validation**: size 0 / negative / non-integer; empty seed; non-positive/non-finite totalCost; malformed `now` → throws.
- **`summarizeBuckets`**: counts per bucket for a known plan list.

### 7.6 NEW `src/components/retreat/__tests__/RetreatPreinscriptionCreate.test.tsx` (PR #4)

Mirror `CaptureForm.adapter.test.tsx` mocking strategy (mock `@/lib/retreat/submit-adapter`, `@/lib/retreat/constants`, `sonner`, `next/navigation`, `lucide-react`; stub `ResizeObserver` + `window.matchMedia`):

1. **renders disabled button with title** when `disabled` + `disabledTitle` given; click does not open dialog.
2. **click opens dialog** with retreat `CaptureForm` (variant + adapter props asserted; privacy text visible).
3. **adapter success**: resolves → form reset called, success toast, dialog closed, `onSuccess` called once.
4. **adapter failure**: rejects → error toast, dialog still open, entered values retained (query input still present), `onSuccess` not called.
5. **default props**: enabled button opens dialog (no title attribute).

### 7.7 NEW `src/app/(dashboard)/retreat-registrations/__tests__/create-preinscription-gate.test.tsx` (PR #4)

Follow `pagination.test.tsx` page-mock pattern: mock `useRole` to return `'server'` → render page → "Nueva preinscripción" button absent + `No tiene permisos` notice present. (One focused gate test; the component's own suite covers the rest.)

### 7.8 Manual verification matrix (no Vitest coverage, documented in `docs/retreat-seed-cohort.md`)

- Runner `--help`, usage error (exit 2), missing key error.
- `--dry-run` against local (prints plan; DB row counts unchanged).
- Local seed run: insert, readback distribution matches `summarizeBuckets`, statuses in DB (`preinscrito`/`pagos_parciales`/`inscrito`), `recorded_by` set on payments.
- Re-run same seed → 23505 actionable message.
- `--clean` → payments + registrations removed, real rows untouched.
- `--ensure-total` idempotence (run twice; value unchanged without `--overwrite-total`).
- Hosted targeting: without `--confirm-hosted-total` aborts before any write; with it (and product-owner-approved value) upserts.
- S1/S2/S3/S4 ops smoke checks (below).

---

## 8. Requirements → design traceability (24 scenarios)

| Req | Scenario (abbreviated) | Design element | Verification |
|---|---|---|---|
| R1 | Valid creation works on hosted | Ops env fix (no code change needed; chain verified) | S1 smoke (Vercel env + redeploy + create) |
| R1 | Duplicate email → 409, never 500 | AD-1 classifier + conflict branch; existing route mapping | 7.1 (1–3, 6) |
| R1 | Panel shows es-CO conflict toast | AD-2 verified chain (zero UI code change) | 7.2 |
| R1 | Non-duplicate keeps existing mapping | password-exclusion + fallback branch | 7.1 (4–5) |
| R2 | Local reset applies full chain | AD-3 rename; order safety (§3.2) | S3 `db reset` (Docker up) |
| R2 | No test references old paths | §2.2 exact reference set updated | grep gate + 7.4 |
| R2 | Order-safe with 013/014 | disjoint object sets, internal order preserved | §3.2 analysis + S3 |
| R2 | Hosted push repairs | same files | S4 `db push --dry-run` then push |
| R3 | Same seed → identical cohort | AD-5 purity + determinism contract | 7.5 determinism block |
| R3 | Every bucket covered | AD-6 `i % 3` | 7.5 bucket block |
| R3 | Unique synthetic contacts | AD-7 derivation | 7.5 identity block |
| R3 | Consent stamps on every plan | builder stamps; §2.5 NOT NULL columns | 7.5 consent block |
| R4 | Total ensured before payments | runner step 5 before steps 8–9 | 7.8 local run + code order |
| R4 | Ensure-total idempotent | step 5 read-first logic | 7.8 idempotence run |
| R4 | Statuses trigger-derived + reported | no status writes; readback step 10 | 7.8 run + code review |
| R4 | Clean removes only seed rows | AD-13 marker filter + payments-first | 7.8 clean run |
| R4 | Dry-run touches nothing | step 7 | 7.8 dry-run run |
| R4 | Hosted targeting explicit | AD-10 key required + hosted gate | 7.8 hosted matrix |
| R5 | Button opens retreat form dialog | §3.4 component | 7.6 (2, 5) |
| R5 | Success closes + refreshes + toasts | onSuccess wiring; CaptureForm native toasts/reset | 7.6 (3) |
| R5 | Failed submit keeps dialog open | CaptureForm native failure behavior | 7.6 (4) |
| R5 | Permission gate (server role) | page early return hides UI | 7.7 |
| R5 | Offline gate | disabled + title mirror of export buttons | 7.6 (1) + page wiring |
| R5 | Shared form contract unchanged | AD-15 direct adapter, zero CaptureForm diff | existing CaptureForm suites pass unmodified + empty diff |

---

## 9. Rollout and ops runbook integration

1. **Before/with PR #1 (P0)**: `vercel env add SUPABASE_SERVICE_ROLE_KEY` (production + preview) using the verified hosted service key from the local `.env`; redeploy; S1 smoke — create one hosted user via `/members`, then repeat with the same email to observe the 409 + es-CO toast (S2). Note: env secret rotation invalidates the old value — verify by a successful create, not by absence of errors.
2. **PR #2 merge** → local `supabase db reset` (S3) → hosted `supabase db push --dry-run` review → push (S4). If RK-1 materializes, follow the §10 decision tree before pushing hosted.
3. **PR #3a/#3b merge** → run the 7.8 manual matrix locally (dry-run → seed → readback → re-run 23505 → clean). **Hosted seeding is conditional**: only with product-owner confirmation of the real `total_cost` (via `--confirm-hosted-total` after the price is set in the UI), per the proposal's "only with explicit operator confirmation" policy.
4. **PR #4 merge** → manual pass on `/retiro` (public form unchanged) and `/retreat-registrations` (button → dialog → create → row appears with `Preinscrito` + consent stamps; filters/pagination preserved).
5. Merge order = stack order; squash merges; each PR gets the standard RDD 4R review before merge.

Rollback (per PR, from proposal, refined):

- #1: revert — hosted creation returns to pre-fix behavior (still broken without env var, which is the status quo; the env var itself is additive and harmless).
- #2: revert restores old names; migrations are `IF NOT EXISTS`/`CREATE OR REPLACE` idempotent → re-running reset after revert is safe; no data migrations involved.
- #3a: revert deletes an unused pure module + tsconfig flag (nothing imports it but #3b).
- #3b: revert removes the script; `--clean` (or #3b's revert + manual delete of marker-domain rows) removes seed data.
- #4: revert removes the button/dialog; existing flows untouched.

---

## 10. Risks and mitigations

Carried from the proposal (R1–R9) unless refined, plus design-discovered risks:

| ID | Risk | Likelihood/Impact | Mitigation |
|---|---|---|---|
| RK-1 (from R2/R4) | `016` `CREATE INDEX CONCURRENTLY` fails if the CLI wraps a migration in a transaction (never actually exercised locally) | Medium / blocks PR #2 verification | **MATERIALIZED 2026-08-29 and resolved via Amendment A1 (AD-17)**: S3 `db reset` failed earlier and differently than predicted — `015` statement 5 raised 42P17 (`age()` is STABLE, illegal in a generated column), the whole-file rollback of 015's statements 1–4 proved the CLI's per-file transaction (which would also break 016's nine CONCURRENTLY statements, 25001, locally and hosted), and after fixing those, `018` raised 42601 from nested identical `$$` tags. All three fixed inside the amendment with owner sign-off the same day, per the §11 contingency; never silently. |
| RK-2 (from R6/R7) | Local Docker/stack down → S3 + 7.8 manual matrix blocked | Medium / verification only | Tasks phase gates S3 behind `docker ps` check; the matrix is documented so it can be re-run later; RK-1 remains open until the first real reset. |
| RK-3 (from R1/R8) | 422 classifier false positive on a non-duplicate GoTrue 422 wording that mentions neither "password" nor "registered" | Low / misclassified error kind (still a 4xx with a clear message, panel shows es-CO text) | Message regex covers the canonical wording; policy pre-validation dominates other 422 sources at this call site; case 7.1(5) pins the fallback. Monitor S2 smoke. |
| RK-4 (from R5) | Node type-stripping incompatibility in the runner environment (future Node removal/flags) | Low / dev tooling only | Node v26.7.0 verified available; erasable-syntax-only rule for the lib module; `npx tsx` fallback documented in header + docs. |
| RK-5 | `allowImportingTsExtensions` interacts with an unexpected lint/build rule | Low / build break caught immediately | `next build` + `vitest run` in the same PR; flag is inert for emitted code (`noEmit: true`). |
| RK-6 | Seed phone/email collides with pre-existing real data | Very Low / insert aborts atomically | Emails/phones are constructed on the synthetic marker domain; 23505 path prints the actionable message. |
| RK-7 | Hosted seeding accidentally run with wrong key/target | Low / data pollution | Key always explicit; hosted total gated by `--confirm-hosted-total`; marker domain makes seed rows identifiable and `--clean`-able; dry-run default posture for inspection. |
| RK-8 (from R9) | W3 size exceeds 200-line PR budget even split | Medium / review friction | Pre-split #3a/#3b (AD-16); tasks phase forecasts again; further slimming lever: move `summarizeBuckets` (already lib-side) and keep runner I/O-only. |
| RK-9 | Revert of #3a while #3b is stacked above it | Low / stack discipline | Standard stacked-PR practice: reverting #3a requires reverting #3b first; noted for the delivery plan. |

---

## 11. Handoff notes for the tasks phase

- Plan **5 work units → 5 PRs** in stack order `#1, #2, #3a, #3b, #4` (merge #3a+#3b only if the real forecast stays under the 200-line budget).
- Production-line forecasts (for the Review Workload Forecast): #1 ≈ 25, #2 ≈ 0 (pure renames; test-only edits), #3a ≈ 150–190 + 1 tsconfig line, #3b ≈ 150–190 + docs, #4 ≈ 70–90. All within budget per-PR.
- Strict-TDD ordering per PR is written in §7; PR #2's RED phase is the updated test literals against un-renamed files.
- Ops actions to sequence with the code (not inside PRs): Vercel env var + redeploy + S1/S2 smokes; local `db reset` (S3) gated on Docker; hosted `db push --dry-run` review (S4); hosted seeding only after product-owner confirmation of the real price.
- The exact spec message constant (`CONFLICT_EMAIL_MESSAGE_ES`) must be imported by tests — no re-typed copies.
- `docs/retreat-seed-cohort.md` (PR #3b) should include the 7.8 manual matrix as a checklist.
- Open contingency: RK-1 decision tree — if triggered, a spec amendment for 016's `CONCURRENTLY` wording needs product/spec-owner sign-off before any content edit.

---

## 12. Verification checklist for this design

- [x] Every spec requirement (R1–R5) and all 24 scenarios trace to a design element + a verification artifact (§8).
- [x] Every proposal decision (D1–D6) is resolved: D1 rename adopted (AD-3); D2 direct insert adopted (AD-11); D3 Node type-stripping adopted (AD-9/RK-4); D4 typed stack adopted and *narrowed* (AD-2); D5 option (a) direct adapter + onSuccess (AD-15); D6 defaults adopted with the service-key-required refinement (AD-10).
- [x] All file paths referenced exist today or are explicitly marked NEW/MOD/RENAME (§6).
- [x] No `CaptureForm`, `user-api.ts`, `user-service.ts`, `route.ts`, or `UsersPanel.tsx` production changes (verified zero-delta claims in §2.1/§2.6).
- [x] es-CO UI copy (conflict message, dialog copy, button labels) vs English artifacts/tests/docs respected.
- [x] Stacked-PR green rule: every PR leaves main buildable and tests green.
