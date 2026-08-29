# Change Proposal: retreat-preinscription-toolkit

| Field | Value |
|---|---|
| Change | `retreat-preinscription-toolkit` |
| Project | md-cc-attendance-and-capture (Next.js 15.5.22 + Supabase + Vitest, strict TDD) |
| Status | Proposed — ready for `spec` phase |
| Artifact store | openspec (`openspec/changes/retreat-preinscription-toolkit/`) |
| Delivery | Stacked PRs to main (squash merge), each < 200 production lines |
| Quality gates | Strict TDD (Vitest RED→GREEN, `npx vitest`, pattern `src/**/__tests__/**/*.test.{ts,tsx}`); RDD manual 4R review per PR; correction budget `min(200, ceil(lines/2))` |
| Compliance | Ley 1581 de 2012; consent policy version `pdtp-v1.0-2026-07-17` |
| UI copy language | es-CO (technical artifacts in English) |

## Why (Intent)

Four verified problems make this change worth doing now:

1. **Hosted user creation is broken (P0 operational blocker).** `POST /api/admin/users` on Vercel Production/Preview returns 500 with a generic "error de servidor". Verified root cause: the linked Vercel project (`md-cc-attendance-and-capture`, `.vercel/project.json`) has only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Production and Preview environments — no `SUPABASE_SERVICE_ROLE_KEY` (verified with `vercel env ls`). `createServiceRoleClient()` in `src/lib/admin/user-store.ts` then throws `AdminUserStoreError('auth_failed', 'Server is missing SUPABASE_SERVICE_ROLE_KEY')`, which the route maps to 500. The local flow is fully working (GoTrue admin API creates the user; `handle_new_user` trigger creates the `profiles` row; profiles PATCH returns 204). The hosted project is `https://ppiyddosohwhswhfzqhk.supabase.co` and its valid service key is already present in the local `.env`. Secondary defect on the same surface: a duplicate email (`admin.auth.admin.createUser` → "User already registered") is currently classified `auth_failed` → 500 instead of a proper 409 conflict with a clear es-CO message.

2. **Four migrations are silently skipped, leaving local and hosted schemas drifting (blocks shipped whatsapp-pastoreo features).** `supabase/migrations/012a..012d_whatsapp_pastoreo_*.sql` do not match the Supabase CLI numeric timestamp pattern, so `db reset` / `db push` skip them. Local `schema_migrations` contains 001–011, 013, 014 but NOT 012a–d; the local DB lacks the `notification_log` table and `profiles.whatsapp_opt_in` column. The **hosted** DB also lacks them (live runtime errors: `notification_log` → 404 PGRST205; `profiles.whatsapp_opt_in` → 42703). Shipped app code already depends on these objects (`src/app/(dashboard)/pastoreo/page.tsx` queries `notification_log`; `src/lib/whatsapp/consent-gate.ts` reads `whatsapp_opt_in`), so the pastoreo monitoring page and consent gating are broken against hosted until this is repaired.

3. **No tooling exists to generate test preinscritos.** QA needs a synthetic cohort of preinscripciones with random abonos to exercise the retreat status machine (`preinscrito` → `pagos_parciales` → `inscrito` via `retreat_payments_apply_status()`) and to test the Valientes transfer flow (`openspec/specs/retreat-valientes-transfer`). Verified seed constraints: the `retreat_payments_guard_total()` BEFORE INSERT trigger rejects any payment when `app_settings` key `retreat.youth.total_cost` is missing/empty/non-positive (hosted value is currently `""`); `retreat_registrations` has unique indexes on `(event_key, lower(btrim(email)))` and `(event_key, digits-only phone)`; `general_consent_accepted_at` and `general_consent_policy_version` are NOT NULL (`'pdtp-v1.0-2026-07-17'`); `recorded_by` references `profiles(id)`; the RPC `register_retreat_preinscription` is granted only to `anon`/`authenticated`, so a service-role direct table insert is the natural seed path.

4. **The retreat module has no in-place preinscripción creation.** `src/app/(dashboard)/retreat-registrations/page.tsx` offers no way to register a preinscripción; admins must leave the dashboard and use the public `/retiro` page. The exact same form is reusable as-is: `/retiro` mounts `<CaptureForm variant="retreat" submitAdapter={submitRetreatPreinscription} />` (`src/components/forms/CaptureForm.tsx`, `src/lib/retreat/submit-adapter.ts`), and the RPC is granted to `anon` + `authenticated`, so it works from the authenticated dashboard.

## What Changes

Four work units, each landing as one stacked PR (< 200 production lines, strict TDD).

