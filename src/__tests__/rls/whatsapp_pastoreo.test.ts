import { describe, it, expect } from "vitest";

/**
 * RLS contract tests for whatsapp-pastoreo-notifications (T-006 RED).
 * Mirrors supabase/tests/ pattern but as Vitest unit asserting policy file existence.
 * Real DB assertions run via supabase/tests/whatsapp_pastoreo_rls.test.sql.
 */
describe("whatsapp_pastoreo RLS contract", () => {
  it("notification_log SELECT policy exists and denies server/anon", async () => {
    // This will fail RED until migration 017 exists.
    // We assert the migration file is present and contains correct policy shape.
    const fs = await import("node:fs");
    const path = "supabase/migrations/017_whatsapp_pastoreo_rls.sql";
    const exists = fs.existsSync(path);
    expect(exists, "017 RLS migration must exist (RED → GREEN)").toBe(true);
    if (!exists) return;
    const sql = fs.readFileSync(path, "utf8");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("notification_log_select");
    expect(sql).toContain("TO authenticated");
    expect(sql).toContain("USING");
    expect(sql).toContain("super_admin");
    expect(sql).toContain("leader");
    expect(sql).toContain("REVOKE ALL");
  });

  it("notification_log has no INSERT/UPDATE for authenticated (service_role only)", async () => {
    const fs = await import("node:fs");
    const path = "supabase/migrations/017_whatsapp_pastoreo_rls.sql";
    if (!fs.existsSync(path)) return expect(true).toBe(false);
    const sql = fs.readFileSync(path, "utf8");
    // No INSERT/UPDATE policies for authenticated on notification_log
    expect(sql).not.toMatch(
      /CREATE POLICY[\s\S]*notification_log[\s\S]*FOR (INSERT|UPDATE)[\s\S]*TO authenticated/,
    );
  });

  it("app_settings UPDATE whatsapp_% denied for leader (only super_admin)", async () => {
    const fs = await import("node:fs");
    const path = "supabase/migrations/017_whatsapp_pastoreo_rls.sql";
    if (!fs.existsSync(path)) return expect(true).toBe(false);
    const sql = fs.readFileSync(path, "utf8");
    // app_settings RLS update policy should restrict whatsapp keys to super_admin
    // Existing 001 has generic super_admin update — we check no leader bypass added
    expect(sql).not.toContain(
      "TO authenticated USING ((SELECT public.user_role()) IN ('leader'",
    );
  });
});
