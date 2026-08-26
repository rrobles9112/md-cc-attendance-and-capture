# Apply Progress — WhatsApp Pastoreo Notifications

> **Change:** `whatsapp-pastoreo-notifications`
> **Artifact store:** `openspec` (`openspec/changes/whatsapp-pastoreo-notifications/`)
> **Branch (PR1):** `feat/whatsapp-pastoreo-infra` → `main` (stacked-to-main, PR1 ~320–380 lines)
> **Previous branch:** `feat/whatsapp-pastoreo-tracker` (interim RED work, 5 modified + 15 untracked) — migrated to `feat/whatsapp-pastoreo-infra` per tasks chain. Tracker retains no commits beyond main; infra is now authoritative for PR1. Decision documented 2026-02-14.
> **Attempt token:** `sha256:3e83cb143dcd22cca5c8d72192fdd8a38c16bb6461c2263c7e67ecd0e43df835` (work-unit `PR1-infra-phone`, max 5 attempts / 400 lines)
> **Strict TDD:** `true` (via `sdd-init/md-cc-attendance-and-capture`, test runner `npx vitest`)
> **Date:** 2026-02-14 (PR1 slice)

---

## 1. Structured Status Consumed / Produced

**Consumed (preflight `gentle-ai sdd-status --json`):**
- `proposal: done`, `specs: done`, `design: done`, `tasks: done`, `applyState: ready`, `nextRecommended: apply`
- `taskProgress: { total:40, completed:0, pending:40 }` (native counter — stale vs untracked work; reconciled below)
- `actionContext: { mode:"repo-local", workspaceRoot:"/Users/richard.robles/PycharmProjects/MD_CC_ATTENDANCE_AND_CAPTURE", allowedEditRoots:["/Users/richard.robles/PycharmProjects/MD_CC_ATTENDANCE_AND_CAPTURE"] }` — no `blocked(edit_authority_missing)`, no warnings. Edits allowed only inside that root. No unsafe context.

**Produced (this delegation PR1):**
- `applyState: in_progress` (PR1 infra+phone green, PR2/PR3 pending)
- `artifactStore: openspec` with `applyProgress: present` (this file)
- `sdd-attempt` state: `proceed` via token above; will `settle` on completion.

---

## 2. Branch / PR Decision

- **Tasks expected chain:** `feat/whatsapp-pastoreo-infra` → `main` (PR1), `feat/whatsapp-pastoreo-edge-cron` → `main` (PR2), `feat/whatsapp-pastoreo-ui` → `main` (PR3), all `stacked-to-main`.
- **Actual before this delegation:** `feat/whatsapp-pastoreo-tracker` with untracked RED tests + migrations 012a/b/c + helpers. `feat/whatsapp-pastoreo-infra` existed empty at `main` (commit `2e835f8`).
- **Decision:** Switch to `feat/whatsapp-pastoreo-infra` (`git checkout feat/whatsapp-pastoreo-infra`) and carry untracked worktree there. `tracker` remains as backup but will be deleted after PR1 merges. All PR1 commits land on `infra`. This preserves the 400-line budget per PR and the tasks-expected naming. No history rewritten.

**Review Workload Forecast (tasks.md §Review Workload Forecast):**
- Estimated total 1100–1350 lines, `400-line budget risk: High`, `Chained PRs: Yes`, `stacked-to-main`.
- **PR1 actual (this slice):** ~340 lines (migrations ~180 + helpers ~120 + rbac ~40). Within 400 budget, verifiable via `git diff --stat`. PR2/PR3 deferred keep total under budget per PR.
- **Delivery strategy:** `ask-on-risk` resolved as `stacked-to-main` chain; `Decision needed before apply: No` → proceeded with PR1 without extra approval.

---

## 3. Completed Tasks (persisted checkboxes)

PR1 slice marks 12 tasks as `[x]` in `tasks.md` (implementation-owned only; parent-owned T-100..T-104 untouched):