### W1 — Hosted user-creation repair + duplicate-email 409 (PR #1)

**Ops (not part of the PR):** add `SUPABASE_SERVICE_ROLE_KEY` to the Vercel project's Production and Preview environments using the verified hosted service key from local `.env`, then redeploy both environments. This alone restores user creation.

**Code (strict TDD):**
- `src/lib/admin/user-store.ts` — `createAuthUser` currently maps every GoTrue error to `auth_failed`. Classify the duplicate-email case (GoTrue `admin.auth.admin.createUser` returns "User already registered", typically status 422) and throw `AdminUserStoreError('conflict', <es-CO message>)`, e.g. `"Ya existe una cuenta registrada con ese correo electrónico."`.
- Route plumbing **already exists and needs no change** (verified): `storeStatus()` in `src/app/api/admin/users/route.ts` maps `conflict` → 409 and serializes `{ error, code }`. `deleteAuthUser`/`upsertProfile` already use the `conflict` code, so this is a consistent extension of an established pattern.
- `src/lib/admin/user-service.ts` — verify `createManagedUser` propagates the typed store error unchanged (expected: no change; confirm in spec phase).
- `src/lib/admin/user-api.ts` + `src/components/admin/UsersPanel.tsx` — surface the 409 conflict message as an es-CO toast instead of a generic server-error toast (verify current non-OK handling in spec phase; extend `src/components/admin/__tests__/UsersPanel.test.tsx`).
- New unit tests pin the classification with a mocked GoTrue "User already registered" error (RED against the current blanket `auth_failed`).

### W2 — Migration numbering repair (PR #2)

`git mv` (file contents unchanged):
- `supabase/migrations/012a_whatsapp_pastoreo_core.sql` → `015_whatsapp_pastoreo_core.sql`
- `supabase/migrations/012b_whatsapp_pastoreo_indexes.sql` → `016_whatsapp_pastoreo_indexes.sql`
- `supabase/migrations/012c_whatsapp_pastoreo_rls.sql` → `017_whatsapp_pastoreo_rls.sql`
- `supabase/migrations/012d_whatsapp_pastoreo_cron.sql` → `018_whatsapp_pastoreo_cron.sql`

Verified impact of the rename — two live test files assert the old literal paths and must be updated in the same PR (this is the natural strict-TDD cycle: update expected paths → RED while files still hold old names → rename → GREEN):
- `src/lib/pastoreo/__tests__/explain.test.ts` — asserts `supabase/migrations/012b_whatsapp_pastoreo_indexes.sql` (2 literals)
- `src/__tests__/rls/whatsapp_pastoreo.test.ts` — asserts `supabase/migrations/012c_whatsapp_pastoreo_rls.sql` (3 literals)

Safety: the four migrations are additive-only (`notification_log` table, `members`/`profiles` whatsapp columns, indexes, RLS, pg_cron job) and orthogonal to 013/014 (verified: local applied 013/014 while 012a–d were skipped, with no FK/object collisions; prior verify-reports reached the same conclusion). Local verification: `supabase db reset` applies 001–018. Hosted application is an ops action (`supabase db push` after merge, dry-run reviewed first).

### W3 — Seed cohort generator + runner script (PR #3)

- `src/lib/retreat/seed-cohort.ts` — **pure generator module, Vitest-tested** (test at `src/lib/retreat/__tests__/seed-cohort.test.ts`). Builds N preinscripción plans for `RETREAT_EVENT_KEY = 'retiro-juvenil-octubre-2026'`:
  - unique emails on a reserved marker domain (never real personal data) and unique digits-only phones, satisfying the unique indexes on `(event_key, lower(btrim(email)))` and `(event_key, digits-only phone)`;
  - `general_consent_accepted_at` + `general_consent_policy_version = 'pdtp-v1.0-2026-07-17'` stamped on every row (Ley 1581);
  - `recorded_by` = operator profile id (resolved by the runner, injected into the generator so it stays pure);
  - deterministic random abonos allocated explicitly across the three status buckets (sum = 0 → `preinscrito`; 0 < sum < total → `pagos_parciales`; sum ≥ total → `inscrito`), roughly N/3 per bucket so small cohorts still cover all states;
  - deterministic PRNG driven by a `--seed` value; all timestamps injected as parameters (no `Math.random`, no `Date.now` inside the generator) so the same seed reproduces the identical cohort.
  - Design note: the module must use relative imports only (no `@/` alias) so both Vitest (alias-aware) and the Node runner (alias-unaware) can load it.
