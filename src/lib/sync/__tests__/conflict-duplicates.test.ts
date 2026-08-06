import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFilter = vi.hoisted(() => vi.fn())
const mockFrom = vi.hoisted(() => vi.fn())
const mockSelect = vi.hoisted(() => vi.fn())
const mockOr = vi.hoisted(() => vi.fn())

vi.mock('@/lib/sync/db', () => ({
  db: {
    members: {
      filter: mockFilter,
    },
  },
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: mockFrom,
  }),
}))

import { findDuplicateMembers, normalizeName, normalizePhone } from '../conflict'

describe('normalizeName / normalizePhone (re-exported helpers)', () => {
  it('normalizes name and phone', () => {
    expect(normalizeName('  Juan Pérez  ')).toBe('juan perez')
    expect(normalizePhone('+57 300-123 4567')).toBe('+573001234567')
  })
})

describe('findDuplicateMembers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    mockFilter.mockReturnValue({ toArray: () => Promise.resolve([]) })
    mockFrom.mockReturnValue({ select: mockSelect })
    mockSelect.mockReturnValue({ or: mockOr })
    mockOr.mockResolvedValue({ data: [], error: null })
  })

  it('returns local-only duplicates when offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    const localMember = {
      id: 'local-1',
      name: 'richard robles',
      name_normalized: 'richard robles',
      phone: '+573004445217',
      email: 'rrobles9112@gmail.com',
      is_minor: false,
      has_whatsapp: true,
      consent_recorded: true,
      sensitive_consent_recorded: false,
      duplicate_flag: false,
      created_by: 'u1',
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-01T00:00:00Z',
      deleted_at: null,
    }
    mockFilter.mockReturnValue({ toArray: () => Promise.resolve([localMember]) })

    const dupes = await findDuplicateMembers('richard robles', '+573004445217', 'rrobles9112@gmail.com')
    expect(dupes).toHaveLength(1)
    expect(dupes[0].id).toBe('local-1')
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('detects a remote duplicate not present in the local cache (cross-session)', async () => {
    // Local cache is empty (new browser session).
    mockFilter.mockReturnValue({ toArray: () => Promise.resolve([]) })
    mockOr.mockResolvedValue({
      data: [
        {
          id: 'remote-1',
          name: 'richard robles',
          name_normalized: 'richard robles',
          phone: '+573004445217',
          email: 'rrobles9112@gmail.com',
          is_minor: false,
          has_whatsapp: true,
          consent_recorded: true,
          sensitive_consent_recorded: false,
          duplicate_flag: false,
          created_by: 'u1',
          created_at: '2026-08-01T00:00:00Z',
          updated_at: '2026-08-01T00:00:00Z',
          deleted_at: null,
        },
      ],
      error: null,
    })

    const dupes = await findDuplicateMembers('richard robles', '+573004445217', 'rrobles9112@gmail.com')
    expect(dupes).toHaveLength(1)
    expect(dupes[0].id).toBe('remote-1')
  })

  it('deduplicates by id when the same member exists locally and remotely', async () => {
    const shared = {
      id: 'shared-1',
      name: 'richard robles',
      name_normalized: 'richard robles',
      phone: '+573004445217',
      email: 'rrobles9112@gmail.com',
      is_minor: false,
      has_whatsapp: true,
      consent_recorded: true,
      sensitive_consent_recorded: false,
      duplicate_flag: false,
      created_by: 'u1',
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-01T00:00:00Z',
      deleted_at: null,
    }
    mockFilter.mockReturnValue({ toArray: () => Promise.resolve([shared]) })
    mockOr.mockResolvedValue({ data: [shared], error: null })

    const dupes = await findDuplicateMembers('richard robles', '+573004445217', 'rrobles9112@gmail.com')
    expect(dupes).toHaveLength(1)
  })

  it('ignores soft-deleted remote rows', async () => {
    mockFilter.mockReturnValue({ toArray: () => Promise.resolve([]) })
    mockOr.mockResolvedValue({
      data: [
        {
          id: 'remote-deleted',
          name: 'richard robles',
          name_normalized: 'richard robles',
          phone: '+573004445217',
          email: 'rrobles9112@gmail.com',
          is_minor: false,
          has_whatsapp: true,
          consent_recorded: true,
          sensitive_consent_recorded: false,
          duplicate_flag: false,
          created_by: 'u1',
          created_at: '2026-08-01T00:00:00Z',
          updated_at: '2026-08-01T00:00:00Z',
          deleted_at: '2026-08-02T00:00:00Z',
        },
      ],
      error: null,
    })

    const dupes = await findDuplicateMembers('richard robles', '+573004445217', 'rrobles9112@gmail.com')
    expect(dupes).toHaveLength(0)
  })

  it('falls back to local-only when the remote lookup errors', async () => {
    const localMember = {
      id: 'local-1',
      name: 'richard robles',
      name_normalized: 'richard robles',
      phone: '+573004445217',
      email: 'rrobles9112@gmail.com',
      is_minor: false,
      has_whatsapp: true,
      consent_recorded: true,
      sensitive_consent_recorded: false,
      duplicate_flag: false,
      created_by: 'u1',
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-01T00:00:00Z',
      deleted_at: null,
    }
    mockFilter.mockReturnValue({ toArray: () => Promise.resolve([localMember]) })
    mockOr.mockResolvedValue({ data: null, error: { message: 'rls denied' } })

    const dupes = await findDuplicateMembers('richard robles', '+573004445217', 'rrobles9112@gmail.com')
    expect(dupes).toHaveLength(1)
    expect(dupes[0].id).toBe('local-1')
  })
})
