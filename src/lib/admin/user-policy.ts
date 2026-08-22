import type { AppRole } from '@/lib/rbac/types'

export class AdminUserPolicyError extends Error {
  readonly code: 'invalid_input' | 'self_demote' | 'self_deactivate' | 'self_delete'

  constructor(code: AdminUserPolicyError['code'], message: string) {
    super(message)
    this.name = 'AdminUserPolicyError'
    this.code = code
  }
}

export interface CreateUserInput {
  full_name: string
  email: string
  password: string
  role: AppRole
}

export interface UpdateUserPatch {
  full_name?: string
  role?: AppRole
  is_active?: boolean
}

const APP_ROLES: readonly AppRole[] = ['super_admin', 'leader', 'server']

function isAppRole(value: unknown): value is AppRole {
  return typeof value === 'string' && (APP_ROLES as readonly string[]).includes(value)
}

export function parseCreateUserInput(input: unknown): CreateUserInput {
  if (input === null || typeof input !== 'object') {
    throw new AdminUserPolicyError('invalid_input', 'Invalid create-user payload')
  }

  const body = input as Record<string, unknown>
  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!fullName) {
    throw new AdminUserPolicyError('invalid_input', 'Full name is required')
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AdminUserPolicyError('invalid_input', 'A valid email is required')
  }
  if (password.length < 8) {
    throw new AdminUserPolicyError('invalid_input', 'Password must be at least 8 characters')
  }
  if (!isAppRole(body.role)) {
    throw new AdminUserPolicyError('invalid_input', 'Role must be super_admin, leader, or server')
  }

  return { full_name: fullName, email, password, role: body.role }
}

export function parseUpdateUserPatch(input: unknown): UpdateUserPatch {
  if (input === null || typeof input !== 'object') {
    throw new AdminUserPolicyError('invalid_input', 'Invalid update-user payload')
  }

  const body = input as Record<string, unknown>
  const patch: UpdateUserPatch = {}

  if ('full_name' in body) {
    const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : ''
    if (!fullName) {
      throw new AdminUserPolicyError('invalid_input', 'Full name is required')
    }
    patch.full_name = fullName
  }
  if ('role' in body) {
    if (!isAppRole(body.role)) {
      throw new AdminUserPolicyError('invalid_input', 'Role must be super_admin, leader, or server')
    }
    patch.role = body.role
  }
  if ('is_active' in body) {
    if (typeof body.is_active !== 'boolean') {
      throw new AdminUserPolicyError('invalid_input', 'is_active must be a boolean')
    }
    patch.is_active = body.is_active
  }
  if (patch.full_name === undefined && patch.role === undefined && patch.is_active === undefined) {
    throw new AdminUserPolicyError('invalid_input', 'No updatable fields provided')
  }

  return patch
}

export function assertCanUpdateUser(
  actorId: string,
  targetId: string,
  patch: UpdateUserPatch,
): void {
  if (actorId !== targetId) {
    return
  }
  if (patch.role !== undefined && patch.role !== 'super_admin') {
    throw new AdminUserPolicyError('self_demote', 'Self-demotion is not allowed')
  }
  if (patch.is_active === false) {
    throw new AdminUserPolicyError('self_deactivate', 'Cannot deactivate your own account')
  }
}

export function assertCanDeleteUser(actorId: string, targetId: string): void {
  if (actorId === targetId) {
    throw new AdminUserPolicyError('self_delete', 'Cannot delete your own account')
  }
}
