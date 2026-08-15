import type { Attendance, Member } from '@/lib/sync/db'

export function countPresent(
  filteredMembers: Member[],
  attendanceMap: Record<string, Attendance>,
): number {
  return filteredMembers.filter((member) => attendanceMap[member.id]).length
}
