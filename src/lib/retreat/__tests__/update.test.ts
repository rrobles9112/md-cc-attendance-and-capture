import { describe, expect, it } from "vitest";
import {
  applyRetreatRegistrationUpdate,
  buildRetreatRegistrationUpdate,
  mapRetreatUpdateError,
} from "../update";

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
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
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
      denomination: null,
      community_name: null,
      sensitive_consent_accepted_at: null,
      sensitive_consent_policy_version: null,
    });
  });

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
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/representante legal/i);
  });

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
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/nombre|obligatori/i);
  });

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
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.whatsapp_number).toBeNull();
    expect(result.payload.birthday).toBeNull();
    expect(result.payload.is_minor).toBe(false);
  });

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
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/condiciones m/i);
  });

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
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.has_medical_conditions).toBe(false);
    expect(result.payload.medical_conditions).toBeNull();
    expect(result.payload.medical_medications).toBeNull();
    expect(result.payload.medical_dosage).toBeNull();
  });
});

describe("mapRetreatUpdateError", () => {
  it("maps unique violations to the duplicate preinscription message", () => {
    expect(
      mapRetreatUpdateError({ code: "23505", message: "duplicate key" }),
    ).toMatch(/Ya existe una preinscripción/i);
  });

  it("maps permission denials", () => {
    expect(
      mapRetreatUpdateError({ code: "42501", message: "not_authorized" }),
    ).toMatch(/permisos/i);
  });

  it("maps unknown errors to a generic Spanish message", () => {
    expect(mapRetreatUpdateError({ message: "boom" })).toMatch(
      /Error al actualizar/i,
    );
  });
});

describe("applyRetreatRegistrationUpdate", () => {
  it("does not persist when validation fails", async () => {
    const persist = async () => {
      throw new Error("should not persist");
    };
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
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/nombre|obligatori/i);
  });

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
        expect(payload.email).toBe("ana@example.com");
        expect(payload.has_whatsapp).toBe(true);
        return { data: [{ id: "reg-1" }], error: null };
      },
    );
    expect(result).toEqual({ ok: true });
  });

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
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/permisos/i);
  });

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
      async () => ({
        data: null,
        error: { code: "23505", message: "duplicate key" },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Ya existe una preinscripción/i);
  });
});

describe("buildRetreatRegistrationUpdate religious fields (PR3)", () => {
  const base = {
    name: "Ana Pérez",
    phone: "3001234567",
    email: "ana@example.com",
    birthday: "2000-01-15",
    legalRepName: "",
    hasWhatsapp: false,
    whatsappNumber: "",
    hasMedicalConditions: false,
    medicalConditions: "",
    medicalMedications: "",
    medicalDosage: "",
  };

  it("requires sensitive consent when new religious data is stored", () => {
    const result = buildRetreatRegistrationUpdate({
      ...base,
      denomination: "Católica",
      communityName: "San Pablo",
      sensitiveConsent: false,
      prevDenomination: null,
      prevCommunityName: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/consentimiento.*sensible/i);
  });

  it("stamps sensitive consent when new religious data is stored with consent", () => {
    const result = buildRetreatRegistrationUpdate({
      ...base,
      denomination: "  Católica ",
      communityName: " San Pablo ",
      sensitiveConsent: true,
      prevDenomination: null,
      prevCommunityName: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.denomination).toBe("Católica");
    expect(result.payload.community_name).toBe("San Pablo");
    expect(result.payload.sensitive_consent_accepted_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );
    expect(result.payload.sensitive_consent_policy_version).toBe(
      "pdtp-v1.0-2026-07-17",
    );
  });

  it("does not require consent when religious values are unchanged", () => {
    const result = buildRetreatRegistrationUpdate({
      ...base,
      denomination: "Católica",
      communityName: "San Pablo",
      sensitiveConsent: false,
      prevDenomination: "Católica",
      prevCommunityName: "San Pablo",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.denomination).toBe("Católica");
    expect(result.payload.sensitive_consent_accepted_at).toBeNull();
    expect(result.payload.sensitive_consent_policy_version).toBeNull();
  });

  it("clears religious data to null without consent when both are emptied", () => {
    const result = buildRetreatRegistrationUpdate({
      ...base,
      denomination: "  ",
      communityName: "",
      sensitiveConsent: false,
      prevDenomination: "Católica",
      prevCommunityName: "San Pablo",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.denomination).toBeNull();
    expect(result.payload.community_name).toBeNull();
  });
});
