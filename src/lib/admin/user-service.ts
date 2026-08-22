import {
  AdminUserPolicyError,
  assertCanDeleteUser,
  assertCanUpdateUser,
  type CreateUserInput,
  type UpdateUserPatch,
} from './user-policy'

export interface AuthUserPatch {
  full_name?: string
  role?: CreateUserInput['role']
  banned?: boolean
}

export interface AdminUserStore {
  createAuthUser(input: CreateUserInput): Promise<{ id: string }>
  updateAuthUser(userId: string, patch: AuthUserPatch): Promise<void>
  deleteAuthUser(userId: string): Promise<void>
  upsertProfile(userId: string, patch: UpdateUserPatch & { is_active?: boolean }): Promise<void>
}

export async function createManagedUser(
  store: AdminUserStore,
  input: CreateUserInput,
): Promise<{ id: string }> {
  const created = await store.createAuthUser(input)
  await store.upsertProfile(created.id, {
    full_name: input.full_name,
    role: input.role,
    is_active: true,
  })
  return created
}

export async function updateManagedUser(
  store: AdminUserStore,
  actorId: string,
  targetId: string,
  patch: UpdateUserPatch,
): Promise<void> {
  assertCanUpdateUser(actorId, targetId, patch)

  const authPatch: AuthUserPatch = {}
  if (patch.full_name !== undefined) authPatch.full_name = patch.full_name
  if (patch.role !== undefined) authPatch.role = patch.role
  if (patch.is_active !== undefined) authPatch.banned = !patch.is_active

  if (Object.keys(authPatch).length > 0) {
    await store.updateAuthUser(targetId, authPatch)
  }
  await store.upsertProfile(targetId, patch)
}

export async function deleteManagedUser(
  store: AdminUserStore,
  actorId: string,
  targetId: string,
): Promise<void> {
  assertCanDeleteUser(actorId, targetId)
  await store.deleteAuthUser(targetId)
}

export { AdminUserPolicyError }
