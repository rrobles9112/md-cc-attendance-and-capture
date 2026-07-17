import { db, type Member, type Session, type Attendance, type SocialMedia, type WhatsAppNumber, type SyncQueueItem } from '@/lib/sync/db'

type SoftDeletableTable = 'members' | 'sessions'

export function excludeDeleted<T extends { deleted_at: string | null }>(
  collection: T[]
): T[] {
  return collection.filter((item) => item.deleted_at === null)
}

export async function softDelete(table: SoftDeletableTable, id: string): Promise<void> {
  switch (table) {
    case 'members':
      await db.members.update(id, { deleted_at: new Date().toISOString() })
      break
    case 'sessions':
      await db.sessions.update(id, { deleted_at: new Date().toISOString() })
      break
  }
}

export function assertCanHardDelete(role: string): void {
  if (role !== 'super_admin') {
    throw new Error('Hard delete is restricted to super_admin only')
  }
}

export async function hardDelete(table: SoftDeletableTable, id: string, role: string): Promise<void> {
  assertCanHardDelete(role)
  switch (table) {
    case 'members':
      await db.members.delete(id)
      break
    case 'sessions':
      await db.sessions.delete(id)
      break
  }
}

export function isDeleted(record: { deleted_at: string | null }): boolean {
  return record.deleted_at !== null
}

export function isPurgeEligible(deletedAt: string): boolean {
  const deletedDate = new Date(deletedAt)
  const now = new Date()
  const diffMs = now.getTime() - deletedDate.getTime()
  const diffDays = diffMs / (1000 * 60 * 60 * 24)
  return diffDays >= 90
}
