import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/sync/db', () => {
  return {
    db: {
      members: {
        update: vi.fn(),
        delete: vi.fn(),
      },
      sessions: {
        update: vi.fn(),
        delete: vi.fn(),
      },
    },
  }
})

import { excludeDeleted, assertCanHardDelete, isDeleted, isPurgeEligible } from '../soft-delete'

describe('excludeDeleted', () => {
  it('filters out soft-deleted records', () => {
    const items = [
      { id: '1', deleted_at: null },
      { id: '2', deleted_at: '2026-07-01T00:00:00Z' },
      { id: '3', deleted_at: null },
    ]
    const result = excludeDeleted(items)
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.id)).toEqual(['1', '3'])
  })

  it('returns all when none deleted', () => {
    const items = [
      { id: '1', deleted_at: null },
      { id: '2', deleted_at: null },
    ]
    expect(excludeDeleted(items)).toHaveLength(2)
  })

  it('returns empty when all deleted', () => {
    const items = [
      { id: '1', deleted_at: '2026-07-01T00:00:00Z' },
    ]
    expect(excludeDeleted(items)).toHaveLength(0)
  })
})

describe('assertCanHardDelete', () => {
  it('does not throw for super_admin', () => {
    expect(() => assertCanHardDelete('super_admin')).not.toThrow()
  })

  it('throws for leader', () => {
    expect(() => assertCanHardDelete('leader')).toThrow('Hard delete is restricted to super_admin only')
  })

  it('throws for server', () => {
    expect(() => assertCanHardDelete('server')).toThrow('Hard delete is restricted to super_admin only')
  })

  it('throws for unknown role', () => {
    expect(() => assertCanHardDelete('unknown')).toThrow('Hard delete is restricted to super_admin only')
  })
})

describe('isDeleted', () => {
  it('returns true when deleted_at is set', () => {
    expect(isDeleted({ deleted_at: '2026-07-01T00:00:00Z' })).toBe(true)
  })

  it('returns false when deleted_at is null', () => {
    expect(isDeleted({ deleted_at: null })).toBe(false)
  })
})

describe('isPurgeEligible', () => {
  it('returns true when 90+ days have passed', () => {
    const ninetyOneDaysAgo = new Date()
    ninetyOneDaysAgo.setDate(ninetyOneDaysAgo.getDate() - 91)
    expect(isPurgeEligible(ninetyOneDaysAgo.toISOString())).toBe(true)
  })

  it('returns false when less than 90 days', () => {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    expect(isPurgeEligible(thirtyDaysAgo.toISOString())).toBe(false)
  })

  it('returns true at exactly 90 days', () => {
    const exactly90 = new Date()
    exactly90.setDate(exactly90.getDate() - 90)
    expect(isPurgeEligible(exactly90.toISOString())).toBe(true)
  })
})
