import { createClient } from '@/lib/supabase/client'
import { db, type Member, type Session, type Attendance, type SocialMedia, type WhatsAppNumber } from './db'

export type HydrateTableName =
  | 'members'
  | 'sessions'
  | 'attendance'
  | 'social_media'
  | 'whatsapp_numbers'

export interface HydrateResult {
  ok: boolean
  skipped: boolean
  counts: Partial<Record<HydrateTableName, number>>
  error?: string
}

export type HydrationPhase = 'idle' | 'syncing' | 'done' | 'failed'

type HydrateListener = (result: HydrateResult) => void

const HYDRATE_COOLDOWN_MS = 15_000

let hydrationPhase: HydrationPhase = 'idle'
let lastHydratedAt: number | null = null
let inFlight: Promise<HydrateResult> | null = null
const listeners = new Set<HydrateListener>()

export function getHydrationPhase(): HydrationPhase {
  return hydrationPhase
}

export function getLastHydratedAt(): number | null {
  return lastHydratedAt
}

/** True once this browser tab has completed at least one successful remote pull. */
export function hasHydratedThisSession(): boolean {
  return lastHydratedAt !== null
}

export function onCacheHydrated(listener: HydrateListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notifyListeners(result: HydrateResult): void {
  for (const listener of listeners) {
    try {
      listener(result)
    } catch {
      // Listener errors must not break hydration.
    }
  }
}

async function pendingRecordIds(tableName: HydrateTableName): Promise<Set<string>> {
  const items = await db.sync_queue
    .where('table_name')
    .equals(tableName)
    .filter((item) => item.status === 'pending' || item.status === 'failed' || item.status === 'syncing')
    .toArray()
  return new Set(items.map((item) => item.record_id))
}

async function reconcileSoftDeletable<T extends { id: string; deleted_at: string | null }>(
  tableName: 'members' | 'sessions',
  remoteRows: T[],
  bulkPut: (rows: T[]) => Promise<unknown>,
  bulkDelete: (ids: string[]) => Promise<unknown>,
  listLocal: () => Promise<T[]>
): Promise<void> {
  const pendingIds = await pendingRecordIds(tableName)
  // Preserve local rows that still have outbound queue work (e.g. soft-delete
  // pending push). Overwriting them from remote would resurrect deleted_at=null
  // before flushQueue runs and undo the local delete.
  const rowsToPut = remoteRows.filter((row) => !pendingIds.has(row.id))
  if (rowsToPut.length > 0) {
    await bulkPut(rowsToPut)
  }

  const remoteIds = new Set(remoteRows.map((row) => row.id))
  const localRows = await listLocal()
  const staleIds = localRows
    .filter((row) => row.deleted_at === null)
    .filter((row) => !remoteIds.has(row.id) && !pendingIds.has(row.id))
    .map((row) => row.id)

  if (staleIds.length > 0) {
    await bulkDelete(staleIds)
  }
}

async function reconcileExact<T extends { id: string }>(
  tableName: HydrateTableName,
  remoteRows: T[],
  bulkPut: (rows: T[]) => Promise<unknown>,
  bulkDelete: (ids: string[]) => Promise<unknown>,
  listLocalIds: () => Promise<string[]>
): Promise<void> {
  const pendingIds = await pendingRecordIds(tableName)
  const rowsToPut = remoteRows.filter((row) => !pendingIds.has(row.id))
  if (rowsToPut.length > 0) {
    await bulkPut(rowsToPut)
  }

  const remoteIds = new Set(remoteRows.map((row) => row.id))
  const localIds = await listLocalIds()
  const staleIds = localIds.filter((id) => !remoteIds.has(id) && !pendingIds.has(id))

  if (staleIds.length > 0) {
    await bulkDelete(staleIds)
  }
}

function mapMember(row: Record<string, unknown>): Member {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    name_normalized: String(row.name_normalized ?? ''),
    phone: String(row.phone ?? ''),
    email: String(row.email ?? ''),
    birthday: row.birthday ? String(row.birthday) : undefined,
    is_minor: Boolean(row.is_minor),
    legal_rep_name: row.legal_rep_name ? String(row.legal_rep_name) : undefined,
    has_whatsapp: Boolean(row.has_whatsapp),
    consent_recorded: Boolean(row.consent_recorded),
    sensitive_consent_recorded: Boolean(row.sensitive_consent_recorded),
    duplicate_flag: Boolean(row.duplicate_flag),
    created_by: String(row.created_by ?? ''),
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? new Date().toISOString()),
    deleted_at: row.deleted_at ? String(row.deleted_at) : null,
  }
}

function mapSession(row: Record<string, unknown>): Session {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    session_date: String(row.session_date ?? ''),
    created_by: String(row.created_by ?? ''),
    created_at: String(row.created_at ?? new Date().toISOString()),
    deleted_at: row.deleted_at ? String(row.deleted_at) : null,
  }
}

function mapAttendance(row: Record<string, unknown>): Attendance {
  return {
    id: String(row.id),
    member_id: String(row.member_id),
    session_id: String(row.session_id),
    marked_by: String(row.marked_by ?? ''),
    marked_at: String(row.marked_at ?? new Date().toISOString()),
  }
}

