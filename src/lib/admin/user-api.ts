import type { AppRole } from '@/lib/rbac/types'
import type { CreateUserInput, UpdateUserPatch } from '@/lib/admin/user-policy'

async function parseError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string }
    return body.error ?? `Request failed (${response.status})`
  } catch {
    return `Request failed (${response.status})`
  }
}

export async function createAdminUser(input: CreateUserInput): Promise<{ id: string }> {
  const response = await fetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<{ id: string }>
}

export async function updateAdminUser(
  userId: string,
  patch: UpdateUserPatch,
): Promise<void> {
  const response = await fetch('/api/admin/users', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: userId, ...patch }),
  })
  if (!response.ok) throw new Error(await parseError(response))
}

export async function deleteAdminUser(userId: string): Promise<void> {
  const response = await fetch(`/api/admin/users?id=${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  })
  if (!response.ok) throw new Error(await parseError(response))
}

export const ROLE_LABELS: Record<AppRole, string> = {
  super_admin: 'Super Admin',
  leader: 'Líder',
  server: 'Servidor',
}
