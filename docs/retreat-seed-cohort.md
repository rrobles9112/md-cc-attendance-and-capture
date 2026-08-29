# Retreat Seed Cohort — Runner Guide

Synthetic QA cohort for `retiro-juvenil-octubre-2026`. The generator is pure and deterministic; the runner is a thin I/O script that persists the cohort through the service_role path. No real personal data is ever seeded — every row is on the reserved marker domain `@seed.retiro.test`.

Source of truth: `src/lib/retreat/seed-cohort.ts` (pure, Vitest-covered) + `scripts/retreat/seed-cohort.ts` (thin runner, manually verified). `scripts/` is outside the Vitest include pattern by design (AD-12).

---

## Quick start (local Supabase)

```bash
# 1. Ensure local stack is up (required for S3 + local matrix — RK-2)
supabase status

# 2. Preview without writing
node scripts/retreat/seed-cohort.ts --dry-run
# or: npx tsx scripts/retreat/seed-cohort.ts --dry-run

# 3. Seed 12 rows (default) — total must already be positive or will be set to 400000
node scripts/retreat/seed-cohort.ts

# 4. Inspect — the runner prints the trigger-derived status distribution
# 5. Remove only the seed rows
node scripts/retreat/seed-cohort.ts --clean
```

Both runtimes run the **same** module imports (relative `*.ts` with `allowImportingTsExtensions`):

| Runtime | Command | When to use |
|---|---|---|
| Node native type-stripping | `node scripts/retreat/seed-cohort.ts [flags]` | Node >= 22.6 (project default v26.7.0) — no extra deps |
| `tsx` fallback | `npx tsx scripts/retreat/seed-cohort.ts [flags]` | Older Node or when type-stripping flags are unavailable |

---

## Flag reference

| Flag | Default | Description |
|---|---|---|
| `--size <int>` | `12` | Cohort size. Integer `>= 1`. Bucket allocation is `BUCKETS[i % 3]` (`preinscrito`/`pagos_parciales`/`inscrito`), so `size=12 → 4/4/4`, `size>=3` guarantees every bucket appears. |
| `--seed <string>` | `'1'` | PRNG seed. Any non-empty string. Same seed → identical cohort (names, marker emails/phones, payment splits) across Node and Vitest. Changing the seed changes identities and amounts; changing only `--ensure-total` changes amounts only. |
| `--ensure-total <number>` | `400000` | `retreat.youth.total_cost` to ensure **before** any payment insert. Positive number. The guard trigger `retreat_payments_guard_total()` rejects every payment unless this setting is positive. |
| `--overwrite-total` | off | Overwrite an already-positive `retreat.youth.total_cost`. Without it, an existing positive value is kept (idempotent). |
| `--confirm-hosted-total` | off | **Required** to write `retreat.youth.total_cost` when the target is not local (see Hosted policy below). Without it the runner aborts before any write. |
| `--recorded-by <uuid>` | auto | Operator profile id written as `retreat_payments.recorded_by` and `app_settings.updated_by`. When omitted, the runner selects the first `super_admin` profile by `created_at` (the local `seed.sql` super_admin `a000...001` on a fresh `db reset`). Fails with guidance if no super_admin exists. `--dry-run` degrades to `<unresolved>` with a warning instead of aborting. |
| `--url <url>` | `SUPABASE_URL` or `http://127.0.0.1:54321` | Supabase URL. `config.toml [api] port = 54321`. |
| `--service-key <key>` | `SUPABASE_SERVICE_ROLE_KEY` | **Always required.** Explicit flag or env. Never reads `NEXT_PUBLIC_*`. No default key is hardcoded — not even the well-known local demo JWT. Error message points to `supabase status` for the local key and warns that the local `.env` key may belong to the *hosted* project. |
| `--clean` | off | Delete prior seed rows and exit without seeding. Deletes `retreat_payments` for the marker domain **first**, then the `retreat_registrations` (FK has no `ON DELETE CASCADE`). No non-seed rows are affected. |
| `--dry-run` | off | Print the full plan (per-plan index/bucket/name/email/phone/amounts + `summarizeBuckets` distribution) and the intended total-cost/insert actions; **zero writes**. Reads are allowed. If the DB read fails (offline), falls back to `--ensure-total` as the preview total with a warning. |
| `--help` / `-h` | — | Print usage and exit 0. Unknown flag or bad value prints usage and exits 2. |