function mapSocialMedia(row: Record<string, unknown>): SocialMedia {
  return {
    id: String(row.id),
    member_id: String(row.member_id),
    platform: String(row.platform ?? ''),
    handle: String(row.handle ?? ''),
    created_at: String(row.created_at ?? new Date().toISOString()),
  }
}

function mapWhatsApp(row: Record<string, unknown>): WhatsAppNumber {
  return {
    id: String(row.id),
    member_id: String(row.member_id),
    number: String(row.number ?? ''),
    is_primary_phone: Boolean(row.is_primary_phone),
    created_at: String(row.created_at ?? new Date().toISOString()),
  }
}

async function fetchAll(
  table: HydrateTableName,
  columns: string
): Promise<Record<string, unknown>[]> {
  const supabase = createClient()
  const pageSize = 1000
  const rows: Record<string, unknown>[] = []
  let from = 0

  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1)

    if (error) throw error
    if (!data || data.length === 0) break

    rows.push(...(data as unknown as Record<string, unknown>[]))
    if (data.length < pageSize) break
    from += pageSize
  }

  return rows
}

async function runHydrate(): Promise<HydrateResult> {
  const counts: HydrateResult['counts'] = {}

  const [memberRows, sessionRows, attendanceRows, socialRows, whatsappRows] = await Promise.all([
    fetchAll(
      'members',
      'id, name, name_normalized, phone, email, birthday, is_minor, legal_rep_name, has_whatsapp, consent_recorded, sensitive_consent_recorded, duplicate_flag, created_by, created_at, updated_at, deleted_at'
    ),
    fetchAll('sessions', 'id, name, session_date, created_by, created_at, deleted_at'),
    fetchAll('attendance', 'id, member_id, session_id, marked_by, marked_at'),
    fetchAll('social_media', 'id, member_id, platform, handle, created_at'),
    fetchAll('whatsapp_numbers', 'id, member_id, number, is_primary_phone, created_at'),
  ])

  const members = memberRows.map(mapMember)
  const sessions = sessionRows.map(mapSession)
  const attendance = attendanceRows.map(mapAttendance)
  const socialMedia = socialRows.map(mapSocialMedia)
  const whatsappNumbers = whatsappRows.map(mapWhatsApp)

  await reconcileSoftDeletable(
    'members',
    members,
    (rows) => db.members.bulkPut(rows),
    (ids) => db.members.bulkDelete(ids),
    () => db.members.toArray()
  )
  counts.members = members.length

  await reconcileSoftDeletable(
    'sessions',
    sessions,
    (rows) => db.sessions.bulkPut(rows),
    (ids) => db.sessions.bulkDelete(ids),
    () => db.sessions.toArray()
  )
  counts.sessions = sessions.length

  await reconcileExact(
    'attendance',
    attendance,
    (rows) => db.attendance.bulkPut(rows),
    (ids) => db.attendance.bulkDelete(ids),
    () => db.attendance.toCollection().primaryKeys() as Promise<string[]>
  )
  counts.attendance = attendance.length

  await reconcileExact(
    'social_media',
    socialMedia,
    (rows) => db.social_media.bulkPut(rows),
    (ids) => db.social_media.bulkDelete(ids),
    () => db.social_media.toCollection().primaryKeys() as Promise<string[]>
  )
  counts.social_media = socialMedia.length

  await reconcileExact(
    'whatsapp_numbers',
    whatsappNumbers,
    (rows) => db.whatsapp_numbers.bulkPut(rows),
    (ids) => db.whatsapp_numbers.bulkDelete(ids),
    () => db.whatsapp_numbers.toCollection().primaryKeys() as Promise<string[]>
  )
  counts.whatsapp_numbers = whatsappNumbers.length

  return { ok: true, skipped: false, counts }
}

/**
 * Pull all Dexie-backed entities from Supabase into the local cache.
 * Safe to call from multiple mounts — coalesces in-flight work and cools down repeats.
 * Intentionally not `async` so concurrent callers receive the same Promise reference.
 */
export function hydrateFromRemote(options?: { force?: boolean }): Promise<HydrateResult> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return Promise.resolve({
      ok: false,
      skipped: true,
      counts: {},
      error: 'offline',
    })
  }

  if (inFlight) return inFlight

  if (
    !options?.force &&
    lastHydratedAt !== null &&
    Date.now() - lastHydratedAt < HYDRATE_COOLDOWN_MS
  ) {
    return Promise.resolve({ ok: true, skipped: true, counts: {} })
  }

  hydrationPhase = 'syncing'

  inFlight = (async () => {
    try {
      const result = await runHydrate()
      hydrationPhase = 'done'
      lastHydratedAt = Date.now()
      notifyListeners(result)
      return result
    } catch (err) {
      hydrationPhase = 'failed'
      const result: HydrateResult = {
        ok: false,
        skipped: false,
        counts: {},
        error: err instanceof Error ? err.message : String(err),
      }
      notifyListeners(result)
      return result
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}

/** Test-only reset for module singletons. */
export function __resetHydrationStateForTests(): void {
  hydrationPhase = 'idle'
  lastHydratedAt = null
  inFlight = null
  listeners.clear()
}
