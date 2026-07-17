import type { AppRole, PermissionMap } from './types'
import { getPermissions } from './types'

export function hasPermission(role: AppRole, permission: keyof PermissionMap): boolean {
  return getPermissions(role)[permission]
}

export function canCreate(role: AppRole): boolean {
  return hasPermission(role, 'canCreate')
}

export function canModify(role: AppRole): boolean {
  return hasPermission(role, 'canModify')
}

export function canDelete(role: AppRole): boolean {
  return hasPermission(role, 'canDelete')
}

export function canHardDelete(role: AppRole): boolean {
  return hasPermission(role, 'canHardDelete')
}

export function canMarkAttendance(role: AppRole): boolean {
  return hasPermission(role, 'canMarkAttendance')
}

export function canManageUsers(role: AppRole): boolean {
  return hasPermission(role, 'canManageUsers')
}

export function canViewAudit(role: AppRole): boolean {
  return hasPermission(role, 'canViewAudit')
}

export function canExport(role: AppRole): boolean {
  return hasPermission(role, 'canExport')
}

export function canManageARCO(role: AppRole): boolean {
  return hasPermission(role, 'canManageARCO')
}

export function requirePermission(role: AppRole, permission: keyof PermissionMap): void {
  if (!hasPermission(role, permission)) {
    throw new Error(`Insufficient permissions: role '${role}' lacks '${permission}'`)
  }
}

export function requireRole(role: AppRole, allowed: AppRole[]): void {
  if (!allowed.includes(role)) {
    throw new Error(`Insufficient permissions: role '${role}' not in [${allowed.join(', ')}]`)
  }
}