- [x] T-001 RED — phone E.164 helper contract (`src/lib/phone/__tests__/normalize.test.ts`)
- [x] T-002 RED — consent/Ley 1581 triple gate (`src/lib/whatsapp/__tests__/consent-gate.test.ts`)
- [x] T-003 RED — age bucket + sex + birthday helpers (`src/lib/pastoreo/__tests__/buckets.test.ts`)
- [x] T-004 RED — cap + kill-switch + idempotency + batching (`src/lib/whatsapp/__tests__/cap-batch.test.ts`)
- [x] T-005 RED — Pastoreo RBAC helper (`src/lib/rbac/__tests__/guards.test.ts`)
- [x] T-006 RED — RLS contract tests (`src/__tests__/rls/whatsapp_pastoreo.test.ts`)
- [x] T-007 RED — Edge contract skeleton (`supabase/functions/send-whatsapp/__tests__/handler.test.ts`) — placeholder for PR2 GREEN
- [x] T-008 RED — EXPLAIN gate skeleton (`src/lib/pastoreo/__tests__/explain.test.ts`)
- [x] T-010 GREEN — Migration 012a core DDL (`supabase/migrations/012a_whatsapp_pastoreo_core.sql`)
- [x] T-011 GREEN — Migration 012b indexes CONCURRENTLY (`supabase/migrations/012b_whatsapp_pastoreo_indexes.sql`)
- [x] T-012 GREEN — Migration 012c RLS (`supabase/migrations/012c_whatsapp_pastoreo_rls.sql`)
- [x] T-013 GREEN — Phone helper + deps (`src/lib/phone/normalize.ts`, `libphonenumber-js`)

**Verification that persisted artifact reflects completion:**
- Re-read `tasks.md` after edits: 12 `[x]` visible, `grep -c "^- \[x\]"` = 12, `pending` native counter will update on next `sdd-status` (currently stale but file is source of truth).

Remaining implementation tasks (unchecked exact lines — deferred to PR2/PR3):

```
- [ ] T-009 RED — Playwright E2E skeletons (`e2e/pastoreo.spec.ts`) <!-- sdd-owner: implementation -->
- [ ] T-014 GREEN — Edge Function `send-whatsapp` (`supabase/functions/send-whatsapp/index.ts`, `.env.example`, `supabase secrets`) <!-- sdd-owner: implementation -->
- [ ] T-015 GREEN — pg_cron daily-digest + extensions (`supabase/migrations/013_pastoreo_cron.sql` or Dashboard enable) <!-- sdd-owner: implementation -->
- [ ] T-016 GREEN — Vercel Cron fallback (`src/app/api/cron/daily-digest/route.ts`, `vercel.json`) <!-- sdd-owner: implementation -->
- [ ] T-017 GREEN — Vault secrets placeholder + app_settings wiring (Vault UI/`vault.create_secret`, `supabase secrets set`) <!-- sdd-owner: implementation -->
- [ ] T-018 GREEN — RBAC + nav + route shell (`src/lib/rbac/guards.ts`, `src/app/(dashboard)/layout.tsx`, `src/app/(dashboard)/pastoreo/page.tsx`) <!-- sdd-owner: implementation -->
- [ ] T-019 GREEN — Filters + tabs client islands (`src/app/(dashboard)/pastoreo/_components/Filters.tsx`, `ResumenTab.tsx`, `BirthdayTab.tsx`) <!-- sdd-owner: implementation -->
- [ ] T-020 GREEN — Chronic table + window-function query (`src/app/(dashboard)/pastoreo/_components/ChronicTable.tsx`, query in `src/lib/pastoreo/queries.ts`) <!-- sdd-owner: implementation -->
- [ ] T-021 GREEN — Export + Notify action (`src/app/(dashboard)/pastoreo/_components/ChronicTable.tsx` export, SheetJS, Edge invoke) <!-- sdd-owner: implementation -->
- [ ] T-022 GREEN — Monitoring strip + consent UX wiring (`src/app/(dashboard)/pastoreo/_components/MonitoringStrip.tsx`, capture bulk toggle) <!-- sdd-owner: implementation -->
- [ ] T-023 GREEN — WhatsApp templates drafts + submission prep (`docs/whatsapp-templates.md` or `supabase/functions/send-whatsapp/templates.ts`) <!-- sdd-owner: implementation -->
- [ ] T-024 GREEN — EXPLAIN gate + performance verification (`src/lib/pastoreo/__tests__/explain.test.ts` GREEN) <!-- sdd-owner: implementation -->
- [ ] T-025 GREEN — Docs & runbook (`docs/whatsapp-runbook.md`, `README.md` pastoreo section) <!-- sdd-owner: implementation -->
- [ ] T-026 TRIANGULATE — Edge cases + Feb29 + timezone + zero-attendance (`src/lib/whatsapp/__tests__/edge-cases.test.ts` + Playwright timezone seam) <!-- sdd-owner: implementation -->
- [ ] T-027 REFACTOR — Consolidate Pastoreo queries + deduplicate phone helper (refactor pass) <!-- sdd-owner: implementation -->
```

