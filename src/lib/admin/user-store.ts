import { createClient } from '@supabase/supabase-js'
import type { AdminUserStore, AuthUserPatch } from './user-service'
import type { CreateUserInput, UpdateUserPatch } from './user-policy'

export class AdminUserStoreError extends Error {
  readonly code: 'conflict' | 'auth_failed'

  constructor(code: AdminUserStoreError['code'], message: string) {
    super(message)
    this.name = 'AdminUserStoreError'
    this.code = code
  }
}

export const CONFLICT_EMAIL_MESSAGE_ES = 'Ya existe una cuenta registrada con ese correo electrónico.'

const DUPLICATE_EMAIL_MESSAGE = /already registered|user_already_exists/i

/**
 * GoTrue admin createUser signals a duplicate email with "User already registered"
 * (HTTP 422). parseCreateUserInput already rejects short passwords / malformed
 * emails (400) before GoTrue is called, so a 422 at this call site is not a
 * password/format validation failure; those phrasings are excluded anyway.
 */
export function isDuplicateEmailAuthError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  const { message, code, status } = error as { message?: unknown; code?: unknown; status?: unknown }
  const messageText = typeof message === 'string' ? message : ''
  if (DUPLICATE_EMAIL_MESSAGE.test(messageText)) return true
  if (code === 'user_already_exists') return true
  if (/password/i.test(messageText)) return false
  return code === '422' || status === 422
}

export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new AdminUserStoreError('auth_failed', 'Server is missing SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export function createSupabaseAdminStore(): AdminUserStore {
  const admin = createServiceRoleClient()

  return {
    async createAuthUser(input: CreateUserInput) {
      const { data, error } = await admin.auth.admin.createUser({
        email: input.email,
        password: input.password,
        email_confirm: true,
        user_metadata: { full_name: input.full_name },
        app_metadata: { role: input.role },
      })
      if (error || !data.user) {
        if (isDuplicateEmailAuthError(error)) {
          throw new AdminUserStoreError('conflict', CONFLICT_EMAIL_MESSAGE_ES)
        }
        throw new AdminUserStoreError('auth_failed', error?.message ?? 'Could not create auth user')
      }
      return { id: data.user.id }
    },

    async updateAuthUser(userId: string, patch: AuthUserPatch) {
      const { data: existing, error: loadError } = await admin.auth.admin.getUserById(userId)
      if (loadError || !existing.user) {
        throw new AdminUserStoreError('auth_failed', loadError?.message ?? 'User not found')
      }

      const { error } = await admin.auth.admin.updateUserById(userId, {
        user_metadata: patch.full_name
          ? { ...existing.user.user_metadata, full_name: patch.full_name }
          : existing.user.user_metadata,
        app_metadata: patch.role
          ? { ...existing.user.app_metadata, role: patch.role }
          : existing.user.app_metadata,
        ban_duration: patch.banned === undefined ? undefined : patch.banned ? '876000h' : 'none',
      })
      if (error) {
        throw new AdminUserStoreError('auth_failed', error.message)
      }
    },

    async deleteAuthUser(userId: string) {
      const { error } = await admin.auth.admin.deleteUser(userId)
      if (!error) return
      if (error.message.includes('foreign key') || error.code === '23503') {
        throw new AdminUserStoreError(
          'conflict',
          'Cannot delete this user while related records exist. Deactivate the account instead.',
        )
      }
      throw new AdminUserStoreError('auth_failed', error.message)
    },

    async upsertProfile(userId: string, patch: UpdateUserPatch) {
      const { error } = await admin
        .from('profiles')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', userId)
      if (error) {
        if (error.code === '23503') {
          throw new AdminUserStoreError('conflict', error.message)
        }
        throw new AdminUserStoreError('auth_failed', error.message)
      }
    },
  }
}
