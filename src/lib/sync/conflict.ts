import { createClient } from '@/lib/supabase/client'
import { db, type Member } from './db'

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

export function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-()]/g, '')
}

function isLocalDuplicate(member: Member, nameNorm: string, phoneNorm: string, email?: string): boolean {
  const nameMatch = normalizeName(member.name) === nameNorm
  const phoneMatch = normalizePhone(member.phone) === phoneNorm
  const emailMatch = email ? member.email.toLowerCase() === email.toLowerCase() : false
  return (nameMatch && phoneMatch) || (emailMatch && email !== undefined)
}

/**
 * Find duplicate members across both the local Dexie cache and the remote Supabase
 * database. Checking only the local cache caused cross-session duplicates: a new
 * browser session with an empty/stale cache could not see a member created in
 * another session, so the duplicate check passed and a second row was inserted.
 *
 * When offline (or when the remote lookup fails), falls back to local-only results
 * so capture still works offline.
 */
export async function findDuplicateMembers(
  name: string,
  phone: string,
  email?: string
): Promise<Member[]> {
  const nameNorm = normalizeName(name)
  const phoneNorm = normalizePhone(phone)

  const localMembers = await db.members
    .filter((m) => m.deleted_at === null)
    .toArray()
  const localDuplicates = localMembers.filter((m) =>
    isLocalDuplicate(m, nameNorm, phoneNorm, email)
  )

  // Offline: local cache is the only source of truth.
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return localDuplicates
  }

  // Online: also query Supabase so cross-session duplicates are detected even when
  // the local cache is empty or stale (e.g. a brand-new browser session).
  try {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('members')
      .select('id, name, name_normalized, phone, email, birthday, is_minor, legal_rep_name, has_whatsapp, consent_recorded, sensitive_consent_recorded, duplicate_flag, created_by, created_at, updated_at, deleted_at')
      .or(`phone.eq.${phoneNorm},email.eq.${email ?? ''}`)

    if (error || !data) return localDuplicates

    const remoteDuplicates = (data as Record<string, unknown>[])
      .filter((row) => row.deleted_at === null)
      .map((row): Member => ({
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
      }))
      .filter((m) => isLocalDuplicate(m, nameNorm, phoneNorm, email))

    // Merge by id, preferring local rows when both exist.
    const byId = new Map<string, Member>()
    for (const m of localDuplicates) byId.set(m.id, m)
    for (const m of remoteDuplicates) byId.set(m.id, m)
    return [...byId.values()]
  } catch {
    // Network/permission failure: fall back to local-only detection.
    return localDuplicates
  }
}

export async function resolveAttendanceConflict(
  memberId: string,
  sessionId: string,
  markedBy: string,
  markedAt: string
): Promise<void> {
  const existing = await db.attendance
    .where('[member_id+session_id]')
    .equals([memberId, sessionId])
    .first()

  if (!existing) {
    await db.attendance.add({
      id: crypto.randomUUID(),
      member_id: memberId,
      session_id: sessionId,
      marked_by: markedBy,
      marked_at: markedAt,
    })
    return
  }

  if (new Date(markedAt) > new Date(existing.marked_at)) {
    await db.attendance.update(existing.id, {
      marked_by: markedBy,
      marked_at: markedAt,
    })
  }
}

export async function markDuplicateFlag(memberId: string): Promise<void> {
  await db.members.update(memberId, { duplicate_flag: true })
}