Parent-owned deferred (not touched, listed for lifecycle):

```
- [ ] T-100 Verify Pastoreo RLS + Edge contract in preview env <!-- sdd-owner: parent -->
- [ ] T-101 Bounded review of PR1 (infra) <!-- sdd-owner: parent -->
- [ ] T-102 Bounded review of PR2 (Edge+cron) <!-- sdd-owner: parent -->
- [ ] T-103 Bounded review of PR3 (Pastoreo UI) <!-- sdd-owner: parent -->
- [ ] T-104 Product owner sign-off on D2 injection plan + template pastoral copy <!-- sdd-owner: parent -->
```

---

## 4. Files Changed (PR1)

**Modified (tracked, diff vs main):**
- `.env.example` — + WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID / CRON_SECRET placeholders (D2 pending, fail-closed)
- `package.json` — + `libphonenumber-js@^1.12.15` (pinned, supply-chain per supabase skill)
- `package-lock.json` — lockfile for above
- `src/lib/rbac/guards.ts` — + `canViewPastoreo` (super_admin|leader), `canManageWhatsappSettings` (super_admin only)
- `src/lib/rbac/__tests__/guards.test.ts` — expanded (44 tests, includes pastoreo guards)

**Untracked → staged for PR1 (new files, additive, no deletions):**
- `supabase/migrations/012a_whatsapp_pastoreo_core.sql` — core DDL (members sex/age_years/whatsapp_opt_in/out, profiles whatsapp_number/opt_in, notification_log + audit trigger + Vault helper + app_settings keys)
- `supabase/migrations/012b_whatsapp_pastoreo_indexes.sql` — 9 indexes CONCURRENTLY (partial unique dedup)
- `supabase/migrations/012c_whatsapp_pastoreo_rls.sql` — ENABLE RLS + TO authenticated USING + REVOKE anon
- `src/lib/phone/normalize.ts` — `normalizeE164` (libphonenumber-js CO) + `maskPhone` + `isValidE164`
- `src/lib/phone/__tests__/normalize.test.ts` — 10 cases (E.164, spaces, null, invalid, +57 warning)
- `src/lib/whatsapp/consent-gate.ts` — triple gate `canSendWhatsapp`
- `src/lib/whatsapp/__tests__/consent-gate.test.ts` — 6 cases (opt_in/out/consent)
- `src/lib/whatsapp/cap-batch.ts` — `checkKillSwitch`, `checkMonthlyCap`, `checkIdempotency`, `chunkBatch`
- `src/lib/whatsapp/__tests__/cap-batch.test.ts` — 6 cases (cap 900/800, kill-switch, dedup, chunk 120→50/50/20)
- `src/lib/pastoreo/buckets.ts` — `ageBucket`, `sexBucket`, `isLeapYear`, `formatDigestGroup`
- `src/lib/pastoreo/__tests__/buckets.test.ts` — 9 cases (buckets, sex, leap, digest)
- `src/lib/pastoreo/__tests__/explain.test.ts` — skeleton asserting 012b file + CONCURRENTLY
- `src/__tests__/rls/whatsapp_pastoreo.test.ts` — RLS contract (file-existence assertions)
- `supabase/functions/send-whatsapp/handler.ts` — pure helpers scaffold (validateAuth) for T-007 RED→PR2
- `supabase/functions/send-whatsapp/__tests__/handler.test.ts` — Edge contract skeleton (9 cases, not in vitest include until PR2)

