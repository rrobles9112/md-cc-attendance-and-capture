import { describe, expect, it } from 'vitest'
import type { Attendance } from '@/lib/sync/db'
import { excludeOrphanedAttendance } from '../orphans'

const attendance = (id: string, memberId: string): Attendance => ({
  id,
  member_id: memberId,
  session_id: 'session-1',
  marked_by: 'user-1',
  marked_at: '2026-08-13T10:00:00Z',
})

describe('excludeOrphanedAttendance', () => {
  it('drops records for non-existent members', () => {
    const records = [
      attendance('attendance-1', 'member-1'),
      attendance('attendance-orphan', 'deleted-member'),
    ]

    expect(excludeOrphanedAttendance(records, new Set(['member-1']))).toEqual({
      'member-1': records[0],
    })
  })

  it('keeps records for active members', () => {
    const records = [
      attendance('attendance-1', 'member-1'),
      attendance('attendance-2', 'member-2'),
    ]

    expect(excludeOrphanedAttendance(records, new Set(['member-1', 'member-2']))).toEqual({
      'member-1': records[0],
      'member-2': records[1],
    })
  })
})
