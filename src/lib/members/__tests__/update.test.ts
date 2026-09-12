import { describe, expect, it } from "vitest"
import { buildMemberUpdate } from "../update"

describe("buildMemberUpdate", () => {
  it("builds a payload for super_admin member edits", () => {
    const result = buildMemberUpdate({
      name: "  Ana Pérez  ",
      phone: " 3001234567 ",
      email: " Ana@Example.com ",
      birthday: "2000-01-15",
      legalRepName: "",
      hasWhatsapp: true,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.payload.name).toBe("Ana Pérez")
    expect(result.payload.name_normalized).toBe("ana perez")
    expect(result.payload.phone).toBe("3001234567")
    expect(result.payload.email).toBe("ana@example.com")
    expect(result.payload.birthday).toBe("2000-01-15")
    expect(result.payload.is_minor).toBe(false)
    expect(result.payload.legal_rep_name).toBeNull()
    expect(result.payload.has_whatsapp).toBe(true)
    expect(result.payload.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it("requires legal representative for minors", () => {
    const result = buildMemberUpdate({
      name: "Niño",
      phone: "3001111111",
      email: "nino@example.com",
      birthday: "2014-06-15",
      legalRepName: "  ",
      hasWhatsapp: false,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/representante legal/i)
  })

  it("rejects empty identity fields", () => {
    const result = buildMemberUpdate({
      name: " ",
      phone: "3001111111",
      email: "ana@example.com",
      birthday: "",
      legalRepName: "",
      hasWhatsapp: false,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/nombre|obligatori/i)
  })
})