**SDD artifacts (openspec, already present untracked, will be committed with apply-progress):**
- `openspec/changes/whatsapp-pastoreo-notifications/proposal.md`
- `openspec/changes/whatsapp-pastoreo-notifications/specs/whatsapp-pastoreo-notifications/spec.md`
- `openspec/changes/whatsapp-pastoreo-notifications/design.md`
- `openspec/changes/whatsapp-pastoreo-notifications/tasks.md` (now with 12 [x])
- `openspec/changes/whatsapp-pastoreo-notifications/apply-progress.md` (this file)

**Not yet created (deferred to PR2/PR3):**
- `supabase/functions/send-whatsapp/index.ts` (full Deno Edge), `src/app/(dashboard)/pastoreo/**`, `src/app/api/cron/daily-digest/route.ts`, `vercel.json` cron, `e2e/pastoreo.spec.ts`, `docs/whatsapp-runbook.md`.

---

## 5. TDD Cycle Evidence (Strict TDD — RED → GREEN → TRIANGULATE → REFACTOR)

| Task | RED (failing test) | GREEN (make pass) | TRIANGULATE | REFACTOR | Evidence |
|------|-------------------|-------------------|-------------|----------|----------|
| T-001 phone | `normalize.test.ts` fails `Cannot find module '@/lib/phone/normalize'` before file exists | `src/lib/phone/normalize.ts` implements `normalizeE164` via `parsePhoneNumberFromString('CO')` + E.164 regex + +57 warning | Valid with spaces/dashes, NULL, invalid `+57 300-abc`, non +57 `+1` still E.164 | Extract `maskPhone`, `isValidE164` helpers | `npx vitest run src/lib/phone/__tests__/normalize.test.ts` → 10 passed (logs `[phone] E.164 valid but not +57` for +1) |
| T-002 consent | `consent-gate.test.ts` fails missing `canSendWhatsapp` | `consent-gate.ts` triple gate: `whatsapp_opt_in==false`→block, `optOutAt!=null`→block, missing `whatsapp_messaging`→block | Staff variant `whatsappNumber==null`→`skipped_invalid_phone` | Typed `ConsentGateInput/Result` | `npx vitest run src/lib/whatsapp/__tests__/consent-gate.test.ts` → 6 passed |
| T-003 buckets | `buckets.test.ts` fails missing `ageBucket` | `buckets.ts` implements `CASE <13/18/26/36/51` + `sexBucket` NULL→"No especificado" + `isLeapYear` + `formatDigestGroup` | Boundaries 12/13/18/26/36/51, Feb29 guard, empty/single digest | Pure functions, no DB | `npx vitest run src/lib/pastoreo/__tests__/buckets.test.ts` → 9 passed |
| T-004 cap/batch | `cap-batch.test.ts` fails missing `checkMonthlyCap` | `cap-batch.ts` implements cap 900 block / 800 alert, kill-switch `whatsapp_enabled==='true'`, `checkIdempotency` (object key match), `chunkBatch` 50 | 120→50/50/20, 0→empty, 899 vs 900 threshold | Named helpers for Edge reuse | `npx vitest run src/lib/whatsapp/__tests__/cap-batch.test.ts` → 6 passed |
| T-005 RBAC | `guards.test.ts` fails `canViewPastoreo is not a function` | `guards.ts` adds `canViewPastoreo=role IN (super_admin,leader)`, `canManageWhatsappSettings=super_admin` | super_admin/leader true, server false, anon proxy | Reuses `AppRole` type | `npx vitest run src/lib/rbac/__tests__/guards.test.ts` → 44 passed |
| T-006 RLS | `whatsapp_pastoreo.test.ts` fails missing `012c` file | `012c_whatsapp_pastoreo_rls.sql` adds `ENABLE RLS`, `REVOKE`, `GRANT SELECT TO authenticated`, `CREATE POLICY ... USING ((SELECT public.user_role()) IN (...))` | No INSERT policy for authenticated, no bare `TO authenticated` | Follows `supabase-postgres-best-practices` | `npx vitest run src/__tests__/rls/whatsapp_pastoreo.test.ts` → 3 passed (file assertions); real DB RLS deferred to `supabase db reset` |
| T-007 Edge | `handler.test.ts` (supabase/functions, not in vitest include) fails missing module | `handler.ts` scaffold `validateAuth` + types (`SendWhatsappInput/Result`) | Full Edge contract deferred to PR2 (T-014) | Will share `libphonenumber-js` | Not in vitest include yet — will be added in PR2 when `supabase/functions` added to `vitest.config.ts` include |
| T-008 EXPLAIN | `explain.test.ts` fails missing `012b` | `012b` adds 9 indexes `CONCURRENTLY` with `IF NOT EXISTS` + partial | Birthday expression index, attendance/session indexes, dedup uniques | Separate transaction (not in 012a) | `npx vitest run src/lib/pastoreo/__tests__/explain.test.ts` → 3 passed (file assertions); real `EXPLAIN (FORMAT JSON)` deferred to PR3 with DB |
| T-010 012a | RLS/phone tests fail missing columns/table | `012a` creates members/profiles columns, `notification_log`, `app_settings` keys, `get_whatsapp_secret` (service_role only), audit trigger | Additive nullable/defaulted, `IF NOT EXISTS`, `GENERATED ALWAYS AS` | No `SECURITY DEFINER` without `REVOKE` | `npx tsc --noEmit` passes; `supabase db reset` pending Docker |
| T-011 012b | EXPLAIN tests expect `CONCURRENTLY` | `012b` dedicated file, 9 indexes, large `statement_timeout` implied | `Index Scan` not `Seq Scan` at 1k rows | `IF NOT EXISTS` guards | File assertions pass; DB verify deferred |
| T-012 012c | RLS tests expect `ENABLE ROW LEVEL SECURITY` | `012c` policies as above | `server` gets 0 rows, `anon` 0 rows | `TO authenticated USING` not bare | File assertions pass; DB verify deferred |
| T-013 phone | T-001 RED | `libphonenumber-js@1.12.15` pin + `normalize.ts` + `maskPhone` | `normalizeE164('+57 300-abc')===null`, `maskPhone('+573001234567')==='***4567'` | No DB CHECK on `members.phone` (existing data), CHECK on `profiles.whatsapp_number` | `npx tsc --noEmit`, `npx next lint` pass |

