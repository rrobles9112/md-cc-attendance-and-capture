import { describe, expect, it } from 'vitest'
import type { Attendance, Member } from '@/lib/sync/db'
import { countPresent } from '../count'

const members = [
  { id: 'member-1' },
  { id: 'member-2' },
  { id: 'member-3' },
] as Member[]

const attendance = (memberId: string): Attendance => ({
  id: `attendance-${memberId}`,
  member_id: memberId,
  session_id: 'session-1',
  marked_by: 'user-1',
  marked_at: '2026-08-13T10:00:00Z',
})

describe('countPresent', () => {
  it('returns 0 when no attendance', () => {
    expect(countPresent(members, {})).toBe(0)
  })

  it('counts only members with attendance', () => {
    const attendanceMap = {
      'member-1': attendance('member-1'),
      'member-3': attendance('member-3'),
    }

    expect(countPresent(members, attendanceMap)).toBe(2)
  })

  it('excludes attendance for members not in filteredMembers', () => {
    const attendanceMap = {
      'member-1': attendance('member-1'),
      'member-4': attendance('member-4'),
    }

    expect(countPresent(members.slice(0, 2), attendanceMap)).toBe(1)
  })
})
