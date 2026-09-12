import { describe, expect, it } from "vitest"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

function latestMigrationMatching(needle: string): string | null {
  const dir = "supabase/migrations"
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql") && name.includes(needle))
    .sort()
  if (files.length === 0) return null
  return join(dir, files[files.length - 1])
}

describe("super_admin-only retreat mutation RLS contract", () => {
  it("adds a migration that restricts payment insert/delete and registration delete/update to super_admin", () => {
    const path = latestMigrationMatching("super_admin")
    expect(path, "additive migration restricting retreat mutations must exist").toBeTruthy()
    if (!path || !existsSync(path)) return
    const sql = readFileSync(path, "utf8")
    expect(sql).toContain("retreat_payments_insert")
    expect(sql).toContain("retreat_payments_delete")
    expect(sql).toContain("retreat_registrations_delete")
    expect(sql).toMatch(/user_role\(\)\)?\s*=\s*'super_admin'/)
    expect(sql).not.toMatch(
      /retreat_payments_insert[\s\S]{0,400}IN\s*\(\s*'super_admin'\s*,\s*'leader'/,
    )
  })

  it("tightens transfer and member-linked preinscription RPCs to super_admin", () => {
    const path = latestMigrationMatching("super_admin")
    expect(path).toBeTruthy()
    if (!path || !existsSync(path)) return
    const sql = readFileSync(path, "utf8")
    expect(sql).toContain("transfer_retreat_to_valientes")
    expect(sql).toContain("register_retreat_preinscription_for_member")
    expect(sql).toMatch(/not_authorized: super_admin required/)
  })
})