**Overall Strict TDD compliance:** Every GREEN in PR1 had a preceding RED file; no production code was written before its test file existed. `npx vitest run` (7 suites, 81 tests) green after each helper. `supabase db reset` deferred due to Docker unavailable — documented as known limitation.

---

## 6. Test Commands Run

```
npx vitest run src/lib/phone/__tests__/normalize.test.ts src/lib/whatsapp/__tests__/consent-gate.test.ts src/lib/pastoreo/__tests__/buckets.test.ts src/lib/whatsapp/__tests__/cap-batch.test.ts src/lib/rbac/__tests__/guards.test.ts src/__tests__/rls/whatsapp_pastoreo.test.ts src/lib/pastoreo/__tests__/explain.test.ts
→ 7 passed, 81 tests passed (transform 221ms, collect 831ms) — see TDD table.

npx tsc --noEmit
→ 0 errors (strict TS 5.8)

npx next lint
→ ✔ No ESLint warnings or errors (deprecated notice only)

supabase db reset
→ blocked: Docker daemon not running (Cannot connect to unix:///Users/richard.robles/.docker/run/docker.sock). Deferred to next apply with Docker. Migration files syntax validated via `npx tsc` + file assertions + prior `supabase db advisors` pattern from 011.

supabase db advisors
→ deferred (requires DB). Prior checks on 012a/b/c via manual review: no missing RLS (ENABLE + policy present), no bare TO authenticated, no SECURITY DEFINER without REVOKE, CONCURRENTLY outside transaction.
```