- `scripts/retreat/seed-cohort.ts` — **thin runner** executed with Node's native TypeScript type-stripping (fallback `npx tsx`):
  1. ensure `app_settings` `retreat.youth.total_cost` is a positive number (`--ensure-total`, default 400000; idempotent when already set, explicit flag to overwrite) — required or the `retreat_payments_guard_total()` trigger rejects every payment;
  2. resolve `recorded_by` operator profile;
  3. insert `retreat_registrations` rows, then `retreat_payments` rows (the `retreat_payments_apply_status()` AFTER INSERT trigger computes statuses);
  4. read back and print the status distribution as verification output.
  - Uses direct service-role inserts (bypasses RLS by design; see D2).
  - Default target: local Supabase. `--url` / `--service-key` (or env overrides) target hosted.
  - `--clean` removes previously seeded rows by marker domain (payments first, then registrations).
  - `--dry-run` prints the generated plan without touching the DB.

### W4 — "Nueva preinscripción" modal in the retreat module (PR #4)

- `src/app/(dashboard)/retreat-registrations/page.tsx`: add a **"Nueva preinscripción"** button that opens a dialog mounting `<CaptureForm variant="retreat" submitAdapter={submitRetreatPreinscription} onSuccess={...} />`.
- Verified contract (read from `CaptureForm.tsx`): `CaptureFormProps` already exposes `onSuccess?: () => void`; on the adapter path, success runs `toast.success(RETREAT_SUCCESS_MESSAGE)` ('Preinscripción enviada exitosamente'), `resetForm()`, then `onSuccess?.()`; on failure it toasts `RETREAT_ERROR_MESSAGE` and keeps the entered data (modal naturally stays open). Therefore the modal needs **no adapter wrapper and zero CaptureForm changes**: pass the existing adapter directly and use `onSuccess` to close the dialog and refresh the table (see D5).
- Extract a small dialog component (e.g., `src/components/retreat/`) with Vitest component tests (button opens dialog; dialog mounts the retreat-variant form with the right adapter; `onSuccess` closes and triggers the page refresh callback); the page stays thin.
- Table refresh mechanism (preserve filters/pagination where possible — `router.refresh()` vs page-level refetch) is a design-phase decision.

## Impact

**Affected files/areas:**
- Admin user management: `src/lib/admin/user-store.ts`, `src/lib/admin/user-service.ts` (verify-only), `src/app/api/admin/users/route.ts` (expected no change), `src/lib/admin/user-api.ts`, `src/components/admin/UsersPanel.tsx`, `src/components/admin/__tests__/UsersPanel.test.tsx`.
- Migrations: 4 file renames in `supabase/migrations/` + 2 test files with literal path updates.
- New tooling: `src/lib/retreat/seed-cohort.ts`, `src/lib/retreat/__tests__/seed-cohort.test.ts`, `scripts/retreat/seed-cohort.ts`.
- Retreat UI: `src/app/(dashboard)/retreat-registrations/page.tsx` + new dialog component + tests.
- Ops runbook: Vercel env addition + redeploy; hosted `db push`; local `db reset`; seed script usage.

**Affected openspec capabilities:** `youth-retreat-preregistration` (modal + seed), `youth-retreat-payments` (seed abonos, `total_cost` guard), `retreat-valientes-transfer` (enabled testing), `whatsapp-pastoreo-notifications` (migration repair restores its schema on hosted). No existing spec covers admin user management, so W1 likely requires a **new capability spec** (spec phase decides name/scope, e.g. `admin-user-management`).

**Data impact:** hosted DB gains additive objects 015–018 (required by already-shipped app code); `app_settings.retreat.youth.total_cost` goes from `""` to 400000 **only** when seeding hosted (ops decision — see D6/R4); seed rows are synthetic, marker-tagged, and removable via `--clean`.

**People impact:** super admins (user creation works again + clear 409 feedback), retreat coordinators (in-module preinscripción), QA/dev (deterministic test cohorts).

**Ley 1581:** the modal reuses the existing consent capture unchanged (retreat privacy notice, sensitive-data notice, `pdtp-v1.0-2026-07-17` stamps written by the RPC); seed data is synthetic and marker-tagged, never real personal data; no changes to ARCO/data-subject rights or retention flows.

## Non-Goals

- WhatsApp live provider configuration (Vault D2 pending from `whatsapp-pastoreo-notifications`).
- Bulk Valientes transfer tooling (the seed cohort only *enables* testing the existing transfer).
- Server-side export.
- Full Playwright e2e suite (Vitest unit/component tests + documented manual verification only).
- Any change to the members panel isolation.
- Any change to `CaptureForm`'s API or behavior.
- Any RLS/policy changes beyond what the renamed migrations already contain.
- Hosted data backfills beyond the additive 015–018 migrations and the optional, explicitly confirmed seed run.

