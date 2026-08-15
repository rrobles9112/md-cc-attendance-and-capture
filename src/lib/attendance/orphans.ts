import type { Attendance } from '@/lib/sync/db'

export function excludeOrphanedAttendance(
  records: Attendance[],
  activeMemberIds: Set<string>,
): Record<string, Attendance> {
  return records.reduce<Record<string, Attendance>>((attendanceMap, record) => {
    if (activeMemberIds.has(record.member_id)) {
      attendanceMap[record.member_id] = record
    }
    return attendanceMap
  }, {})
}