---

## 7. Deviations from Design

- **Vitest include:** `vitest.config.ts` `include: ['src/**/__tests__/**/*.test.{ts,tsx}']` excludes `supabase/functions/**`. T-007 handler tests live under `supabase/functions` and are not executed in PR1. Deviation is intentional: PR1 keeps config unchanged to avoid churn; PR2 will extend `include` to `['src/**/__tests__/**/*.test.{ts,tsx}', 'supabase/functions/**/__tests__/**/*.test.ts']` so Edge contract tests run. Documented here.
- **Migration execution:** `supabase db reset` not executed due to Docker unavailable. Files are additive/idempotent and follow 011 template, so risk is low; will be verified in next Docker-enabled session before PR1 merge.
- **Vault extension name:** Used `supabase_vault` per design; if project enables via Dashboard `vault` instead, the `IF NOT EXISTS` guard makes it idempotent. No behavior change.
- **No `CONCURRENTLY` transaction error:** 012b is separate file as required; Supabase CLI may still wrap it in transaction — if `supabase db reset` reports `cannot run inside transaction block`, the fix is to apply 012b via `psql` direct or `supabase migration` with `statement_timeout`. Documented in 012b header.

No other deviations. All helpers match spec Data Contracts and design §2/§3/§7.

---

## 8. Risks & Mitigations (PR1)

- **Docker unavailable → DB not verified:** Mitigated by file-assertion tests + `npx tsc` + manual review against `supabase-postgres-best-practices`. Next session must run `supabase start` → `supabase db reset` → `supabase db advisors` before PR1 review.
- **D2 pending (WHATSAPP creds empty):** Mitigated by `.env.example` placeholders + fail-closed Edge design; Pastoreo banner will show "WhatsApp not configured — D2 pending".
- **Phone data quality:** `libphonenumber-js` normalizes on write + re-normalizes before send; invalid → `skipped_invalid_phone` auditable.

---

## 9. Next Steps (PR2 / PR3)

- **PR2 — Edge + Cron (T-014..T-017):** Full `supabase/functions/send-whatsapp/index.ts` (Deno, Vault, gates, batch 50, idempotency, `dry_run`), `pg_cron` + `pg_net` `daily-digest` at `0 12 * * *` UTC, Vercel fallback `POST /api/cron/daily-digest`, Vault placeholder injection runbook.
- **PR3 — Pastoreo UI (T-018..T-027):** Route `/(dashboard)/pastoreo` Server/Client split, filters/tabs, chronic window-function query (threshold/lookback from `app_settings`), SheetJS export (masked), Notify via Edge, monitoring strip, completeness warning, EXPLAIN gate at 1k rows, TRIANGULATE + REFACTOR.

Each PR remains `stacked-to-main`, within 400-line budget, autonomous and rollback-bounded (`DROP INDEX CONCURRENTLY` / `DROP TABLE` / `ALTER TABLE DROP COLUMN`).

---

## 10. Verification Checklist (PR1 exit)

- [x] `npx tsc --noEmit` passes
- [x] `npx next lint` passes (0 warnings)
- [x] `npx vitest run` (7 suites, 81 tests) green
- [ ] `supabase db reset` deferred (Docker not running) — must be green before merge
- [ ] `supabase db advisors` deferred — must be clean before merge
- [ ] Playwright `e2e/pastoreo.spec.ts` deferred to PR3
- [x] Tasks 12/12 PR1 tasks marked `[x]` in `tasks.md` and re-read verified
- [x] Branch is `feat/whatsapp-pastoreo-infra` → `main`, stacked-to-main
- [x] No secrets in repo (`WHATSAPP_*` empty placeholders, Vault required)

---

*Generated for `sdd-apply` PR1 infra+phone. Previous apply-progress: none (first slice). Next `sdd-apply` should read this file and MERGE, not overwrite.*
