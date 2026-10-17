import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockQueueWhere, mockQueueUpdate, mockUpsert } = vi.hoisted(() => ({
  mockQueueWhere: vi.fn(),
  mockQueueUpdate: vi.fn(),
  mockUpsert: vi.fn(),
}))

let pendingItems: Record<string, unknown>[] = []

vi.mock('../db', () => ({
  db: {
    sync_queue: {
      where: mockQueueWhere,
      update: mockQueueUpdate,
    },
  },
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      upsert: mockUpsert,
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  }),
}))

vi.mock('../hydrate', () => ({
  getHydrationPhase: vi.fn(() => 'done'),
  hasHydratedThisSession: vi.fn(() => true),
}))

import { flushQueue } from '../queue'

describe('flushQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQueueUpdate.mockResolvedValue(1)
    mockQueueWhere.mockImplementation(() => ({
      equals: () => ({ modify: vi.fn().mockResolvedValue(0) }),
      anyOf: () => ({ sortBy: () => Promise.resolve(pendingItems) }),
    }))
  })

  it('stores a readable PostgREST error message (not "[object Object]") on permanent failures', async () => {
    pendingItems = [
      {
        id: 'q1',
        table_name: 'attendance',
        record_id: 'att-1',
        operation: 'insert',
        payload: { id: 'att-1', member_id: 'm1', session_id: 's1' },
        status: 'pending',
        created_at: '2026-10-17T10:00:00Z',
        retry_count: 0,
      },
    ]
    mockUpsert.mockResolvedValue({
      error: {
        message:
          'duplicate key value violates unique constraint "attendance_member_id_session_id_key"',
        code: '23505',
        details: 'Key (member_id, session_id)=(m1, s1) already exists.',
        hint: null,
      },
    })

    const result = await flushQueue()

    expect(result).toEqual({ succeeded: 0, failed: 1 })
    const failureUpdate = mockQueueUpdate.mock.calls
      .map((call) => call[1] as { status?: string; error?: string })
      .find((update) => update.status === 'failed')
    expect(failureUpdate).toBeDefined()
    expect(failureUpdate?.error).not.toBe('[object Object]')
    expect(failureUpdate?.error).toContain('duplicate key value violates unique constraint')
    expect(failureUpdate?.error).toContain('23505')
  })

  it('upserts attendance inserts on the (member_id, session_id) unique key so cross-device marks do not fail with 23505', async () => {
    pendingItems = [
      {
        id: 'q2',
        table_name: 'attendance',
        record_id: 'att-2',
        operation: 'insert',
        payload: { id: 'att-2', member_id: 'm1', session_id: 's1' },
        status: 'pending',
        created_at: '2026-10-17T10:00:00Z',
        retry_count: 0,
      },
    ]
    mockUpsert.mockResolvedValue({ error: null })

    const result = await flushQueue()

    expect(result).toEqual({ succeeded: 1, failed: 0 })
    expect(mockUpsert).toHaveBeenCalledWith(
      { id: 'att-2', member_id: 'm1', session_id: 's1' },
      { onConflict: 'member_id,session_id' },
    )
  })
})
