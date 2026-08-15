import type { Member } from '@/lib/sync/db'

export const PAGE_SIZE = 50

export function paginateMembers(members: Member[], visibleCount: number): Member[] {
  return members.slice(0, visibleCount)
}
