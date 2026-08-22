import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminUserPolicyError } from '../user-policy'
import { createManagedUser, deleteManagedUser, updateManagedUser } from '../user-service'
import type { AdminUserStore } from '../user-service'

const ACTOR = 'actor-super-admin'

function createStore(): AdminUserStore & {
  createAuthUser: ReturnType<typeof vi.fn>
  updateAuthUser: ReturnType<typeof vi.fn>
  deleteAuthUser: ReturnType<typeof vi.fn>
  upsertProfile: ReturnType<typeof vi.fn>
} {
  return {
    createAuthUser: vi.fn().mockResolvedValue({ id: 'new-user' }),
    updateAuthUser: vi.fn().mockResolvedValue(undefined),
    deleteAuthUser: vi.fn().mockResolvedValue(undefined),
    upsertProfile: vi.fn().mockResolvedValue(undefined),
  }
}

describe('createManagedUser', () => {
  let store: ReturnType<typeof createStore>

  beforeEach(() => {
    store = createStore()
  })

  it('creates auth user with app_metadata.role and aligns the profile', async () => {
    const created = await createManagedUser(store, {
      full_name: 'Ana Leader',
      email: 'leader@church.com',
      password: 'secure-pass',
      role: 'leader',
    })

    expect(created).toEqual({ id: 'new-user' })
    expect(store.createAuthUser).toHaveBeenCalledWith({
      full_name: 'Ana Leader',
      email: 'leader@church.com',
      password: 'secure-pass',
      role: 'leader',
    })
    expect(store.upsertProfile).toHaveBeenCalledWith('new-user', {
      full_name: 'Ana Leader',
      role: 'leader',
      is_active: true,
    })
  })
})

describe('updateManagedUser', () => {
  let store: ReturnType<typeof createStore>

  beforeEach(() => {
    store = createStore()
  })

  it('syncs role to both auth app_metadata and profiles', async () => {
    await updateManagedUser(store, ACTOR, 'other-user', { role: 'server' })

    expect(store.updateAuthUser).toHaveBeenCalledWith('other-user', { role: 'server' })
    expect(store.upsertProfile).toHaveBeenCalledWith('other-user', { role: 'server' })
  })

  it('bans a deactivated account and unbans a reactivated one', async () => {
    await updateManagedUser(store, ACTOR, 'other-user', { is_active: false })
    expect(store.updateAuthUser).toHaveBeenCalledWith('other-user', { banned: true })
    expect(store.upsertProfile).toHaveBeenCalledWith('other-user', { is_active: false })

    await updateManagedUser(store, ACTOR, 'other-user', { is_active: true })
    expect(store.updateAuthUser).toHaveBeenCalledWith('other-user', { banned: false })
  })

  it('rejects self-demotion before touching the store', async () => {
    await expect(updateManagedUser(store, ACTOR, ACTOR, { role: 'leader' })).rejects.toBeInstanceOf(
      AdminUserPolicyError,
    )
    expect(store.updateAuthUser).not.toHaveBeenCalled()
    expect(store.upsertProfile).not.toHaveBeenCalled()
  })
})

describe('deleteManagedUser', () => {
  let store: ReturnType<typeof createStore>

  beforeEach(() => {
    store = createStore()
  })

  it('deletes another auth user', async () => {
    await deleteManagedUser(store, ACTOR, 'other-user')
    expect(store.deleteAuthUser).toHaveBeenCalledWith('other-user')
  })

  it('rejects self-delete before touching the store', async () => {
    await expect(deleteManagedUser(store, ACTOR, ACTOR)).rejects.toBeInstanceOf(AdminUserPolicyError)
    expect(store.deleteAuthUser).not.toHaveBeenCalled()
  })
})
