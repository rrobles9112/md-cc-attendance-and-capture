import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockCount = vi.hoisted(() => vi.fn())
const mockWhere = vi.hoisted(() => vi.fn())

vi.mock('../db', () => ({
  db: {
    sync_queue: {
      where: mockWhere,
    },
  },
}))

vi.mock('../hydrate', () => ({
  getHydrationPhase: vi.fn(),
  hasHydratedThisSession: vi.fn(),
}))

import { getSyncStatus } from '../queue'
import { getHydrationPhase, hasHydratedThisSession } from '../hydrate'

describe('getSyncStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    mockWhere.mockReturnValue({
      equals: () => ({ count: mockCount }),
      anyOf: () => ({ count: mockCount }),
    })
    mockCount.mockResolvedValue(0)
  })

  it('returns offline when navigator is offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    await expect(getSyncStatus()).resolves.toBe('offline')
  })

  it('returns syncing before the first successful remote hydrate', async () => {
    vi.mocked(getHydrationPhase).mockReturnValue('idle')
    vi.mocked(hasHydratedThisSession).mockReturnValue(false)
    await expect(getSyncStatus()).resolves.toBe('syncing')
  })

  it('returns syncing while hydration is in progress', async () => {
    vi.mocked(getHydrationPhase).mockReturnValue('syncing')
    vi.mocked(hasHydratedThisSession).mockReturnValue(false)
    await expect(getSyncStatus()).resolves.toBe('syncing')
  })

  it('returns failed when hydration failed and never succeeded', async () => {
    vi.mocked(getHydrationPhase).mockReturnValue('failed')
    vi.mocked(hasHydratedThisSession).mockReturnValue(false)
    await expect(getSyncStatus()).resolves.toBe('failed')
  })

  it('returns done only after successful hydrate and empty outbound queue', async () => {
    vi.mocked(getHydrationPhase).mockReturnValue('done')
    vi.mocked(hasHydratedThisSession).mockReturnValue(true)
    await expect(getSyncStatus()).resolves.toBe('done')
  })

  it('returns syncing when outbound queue still has pending items after hydrate', async () => {
    vi.mocked(getHydrationPhase).mockReturnValue('done')
    vi.mocked(hasHydratedThisSession).mockReturnValue(true)
    mockWhere.mockImplementation((field: string) => ({
      equals: (value: string) => ({
        count: () =>
          Promise.resolve(field === 'status' && value === 'pending' ? 0 : 0),
      }),
      anyOf: () => ({
        count: () => Promise.resolve(2),
      }),
    }))
    // pending path uses equals('pending').count()
    mockWhere.mockReturnValue({
      equals: (status: string) => ({
        count: () => Promise.resolve(status === 'pending' ? 3 : 0),
      }),
      anyOf: () => ({ count: () => Promise.resolve(0) }),
    })
    await expect(getSyncStatus()).resolves.toBe('syncing')
  })
})