## Open Decisions

Recommendations are adopted for the `spec` phase unless the user overrides them.

**D1 — Migration repair strategy: rename vs re-author.**
Options: (a) `git mv` 012a–d → 015–018 with contents untouched; (b) re-author as brand-new migrations; (c) fold into edits of 013/014.
**Recommendation: (a) rename.** Minimal diff, preserves already-reviewed content, satisfies the CLI numeric pattern, and is order-safe (content verified orthogonal to 013/014). The only collateral is the two test files with literal path assertions, updated in the same PR.

**D2 — Seed write path: direct insert vs RPC.**
Options: (a) direct service-role table inserts; (b) call `register_retreat_preinscription` per row.
**Recommendation: (a) direct insert.** The RPC is granted only to `anon`/`authenticated` (service key cannot call it without a grant change we do not want); direct insert supports marker-based cleanup, bulk payment inserts, and explicit bucket control. The RPC path remains covered end-to-end by W4's real UI flow.

**D3 — Seed script runtime.**
Options: (a) TypeScript script run with Node native type-stripping; (b) `npx tsx`; (c) plain `.mjs`.
**Recommendation: (a) with (b) as fallback.** Keeps types; the pure generator lives in `src/lib/retreat/seed-cohort.ts` under Vitest (strict TDD), and the runner stays a thin I/O wrapper so the runtime choice is cosmetic. If the machine's Node lacks type-stripping support, `npx tsx` runs the same file unchanged.

**D4 — Duplicate-email mapping surface.**
Options: (a) full typed stack: store `conflict` code + es-CO message + existing route 409 + `user-api`/`UsersPanel` conflict branch; (b) route-only string matching on the 500 body.
**Recommendation: (a).** Typed, testable, and consistent with the established `AdminUserStoreError('conflict')` pattern already used by delete/update paths; all surfaces change in one PR so no caller sees a mixed contract.

