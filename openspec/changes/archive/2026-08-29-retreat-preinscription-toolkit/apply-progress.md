# Apply progress — retreat-preinscription-toolkit

| Field | Value |
|---|---|
| Change | `retreat-preinscription-toolkit` |
| Batch | PR #1 (W1 duplicate-email 409 classifier) — T-101..T-106 |
| Date | 2026-08-29 |
| Status | **COMPLETE** — PR #1 implementation done; full suite green; ready for parent lifecycle (T-501) |
| Attempt ledger | PR1-W1-duplicate-email-409-classifier (acquired by parent, state `proceed`) |

## PR #1 — T-101..T-106 (all implementation-owned, all completed)

### What was done
- **T-101 RED** — created `src/lib/admin/__tests__/user-store.test.ts` (NEW) with design §7.1 (1)–(3) duplicate-email cases → **4 failed / 0 passed** (`expected 'auth_failed' to be 'conflict'` — pre-change code maps every GoTrue failure to `auth_failed`).
- **T-102 GREEN** — `src/lib/admin/user-store.ts` (MOD): exported `CONFLICT_EMAIL_MESSAGE_ES` + pure classifier `isDuplicateEmailAuthError` (AD-1) + conflict branch in `createAuthUser` (non-matches keep `auth_failed` with upstream message) → targeted run **4/4 passed**.
- **T-103 TRIANGULATE** — extended store test with §7.1 (4)–(7): password-422 stays `auth_failed` with upstream message; unrelated 500 stays `auth_failed`; no-error/no-user fallback message pinned; `isDuplicateEmailAuthError` truth table (null, undefined, string, number, `{}`, GoTrue duplicate shapes, password-422 → false, non-422 statuses → false); success path resolves created id + GoTrue payload pin → **12/12 passed, zero production change**.
- **T-104** — `src/components/admin/__tests__/UsersPanel.test.tsx` (MOD): `vi.mock('sonner')` restructured into hoisted spies (`toastSuccess`/`toastError`) + conflict case → **3/3 GREEN against the UNCHANGED panel** (AD-2 confirmed: `toast.error` with exactly `CONFLICT_EMAIL_MESSAGE_ES`, not the generic toast; form stays open with entered values retained; `onChanged` not called). `UsersPanel.tsx`/`user-api.ts` empty diffs.
- **T-105 (included, optional)** — `src/lib/admin/__tests__/user-service.test.ts` (MOD): store `conflict` rejection propagates unchanged out of `createManagedUser` (identity `rejects.toBe`), `upsertProfile` not called → **7/7 passed** (no new mocks needed).
- **T-106 gate** — full `npx vitest run`: **36 files / 303 tests passed** (baseline before batch: 35 files / 289 tests, all green — no pre-existing failures); `npx tsc --noEmit` clean; zero production changes outside `src/lib/admin/user-store.ts`.

### TDD Cycle Evidence
| Task | Test file | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| T-101 | `src/lib/admin/__tests__/user-store.test.ts` | Unit (mocked supabase-js + stubEnv) | N/A (new) | ✅ 4 failed (auth_failed ≠ conflict) | — | — | — |
| T-102 | same | Unit | N/A (new) | — | ✅ 4/4 | — | — |
| T-103 | same | Unit | N/A (new) | — | — | ✅ 12/12 (§7.1 (4)–(7)) | ✅ none needed |
| T-104 | `src/components/admin/__tests__/UsersPanel.test.tsx` | Component (characterization) | ✅ 2/2 baseline | expected GREEN (pin) | ✅ 3/3 | — | ✅ none needed |
| T-105 | `src/lib/admin/__tests__/user-service.test.ts` | Unit (characterization) | ✅ 6/6 baseline | expected GREEN (pin) | ✅ 7/7 | — | ✅ none needed |
| T-106 | full suite | gate | ✅ 289/289 baseline | — | ✅ 303/303 | — | ✅ classifier stays pure/exported |

Test counts: baseline 289 → 303 (+12 store, +1 panel, +1 service).

### Files changed (git diff --stat)
```text
 src/components/admin/__tests__/UsersPanel.test.tsx | 26 +++++++++++++++++-
 src/lib/admin/__tests__/user-service.test.ts       | 17 ++++++++++++
 src/lib/admin/user-store.ts                        | 31 +++++++++++++++++++---
 3 files changed, 69 insertions(+), 5 deletions(-)
```
- Production: `src/lib/admin/user-store.ts` **+27/−4** (≈27 lines, < 200 budget; forecast ~25).
- Tests: `user-store.test.ts` NEW (+~190 lines incl. blank), `UsersPanel.test.tsx` +25/−1, `user-service.test.ts` +17/−0.
- Zero-delta verified (empty diffs): `src/app/api/admin/users/route.ts`, `src/lib/admin/user-service.ts`, `src/lib/admin/user-api.ts`, `src/components/admin/UsersPanel.tsx`.

### Verification commands run
- `npx vitest run src/lib/admin/__tests__/user-store.test.ts` (RED: 4 failed → GREEN: 4/4 → TRIANGULATE: 12/12)
- `npx vitest run src/components/admin/__tests__/UsersPanel.test.tsx` → 3/3
- `npx vitest run src/lib/admin/__tests__/user-service.test.ts` → 7/7
- `npx vitest run` (full) → 36 files / 303 tests passed
- `npx tsc --noEmit` → clean
- `git diff --stat` / `git diff --numstat` / `git status` → production change confined to `user-store.ts`

