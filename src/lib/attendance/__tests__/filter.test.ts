import { describe, expect, it } from 'vitest'
import type { Member } from '@/lib/sync/db'
import { filterBySearch } from '../filter'

const members = [
  { id: 'member-1', name: 'Ana García', phone: '555-1234', email: 'Ana@Example.com' },
  { id: 'member-2', name: 'Carlos López', phone: '555-5678', email: 'carlos@example.com' },
  { id: 'member-3', name: 'Ana Martínez', phone: '111-9999', email: 'ana.martinez@test.com' },
] as Member[]

describe('filterBySearch', () => {
  it('matches by name case-insensitive', () => {
    const result = filterBySearch(members, 'ana')

    expect(result.map((member) => member.id)).toEqual(['member-1', 'member-3'])
  })

  it('matches by phone substring', () => {
    const result = filterBySearch(members, '555')

    expect(result.map((member) => member.id)).toEqual(['member-1', 'member-2'])
  })

  it('matches by email case-insensitive', () => {
    const result = filterBySearch(members, 'ANA@')

    expect(result.map((member) => member.id)).toEqual(['member-1'])
  })

  it('matches across phone and email fields', () => {
    const results = filterBySearch(
      [
        { id: 'phone-match', name: 'Ana', phone: '555-1234', email: 'ana@example.com' },
        { id: 'email-match', name: 'Bob', phone: '111-9999', email: 'bob@555.com' },
        { id: 'no-match', name: 'Carlos', phone: '222-0000', email: 'carlos@example.com' },
      ] as Member[],
      '555',
    )

    expect(results.map((member) => member.id)).toEqual(['phone-match', 'email-match'])
  })

  it('returns all members on an empty query', () => {
    expect(filterBySearch(members, '')).toEqual(members)
  })
})