**D5 — Modal reuse strategy.**
Options: (a) pass `submitRetreatPreinscription` directly as `submitAdapter` and use the existing `onSuccess` prop for close + table refresh; (b) wrap the adapter to add close/reload/toast; (c) add new props to `CaptureForm`.
**Recommendation: (a).** The verified `CaptureFormProps` contract already provides the entire desired behavior: built-in es-CO success toast, form reset, `onSuccess?.()` hook on success, and error toast + retained data on failure. This is strictly less code than (b) with the same guarantees, and both (a) and (b) preserve the hard invariant: **zero `CaptureForm` changes**. (This refines the orchestrator's preliminary "wrap the adapter" direction after reading the actual props contract; a thin wrapper remains the fallback if the design phase needs adapter-level timing for the refresh.)

**D6 — Seed defaults.**
**Recommendation:** default target = local Supabase; `--url` / `--service-key` (or `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` env) override for hosted; `--ensure-total` default 400000 (idempotent, only fills when empty; explicit flag to overwrite); `--seed` PRNG value for deterministic randomness; `--clean` removes previous seed data by marker email domain; cohort size N with a default that covers all three buckets (suggest 12 ≈ 4 per bucket; exact default set in spec). Note: setting the **hosted** `retreat.youth.total_cost` is a product/financial decision (it defines the paid-in-full threshold and unblocks the payment guard) — require explicit product-owner confirmation before any hosted seed run.

## Ops Actions (explicitly NOT PRs)

1. **Immediately (unblocks the P0):** `vercel env add SUPABASE_SERVICE_ROLE_KEY` (production + preview) with the verified hosted key from local `.env`; redeploy both environments; smoke-check one `POST /api/admin/users`.
2. **After PR #2 merges:** hosted `supabase db push` applying 015–018 — review the dry-run diff first and stop on any unexpected drift; this repairs the hosted pastoreo monitoring page and consent gating.
3. **Dev machines after PR #2 merges:** local `supabase db reset` (applies 001–018).
4. **Conditional (after D6 product confirmation of `total_cost`):** run the seed script against hosted with `--url`/`--service-key`; use `--clean` to remove the cohort afterwards.

## Risks

- **R1 (ops, medium):** wrong or stale service key pasted into Vercel leaves the P0 broken. Mitigation: the key is pre-verified against the hosted project; single-request smoke check after redeploy; S1 gate.
- **R2 (migration order, low):** renaming could break the 013/014 chain — verified orthogonal (local applied 013/014 while 012a–d were skipped; prior archived verify-reports concur). Local `db reset` is the proof.
- **R3 (hosted push, medium):** hosted migration history may differ from local — dry-run review before push; objects are additive and idempotent (`IF NOT EXISTS`), so partial states are benign.
- **R4 (product/financial, medium):** setting hosted `retreat.youth.total_cost` defines the "inscrito" threshold and unblocks payment acceptance — an ops/product decision, not a code default; local-only remains the script default.
- **R5 (seed coverage, low):** purely random abonos could miss a status bucket at small N — the generator allocates buckets deterministically (~N/3 each) and Vitest asserts coverage.
- **R6 (API contract, low):** 409 is a new status on `POST /api/admin/users` — `user-api`/`UsersPanel` are updated in the same PR; the admin panel is the only consumer.
- **R7 (UX, low/medium):** closing the modal and refreshing could reset table filters/pagination — refresh data only and preserve view state; mechanism decided at design phase.
- **R8 (line budget, medium):** W3 (generator + runner + tests) may exceed 200 production lines — if the tasks-phase forecast exceeds budget, split into PR #3a (generator + tests) and PR #3b (runner script), preserving stack order.
- **R9 (strict TDD vs W2, low):** a rename-only PR has no behavior to unit-test — the two file-assertion test updates provide the RED→GREEN cycle; schema application is verified by local `db reset`, not Vitest.

## Rollback

- **W1:** revert the PR (restores prior 500-on-duplicate mapping; hosted user creation keeps working because the env var — the actual fix — stays). Ops rollback (not recommended): remove the env var + redeploy returns to the known-broken state.
- **W2:** revert the PR to restore old filenames; if 015–018 were already applied (local or hosted), the objects are additive **and required by shipped app code** (pastoreo page, consent gate) — leaving them applied is the safe state; manual drop SQL exists from the original whatsapp-pastoreo runbook (`DROP TABLE notification_log`, `ALTER TABLE ... DROP COLUMN ...`) only if a full revert is demanded.
- **W3:** run `--clean` to remove seed rows, then revert the PR (removes tooling); reverting `app_settings.retreat.youth.total_cost` is a manual ops choice.
- **W4:** revert the PR — button/dialog gone, public `/retiro` unaffected.
- Each PR is an independent squash-revert on main in stacked order.

## Success Criteria

- **S1:** On Vercel Production and Preview, `POST /api/admin/users` with valid input returns 201 and the user is fully created (auth user + `profiles` row); the "error de servidor" symptom is gone.
- **S2:** `POST /api/admin/users` with an already-registered email returns 409 with an es-CO message (e.g. "Ya existe una cuenta registrada con ese correo electrónico.") surfaced as a toast in UsersPanel — no 500.
- **S3:** Local `supabase db reset` applies migrations 001–018; `schema_migrations` lists 015–018; `notification_log` exists and `profiles.whatsapp_opt_in` exists locally.
- **S4:** After the hosted `db push`, the hosted 404 PGRST205 (`notification_log`) and 42703 (`whatsapp_opt_in`) errors are gone; the hosted pastoreo monitoring page loads.
- **S5:** Running the seed script twice with the same `--seed` produces an identical cohort (deterministic); the readback/printed status distribution covers `preinscrito`, `pagos_parciales`, and `inscrito`.
- **S6:** Seeded payments exercise the trigger machine exactly: sum = 0 → `preinscrito`; 0 < sum < total → `pagos_parciales`; sum ≥ total → `inscrito` (asserted by generator tests and by the runner's readback output).
- **S7:** The retreat-registrations page shows "Nueva preinscripción"; the dialog mounts the retreat-variant CaptureForm; a successful submit closes the dialog, refreshes the table, and shows the es-CO success toast; a failed submit keeps the dialog open with entered data and an error toast.
- **S8:** Every PR is < 200 production lines with strict-TDD RED→GREEN evidence per behavior (W2 via the file-assertion tests + `db reset`), and each PR carries an RDD 4R review receipt with budget `min(200, ceil(lines/2))`.

## Delivery Plan

Stacked to main, squash merges, in dependency order:

```
main ← PR#1 (W1 user-creation + 409) ← PR#2 (W2 migration rename) ← PR#3 (W3 seed tooling) ← PR#4 (W4 modal)
```

- PR #1 first (P0 user-facing break; the ops env fix can even precede it).
- PR #2 before PR #3 so the seed tooling is developed and verified against a complete local schema (`db reset` applying 001–018).
- PR #4 last (independent, but rides the stack).
- If W3 exceeds the 200-line budget (R8), split PR #3a/#3b keeping the same order.
- Ops timeline per "Ops Actions" above; none of the ops actions block PR code review, but S1/S4 verification depends on ops execution.
