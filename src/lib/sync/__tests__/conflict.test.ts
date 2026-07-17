import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockWhere, mockFilter, mockAdd, mockUpdate } = vi.hoisted(() => ({
  mockWhere: vi.fn(),
  mockFilter: vi.fn(),
  mockAdd: vi.fn(),
  mockUpdate: vi.fn(),
}))

vi.mock('@/lib/sync/db', () => {
  return {
    db: {
      members: {
        filter: mockFilter,
        update: vi.fn(),
        add: vi.fn(),
      },
      attendance: {
        where: mockWhere,
        add: mockAdd,
        update: mockUpdate,
      },
    },
  }
})

import { normalizeName, normalizePhone, resolveAttendanceConflict } from '../conflict'

describe('normalizeName', () => {
  it('lowercases and trims', () => {
    expect(normalizeName('  Juan Pérez  ')).toBe('juan perez')
  })

  it('removes accents', () => {
    expect(normalizeName('María López')).toBe('maria lopez')
  })

  it('collapses whitespace', () => {
    expect(normalizeName('Juan   Carlos')).toBe('juan carlos')
  })

  it('handles empty string', () => {
    expect(normalizeName('')).toBe('')
  })
})

describe('normalizePhone', () => {
  it('removes spaces', () => {
    expect(normalizePhone('+57 300 123 4567')).toBe('+573001234567')
  })

  it('removes dashes', () => {
    expect(normalizePhone('+57-300-123-4567')).toBe('+573001234567')
  })

  it('removes parentheses', () => {
    expect(normalizePhone('+57(300)1234567')).toBe('+573001234567')
  })

  it('handles clean number', () => {
    expect(normalizePhone('+573001234567')).toBe('+573001234567')
  })
})

describe('resolveAttendanceConflict', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts new attendance when none exists', async () => {
    mockWhere.mockReturnValue({
      equals: () => ({ first: () => Promise.resolve(null) }),
    })

    await resolveAttendanceConflict('member-1', 'session-1', 'user-1', '2026-07-17T10:00:00Z')
    expect(mockAdd).toHaveBeenCalled()
  })

  it('updates when new timestamp is later (LWW)', async () => {
    const existing = {
      id: 'att-1',
      member_id: 'member-1',
      session_id: 'session-1',
      marked_by: 'user-old',
      marked_at: '2026-07-17T09:00:00Z',
    }
    mockWhere.mockReturnValue({
      equals: () => ({ first: () => Promise.resolve(existing) }),
    })

    await resolveAttendanceConflict('member-1', 'session-1', 'user-new', '2026-07-17T10:00:00Z')
    expect(mockUpdate).toHaveBeenCalledWith('att-1', {
      marked_by: 'user-new',
      marked_at: '2026-07-17T10:00:00Z',
    })
  })

  it('does not update when existing timestamp is later', async () => {
    const existing = {
      id: 'att-1',
      member_id: 'member-1',
      session_id: 'session-1',
      marked_by: 'user-old',
      marked_at: '2026-07-17T11:00:00Z',
    }
    mockWhere.mockReturnValue({
      equals: () => ({ first: () => Promise.resolve(existing) }),
    })

    await resolveAttendanceConflict('member-1', 'session-1', 'user-new', '2026-07-17T10:00:00Z')
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
