import { describe, expect, it } from "vitest"
import {
  applyRetreatRegistrationUpdate,
  buildRetreatRegistrationUpdate,
  mapRetreatUpdateError,
} from "../update"

describe("buildRetreatRegistrationUpdate", () => {
  it("builds a payload for super_admin preinscription edits", () => {
    const result = buildRetreatRegistrationUpdate({
      name: "  Ana Pérez  ",
      phone: " 3001234567 ",
      email: " Ana@Example.com ",
      birthday: "2000-01-15",
      legalRepName: "",
      hasWhatsapp: true,
      whatsappNumber: " 3009998877 ",
      hasMedicalConditions: true,
      medicalConditions: "  Asma ",
      medicalMedications: " Salbutamol ",
      medicalDosage: " Cada 8 horas ",
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.payload).toEqual({
      name: "Ana Pérez",
      phone: "3001234567",
      email: "ana@example.com",
      birthday: "2000-01-15",
      is_minor: false,
      legal_rep_name: null,
      has_whatsapp: true,
      whatsapp_number: "3009998877",
      has_medical_conditions: true,
      medical_conditions: "Asma",
      medical_medications: "Salbutamol",
      medical_dosage: "Cada 8 horas",
    })
  })

  it("requires legal representative for minors", () => {
    const result = buildRetreatRegistrationUpdate({
      name: "Niño",
      phone: "3001111111",
      email: "nino@example.com",
      birthday: "2014-06-15",
      legalRepName: "  ",
      hasWhatsapp: false,
      whatsappNumber: "",
      hasMedicalConditions: false,
      medicalConditions: "",
      medicalMedications: "",
      medicalDosage: "",
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/representante legal/i)
  })

  it("rejects empty identity fields", () => {
    const result = buildRetreatRegistrationUpdate({
      name: " ",
      phone: "3001111111",
      email: "ana@example.com",
      birthday: "",
      legalRepName: "",
      hasWhatsapp: false,
      whatsappNumber: "",
      hasMedicalConditions: false,
      medicalConditions: "",
      medicalMedications: "",
      medicalDosage: "",
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/nombre|obligatori/i)
  })

  it("stores empty WhatsApp number as null", () => {
    const result = buildRetreatRegistrationUpdate({
      name: "Ana",
      phone: "3001111111",
      email: "ana@example.com",
      birthday: "",
      legalRepName: "",
      hasWhatsapp: false,
      whatsappNumber: "   ",
      hasMedicalConditions: false,
      medicalConditions: "",
      medicalMedications: "",
      medicalDosage: "",
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.payload.whatsapp_number).toBeNull()
    expect(result.payload.birthday).toBeNull()
    expect(result.payload.is_minor).toBe(false)
  })

  it("requires medical conditions detail when the flag is set", () => {
    const result = buildRetreatRegistrationUpdate({
      name: "Ana",
      phone: "3001111111",
      email: "ana@example.com",
      birthday: "",
      legalRepName: "",
      hasWhatsapp: false,
      whatsappNumber: "",
      hasMedicalConditions: true,
      medicalConditions: "   ",
      medicalMedications: "",
      medicalDosage: "",
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/condiciones m/i)
  })

  it("stores null medical details when the flag is not set", () => {
    const result = buildRetreatRegistrationUpdate({
      name: "Ana",
      phone: "3001111111",
      email: "ana@example.com",
      birthday: "",
      legalRepName: "",
      hasWhatsapp: false,
      whatsappNumber: "",
      hasMedicalConditions: false,
      medicalConditions: "Asma",
      medicalMedications: "Salbutamol",
      medicalDosage: "Cada 8 horas",
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.payload.has_medical_conditions).toBe(false)
    expect(result.payload.medical_conditions).toBeNull()
    expect(result.payload.medical_medications).toBeNull()
    expect(result.payload.medical_dosage).toBeNull()
  })
})

describe("mapRetreatUpdateError", () => {
  it("maps unique violations to the duplicate preinscription message", () => {
    expect(mapRetreatUpdateError({ code: "23505", message: "duplicate key" })).toMatch(
      /Ya existe una preinscripción/i,
    )
  })

  it("maps permission denials", () => {
    expect(mapRetreatUpdateError({ code: "42501", message: "not_authorized" })).toMatch(
      /permisos/i,
    )
  })

  it("maps unknown errors to a generic Spanish message", () => {
    expect(mapRetreatUpdateError({ message: "boom" })).toMatch(/Error al actualizar/i)
  })
})

describe("applyRetreatRegistrationUpdate", () => {
  it("does not persist when validation fails", async () => {
    const persist = async () => {
      throw new Error("should not persist")
    }
    const result = await applyRetreatRegistrationUpdate(
      {
        name: " ",
        phone: "3001111111",
        email: "ana@example.com",
        birthday: "",
        legalRepName: "",
        hasWhatsapp: false,
        whatsappNumber: "",
        hasMedicalConditions: false,
        medicalConditions: "",
        medicalMedications: "",
        medicalDosage: "",
      },
      persist,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/nombre|obligatori/i)
  })

  it("persists a valid payload and succeeds when a row is returned", async () => {
    const result = await applyRetreatRegistrationUpdate(
      {
        name: "Ana Pérez",
        phone: "3001234567",
        email: "ana@example.com",
        birthday: "2000-01-15",
        legalRepName: "",
        hasWhatsapp: true,
        whatsappNumber: "",
        hasMedicalConditions: false,
        medicalConditions: "",
        medicalMedications: "",
        medicalDosage: "",
      },
      async (payload) => {
        expect(payload.email).toBe("ana@example.com")
        expect(payload.has_whatsapp).toBe(true)
        return { data: [{ id: "reg-1" }], error: null }
      },
    )
    expect(result).toEqual({ ok: true })
  })

  it("treats empty update results as a permission denial", async () => {
    const result = await applyRetreatRegistrationUpdate(
      {
        name: "Ana Pérez",
        phone: "3001234567",
        email: "ana@example.com",
        birthday: "",
        legalRepName: "",
        hasWhatsapp: false,
        whatsappNumber: "",
        hasMedicalConditions: false,
        medicalConditions: "",
        medicalMedications: "",
        medicalDosage: "",
      },
      async () => ({ data: [], error: null }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/permisos/i)
  })

  it("maps persist unique violations", async () => {
    const result = await applyRetreatRegistrationUpdate(
      {
        name: "Ana Pérez",
        phone: "3001234567",
        email: "ana@example.com",
        birthday: "",
        legalRepName: "",
        hasWhatsapp: false,
        whatsappNumber: "",
        hasMedicalConditions: false,
        medicalConditions: "",
        medicalMedications: "",
        medicalDosage: "",
      },
      async () => ({ data: null, error: { code: "23505", message: "duplicate key" } }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/Ya existe una preinscripción/i)
  })
})
