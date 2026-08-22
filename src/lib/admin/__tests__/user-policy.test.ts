import { describe, expect, it } from 'vitest'
import {
  AdminUserPolicyError,
  assertCanDeleteUser,
  assertCanUpdateUser,
  parseCreateUserInput,
  parseUpdateUserPatch,
} from '../user-policy'

const ACTOR = 'actor-super-admin'
const OTHER = 'other-user'

describe('parseCreateUserInput', () => {
  it('accepts a complete create payload', () => {
    expect(
      parseCreateUserInput({
        full_name: '  Ana Leader  ',
        email: 'leader@church.com',
        password: 'secure-pass',
        role: 'leader',
      }),
    ).toEqual({
      full_name: 'Ana Leader',
      email: 'leader@church.com',
      password: 'secure-pass',
      role: 'leader',
    })
  })

  it('rejects missing name, invalid email, short password, and unknown role', () => {
    expect(() => parseCreateUserInput({ full_name: ' ', email: 'a@b.com', password: 'long-enough', role: 'leader' }))
      .toThrow(AdminUserPolicyError)
    expect(() => parseCreateUserInput({ full_name: 'Ana', email: 'not-an-email', password: 'long-enough', role: 'leader' }))
      .toThrow(AdminUserPolicyError)
    expect(() => parseCreateUserInput({ full_name: 'Ana', email: 'a@b.com', password: 'short', role: 'leader' }))
      .toThrow(AdminUserPolicyError)
    expect(() => parseCreateUserInput({ full_name: 'Ana', email: 'a@b.com', password: 'long-enough', role: 'admin' }))
      .toThrow(AdminUserPolicyError)
  })
})

describe('parseUpdateUserPatch', () => {
  it('accepts a role and deactivation patch', () => {
    expect(parseUpdateUserPatch({ role: 'server', is_active: false })).toEqual({
      role: 'server',
      is_active: false,
    })
  })

  it('rejects an empty patch', () => {
    expect(() => parseUpdateUserPatch({})).toThrow(AdminUserPolicyError)
  })
})

describe('assertCanUpdateUser', () => {
  it('allows a super_admin to edit another user including role and deactivation', () => {
    expect(() =>
      assertCanUpdateUser(ACTOR, OTHER, { role: 'server', is_active: false, full_name: 'Server One' }),
    ).not.toThrow()
  })

  it('blocks self-demotion', () => {
    expect(() => assertCanUpdateUser(ACTOR, ACTOR, { role: 'leader' })).toThrowError(
      /self-demotion is not allowed/i,
    )
  })

  it('blocks self-deactivation', () => {
    expect(() => assertCanUpdateUser(ACTOR, ACTOR, { is_active: false })).toThrowError(
      /cannot deactivate your own account/i,
    )
  })

  it('allows a super_admin to rename themselves without changing role', () => {
    expect(() => assertCanUpdateUser(ACTOR, ACTOR, { full_name: 'Same Admin' })).not.toThrow()
  })
})

describe('assertCanDeleteUser', () => {
  it('allows deleting another user', () => {
    expect(() => assertCanDeleteUser(ACTOR, OTHER)).not.toThrow()
  })

  it('blocks deleting the signed-in super_admin', () => {
    expect(() => assertCanDeleteUser(ACTOR, ACTOR)).toThrowError(/cannot delete your own account/i)
  })
})