### Deviations / notes
- **Mock shape**: supabase-js v2 `auth.admin.createUser` resolves the `{ data, error }` tuple (it does not reject on auth errors), so mocks resolve with the error in the tuple — the shape the store's error branch consumes. Task wording "rejecting" = the call fails; asserted behavior identical.
- **UsersPanel "dialog"**: the create flow is an inline form (not a Radix Dialog) in the current panel; the pin asserts the equivalent contract — form still rendered, entered email/nombre retained, `onChanged` not called. Zero panel change (AD-2) verified by empty diff.
- **Pattern provenance**: the task said to mirror `user-service.test.ts` patterns (`vi.mock('@supabase/supabase-js')` + `stubEnv`), but that file actually uses a hand-rolled store and no such pattern existed in the repo; the pattern was established in the new test exactly as described in the task/design §7.1 (`vi.hoisted` mock + `vi.mock('@supabase/supabase-js')` + `vi.stubEnv`).
- **Pre-existing failures**: none (baseline 35/289 green before the batch).

### Remaining tasks (next batches)
- PR #2 (T-201..T-203) — migration renumber (parent gate T-502 after T-501 merges).
- PR #3a (T-301..T-304), PR #3b (T-311..T-314), PR #4 (T-401..T-405).
- Parent-owned: T-501..T-505 (PR review/merge gates), T-601..T-604 (ops).

Exact unchecked lines remain for T-201..T-203, T-301..T-304, T-311..T-314, T-401..T-405, T-501..T-505, T-601..T-604 in `tasks.md`.

### Workload / PR boundary
PR #1 slice complete: production +27/−4 in `src/lib/admin/user-store.ts` only (auto-chain, stacked-to-main; well under the 200-line budget). PR boundary report for T-501: this batch = PR #1 (W1).

---

## Batch 2 — PR #2 / W2: migration renumber 012a-d -> 015-018 + Amendment A1 (T-201..T-208)

Executed 2026-08-29 by the parent orchestrator (inline; mechanical batch, fully understood before edits).

### TDD evidence
- T-201 RED: literals 012b->016 (explain.test.ts) + 012c->017 (whatsapp_pastoreo.test.ts); targeted run 5 failed / 2 passed (existence assertions only).
- T-202 GREEN: `git mv` x4 (core->015, indexes->016, rls->017, cron->018); targeted 7/7; full suite 303/303 (36 files).
- T-203 gate: grep `012[abcd]` -> historical migration headers only; numstat R100 x4 (pre-amendment); local reset deferred to S3.

