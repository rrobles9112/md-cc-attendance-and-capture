export type AppRole = 'super_admin' | 'leader' | 'server'

export interface PermissionMap {
  canCreate: boolean
  canModify: boolean
  canDelete: boolean
  canHardDelete: boolean
  canMarkAttendance: boolean
  canManageUsers: boolean
  canViewAudit: boolean
  canExport: boolean
  canManageARCO: boolean
}

const ROLE_PERMISSIONS: Record<AppRole, PermissionMap> = {
  super_admin: {
    canCreate: true,
    canModify: true,
    canDelete: true,
    canHardDelete: true,
    canMarkAttendance: true,
    canManageUsers: true,
    canViewAudit: true,
    canExport: true,
    canManageARCO: true,
  },
  leader: {
    canCreate: true,
    canModify: false,
    canDelete: false,
    canHardDelete: false,
    canMarkAttendance: true,
    canManageUsers: false,
    canViewAudit: false,
    canExport: true,
    canManageARCO: false,
  },
  server: {
    canCreate: false,
    canModify: false,
    canDelete: false,
    canHardDelete: false,
    canMarkAttendance: true,
    canManageUsers: false,
    canViewAudit: false,
    canExport: false,
    canManageARCO: false,
  },
}

export function getPermissions(role: AppRole): PermissionMap {
  return ROLE_PERMISSIONS[role]
}
