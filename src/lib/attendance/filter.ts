import type { Member } from '@/lib/sync/db'

export function filterBySearch(members: Member[], query: string): Member[] {
  const normalizedQuery = query.trim().toLowerCase()

  if (!normalizedQuery) return members

  return members.filter((member) =>
    [member.name, member.phone, member.email].some((field) =>
      field.toLowerCase().includes(normalizedQuery),
    ),
  )
}
