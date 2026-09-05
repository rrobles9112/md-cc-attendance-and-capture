import { describe, it, expect } from "vitest";
import {
  hasPermission,
  canCreate,
  canModify,
  canDelete,
  canHardDelete,
  canMarkAttendance,
  canManageUsers,
  canViewAudit,
  canExport,
  canManageARCO,
  canManageRetreatRegistrations,
  canManageAttendanceSessions,
  canRecordRetreatPayments,
  canDeleteRetreatRegistration,
  canViewPastoreo,
  canManageWhatsappSettings,
  requirePermission,
  requireRole,
} from "../guards";
import type { AppRole } from "../types";

describe("RBAC Guards", () => {
  describe("super_admin permissions", () => {
    const role: AppRole = "super_admin";

    it("canCreate returns true", () => {
      expect(canCreate(role)).toBe(true);
    });

    it("canModify returns true", () => {
      expect(canModify(role)).toBe(true);
    });

    it("canDelete returns true", () => {
      expect(canDelete(role)).toBe(true);
    });

    it("canHardDelete returns true", () => {
      expect(canHardDelete(role)).toBe(true);
    });

    it("canMarkAttendance returns true", () => {
      expect(canMarkAttendance(role)).toBe(true);
    });

    it("canManageUsers returns true", () => {
      expect(canManageUsers(role)).toBe(true);
    });

    it("canViewAudit returns true", () => {
      expect(canViewAudit(role)).toBe(true);
    });

    it("canExport returns true", () => {
      expect(canExport(role)).toBe(true);
    });

    it("canManageARCO returns true", () => {
      expect(canManageARCO(role)).toBe(true);
    });

    it("has all permissions", () => {
      const permissions = [
        "canCreate",
        "canModify",
        "canDelete",
        "canHardDelete",
        "canMarkAttendance",
        "canManageUsers",
        "canViewAudit",
        "canExport",
        "canManageARCO",
      ] as const;
      for (const perm of permissions) {
        expect(hasPermission(role, perm)).toBe(true);
      }
    });
  });

  describe("leader permissions", () => {
    const role: AppRole = "leader";

    it("canCreate returns true", () => {
      expect(canCreate(role)).toBe(true);
    });

    it("canModify returns false", () => {
      expect(canModify(role)).toBe(false);
    });

    it("canDelete returns false", () => {
      expect(canDelete(role)).toBe(false);
    });

    it("canHardDelete returns false", () => {
      expect(canHardDelete(role)).toBe(false);
    });

    it("canMarkAttendance returns true", () => {
      expect(canMarkAttendance(role)).toBe(true);
    });

    it("canManageUsers returns false", () => {
      expect(canManageUsers(role)).toBe(false);
    });

    it("canViewAudit returns false", () => {
      expect(canViewAudit(role)).toBe(false);
    });

    it("canExport returns true", () => {
      expect(canExport(role)).toBe(true);
    });

    it("canManageARCO returns false", () => {
      expect(canManageARCO(role)).toBe(false);
    });
  });

  describe("server permissions", () => {
    const role: AppRole = "server";

    it("canCreate returns false", () => {
      expect(canCreate(role)).toBe(false);
    });

    it("canModify returns false", () => {
      expect(canModify(role)).toBe(false);
    });

    it("canDelete returns false", () => {
      expect(canDelete(role)).toBe(false);
    });

    it("canHardDelete returns false", () => {
      expect(canHardDelete(role)).toBe(false);
    });

    it("canMarkAttendance returns true", () => {
      expect(canMarkAttendance(role)).toBe(true);
    });

    it("canManageUsers returns false", () => {
      expect(canManageUsers(role)).toBe(false);
    });

    it("canViewAudit returns false", () => {
      expect(canViewAudit(role)).toBe(false);
    });

    it("canExport returns false", () => {
      expect(canExport(role)).toBe(false);
    });

    it("canManageARCO returns false", () => {
      expect(canManageARCO(role)).toBe(false);
    });

    it("only has canMarkAttendance", () => {
      expect(hasPermission(role, "canMarkAttendance")).toBe(true);
      expect(hasPermission(role, "canCreate")).toBe(false);
      expect(hasPermission(role, "canDelete")).toBe(false);
    });
  });

  describe("canManageRetreatRegistrations", () => {
    it("is true for super_admin (retreat module open to all staff roles)", () => {
      expect(canManageRetreatRegistrations("super_admin")).toBe(true);
    });

    it("is true for leader", () => {
      expect(canManageRetreatRegistrations("leader")).toBe(true);
    });

    it("is true for server (preinscriptions open to every staff role per product decision)", () => {
      expect(canManageRetreatRegistrations("server")).toBe(true);
    });
  });

  describe("canManageAttendanceSessions", () => {
    it("is true for super_admin only (create/edit/delete sessions)", () => {
      expect(canManageAttendanceSessions("super_admin")).toBe(true);
    });

    it("is false for leader", () => {
      expect(canManageAttendanceSessions("leader")).toBe(false);
    });

    it("is false for server", () => {
      expect(canManageAttendanceSessions("server")).toBe(false);
    });
  });

  describe("canRecordRetreatPayments", () => {
    it("is true for super_admin (mirrors retreat_payments RLS)", () => {
      expect(canRecordRetreatPayments("super_admin")).toBe(true);
    });

    it("is true for leader", () => {
      expect(canRecordRetreatPayments("leader")).toBe(true);
    });

    it("is false for server (sees the retreat module but not payments)", () => {
      expect(canRecordRetreatPayments("server")).toBe(false);
    });
  });

  describe("canDeleteRetreatRegistration", () => {
    it.each(["super_admin", "leader"] as const)("returns true for %s", (role) => {
      expect(canDeleteRetreatRegistration(role)).toBe(true)
    })

    // NOTE: AppRole union is only 'super_admin' | 'leader' | 'server'
    // (src/lib/rbac/types.ts) — the negative list is just `server`.
    it.each(["server"] as const)("returns false for %s", (role) => {
      expect(canDeleteRetreatRegistration(role)).toBe(false)
    })
  })

  describe("requirePermission", () => {
    it("does not throw when permission exists", () => {
      expect(() => requirePermission("super_admin", "canDelete")).not.toThrow();
    });

    it("throws when permission is missing", () => {
      expect(() => requirePermission("leader", "canDelete")).toThrow(
        "Insufficient permissions: role 'leader' lacks 'canDelete'",
      );
    });

    it("throws when server tries to create", () => {
      expect(() => requirePermission("server", "canCreate")).toThrow();
    });
  });

  describe("requireRole", () => {
    it("does not throw when role is allowed", () => {
      expect(() =>
        requireRole("super_admin", ["super_admin", "leader"]),
      ).not.toThrow();
    });

    it("throws when role is not allowed", () => {
      expect(() => requireRole("server", ["super_admin", "leader"])).toThrow(
        "Insufficient permissions: role 'server' not in [super_admin, leader]",
      );
    });
  });

  describe("canViewPastoreo (PR1 — T-005 RED)", () => {
    it("super_admin can view pastoreo", () => {
      expect(canViewPastoreo("super_admin")).toBe(true);
    });

    it("leader can view pastoreo", () => {
      expect(canViewPastoreo("leader")).toBe(true);
    });

    it("server cannot view pastoreo", () => {
      expect(canViewPastoreo("server")).toBe(false);
    });

    it("anon-like check: non-privileged role cannot view pastoreo (server is anon proxy)", () => {
      // server is the lowest authenticated role; anon has no DB row — both denied
      expect(canViewPastoreo("server")).toBe(false);
    });
  });

  describe("canManageWhatsappSettings (PR1)", () => {
    it("super_admin can manage whatsapp settings", () => {
      expect(canManageWhatsappSettings("super_admin")).toBe(true);
    });

    it("leader cannot manage whatsapp settings", () => {
      expect(canManageWhatsappSettings("leader")).toBe(false);
    });

    it("server cannot manage whatsapp settings", () => {
      expect(canManageWhatsappSettings("server")).toBe(false);
    });
  });
});
