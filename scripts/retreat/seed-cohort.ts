/**
 * Retreat seed-cohort runner — thin I/O script (pure logic in src/lib/retreat/seed-cohort.ts).
 * Usage:
 *   node scripts/retreat/seed-cohort.ts [flags]
 *   npx tsx scripts/retreat/seed-cohort.ts [flags]  # fallback for Node <22.6
 * Flags: --size --seed --ensure-total --overwrite-total --confirm-hosted-total --recorded-by --url --service-key --clean --dry-run --help
 * Exit codes: 0 success/dry-run, 1 operational abort, 2 usage error
 */
import { createClient } from '@supabase/supabase-js'
import { buildSeedCohort, summarizeBuckets, SEED_MARKER_DOMAIN } from '../../src/lib/retreat/seed-cohort.ts'
import { RETREAT_EVENT_KEY } from '../../src/lib/retreat/constants.ts'
import { parsePositiveTotal } from '../../src/lib/retreat/payments.ts'
interface Args { size: number; seed: string; ensureTotal: number; overwriteTotal: boolean; confirmHostedTotal: boolean; recordedBy: string | null; url: string | null; serviceKey: string | null; clean: boolean; dryRun: boolean; help: boolean }
const USAGE = `Usage: node scripts/retreat/seed-cohort.ts [flags]\n       npx tsx scripts/retreat/seed-cohort.ts [flags]\nFlags:\n  --size <int>=12               Cohort size (integer >= 1)\n  --seed <string>='1'           PRNG seed (non-empty)\n  --ensure-total <number>=400000  retreat.youth.total_cost to ensure before seeding\n  --overwrite-total             Overwrite already-positive total_cost\n  --confirm-hosted-total        Confirm writing total_cost to non-local target\n  --recorded-by <uuid>          Operator profile id (default: first super_admin)\n  --url <url>                   Supabase URL (default: SUPABASE_URL or http://127.0.0.1:54321)\n  --service-key <key>           Supabase service_role key (or SUPABASE_SERVICE_ROLE_KEY env)\n  --clean                       Remove prior seed rows and exit\n  --dry-run                     Print plan without writing\n  --help                        Show help and exit\nTarget: url=--url||SUPABASE_URL||http://127.0.0.1:54321  serviceKey=--service-key||SUPABASE_SERVICE_ROLE_KEY (always required)\nExamples:\n  node scripts/retreat/seed-cohort.ts --dry-run\n  node scripts/retreat/seed-cohort.ts --size 12 --seed 1\n  node scripts/retreat/seed-cohort.ts --clean\n  node scripts/retreat/seed-cohort.ts --url https://xyz.supabase.co --service-key <key> --confirm-hosted-total\n`
function printUsage() { console.log(USAGE) }
function usageError(msg: string): never { console.error(`Usage error: ${msg}\n\n${USAGE}`); process.exit(2) }
function parseArgs(argv: string[]): Args {
  const a: Args = { size: 12, seed: '1', ensureTotal: 400000, overwriteTotal: false, confirmHostedTotal: false, recordedBy: null, url: null, serviceKey: null, clean: false, dryRun: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i]
    switch (f) {
      case '--help': case '-h': a.help = true; break
      case '--clean': a.clean = true; break
      case '--dry-run': a.dryRun = true; break
      case '--overwrite-total': a.overwriteTotal = true; break
      case '--confirm-hosted-total': a.confirmHostedTotal = true; break
      case '--size': { const v = argv[++i]; if (v === undefined) usageError('--size requires a value'); const n = Number(v); if (!Number.isInteger(n) || n < 1) usageError(`--size must be integer >=1 (got ${JSON.stringify(v)})`); a.size = n; break }
      case '--seed': { const v = argv[++i]; if (v === undefined) usageError('--seed requires a value'); if (v.length === 0) usageError('--seed must be non-empty'); a.seed = v; break }
      case '--ensure-total': { const v = argv[++i]; if (v === undefined) usageError('--ensure-total requires a value'); const n = Number(v); if (!Number.isFinite(n) || n <= 0) usageError(`--ensure-total must be positive (got ${JSON.stringify(v)})`); a.ensureTotal = n; break }
      case '--recorded-by': { const v = argv[++i]; if (v === undefined) usageError('--recorded-by requires a value'); if (v.trim().length === 0) usageError('--recorded-by must be non-empty UUID'); a.recordedBy = v.trim(); break }
      case '--url': { const v = argv[++i]; if (v === undefined) usageError('--url requires a value'); if (v.trim().length === 0) usageError('--url must be non-empty'); a.url = v.trim(); break }
      case '--service-key': { const v = argv[++i]; if (v === undefined) usageError('--service-key requires a value'); if (v.trim().length === 0) usageError('--service-key must be non-empty'); a.serviceKey = v.trim(); break }
      default: usageError(`Unknown flag ${JSON.stringify(f)}`)
    }
  }
  return a
}
function isLocalUrl(raw: string): boolean { try { const u = new URL(raw); const h = u.hostname.toLowerCase(); return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]' } catch { return false } }
function markerFilter(): string { return `%${SEED_MARKER_DOMAIN}` }
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) { printUsage(); process.exit(0) }
  const url = args.url ?? process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
  const serviceKey = args.serviceKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? null
  if (!serviceKey) { console.error('Missing Supabase service_role key.\nProvide --service-key <key> or set SUPABASE_SERVICE_ROLE_KEY.\nFor local dev, run `supabase status` and copy the service_role key.\nWarning: the local .env file may hold a hosted key — do not use a hosted key against the local target.'); process.exit(1) }
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })
  if (args.clean) {
    console.log(`[seed-cohort] --clean: removing seed rows for event ${RETREAT_EVENT_KEY} (marker ${SEED_MARKER_DOMAIN})`)
    console.log(`[seed-cohort] target: ${url}`)
    const { data: rows, error: selErr } = await supabase.from('retreat_registrations').select('id').eq('event_key', RETREAT_EVENT_KEY).ilike('email', markerFilter())
    if (selErr) { console.error(`[seed-cohort] clean: failed to select seed registrations: ${selErr.message}`); process.exit(1) }
    const ids = (rows ?? []).map((r: { id: string }) => r.id)
    if (ids.length === 0) { console.log('[seed-cohort] clean: no seed registrations found — nothing to remove.'); process.exit(0) }
    const { error: payErr, count: payCount } = await supabase.from('retreat_payments').delete({ count: 'exact' }).in('registration_id', ids)
    if (payErr) { console.error(`[seed-cohort] clean: failed to delete seed payments: ${payErr.message}`); process.exit(1) }
    const { error: regErr, count: regCount } = await supabase.from('retreat_registrations').delete({ count: 'exact' }).in('id', ids)
    if (regErr) { console.error(`[seed-cohort] clean: failed to delete seed registrations: ${regErr.message}`); process.exit(1) }
    console.log(`[seed-cohort] clean: removed ${payCount ?? 0} payment(s) and ${regCount ?? 0} registration(s).`); process.exit(0)
  }
  let operatorId: string | null = null
  let operatorWarning: string | null = null
  if (args.recordedBy) {
    const { data: prof, error: pe } = await supabase.from('profiles').select('id').eq('id', args.recordedBy).maybeSingle()
    if (pe) { console.error(`[seed-cohort] failed to verify --recorded-by profile: ${pe.message}`); process.exit(1) }
    if (!prof) { console.error(`[seed-cohort] --recorded-by profile not found: ${args.recordedBy}. Create the profile or omit --recorded-by to auto-select the first super_admin.`); process.exit(1) }
    operatorId = args.recordedBy
  } else {
    const { data: sa, error: se } = await supabase.from('profiles').select('id').eq('role', 'super_admin').order('created_at', { ascending: true }).limit(1).maybeSingle()
    if (se) { if (args.dryRun) { operatorWarning = `Warning: could not resolve operator (DB read failed: ${se.message}); using <unresolved> placeholder for dry-run.`; operatorId = '<unresolved>'; console.warn(operatorWarning) } else { console.error(`[seed-cohort] failed to resolve super_admin operator: ${se.message}`); process.exit(1) } }
    else if (!sa) { if (args.dryRun) { operatorWarning = 'Warning: no super_admin profile found; using <unresolved> placeholder for dry-run.'; operatorId = '<unresolved>'; console.warn(operatorWarning) } else { console.error('[seed-cohort] no super_admin profile found. Create one (see supabase/seed.sql) or pass --recorded-by <uuid> of an existing profile.'); process.exit(1) } }
    else operatorId = (sa as { id: string }).id
  }
  let effectiveTotal: number
  let totalSource = ''
  try {
    const { data: row, error: te } = await supabase.from('app_settings').select('value').eq('key', 'retreat.youth.total_cost').maybeSingle()
    if (te) throw te
    const raw = (row as { value?: string } | null)?.value ?? null
    const positive = parsePositiveTotal(raw)
    if (positive !== null && !args.overwriteTotal) { effectiveTotal = positive; totalSource = `existing app_settings retreat.youth.total_cost=${positive} (idempotent, use --overwrite-total to change)` }
    else if (args.dryRun) {
      effectiveTotal = args.ensureTotal
      const isLocal = isLocalUrl(url)
      const hostedNote = !isLocal && !args.confirmHostedTotal ? ' — hosted target would require --confirm-hosted-total to actually write' : ''
      if ((operatorId as string) === '<unresolved>') totalSource = `would upsert retreat.youth.total_cost=${effectiveTotal} (dry-run placeholder operator, no write)`
      else if (positive !== null && args.overwriteTotal) totalSource = `would overwrite app_settings retreat.youth.total_cost ${positive} -> ${effectiveTotal} (--overwrite-total, dry-run, no write)${hostedNote}`
      else totalSource = `would upsert app_settings retreat.youth.total_cost=${effectiveTotal} (dry-run, no write)${hostedNote}`
    } else {
      const isLocal = isLocalUrl(url)
      if (!isLocal && !args.confirmHostedTotal) { console.error(`[seed-cohort] abort: target is not local and --confirm-hosted-total was not provided.\nTarget URL: ${url}\nCurrent stored total_cost: ${positive ?? raw ?? '(missing/empty)'}\nRequested --ensure-total: ${args.ensureTotal}\nSetting retreat.youth.total_cost on a hosted environment changes the paid-in-full threshold for real registrations.\nThis requires explicit product-owner confirmation. Re-run with --confirm-hosted-total to proceed.`); process.exit(1) }
      effectiveTotal = args.ensureTotal
      const nowIso = new Date().toISOString()
      const { error: upErr } = await supabase.from('app_settings').upsert({ key: 'retreat.youth.total_cost', value: String(effectiveTotal), updated_by: operatorId, updated_at: nowIso }, { onConflict: 'key' })
      if (upErr) { console.error(`[seed-cohort] failed to upsert retreat.youth.total_cost: ${upErr.message}`); process.exit(1) }
      totalSource = positive !== null ? `overwrote app_settings retreat.youth.total_cost ${positive} -> ${effectiveTotal} (--overwrite-total)` : `upserted app_settings retreat.youth.total_cost=${effectiveTotal}`
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (args.dryRun) { console.warn(`[seed-cohort] warning: could not read app_settings (DB unavailable: ${msg}); using --ensure-total=${args.ensureTotal} as preview total.`); effectiveTotal = args.ensureTotal; totalSource = `fallback --ensure-total=${effectiveTotal} (DB read failed)` }
    else { console.error(`[seed-cohort] failed to ensure retreat.youth.total_cost: ${msg}`); process.exit(1) }
  }
  const nowIso = new Date().toISOString()
  const recordedByForBuild = operatorId as string
  let plans
  try { plans = buildSeedCohort({ seed: args.seed, size: args.size, totalCost: effectiveTotal!, now: nowIso, recordedBy: recordedByForBuild }) } catch (e: unknown) { console.error(`[seed-cohort] buildSeedCohort failed: ${e instanceof Error ? e.message : String(e)}`); process.exit(1) }
  const dist = summarizeBuckets(plans)
  if (args.dryRun) {
    console.log(`\n[seed-cohort] --dry-run preview (no writes)`)
    console.log(`[seed-cohort] target: ${url}`)
    console.log(`[seed-cohort] seed=${JSON.stringify(args.seed)} size=${args.size} totalCost=${effectiveTotal} (${totalSource})`)
    console.log(`[seed-cohort] operator: ${recordedByForBuild}${operatorWarning ? ' — ' + operatorWarning : ''}`)
    console.log(`[seed-cohort] distribution: ${JSON.stringify(dist)}`)
    console.log(`[seed-cohort] plans:`)
    for (const p of plans) { const amts = p.payments.length === 0 ? '(no payments)' : p.payments.map((pp) => pp.amount.toFixed(2)).join(' + '); const sum = p.payments.reduce((s, pp) => s + pp.amount, 0); console.log(`  #${String(p.index).padStart(3, '0')} [${p.bucket}] ${p.name} <${p.email}> ${p.phone}  payments: ${amts}  sum=${sum.toFixed(2)}`) }
    console.log(`\n[seed-cohort] would ensure total: ${totalSource}`)
    console.log(`[seed-cohort] would insert ${plans.length} registration(s) and ${plans.reduce((s, p) => s + p.payments.length, 0)} payment(s).`)
    console.log('[seed-cohort] dry-run complete — zero writes.'); process.exit(0)
  }
  if (recordedByForBuild === '<unresolved>') { console.error('[seed-cohort] operator is <unresolved> — cannot write without a real profile id. Pass --recorded-by or ensure a super_admin exists.'); process.exit(1) }
  console.log(`[seed-cohort] seeding ${plans.length} registration(s) to ${url} (seed=${JSON.stringify(args.seed)}, totalCost=${effectiveTotal})`)
  console.log(`[seed-cohort] total: ${totalSource}`)
  console.log(`[seed-cohort] operator: ${recordedByForBuild}`)
  console.log(`[seed-cohort] distribution (intended): ${JSON.stringify(dist)}`)
  const regRows = plans.map((p) => ({ event_key: p.eventKey, name: p.name, phone: p.phone, email: p.email, birthday: null, is_minor: false, legal_rep_name: null, general_consent_accepted_at: p.generalConsentAcceptedAt, general_consent_policy_version: p.generalConsentPolicyVersion, sensitive_consent_accepted_at: null, sensitive_consent_policy_version: null, denomination: null, community_name: null }))
  const { data: inserted, error: re } = await supabase.from('retreat_registrations').insert(regRows).select('id,email')
  if (re) { const code = (re as { code?: string }).code; const msg = re.message ?? String(re); if (code === '23505' || /23505|duplicate|already exists/i.test(msg)) console.error(`[seed-cohort] insert failed with 23505 (duplicate email/phone): ${msg}\nA cohort with this seed already exists. Run with --clean to remove prior seed rows, or change --seed.`); else console.error(`[seed-cohort] failed to insert registrations: ${msg}${code ? ` (code ${code})` : ''}`); process.exit(1) }
  const emailToId = new Map<string, string>(); for (const r of (inserted as Array<{ id: string; email: string }>) ?? []) emailToId.set(r.email.toLowerCase(), r.id)
  const payRows: Array<{ registration_id: string; amount: number; recorded_by: string }> = []
  for (const p of plans) { const rid = emailToId.get(p.email.toLowerCase()); if (!rid) { console.error(`[seed-cohort] internal error: no inserted id for email ${p.email}`); process.exit(1) } for (const pay of p.payments) payRows.push({ registration_id: rid, amount: pay.amount, recorded_by: recordedByForBuild }) }
  if (payRows.length > 0) { const { error: pe2 } = await supabase.from('retreat_payments').insert(payRows); if (pe2) { console.error(`[seed-cohort] failed to insert payments: ${pe2.message}${(pe2 as { code?: string }).code ? ` (code ${(pe2 as { code?: string }).code})` : ''}`); console.error('[seed-cohort] registrations were inserted but payments failed — run with --clean to remove the partial cohort and retry.'); process.exit(1) } }
  console.log(`[seed-cohort] inserted ${inserted?.length ?? 0} registration(s) and ${payRows.length} payment(s).`)
  const { data: rb, error: rbe } = await supabase.from('retreat_registrations').select('status').eq('event_key', RETREAT_EVENT_KEY).ilike('email', markerFilter())
  if (rbe) console.warn(`[seed-cohort] warning: readback failed: ${rbe.message}`)
  else { const counts: Record<string, number> = {}; for (const r of (rb as Array<{ status: string }>) ?? []) counts[r.status] = (counts[r.status] ?? 0) + 1; console.log(`[seed-cohort] status distribution (marker domain): ${JSON.stringify(counts)}`); if (args.size >= 3) { const missing = (['preinscrito', 'pagos_parciales', 'inscrito'] as const).filter((b) => !(b in counts)); if (missing.length > 0) console.warn(`[seed-cohort] warning: expected all 3 buckets for size >=3, but missing: ${missing.join(', ')}`) } }
  console.log('[seed-cohort] done.')
}
main().catch((e: unknown) => { console.error(`[seed-cohort] unexpected error: ${e instanceof Error ? e.message : String(e)}`); process.exit(1) })
