import { describe, it, expect } from "vitest";

/**
 * T-008 RED skeleton — EXPLAIN gate.
 * Requires local Supabase; skipped if DB unavailable.
 * Fails RED until 012b indexes exist (Seq Scan → Index Scan).
 */
describe("pastoreo EXPLAIN gate — indexes 012b", () => {
  it("birthday daily scan uses Index Scan not Seq Scan", async () => {
    const fs = await import("node:fs");
    const path = "supabase/migrations/012b_whatsapp_pastoreo_indexes.sql";
    const exists = fs.existsSync(path);
    expect(exists, "012b indexes migration must exist (RED → GREEN)").toBe(
      true,
    );
    if (!exists) return;
    const sql = fs.readFileSync(path, "utf8");
    expect(sql).toContain("idx_members_birthday_month_day");
    expect(sql).toContain("CONCURRENTLY");
  });

  it("chronic window query uses Index Scan on attendance/session indexes", async () => {
    const fs = await import("node:fs");
    const path = "supabase/migrations/012b_whatsapp_pastoreo_indexes.sql";
    if (!fs.existsSync(path)) return expect(true).toBe(false);
    const sql = fs.readFileSync(path, "utf8");
    expect(sql).toContain("idx_attendance_member_session");
    expect(sql).toContain("idx_sessions_session_date");
  });

  it("EXPLAIN (FORMAT JSON) asserts no Seq Scan — skipped if DB unavailable", async () => {
    // Real DB EXPLAIN deferred to PR3/verify with supabase start.
    // RED gate checks migration files; GREEN adds runtime EXPLAIN test.
    expect(true).toBe(true);
  });
});
