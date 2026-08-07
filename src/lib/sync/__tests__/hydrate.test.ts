import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockFrom,
  mockBulkPutMembers,
  mockBulkDeleteMembers,
  mockMembersToArray,
  mockBulkPutSessions,
  mockBulkDeleteSessions,
  mockSessionsToArray,
  mockBulkPutAttendance,
  mockBulkDeleteAttendance,
  mockAttendanceKeys,
  mockBulkPutSocial,
  mockBulkDeleteSocial,
  mockSocialKeys,
  mockBulkPutWhatsapp,
  mockBulkDeleteWhatsapp,
  mockWhatsappKeys,
  mockSyncQueueWhere,
} = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockBulkPutMembers: vi.fn(),
  mockBulkDeleteMembers: vi.fn(),
  mockMembersToArray: vi.fn(),
  mockBulkPutSessions: vi.fn(),
  mockBulkDeleteSessions: vi.fn(),
  mockSessionsToArray: vi.fn(),
  mockBulkPutAttendance: vi.fn(),
  mockBulkDeleteAttendance: vi.fn(),
  mockAttendanceKeys: vi.fn(),
  mockBulkPutSocial: vi.fn(),
  mockBulkDeleteSocial: vi.fn(),
  mockSocialKeys: vi.fn(),
  mockBulkPutWhatsapp: vi.fn(),
  mockBulkDeleteWhatsapp: vi.fn(),
  mockWhatsappKeys: vi.fn(),
  mockSyncQueueWhere: vi.fn(),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: mockFrom,
  }),
}))

vi.mock('../db', () => ({
  db: {
    members: {
      bulkPut: mockBulkPutMembers,
      bulkDelete: mockBulkDeleteMembers,
      toArray: mockMembersToArray,
    },
    sessions: {
      bulkPut: mockBulkPutSessions,
      bulkDelete: mockBulkDeleteSessions,
      toArray: mockSessionsToArray,
    },
    attendance: {
      bulkPut: mockBulkPutAttendance,
      bulkDelete: mockBulkDeleteAttendance,
      toCollection: () => ({ primaryKeys: mockAttendanceKeys }),
    },
    social_media: {
      bulkPut: mockBulkPutSocial,
      bulkDelete: mockBulkDeleteSocial,
      toCollection: () => ({ primaryKeys: mockSocialKeys }),
    },
    whatsapp_numbers: {
      bulkPut: mockBulkPutWhatsapp,
      bulkDelete: mockBulkDeleteWhatsapp,
      toCollection: () => ({ primaryKeys: mockWhatsappKeys }),
    },
    sync_queue: {
      where: mockSyncQueueWhere,
    },
  },
}))

import {
  __resetHydrationStateForTests,
  getHydrationPhase,
  hasHydratedThisSession,
  hydrateFromRemote,
  onCacheHydrated,
} from '../hydrate'

function mockSelectResult(rows: Record<string, unknown>[]) {
  return {
    select: vi.fn().mockReturnValue({
      range: vi.fn().mockResolvedValue({ data: rows, error: null }),
    }),
  }
}