Exit codes: `0` success/dry-run, `1` operational abort (missing key, hosted gate, `23505`, missing operator, insert failure), `2` usage error.

---

## Determinism guarantee

`buildSeedCohort({ seed, size, totalCost, now, recordedBy })` is pure:

- `seed` + `size` + `totalCost` determine `name`, `email`, `phone`, `payments`. Internals: `FNV-1a(seed) → mulberry32` with fixed draw order (first name, last name, then payment splits); payments in integer cents.
- `now` (ISO string) affects **only** `generalConsentAcceptedAt`. The runner injects `new Date().toISOString()`; Vitest injects a pinned timestamp. Two builds with the same `seed`/`size`/`totalCost`/`now`/`recordedBy` are deep-equal regardless of runtime.
- No `Math.random`, no `Date.now` inside the pure module; all randomness is scoped to the seeded PRNG.
- `summarizeBuckets` is the single distribution implementation shared by tests, dry-run, and readback.

Verification: `src/lib/retreat/__tests__/seed-cohort.test.ts` — 23 tests covering determinism, bucket coverage, identity invariants (email `/^qa-[0-9a-f]{6}-\d{3}@seed\.retiro\.test$/`, phone `/^\d{12}$/`, uniqueness within/across seeds), payment invariants (`pagos_parciales` `0 < sum < total`, `inscrito` `sum == total`, cents edge cases), consent stamps (`pdtp-v1.0-2026-07-17`, `RETREAT_EVENT_KEY`), and validation.

---

## `--clean` semantics

```bash
node scripts/retreat/seed-cohort.ts --clean
```

1. `SELECT id FROM retreat_registrations WHERE event_key = 'retiro-juvenil-octubre-2026' AND email ILIKE '%@seed.retiro.test'`.
2. `DELETE FROM retreat_payments WHERE registration_id IN (ids)` — **first**, because the FK has no cascade.
3. `DELETE FROM retreat_registrations WHERE id IN (ids)`.

Output: `removed N payment(s) and M registration(s).` If no marker rows exist, prints a no-op message. Re-seeding after a clean is an explicit second run (`--clean` never seeds). Real rows never match the marker filter and are untouched; a mid-payment failure leaves a valid `preinscrito` row (deleting all payments of a row is a valid state).

Duplicate-seed re-run without a preceding `--clean` fails on the batch registration insert with `23505` (unique index on `(event_key, lower(btrim(email)))` / phone); the runner prints: `A cohort with this seed already exists. Run with --clean to remove prior seed rows, or change --seed.`

---

## Local vs hosted targeting

| Aspect | Local (default) | Hosted |
|---|---|---|
| URL | `http://127.0.0.1:54321` (`SUPABASE_URL` or `--url`) | Any non-local hostname (e.g. `xyz.supabase.co`) |
| Key | `supabase status` → copy the `service_role` key; `SUPABASE_SERVICE_ROLE_KEY` or `--service-key` | Verified hosted service_role key from the Vercel/hosted project (never the local `.env` default) |
| Config source | Local `.env.local` typically holds the local anon/service keys | Hosted env vars / Vault |
| Mistake guard | The runner's missing-key error explicitly warns that the local `.env` key may belong to hosted and must not be used against local | Hosted gate below |

The runner **never** reads `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`; an env file cannot silently redirect the default local target to hosted (AD-10). No keys are hardcoded.

---

## Hosted `total_cost` product-owner confirmation policy

`retreat.youth.total_cost` (`app_settings` key) is the paid-in-full threshold that the triggers `retreat_payments_guard_total()` and `retreat_payments_apply_status()` enforce. Setting it on a hosted database is a **product/ops decision**, never a script default (spec R4 — hosted targeting explicit).

- **Local**: the runner may `upsert` the key to `--ensure-total` (default `400000`) freely. If already positive and `--overwrite-total` is absent, the existing value is kept (idempotent).
- **Hosted** (URL hostname not `127.0.0.1`/`localhost`/`::1`): if the stored value is missing/empty **or** `--overwrite-total` is set, the runner **aborts before any write** unless `--confirm-hosted-total` is also present. The abort message prints the target URL, the current stored value, and the requested `--ensure-total`, and explains that the flag is the product-owner confirmation.
- The actual hosted seed run is conditional ops action **T-604**: run only after the product owner confirms the real price (set in the UI or via the script with the two flags together), and use `--clean` to remove the cohort afterwards. The script never seeds hosted by default.

