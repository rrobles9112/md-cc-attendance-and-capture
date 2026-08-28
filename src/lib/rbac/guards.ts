import type { AppRole, PermissionMap } from "./types";
import { getPermissions } from "./types";

export function hasPermission(
  role: AppRole,
  permission: keyof PermissionMap,
): boolean {
  return getPermissions(role)[permission];
}

export function canCreate(role: AppRole): boolean {
  return hasPermission(role, "canCreate");
}

export function canManageRetreatRegistrations(role: AppRole): boolean {
  return canCreate(role);
}

export function canModify(role: AppRole): boolean {
  return hasPermission(role, "canModify");
}

export function canDelete(role: AppRole): boolean {
  return hasPermission(role, "canDelete");
}

export function canHardDelete(role: AppRole): boolean {
  return hasPermission(role, "canHardDelete");
}

export function canMarkAttendance(role: AppRole): boolean {
  return hasPermission(role, "canMarkAttendance");
}

export function canManageUsers(role: AppRole): boolean {
  return hasPermission(role, "canManageUsers");
}

export function canViewAudit(role: AppRole): boolean {
  return hasPermission(role, "canViewAudit");
}

export function canExport(role: AppRole): boolean {
  return hasPermission(role, "canExport");
}

export function canManageARCO(role: AppRole): boolean {
  return hasPermission(role, "canManageARCO");
}

export function canViewPastoreo(role: AppRole): boolean {
  return role === "super_admin" || role === "leader";
}

/**
 * Ley 1581 transfer gate — leader+super_admin (same as canCreate).
 * Mirrors RPC `transfer_retreat_to_valientes` role gate (42501).
 */
export function canTransferRetreatToValientes(role: AppRole | null | undefined): boolean {
  if (!role) return false;
  return canCreate(role as AppRole);
}

export function canManageWhatsappSettings(role: AppRole): boolean {
  return role === "super_admin";
}

export function requirePermission(
  role: AppRole,
  permission: keyof PermissionMap,
): void {
  if (!hasPermission(role, permission)) {
    throw new Error(
      `Insufficient permissions: role '${role}' lacks '${permission}'`,
    );
  }
}

export function requireRole(role: AppRole, allowed: AppRole[]): void {
  if (!allowed.includes(role)) {
    throw new Error(
      `Insufficient permissions: role '${role}' not in [${allowed.join(", ")}]`,
    );
  }
}
