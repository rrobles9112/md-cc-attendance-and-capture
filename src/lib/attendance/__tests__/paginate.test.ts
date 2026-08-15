import { describe, expect, it } from 'vitest'
import type { Member } from '@/lib/sync/db'
import { PAGE_SIZE, paginateMembers } from '../paginate'

const members = Array.from({ length: 75 }, (_, index) => ({
  id: `member-${index + 1}`,
  name: `Member ${index + 1}`,
})) as Member[]

describe('paginateMembers', () => {
  it('returns the first PAGE_SIZE members', () => {
    const result = paginateMembers(members, PAGE_SIZE)

    expect(result).toHaveLength(PAGE_SIZE)
    expect(result[0]?.id).toBe('member-1')
    expect(result.at(-1)?.id).toBe('member-50')
  })

  it('returns all members when fewer than PAGE_SIZE exist', () => {
    const fewerMembers = members.slice(0, 30)

    expect(paginateMembers(fewerMembers, PAGE_SIZE)).toEqual(fewerMembers)
  })

  it('returns members when visibleCount is greater than the member list length', () => {
    const fewerMembers = members.slice(0, 30)

    expect(paginateMembers(fewerMembers, PAGE_SIZE * 2)).toEqual(fewerMembers)
  })
})
