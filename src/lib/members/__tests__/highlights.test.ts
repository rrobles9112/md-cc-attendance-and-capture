import { describe, expect, it } from 'vitest'
import type { Member } from '@/lib/sync/db'
import {
  getBirthdaysOfMonth,
  getNewMembers,
  type MemberHighlight,
} from '../highlights'

function makeMember(overrides: Partial<Member> = {}): Member {
  return {
    id: 'm1',
    name: 'Ana',
    name_normalized: 'ana',
    phone: '3000000000',
    email: 'ana@example.com',
    birthday: undefined,
    is_minor: false,
    has_whatsapp: false,
    consent_recorded: true,
    sensitive_consent_recorded: true,
    duplicate_flag: false,
    created_by: 'user1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    ...overrides,
  }
}

describe('getBirthdaysOfMonth', () => {
  const today = '2026-08-22'

  it('includes members whose birthday month matches the current month', () => {
    const members = [
      makeMember({ id: 'a', name: 'Ana', birthday: '1995-08-10' }),
      makeMember({ id: 'b', name: 'Luis', birthday: '2000-09-05' }),
    ]
    const result = getBirthdaysOfMonth(members, today)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      id: 'a',
      name: 'Ana',
      day: 10,
      date: '1995-08-10',
    } satisfies MemberHighlight)
  })

  it('sorts by day ascending within the month', () => {
    const members = [
      makeMember({ id: 'late', name: 'Zoe', birthday: '1990-08-28' }),
      makeMember({ id: 'early', name: 'Bea', birthday: '1985-08-02' }),
    ]
    const result = getBirthdaysOfMonth(members, today)
    expect(result.map((r) => r.id)).toEqual(['early', 'late'])
  })

  it('excludes invalid or incomplete birthdays without throwing', () => {
    const members = [
      makeMember({ id: 'empty', name: 'A', birthday: '' }),
      makeMember({ id: 'month13', name: 'B', birthday: '2000-13-01' }),
      makeMember({ id: 'incomplete', name: 'C', birthday: '2000-05' }),
      makeMember({ id: 'day32', name: 'D', birthday: '2000-04-31' }),
      makeMember({ id: 'garbage', name: 'E', birthday: 'not-a-date' }),
    ]
    expect(getBirthdaysOfMonth(members, today)).toEqual([])
  })

  it('excludes soft-deleted members even if their birthday matches', () => {
    const members = [
      makeMember({ id: 'gone', name: 'Gone', birthday: '1999-08-15', deleted_at: '2026-08-01T00:00:00Z' }),
    ]
    expect(getBirthdaysOfMonth(members, today)).toEqual([])
  })

  it('returns an empty list when there are no matching birthdays', () => {
    const members = [
      makeMember({ id: 'x', name: 'X', birthday: '1990-03-20' }),
    ]
    expect(getBirthdaysOfMonth(members, today)).toEqual([])
    expect(getBirthdaysOfMonth([], today)).toEqual([])
  })
})

describe('getNewMembers', () => {
  const today = '2026-08-22'

  it('includes a member registered exactly on the inclusive 30-day boundary (today - 29)', () => {
    const members = [
      makeMember({ id: 'boundary', name: 'Boundary', created_at: '2026-07-24T12:00:00Z' }),
    ]
    const result = getNewMembers(members, today)
    expect(result).toHaveLength(1)
    expect(result[0].date).toBe('2026-07-24T12:00:00Z')
  })

  it('excludes a member registered 30+ calendar days before today (outside window)', () => {
    const members = [
      makeMember({ id: 'old', name: 'Old', created_at: '2026-07-23T23:59:59Z' }),
    ]
    expect(getNewMembers(members, today)).toEqual([])
  })

  it('includes a member registered today', () => {
    const members = [
      makeMember({ id: 'today', name: 'Today', created_at: '2026-08-22T08:00:00Z' }),
    ]
    const result = getNewMembers(members, today)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('today')
  })

  it('excludes future registrations', () => {
    const members = [
      makeMember({ id: 'future', name: 'Future', created_at: '2026-08-23T00:00:00Z' }),
    ]
    expect(getNewMembers(members, today)).toEqual([])
  })

  it('excludes soft-deleted members', () => {
    const members = [
      makeMember({
        id: 'gone',
        name: 'Gone',
        created_at: '2026-08-20T00:00:00Z',
        deleted_at: '2026-08-21T00:00:00Z',
      }),
    ]
    expect(getNewMembers(members, today)).toEqual([])
  })

  it('orders results by created_at descending (newest first)', () => {
    const members = [
      makeMember({ id: 'older', name: 'Older', created_at: '2026-08-01T00:00:00Z' }),
      makeMember({ id: 'newest', name: 'Newest', created_at: '2026-08-22T06:00:00Z' }),
      makeMember({ id: 'middle', name: 'Middle', created_at: '2026-08-10T00:00:00Z' }),
    ]
    const result = getNewMembers(members, today)
    expect(result.map((r) => r.id)).toEqual(['newest', 'middle', 'older'])
  })

  it('supports a custom window size in calendar days', () => {
    const members = [
      makeMember({ id: 'week-old', name: 'Week', created_at: '2026-08-16T00:00:00Z' }),
    ]
    // 7-day inclusive window: cutoff = today - 6 = 2026-08-16
    expect(getNewMembers(members, today, 7)).toHaveLength(1)
    expect(getNewMembers(members, today, 3)).toEqual([])
  })

  it('returns an empty list for empty input', () => {
    expect(getNewMembers([], today)).toEqual([])
  })
})