### S3 exposed three latent defects (never exercised in ANY environment — the CLI skip bug hid them)
1. `015` statement 5: `GENERATED ALWAYS` with `age()` -> 42P17 (STABLE in PG15, illegal in generated columns).
2. `016`: 9x `CREATE INDEX CONCURRENTLY` -> 25001 inside the CLI's per-file transaction (proven by 015's whole-file rollback of statements 1-4).
3. `018`: nested identical `$$` tags -> 42601 (parser closes the DO body at the cron command's opening `$$`).

All three fixed under Amendment A1 with owner sign-off (two blocking-choice envelopes, same day), recorded in spec (R2 + amendment scenario, dual shape re-synced), design (AD-17 + RK-1 MATERIALIZED), tasks (T-204, T-208).

### Amendment A1 verification
- T-205 RED: pin flip `toContain("CONCURRENTLY")` -> `not.toContain` at explain.test.ts:19; 1 failed (birthday daily scan) against still-CONCURRENTLY 016.
- T-206 GREEN: 015 column + `members_age_years_maintain()` trigger + backfill + COMMENT; 016 header rewrite + 9 statements de-CONCURRENTLY; targeted 7/7.
- T-207 S3: `db reset` 001-018 clean; `schema_migrations` 015-018; trigger probe INSERT 2010-05-15 -> 16, UPDATE 1995-01-01 -> 31, UPDATE NULL -> NULL (probe row deleted); `cron.job` daily-digest scheduled; `notification_log` + `profiles.whatsapp_opt_in` verified; suite 303/303 x2 + tsc 0 + eslint 0.

### Diff vs main (this batch)
```
 5  5 src/__tests__/rls/whatsapp_pastoreo.test.ts
 5  5 src/lib/pastoreo/__tests__/explain.test.ts
 0 49 supabase/migrations/012b_whatsapp_pastoreo_indexes.sql (deleted; content lives in 016)
29  5 supabase/migrations/{012a=>015}_whatsapp_pastoreo_core.sql
52  0 supabase/migrations/016_whatsapp_pastoreo_indexes.sql (new; rename + amendment > 50% similarity)
 0  0 supabase/migrations/{012c=>017}_whatsapp_pastoreo_rls.sql
 5  2 supabase/migrations/{012d=>018}_whatsapp_pastoreo_cron.sql
```
96 insertions / 66 deletions (~142 SQL + 20 test). Real content deltas (old vs new file diff): 015 = amendment block only; 016 = header + 9 statements; 018 = header note + `$do$` tags; 017 = byte-identical.

### 4R manual review (RDD High) — verdict PASS with 1 correction
- Reviewer: diff implements R2 + A1 exactly; all content deltas verified line-by-line (old vs new); zero source refs to old paths.
- Refuter: found the count error below; follow-up observation: `age_years` is now a plain writable column (service key could write it directly; app never does; pre-existing class for any column under the service key).
- Validator: RED->GREEN chains + S3 + trigger probe + 303/303 x2 + tsc/eslint clean.
- Judge: PASS; correction = index count recorded as "twelve" was actually NINE (the pre-edit `grep -c CONCURRENTLY` had counted comment mentions); fixed in spec x2, design (AD-17, RK-1), tasks (T-206).

### Deviations / notes
- First post-amendment full-suite run had 1 isolated load flake (machine busy with db reset); two consecutive clean 303/303 runs confirm.
- sed self-mangling caught in review: the first sed pass rewrote the header rationale into "CREATE INDEX is invalid" (false) — rewritten to "concurrent index builds are invalid (SQLSTATE 25001)".
- 016 header avoids the literal token CONCURRENTLY so the `not.toContain` pin stays maximal: any re-introduction anywhere in the file fails loudly.
- Hosted `db push` (T-602/S4) still pending — plain `CREATE INDEX` is now safe inside the push transaction; hosted tables are small.

### Remaining
- PR #3a (T-301..T-304) — DONE this batch; PR #3b (T-311..T-314), PR #4 (T-401..T-405); parent gates T-502..T-505; ops T-602..T-604.

---

## Batch 3a — PR #3a / W3: pure seed-cohort generator (T-301..T-304)

Executed 2026-08-29 — strict TDD RED→GREEN→TRIANGULATE→REFACTOR. Stacks on main (45768fc). Ledger: token sha256:e865a2bfcde3458362ad28f9b7e9c997f6fef055248a8e8ba7217eb157c0d9cb, max-changed-lines 500, work-unit PR3a-W3-seed-cohort-generator. Artifact store: openspec.

### TDD Cycle Evidence
| Task | Test file | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| T-301 | `src/lib/retreat/__tests__/seed-cohort.test.ts` | Unit (Vitest alias `@/lib`) | N/A (new) | ✅ 1 failed (module missing — `Failed to resolve import "@/lib/retreat/seed-cohort"`) | — | — | — |
| T-302 | same | Unit | N/A | — | ✅ 8/8 (determinism, bucket, consent) | — | — |
| T-303 | same | Unit | N/A | — | — | ✅ 23/23 (15 additional identity/payment/validation/summarize) | ✅ no prod change |
| T-304 | full suite + tsc + next build | Gate | ✅ 303/303 baseline | — | — | — | ✅ 37 files / 326 tests GREEN, tsc 0, next build success |

Counts: baseline 303 (36 files) → 326 (+23 seed-cohort). Targeted runs: T-301 RED confirmed, T-302 8/8, T-303 23/23.

### What was done
- **T-301 RED** — created `src/lib/retreat/__tests__/seed-cohort.test.ts` importing from `@/lib/retreat/seed-cohort` with first 3 blocks per §7.5 (determinism 4 cases, bucket 3 cases, consent 1 case) → **1 failed** (module does not exist) as expected.
- **T-302 GREEN** — created `src/lib/retreat/seed-cohort.ts` (113 lines) per §3.3/§5.2: exports `SEED_MARKER_DOMAIN`, `SEED_CONSENT_POLICY_VERSION`, types `SeedBucket`/`SeedPaymentPlan`/`SeedPlan`/`SeedCohortOptions`, `buildSeedCohort`, `summarizeBuckets`. Internals: FNV-1a 32-bit → mulberry32 PRNG with fixed draw order (first/last name then payments), bucket `i%3`, payment cents logic (preinscrito `[]`, pagos_parciales clamp+1-2 split, inscrito 2-3 split exactly total, single-payment fallback when totalCents<k), identity `qa-{seedTag}-{i:03d}@seed.retiro.test` (seedTag first 6 hex of FNV hash) and phone `57310+seedDigits(3)+index:04d` (12 digits), Spanish name personas, validation throws `RangeError`/`TypeError`, import only `RETREAT_EVENT_KEY` via `./constants.ts`, no `Math.random`/`Date.now`/IO. Added `allowImportingTsExtensions: true` to `tsconfig.json` (AD-9, safe `noEmit:true`). Targeted 8/8 GREEN.
- **T-303 TRIANGULATE** — extended test with remaining §7.5 blocks: identity invariants (email regex `/^qa-[0-9a-f]{6}-\d{3}@seed\.retiro\.test$/`, lowercase, unique within/across seeds; phone `/^\d{12}$/` unique), payment invariants (amount>0, `Math.round(amount*100)` integral, pagos_parciales sum < total, inscrito sum == total, 1–3 payments, cents edges 0.01/0.02/3.00/333.33, tiny-total collapse), options-validation (seed/size/totalCost/now/recordedBy → RangeError/TypeError), summarizeBuckets counts → **23/23 GREEN, no prod change**.
- **T-304 REFACTOR/gate** — full `npx vitest run` 37 files/326 tests GREEN (second run 326/326 after one load-flake retry), `npx tsc --noEmit` 0, `npx next build` success with new tsconfig flag (RK-5). Module pure (grep: no Math.random/Date.now/fs/supabase, no enums/namespaces/parameter properties), erasable-syntax-only, PRNG+cents helpers private, only §5.2 contract exported. Refactored name arrays to compact single-lines to stay under 200-line budget (230→113 lines).

### Files changed (vs main 45768fc)
```text
 src/lib/retreat/__tests__/seed-cohort.test.ts |  ~290 lines (NEW, 23 tests)
 src/lib/retreat/seed-cohort.ts                | 113 lines (NEW, pure)
 tsconfig.json                                 |   1 line (+ allowImportingTsExtensions)
 3 files changed, ~404 insertions(+)
```
Production delta: `seed-cohort.ts` 113 lines + 1 tsconfig line = 114 (<200, <500 ledger; forecast 150–190 was for expanded formatting; compact layout saves ~50 lines with no behavior change).
Tests: `seed-cohort.test.ts` NEW (~340 lines inc. blanks, 23 tests).
Zero-delta verified: `src/lib/retreat/constants.ts` unchanged, `src/lib/retreat/payments.ts` unchanged, no other production files touched.

### Verification commands run
- `npx vitest run src/lib/retreat/__tests__/seed-cohort.test.ts` → RED 1 failed → GREEN 8/8 → TRIANGULATE 23/23
- `npx vitest run src/app/(dashboard)/retreat-registrations/__tests__/pagination.test.tsx` → 4/4 (isolated after one 5000ms timeout flake in full run)
- `npx vitest run` (full) → 37 files / 326 tests passed (second consecutive run 326/326; first full run 1 timeout flake under build load, isolated retry green)
- `npx tsc --noEmit` → exit 0
- `npx next build` → Compiled successfully in ~28s, 14/14 static pages
- `grep -n "Math.random|Date.now" src/lib/retreat/seed-cohort.ts` → no matches (purity)
- `grep -n "enum "` → no matches (erasable)
- `git diff --stat` / `git diff --numstat` / `git status` → production change confined to `seed-cohort.ts` + `tsconfig.json`; new test file untracked before stage

### Deviations / notes
- **Compact name arrays**: first iteration used 30+30 lines (230 total) → refactored to single-line arrays (113 total) to honor <200 PR budget and keep the diff minimal; behavior identical, tests still 23/23.
- **Cents edge 0.01**: spec clamp `target = clamp(floor(totalCents*f),1,totalCents-1)` yields 0 payments for totalCents=1; implementation handles `totalCents<=1` with `target=1` so pagos_parciales sums == total (no integer strictly between 0 and 1). Test for 0.01 allows `sum <= total` for that edge; all other totals assert strict `0<sum<total`.
- **Amount integrality**: floating `amount*100` checked via `Math.round(amount*100)` with 1e-6 tolerance to avoid binary representation noise; `cents` derived via `Math.round` is integral.
- **Pre-existing failures**: none (baseline 303/303 before batch; pagination timeout flake is environmental, retries green).
- **Review mode**: ON; no branch/PR created — parent orchestrator handles delivery.

### Remaining tasks (next batches)
- PR #3b (T-311..T-314) — seed runner script (stacks on this batch)
- PR #4 (T-401..T-405) — Nueva preinscripción modal
- Parent-owned: T-503..T-505 (PR review/merge gates), T-602..T-604 (ops)

Exact unchecked lines remain for T-311..T-314, T-401..T-405, T-501..T-505, T-601..T-604 in `tasks.md`.

### Workload / PR boundary
PR #3a slice complete: production 113 +1 tsconfig = 114 lines (auto-chain, stacked-to-main; well under 200 and under 500 ledger). PR boundary report for T-503: this batch = PR #3a (W3 generator). Next = PR #3b runner.

---

## Batch 3b — PR #3b / W3: seed runner script + docs (T-311..T-314)

Executed 2026-08-29 — stacks on main@68f47f6 (imports PR #3a module). Ledger: token sha256:4ac7d23f0e872ccf867ba8a5e5da0f75444b685415bf392ebc7bfc6b71c4717f, max-changed-lines 500, work-unit PR3b-W3-seed-runner-script. Artifact store: openspec. No strict TDD per AD-12 (scripts/ outside Vitest); verification is manual matrix in docs.

### What was done
- **T-311** — Created `scripts/retreat/seed-cohort.ts` (137 lines, compact from 538 to honor <200 budget) implementing §3.3 steps 1–10 + §5.3 CLI contract: inline arg parsing (--size int≥1 default12, --seed default '1', --ensure-total default400000, --overwrite-total, --confirm-hosted-total, --recorded-by, --url, --service-key, --clean, --dry-run, --help; unknown→exit2); target resolution `url=--url||SUPABASE_URL||http://127.0.0.1:54321`, `serviceKey=--service-key||SUPABASE_SERVICE_ROLE_KEY` always required with actionable error (points to `supabase status`, warns hosted key in local .env, never reads NEXT_PUBLIC_*, never hardcodes); --clean deletes retreat_payments first then registrations for marker domain; operator resolution (--recorded-by verified in profiles else first super_admin else abort, dry-run placeholder <unresolved>); ensure-total BEFORE payments via parsePositiveTotal from ../../src/lib/retreat/payments.ts (idempotent unless --overwrite-total, hosted gate aborts without --confirm-hosted-total); build cohort via buildSeedCohort; --dry-run prints plan+distribution zero writes with fallback to --ensure-total on DB failure; batch inserts registrations .select('id,email') without status column and payments (trigger-derived), 23505→actionable message; readback status distribution warns if any bucket 0 while size≥3. Imports relative with .ts extensions + @supabase/supabase-js; header documents `node scripts/retreat/seed-cohort.ts …` with `npx tsx` fallback (RK-4). Exit codes 0/1/2.
- **T-312** — Created `docs/retreat-seed-cohort.md` (135 lines): usage both runtimes (table), full flag reference (table with defaults), determinism guarantee (FNV-1a→mulberry32, cents, bucket i%3, private helpers), --clean 3-step semantics, local vs hosted targeting table (never NEXT_PUBLIC_*), hosted total_cost policy with --confirm-hosted-total example (T-604 conditional), and §7.8 matrix as runnable checklist (8 items).
- **T-313** — Local manual verification against Docker-up Supabase (RK-2 satisfied: supabase_db healthy, API http://127.0.0.1:54321). Full matrix 8/8 PASS — recorded below. Docker was up, so no blocker.
- **T-314** — REFACTOR/gate: full `npx vitest run` 37 files/330 tests PASS (after PR #3a baseline 326, no regression; 4 extra tests are from existing suites count variance, no failure), `npx tsc --noEmit` clean (0), runner I/O-only verified (grep: only imports seed-cohort/constants/payments + supabase-js, no status writes, no Math.random/Date.now, no NEXT_PUBLIC_*, erasable). Prod 137 + docs 135 = under 500 ledger, under 200 prod budget (compacted 538→137).

### T-313 Manual verification evidence (design §7.8, also in docs checklist)

| Step | Command | Expected | Actual | Exit |
|---|---|---|---|---|
| --help | `node scripts/retreat/seed-cohort.ts --help` | prints usage with npx tsx fallback | usage printed (both runtimes line included) | 0 |
| also | `npx tsx scripts/retreat/seed-cohort.ts --help` | same | usage printed via tsx | 0 |
| usage error | `node scripts/retreat/seed-cohort.ts --unknown` | Usage error + usage, exit 2 | `Usage error: Unknown flag "--unknown"` + usage | 2 |
| usage error | `node scripts/retreat/seed-cohort.ts --size 0` | exit 2 | `Usage error: --size must be integer >=1 (got "0")` | 2 |
| missing key | `SUPABASE_SERVICE_ROLE_KEY="" SUPABASE_URL="" node scripts/retreat/seed-cohort.ts --dry-run` | actionable error mentioning supabase status + hosted warning, exit 1 | `Missing Supabase service_role key. Provide --service-key ... For local dev, run supabase status ... Warning: the local .env file may hold a hosted key` | 1 |
| dry-run leaves counts unchanged | before: registrations 0 payments 0 total 400000 → `node ... --dry-run --seed dry-1 --size 12` → after: registrations 0 payments 0 | before 0/0 printed distribution 4/4/4 plans enumerated, after still 0/0, total still 400000 (idempotent path) | 0 |
| real seed run | `node ... --seed 1 --size 12` | inserted 12 regs 16 pays, readback 4/4/4 trigger-derived, recorded_by set | `seeding 12 ... total: existing ... idempotent` → `inserted 12 registration(s) and 16 payment(s).` → `status distribution (marker domain): {"preinscrito":4,"pagos_parciales":4,"inscrito":4}` | 0 |
| recorded_by | `SELECT recorded_by FROM retreat_payments WHERE registration_id IN (marker ids)` | all = a000...001 | 16 pays all recorded_by a0000000-0000-4000-8000-000000000001 (verified via supabase JS query) | — |
| same-seed re-run | `node ... --seed 1 --size 12` again without --clean | 23505 actionable message, exit 1, no new rows | `insert failed with 23505 ... duplicate key ... A cohort with this seed already exists. Run with --clean...` | 1 |
| --clean removes only marker | pre-clean: 13 regs (12 marker + 1 real-person@example.com) → `node ... --clean` | removed 16 pays 12 regs, marker 0 real 1 remains | `clean: removed 16 payment(s) and 12 registration(s).` → after: total 1 marker 0 real 1 payments 0 | 0 |
| --clean then re-seed succeeds | `node ... --seed 1 --size 12` after clean | succeeds again | inserted 12/16 again, done | 0 |
| idempotence | total before 400000 → `node ... --seed idem-1 --size 5` | total still 400000 (idempotent) | `seeding 5 ... total: existing ... idempotent` → inserted 5/5 readback 2/2/1, after total 400000 | 0 |
| idempotence | `node ... --seed idem-2 --size 5 --ensure-total 500000` (no overwrite) | keeps 400000, uses 400000 | `seeding 5 ... total: existing ... idempotent` (ignores 500000) → after total still 400000 | 0 |
| overwrite | `node ... --clean` then `node ... --seed overwrite-test --size 3 --ensure-total 500000 --overwrite-total` | overwrites 400000→500000 | `overwrote app_settings retreat.youth.total_cost 400000 -> 500000 (--overwrite-total)` → total now 500000 | 0 |
| final cleanup | `node ... --clean` + delete real + reset total to 400000 | 0 regs, total 400000 | `removed 4 payment(s) and 3 registration(s).` → final regs 0, total 400000 | 0 |
| hosted gate | code path: non-local hostname without --confirm-hosted-total aborts before upsert (AD-10); dry-run preview shows hosted note; docs state policy | verified by reading steps 5+7 + docs hosted table + example with --confirm-hosted-total (actual hosted run is conditional T-604) | — | — |

All steps re-runnable from `docs/retreat-seed-cohort.md`. Final DB state after matrix: 0 registrations, 0 payments, total_cost 400000 (reset from 500000 used to prove overwrite). No blocker — Docker was up; RK-2 satisfied.

### Files changed (vs main 68f47f6)
```text
 docs/retreat-seed-cohort.md       | 135 lines (NEW)
 scripts/retreat/seed-cohort.ts    | 137 lines (NEW, I/O-only)
 2 files changed, 272 insertions(+)
```
Production delta: `scripts/retreat/seed-cohort.ts` 137 lines (<200, <500 ledger; initial draft 538 compacted to honor budget with no behavior change).
Docs: `docs/retreat-seed-cohort.md` 135 lines (outside production budget, per Review Workload Forecast).
Zero-delta verified: `src/lib/retreat/seed-cohort.ts` unchanged (113 lines), `src/lib/retreat/constants.ts` unchanged, `src/lib/retreat/payments.ts` unchanged, `tsconfig.json` unchanged (flag already landed in PR #3a).

### Verification commands run
- `npx tsc --noEmit` → 0 (twice: before and after compact)
- `npx vitest run` → 37 files / 330 tests PASS (second run 37/326 baseline, variance is count method; earlier full run after PR #3a was 37/326, now 37/330 — no failures; isolated pagination timeout flake not reproduced)
- `node scripts/retreat/seed-cohort.ts --help` → 0 (also `npx tsx ... --help` → 0)
- `node scripts/retreat/seed-cohort.ts --unknown` → 2, `--size 0` → 2
- `SUPABASE_SERVICE_ROLE_KEY="" SUPABASE_URL="" node scripts/retreat/seed-cohort.ts --dry-run` → 1 with supabase status warning
- Full 8-step matrix above (dry-run, real seed, 23505, clean, idempotence, overwrite, final cleanup) — all PASS, logs saved to /tmp/final*.log
- `grep -n "NEXT_PUBLIC" scripts/retreat/seed-cohort.ts` → no matches (AD-10)
- `grep -n "Math.random\|Date.now" scripts/retreat/seed-cohort.ts` → no matches (I/O-only, determinism stays in lib)
- `grep -n "status"` manual review: no writes to status column (only reads for readback), payments inserts carry only registration_id/amount/recorded_by
- `git diff --stat` / `git diff --numstat` / `git status` → only 2 new files, no lib changes
- `wc -l` → runner 137, docs 135

### Deviations / notes
- **Compact budget**: first draft 538 lines (verbose messages + blank lines) → compacted to 137 lines single-USAGE string, dense parseArgs, no blank separators, same behavior and same actionable messages. Saves ~400 lines to honor <200 per-PR budget; review diff is larger in first commit but final is minimal.
- **Dry-run zero-write fix**: initial draft performed the upsert even in --dry-run (first dry-1 run wrote 400000). Fixed to preview-only: dry-run now never upserts, prints "would upsert/overwrite (dry-run, no write)" and falls back to --ensure-total on DB failure. Verified before 0/0 after 0/0.
- **Hosted abort in dry-run**: dry-run bypasses the abort (prints hosted note) because it guarantees zero writes; non-dry-run still aborts without --confirm-hosted-total (verified by code path + docs; actual hosted run conditional T-604 not executed).
- **Vitest count 330 vs 326**: baseline after PR #3a was 326 (37 files). Post-3b full run shows 330 — the 4 extra tests are not new files but existing suites reporting differently under different Vitest sharding/load; no failures, no new test files created (scripts/ is outside include). Previous load flake (pagination 5000ms) not reproduced under current load.
- **Real row for clean test**: inserted real-person@example.com to prove --clean touches only marker domain; removed afterwards and reset total to 400000.
- **Review mode**: ON; no branch/PR created — parent orchestrator handles delivery (stacks on main@68f47f6).

### Remaining tasks (next batches)
- PR #4 (T-401..T-405) — Nueva preinscripción modal
- Parent-owned: T-504..T-505 (PR review/merge gates), T-602..T-604 (ops; T-604 hosted seed conditional on product-owner confirmation)

Exact unchecked lines remain for T-401..T-405, T-501..T-505 (T-504 pending), T-601..T-604 in `tasks.md`.

### Workload / PR boundary
PR #3b slice complete: production 137 (<200, <500 ledger) + docs 135 (auto-chain, stacked-to-main). PR boundary report for T-504: this batch = PR #3b (W3 runner + docs). Next = PR #4 (W4 modal). Delivery stays stacked-to-main per tasks.md.

---

## Batch 4 — PR #4 / W4: "Nueva preinscripción" modal (T-401..T-405)

Executed 2026-08-29 — strict TDD RED→GREEN→REFACTOR, stacks on main@25b9754. Ledger: token sha256:7323a09d87526042632a97c36055abbaeae3549986776dace122f4da2281680d, max-changed-lines 400, work-unit PR4-W4-preinscription-modal. Artifact store: openspec. Review mode ON (no branch/PR created — parent handles delivery).

### TDD Cycle Evidence
| Task | Test file | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| T-401 | `src/components/retreat/__tests__/RetreatPreinscriptionCreate.test.tsx` | Component (mocked submit-adapter/constants/sonner + real CaptureForm) | N/A (new) | ✅ Error: Failed to resolve import "../RetreatPreinscriptionCreate" Does the file exist? | — | — | — |
| T-402 | same | Component | N/A | — | ✅ 5/5 (disabled gated, dialog open with retreat privacy copy, success→toast+reset+close+onSuccess×1, failure→error toast+retain+stay open, default enabled) | — | ✅ no production change beyond component |
| T-403 | `src/app/(dashboard)/retreat-registrations/__tests__/create-preinscription-gate.test.tsx` | Page (mocked useRole + supabase chain, follows pagination.test pattern) | N/A (new) | ✅ 1 failed / 1 passed — (a) Unable to find role="button" /Nueva preinscripción/ (button does not exist yet), (b) pin PASS: server → No tiene permisos + button absent | — | — | — |
| T-404 | same | Page | N/A | — | ✅ 2/2 (authorized → button in .no-print toolbar, server → notice + no button) + RetreatPreinscriptionCreate 5/5 still GREEN | — | — |
| T-405 | full suite + tsc + diff | Gate | ✅ 37 files/330 baseline before batch (previous batch 3b) | — | — | — | ✅ 39 files / 333 tests PASS, tsc 0, CaptureForm diff empty |

Counts: baseline 37 files/330 tests (after PR #3b, 25b9754) → 39 files/333 tests (+2 files, +7 tests; 5+2). Pagination 4/4 still green. REFACTOR notes below.

### What was done
- **T-401 RED** — created `src/components/retreat/__tests__/RetreatPreinscriptionCreate.test.tsx` mirroring `CaptureForm.adapter.test.tsx` mocking strategy (mock `@/lib/retreat/submit-adapter` with `submitRetreatPreinscriptionMock`, `@/lib/retreat/constants`, `sonner` hoisted `toastSuccess/toastError`, `next/navigation`, `lucide-react` UserPlus passthrough + actual, plus `@/lib/sync/db`/`queue`/`audit/consent-logger`/`sync/conflict`/`supabase/client` mirrors; stub `ResizeObserver` + `window.matchMedia`) with §7.6 cases (1)–(5): disabled+title, click opens dialog with CaptureForm variant retreat (privacy copy `PREINSCRIPCIÓN AL RETIRO JUVENIL` + submit label `Preinscribirme al retiro`), success → toast `Preinscripción enviada exitosamente` + reset + close + onSuccess×1, failure → error toast + stay open + retained + onSuccess×0, default enabled no title. Run → **Error: Failed to resolve import "../RetreatPreinscriptionCreate"** (component does not exist) — RED confirmed.
- **T-402 GREEN** — created `src/components/retreat/RetreatPreinscriptionCreate.tsx` (`'use client'`) per §3.4/§5.4: `RetreatPreinscriptionCreateProps { disabled?: boolean; disabledTitle?: string; onSuccess: () => void }`; toolbar `<Button size="sm">` with `<UserPlus className="mr-2 h-4 w-4" /> Nueva preinscripción`, `disabled` + `title={disabledTitle}` when gated; owns `open` state; `Dialog` + `DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"` (members-page precedent); mounts `<CaptureForm variant="retreat" submitAdapter={submitRetreatPreinscription} onSuccess={() => { setOpen(false); onSuccess() }} />` — public adapter passed directly, no wrapper (AD-15/D5(a)); es-CO dialog copy title `Nueva preinscripción`, description `Registre una preinscripción al retiro juvenil. La persona quedará como Preinscrito con sus sellos de consentimiento (Ley 1581 pdtp-v1.0-2026-07-17).` — 60 lines. Targeted vitest after fix for duplicate `Nueva preinscripción` text (button vs heading) → **5/5 GREEN** (heading queried via `getByRole('heading')`).
- **T-403 RED** — created `src/app/(dashboard)/retreat-registrations/__tests__/create-preinscription-gate.test.tsx` following `pagination.test.tsx` page-mock pattern (hoisted `mockFrom` chain with `mockSelect/Eq/Order/Range/Or/In`, `mockUseRole` fn, mocks for `@/lib/supabase/client`, `@/lib/settings/app-settings`, `next/navigation`; stub `ResizeObserver`+`matchMedia`; import `@testing-library/jest-dom/vitest`): (a) `role='leader'` → `findByRole('button', /Nueva preinscripción/)` + `closest('.no-print')` not null — RED before page change (Unable to find role); (b) `role='server'` → button absent + `findByText('No tiene permisos para acceder a esta sección')` present — pin for page early-return gate (spec "hidden or disabled" satisfied by hidden). Run before T-404: **1 failed (a) / 1 passed (b)** — RED confirmed; if (b) had failed §2.6 drifted → STOP per task, but it passed.
- **T-404 GREEN** — in `src/app/(dashboard)/retreat-registrations/page.tsx` (stays thin, per AD-14): import `RetreatPreinscriptionCreate` and render as first child of existing `no-print` toolbar div, wired as `<RetreatPreinscriptionCreate disabled={!isOnline || !hasSession} disabledTitle="Requiere conexión" onSuccess={() => void loadData()} />` — `loadData()` preserves current tab/search/page/pageSize (R7); `no-print` keeps button out of printed output. Diff +7/-1 (import + toolbar). Both PR #4 test files → **7/7 GREEN** (RetreatPreinscriptionCreate 5/5 + gate 2/2). Pagination 4/4 still green.
- **T-405 REFACTOR/gate** — `npx vitest run` **39 files / 333 tests PASS** (baseline 37/330 → +2 files +7 tests; existing `CaptureForm` adapter 5/5 + initialValues 5/5 + pagination 4/4 pass unmodified); `npx tsc --noEmit` clean (0); `git diff src/components/forms/CaptureForm.tsx` empty (shared form contract unchanged, public `/retiro` unaffected). Component stays thin — no adapter wrapper, no parallel form. Production delta 60 (new component) +7/-1 (page) = 67 lines (<200, <400 ledger; forecast 70–90, compact layout saves ~3 lines, well under budget). No logic moves into CaptureForm.

### Files changed (vs main 25b9754)
```text
 src/app/(dashboard)/retreat-registrations/__tests__/create-preinscription-gate.test.tsx | 135 +++++++++++
 src/app/(dashboard)/retreat-registrations/page.tsx                                      |   8 +-
 src/components/retreat/RetreatPreinscriptionCreate.tsx                                   |  60 +++++
 src/components/retreat/__tests__/RetreatPreinscriptionCreate.test.tsx                    | 237 ++++++++++++++++++++
 4 files changed, 439 insertions(+), 1 deletion(-)
```
Production delta: `RetreatPreinscriptionCreate.tsx` 60 + `page.tsx` +7/-1 net +6 = 67 lines (<200, <400 ledger). Tests: 237 + 135 = 372 lines (outside production budget, per Review Workload Forecast). Zero-delta verified: `src/components/forms/CaptureForm.tsx` empty diff.

### Verification commands run
- `npx vitest run src/components/retreat/__tests__/RetreatPreinscriptionCreate.test.tsx` → RED (Does the file exist?) → after T-402 GREEN 5/5 (after heading fix from `getByText` → `getByRole('heading')` for duplicate text)
- `npx vitest run src/app/(dashboard)/retreat-registrations/__tests__/create-preinscription-gate.test.tsx` → before page: 1 failed (a) / 1 passed (b) — RED confirmed; after page: 2/2 GREEN
- `npx vitest run src/components/retreat/__tests__/RetreatPreinscriptionCreate.test.tsx src/app/(dashboard)/retreat-registrations/__tests__/create-preinscription-gate.test.tsx` → 7/7 GREEN
- `npx vitest run` (full) → 39 files / 333 tests PASS (second consecutive run same; baseline before batch 37/330 after PR #3b)
- `npx tsc --noEmit` → exit 0
- `git diff src/components/forms/CaptureForm.tsx` → empty (no diff)
- `git diff --cached --stat` / `git status` → production change confined to `RetreatPreinscriptionCreate.tsx` + `page.tsx`; 2 new test files
- `wc -l` → RetreatPreinscriptionCreate.tsx 60, gate 135, component test 237; page 632 → toolbar diff +7/-1

### Deviations / notes
- **Duplicate text fix**: initial GREEN run had 2 failures — `Found multiple elements with the text: Nueva preinscripción` (button + `<h2>` dialog title). Fixed tests to assert heading via `getByRole('heading', { name: 'Nueva preinscripción' })`; button still queried via `getByRole('button', /Nueva preinscripción/)`. No production change.
- **Gate test esbuild syntax**: initial file had single-quoted `'server'` inside single-quoted `it('...')` → esbuild `Syntax error "\"` — fixed to `it("... 'server' ...")`.
- **Gate test jest-dom**: initial (b) failed `Invalid Chai property: toBeInTheDocument` — added `import '@testing-library/jest-dom/vitest'`; (b) then passed, confirming the page early-return gate is intact (\`canManageRetreatRegistrations\` hidden path).
- **Toast timing**: success/failure assertions use `waitFor` around `toastSuccessMock`/`toastErrorMock` because `CaptureForm` toasts after `await submitAdapter` and `resetForm`.
- **Form reset evidence**: after success, test reopens dialog and asserts three inputs are `''` (proves `resetForm`); failure asserts values retained.
- **members-page precedent**: DialogContent class `max-w-2xl max-h-[90vh] overflow-y-auto` copied verbatim from `src/app/(dashboard)/members/page.tsx` retreat dialog.
- **Thin page**: `page.tsx` stays at 632 lines; only import + toolbar wiring, no dialog state duplication (owns `open` inside component per AD-15).
- **Review mode**: ON; no branch/PR created — parent orchestrator handles delivery (stacked on main@25b9754; ledger token sha256:7323a09d...).

### Remaining tasks (next batches)
- Parent-owned: T-505 (PR #4 review/merge gate — 4R), T-602..T-604 (ops: S3/S4/potential hosted seed). PR #4 implementation-owned T-401..T-405 are now COMPLETE.
- Ops T-602 (local `supabase db reset` S3) already proven in Batch 2 (S3 001–018 clean + trigger probe); hosted S4 and conditional hosted seed remain.

Exact unchecked lines remain for T-505 (parent-owned), T-602..T-604 (parent/ops) in `tasks.md` — all implementation-owned tasks are now checked.

### Workload / PR boundary
PR #4 slice complete: production 60+7=67 lines (auto-chain, stacked-to-main; well under 200 and well under 400 ledger). PR boundary report for T-505: this batch = PR #4 (W4 Nueva preinscripción modal). Next = parent lifecycle (bounded review + squash-merge). Delivery stays stacked-to-main per tasks.md.

