import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFrom = vi.hoisted(() => vi.fn())
const mockGetSession = vi.hoisted(() => vi.fn())
const mockUpsert = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: mockFrom,
    auth: { getSession: mockGetSession },
  }),
}))

import {
  RETREAT_TOTAL_COST_KEY,
  getRetreatTotalCost,
  setRetreatTotalCost,
} from '../app-settings'

function mockSelectSingle(result: { data: { value: string } | null; error: unknown }) {
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue(result),
      }),
    }),
  })
}

describe('retreat total cost helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the retreat.youth.total_cost key', () => {
    expect(RETREAT_TOTAL_COST_KEY).toBe('retreat.youth.total_cost')
  })

  it('returns the stored string without coercing it to a number', async () => {
    mockSelectSingle({ data: { value: '150000.50' }, error: null })

    await expect(getRetreatTotalCost()).resolves.toBe('150000.50')
  })

  it('returns null when the setting is missing and does not invent a numeric default', async () => {
    mockSelectSingle({ data: null, error: { code: 'PGRST116' } })

    const result = await getRetreatTotalCost()
    expect(result).toBeNull()
    expect(result).not.toBe('0')
    expect(result).not.toBe('100')
  })

  it('returns the empty stored string as-is instead of a numeric default', async () => {
    mockSelectSingle({ data: { value: '' }, error: null })

    const result = await getRetreatTotalCost()
    expect(result).toBe('')
    expect(result).not.toBe('0')
    expect(result).not.toBe('100')
  })

  it('persists the value through setSetting on retreat.youth.total_cost', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
    })
    mockUpsert.mockResolvedValue({ error: null })
    mockFrom.mockReturnValue({ upsert: mockUpsert })

    await setRetreatTotalCost('250000')

    expect(mockFrom).toHaveBeenCalledWith('app_settings')
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'retreat.youth.total_cost',
        value: '250000',
        updated_by: 'user-1',
      }),
    )
  })
})
