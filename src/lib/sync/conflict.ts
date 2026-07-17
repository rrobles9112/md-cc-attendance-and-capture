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

export async function findDuplicateMembers(
  name: string,
  phone: string,
  email?: string
): Promise<Member[]> {
  const nameNorm = normalizeName(name)
  const phoneNorm = normalizePhone(phone)

  const allMembers = await db.members
    .filter((m) => m.deleted_at === null)
    .toArray()

  return allMembers.filter((m) => {
    const nameMatch = normalizeName(m.name) === nameNorm
    const phoneMatch = normalizePhone(m.phone) === phoneNorm
    const emailMatch = email ? m.email.toLowerCase() === email.toLowerCase() : false

    return (nameMatch && phoneMatch) || (emailMatch && email !== undefined)
  })
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