```bash
# Hosted — explicit credentials + explicit total confirmation (T-604, conditional)
node scripts/retreat/seed-cohort.ts \
  --url https://<project>.supabase.co \
  --service-key <hosted-service-role-key> \
  --ensure-total 400000 --confirm-hosted-total --seed hosted-qa-1

# Remove afterwards
node scripts/retreat/seed-cohort.ts \
  --url https://<project>.supabase.co \
  --service-key <hosted-service-role-key> \
  --clean
```

---

## Manual verification matrix (design §7.8 — runnable checklist)

Run against a **local** Supabase with Docker up (`supabase status` shows API/DB/Studio). If Docker is down (RK-2), record the blocker — the matrix stays re-runnable.

- [ ] **`--help`**: `node scripts/retreat/seed-cohort.ts --help` → prints usage including the `npx tsx` fallback, exits 0.
- [ ] **Usage error → exit 2**: `node scripts/retreat/seed-cohort.ts --unknown` and `node scripts/retreat/seed-cohort.ts --size 0` → each prints `Usage error:` + usage and exits 2.
- [ ] **Missing key → actionable error**: run without `SUPABASE_SERVICE_ROLE_KEY` and without `--service-key` → error points to `supabase status`, warns about hosted key in local env, mentions both flag and env, exits 1. (Restore the env before continuing.)
- [ ] **`--dry-run` leaves counts unchanged**: record `SELECT count(*) FROM retreat_registrations` and `retreat_payments` before and after `node scripts/retreat/seed-cohort.ts --dry-run --seed dry-1 --size 12`; counts are identical; output shows the full plan (per-plan bucket/name/email/phone/amounts + distribution) and the intended actions; exits 0. Offline fallback: disconnect DB → dry-run falls back to `--ensure-total` with a warning and still exits 0.
- [ ] **Real seed run — trigger-derived statuses and `recorded_by`**: on a fresh marker-free DB, `node scripts/retreat/seed-cohort.ts --seed 1 --size 12` → readback prints `status distribution (marker domain)` covering `preinscrito`/`pagos_parciales`/`inscrito` (default 12 → `4/4/4` via `summarizeBuckets`); `SELECT status` values match the trigger logic (no status was written by the script); `SELECT recorded_by FROM retreat_payments JOIN retreat_registrations ON ... WHERE email ILIKE '%@seed.retiro.test'` shows every payment has the resolved operator id (explicit `--recorded-by` or the `super_admin` fallback).
- [ ] **Same-seed re-run → `23505` actionable message**: immediately re-run the same `--seed 1 --size 12` without `--clean` → batch insert fails with `23505` and the message `A cohort with this seed already exists. Run with --clean ... or change --seed.`; exit 1; no additional rows written.
- [ ] **`--clean` removes only marker rows**: run `node scripts/retreat/seed-cohort.ts --clean` → output `removed N payment(s) and M registration(s)`; verify `SELECT ... WHERE email ILIKE '%@seed.retiro.test'` is now 0 while a manually-inserted real row (e.g. `qa-real@example.com`) remains; re-run `node scripts/retreat/seed-cohort.ts --seed 1 --size 12` now succeeds again.
- [ ] **`--ensure-total` idempotence**: note `SELECT value FROM app_settings WHERE key='retreat.youth.total_cost'`; run `node scripts/retreat/seed-cohort.ts --clean` then `node scripts/retreat/seed-cohort.ts --seed idem-1 --size 5` (total is now `400000`); run again without `--overwrite-total` under the same DB state (`--seed idem-2 --size 5`) → second run logs `existing ... idempotent`; `SELECT value` is unchanged. A third run with `--overwrite-total --ensure-total 500000` → overwrites to `500000` and logs the overwrite.

All steps are re-runnable; the matrix doubles as the PR #3b acceptance evidence (T-313). Hosted steps are intentionally not part of this local matrix — they require `--confirm-hosted-total` and product-owner confirmation (T-604).
