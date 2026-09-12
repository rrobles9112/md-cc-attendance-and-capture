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

/**
 * The retreat module listing is open to every staff role
 * (super_admin, leader, server). Mutations are super_admin-only.
 */
export function canManageRetreatRegistrations(role: AppRole): boolean {
  return role === "super_admin" || role === "leader" || role === "server";
}

/**
 * Create/update/delete/pay/transfer of retreat preinscriptions is exclusive
 * to super_admin. Listing stays on canManageRetreatRegistrations.
 */
export function canMutateRetreatPreinscriptions(role: AppRole): boolean {
  return role === "super_admin";
}

/**
 * Attendance sessions are managed exclusively by super_admin
 * (create/edit/delete), per product decision.
 */
export function canManageAttendanceSessions(role: AppRole): boolean {
  return role === "super_admin";
}

/**
 * Retreat payment recording mirrors the retreat_payments RLS policies
 * (super_admin only). Other staff can list preinscriptions but not mutate.
 */
export function canRecordRetreatPayments(role: AppRole): boolean {
  return canMutateRetreatPreinscriptions(role);
}

export function canDeleteRetreatRegistration(role: AppRole): boolean {
  return canMutateRetreatPreinscriptions(role);
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
 * Ley 1581 transfer gate — super_admin only.
 * Mirrors RPC `transfer_retreat_to_valientes` role gate (42501).
 */
export function canTransferRetreatToValientes(role: AppRole | null | undefined): boolean {
  if (!role) return false;
  return canMutateRetreatPreinscriptions(role);
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
