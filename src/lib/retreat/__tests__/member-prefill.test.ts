import { describe, expect, it } from "vitest";
import {
  getMissingRetreatMemberFields,
  memberToCaptureInitialValues,
} from "../member-prefill";
import {
  findMatchingActiveMemberForTransfer,
  normalizeColombianPhoneDigits,
} from "../transfer";

describe("normalizeColombianPhoneDigits", () => {
  it("normalizes +57 and 10-digit Colombian numbers to identical 10-digit strings", () => {
    expect(normalizeColombianPhoneDigits("+57 300-123-4567")).toBe("3001234567");
    expect(normalizeColombianPhoneDigits("573001234567")).toBe("3001234567");
    expect(normalizeColombianPhoneDigits("300 123 4567")).toBe("3001234567");
    expect(normalizeColombianPhoneDigits("")).toBe("");
  });
});

describe("findMatchingActiveMemberForTransfer", () => {
  const candidates = [
    {
      id: "member-1",
      name: "Juan Valiente",
      email: "juan@example.com",
      phone: "+573001234567",
      pastoral_group: "Valientes",
    },
    {
      id: "member-2",
      name: "María Asamblea",
      email: "maria@example.com",
      phone: "+573109998877",
      pastoral_group: null,
    },
  ];

  it("matches by 10-digit preinscrito phone against +57 member phone", () => {
    const match = findMatchingActiveMemberForTransfer(
      {
        email: "otro-correo@example.com",
        phone: "3001234567",
        member_id: null,
      },
      candidates,
    );
    expect(match).toEqual({
      id: "member-1",
      name: "Juan Valiente",
      isAlreadyLinked: false,
      isAlreadyValientes: true,
    });
  });

  it("identifies already linked member by member_id", () => {
    const match = findMatchingActiveMemberForTransfer(
      {
        email: "maria@example.com",
        phone: "3109998877",
        member_id: "member-2",
      },
      candidates,
    );
    expect(match).toEqual({
      id: "member-2",
      name: "María Asamblea",
      isAlreadyLinked: true,
      isAlreadyValientes: false,
    });
  });

  it("returns null when neither email nor normalized phone matches", () => {
    const match = findMatchingActiveMemberForTransfer(
      {
        email: "nuevo@example.com",
        phone: "3200000000",
        member_id: null,
      },
      candidates,
    );
    expect(match).toBeNull();
  });
});

describe("memberToCaptureInitialValues & getMissingRetreatMemberFields (2d)", () => {
  it("maps all stored member fields including medical and emergency contact", () => {
    const values = memberToCaptureInitialValues(
      {
        name: "Ana Pérez",
        phone: "+573001234567",
        email: "ana@example.com",
        birthday: "2002-04-10",
        is_minor: false,
        legal_rep_name: undefined,
        has_whatsapp: true,
        emergency_contact_name: "Rosa Pérez",
        emergency_contact_relationship: "madre",
        emergency_contact_phone: "3009991122",
        has_medical_conditions: true,
        medical_conditions: "Asma",
        medical_medications: "Salbutamol",
        medical_dosage: "2 puff cada 8h",
      },
      [{ number: "+573005556677", is_primary_phone: false }],
    );

    expect(values).toEqual({
      name: "Ana Pérez",
      phone: "+573001234567",
      email: "ana@example.com",
      birthday: "2002-04-10",
      isMinor: false,
      legalRepName: "",
      hasWhatsapp: true,
      additionalWhatsapp: "+573005556677",
      hasMedicalConditions: true,
      medicalConditions: "Asma",
      medicalMedications: "Salbutamol",
      medicalDosage: "2 puff cada 8h",
      emergencyContactName: "Rosa Pérez",
      emergencyContactRelationship: "madre",
      emergencyContactPhone: "3009991122",
    });
  });

  it("reports missing optional/required fields when member lacks health or emergency contact", () => {
    const missing = getMissingRetreatMemberFields({
      birthday: undefined,
      is_minor: true,
      legal_rep_name: "",
      emergency_contact_name: "",
      emergency_contact_relationship: "",
      emergency_contact_phone: "",
      has_medical_conditions: false,
      medical_conditions: "",
    });

    expect(missing).toEqual([
      "Fecha de nacimiento",
      "Representante legal",
      "Contacto de emergencia",
      "Salud / condiciones médicas (si aplica)",
    ]);
  });
});