describe('hydrateFromRemote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetHydrationStateForTests()
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })

    mockSyncQueueWhere.mockReturnValue({
      equals: () => ({
        filter: () => ({
          toArray: () => Promise.resolve([]),
        }),
      }),
    })

    mockMembersToArray.mockResolvedValue([])
    mockSessionsToArray.mockResolvedValue([])
    mockAttendanceKeys.mockResolvedValue([])
    mockSocialKeys.mockResolvedValue([])
    mockWhatsappKeys.mockResolvedValue([])

    mockFrom.mockImplementation((table: string) => {
      if (table === 'members') {
        return mockSelectResult([
          {
            id: 'm1',
            name: 'Richard Robles',
            name_normalized: 'richard robles',
            phone: '+573001111111',
            email: 'richard@test.com',
            birthday: null,
            is_minor: false,
            legal_rep_name: null,
            has_whatsapp: true,
            consent_recorded: true,
            sensitive_consent_recorded: false,
            duplicate_flag: false,
            created_by: 'u1',
            created_at: '2026-08-03T00:00:00Z',
            updated_at: '2026-08-03T00:00:00Z',
            deleted_at: null,
          },
        ])
      }
      if (table === 'sessions') {
        return mockSelectResult([
          {
            id: 's1',
            name: 'Sesión 1',
            session_date: '2026-08-03',
            created_by: 'u1',
            created_at: '2026-08-03T00:00:00Z',
            deleted_at: null,
          },
        ])
      }
      if (table === 'attendance') {
        return mockSelectResult([
          {
            id: 'a1',
            member_id: 'm1',
            session_id: 's1',
            marked_by: 'u1',
            marked_at: '2026-08-03T01:00:00Z',
          },
        ])
      }
      if (table === 'social_media') {
        return mockSelectResult([
          {
            id: 'sm1',
            member_id: 'm1',
            platform: 'instagram',
            handle: '@richard',
            created_at: '2026-08-03T00:00:00Z',
          },
        ])
      }
      return mockSelectResult([
        {
          id: 'w1',
          member_id: 'm1',
          number: '+573009999999',
          is_primary_phone: false,
          created_at: '2026-08-03T00:00:00Z',
        },
      ])
    })
  })

  it('pulls all synced tables into Dexie and marks session hydrated', async () => {
    const listener = vi.fn()
    const unsubscribe = onCacheHydrated(listener)

    const result = await hydrateFromRemote({ force: true })

    expect(result.ok).toBe(true)
    expect(result.skipped).toBe(false)
    expect(result.counts).toEqual({
      members: 1,
      sessions: 1,
      attendance: 1,
      social_media: 1,
      whatsapp_numbers: 1,
    })
    expect(mockBulkPutMembers).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'm1', name: 'Richard Robles', deleted_at: null }),
    ])
    expect(mockBulkPutSessions).toHaveBeenCalledWith([
      expect.objectContaining({ id: 's1', name: 'Sesión 1' }),
    ])
    expect(mockBulkPutAttendance).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'a1', member_id: 'm1', session_id: 's1' }),
    ])
    expect(mockBulkPutSocial).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'sm1', platform: 'instagram' }),
    ])
    expect(mockBulkPutWhatsapp).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'w1', number: '+573009999999' }),
    ])
    expect(hasHydratedThisSession()).toBe(true)
    expect(getHydrationPhase()).toBe('done')
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ ok: true }))

    unsubscribe()
  })

  it('removes stale active local rows missing remotely (unless pending push)', async () => {
    mockMembersToArray.mockResolvedValue([
      { id: 'stale', deleted_at: null },
      { id: 'tombstone', deleted_at: '2026-07-01T00:00:00Z' },
      { id: 'pending-local', deleted_at: null },
    ])
    mockSyncQueueWhere.mockImplementation((field: string) => {
      expect(field).toBe('table_name')
      return {
        equals: (table: string) => ({
          filter: () => ({
            toArray: () =>
              Promise.resolve(
                table === 'members'
                  ? [{ record_id: 'pending-local', status: 'pending' }]
                  : []
              ),
          }),
        }),
      }
    })

    await hydrateFromRemote({ force: true })

    expect(mockBulkDeleteMembers).toHaveBeenCalledWith(['stale'])
  })

  it('does not overwrite local rows that have pending outbound queue items', async () => {
    mockSyncQueueWhere.mockImplementation((field: string) => {
      expect(field).toBe('table_name')
      return {
        equals: (table: string) => ({
          filter: () => ({
            toArray: () =>
              Promise.resolve(
                table === 'members'
                  ? [{ record_id: 'm1', status: 'pending' }]
                  : []
              ),
          }),
        }),
      }
    })

    await hydrateFromRemote({ force: true })

    // Remote returned m1 with deleted_at=null; local soft-delete is pending —
    // hydrate must not bulkPut m1 and resurrect it.
    expect(mockBulkPutMembers).not.toHaveBeenCalled()
  })

  it('skips remote pull while offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    const result = await hydrateFromRemote({ force: true })
    expect(result.ok).toBe(false)
    expect(result.skipped).toBe(true)
    expect(result.error).toBe('offline')
    expect(mockFrom).not.toHaveBeenCalled()
    expect(hasHydratedThisSession()).toBe(false)
  })

  it('coalesces concurrent hydrate calls', async () => {
    const resolvers: Array<(value: unknown) => void> = []
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        range: vi.fn().mockImplementation(
          () =>
            new Promise((resolve) => {
              resolvers.push(resolve)
            })
        ),
      }),
    })

    const first = hydrateFromRemote({ force: true })
    const second = hydrateFromRemote({ force: true })
    expect(first).toBe(second)

    // Five tables × one page each
    await Promise.resolve()
    expect(resolvers.length).toBe(5)
    for (const resolve of resolvers) {
      resolve({ data: [], error: null })
    }
    await first
  })
})
