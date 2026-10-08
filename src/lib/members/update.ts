import { checkMinorStatus, validateMinorFields } from "@/lib/consent/validation";

export type MemberUpdateInput = {
  name: string;
  phone: string;
  email: string;
  birthday: string;
  legalRepName: string;
  hasWhatsapp: boolean;
  emergencyContactName?: string;
  emergencyContactRelationship?: string;
  emergencyContactPhone?: string;
};

export type MemberUpdatePayload = {
  name: string;
  name_normalized: string;
  phone: string;
  email: string;
  birthday: string | null;
  is_minor: boolean;
  legal_rep_name: string | null;
  has_whatsapp: boolean;
  emergency_contact_name: string | null;
  emergency_contact_relationship: string | null;
  emergency_contact_phone: string | null;
  updated_at: string;
};

export type MemberUpdateResult =
  | { ok: true; payload: MemberUpdatePayload }
  | { ok: false; error: string };

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

export function buildMemberUpdate(input: MemberUpdateInput): MemberUpdateResult {
  const name = input.name.trim();
  const phone = input.phone.trim();
  const email = input.email.trim().toLowerCase();

  if (!name) {
    return { ok: false, error: "El nombre es obligatorio" };
  }
  if (!phone) {
    return { ok: false, error: "El teléfono es obligatorio" };
  }
  if (!email) {
    return { ok: false, error: "El correo es obligatorio" };
  }

  const birthday = input.birthday.trim();
  const isMinor = birthday ? checkMinorStatus(new Date(birthday)).isMinor : false;
  const legalRep = input.legalRepName.trim();
  const minorCheck = validateMinorFields(isMinor, legalRep);
  if (!minorCheck.valid) {
    return { ok: false, error: minorCheck.error ?? "El representante legal es obligatorio" };
  }

  const emergencyName = (input.emergencyContactName ?? "").trim();
  const emergencyRelationship = (input.emergencyContactRelationship ?? "").trim();
  const emergencyPhone = (input.emergencyContactPhone ?? "").trim();
  const emergencyStarted =
    emergencyName !== "" ||
    emergencyRelationship !== "" ||
    emergencyPhone !== "";
  if (emergencyStarted) {
    if (emergencyName === "") {
      return { ok: false, error: "Indique el nombre del contacto de emergencia" };
    }
    if (emergencyRelationship === "") {
      return {
        ok: false,
        error: "Indique el parentesco del contacto de emergencia",
      };
    }
    if (emergencyPhone === "") {
      return {
        ok: false,
        error: "Indique el teléfono del contacto de emergencia",
      };
    }
  }

  return {
    ok: true,
    payload: {
      name,
      name_normalized: normalizeName(name),
      phone,
      email,
      birthday: birthday || null,
      is_minor: isMinor,
      legal_rep_name: isMinor ? legalRep : null,
      has_whatsapp: input.hasWhatsapp,
      emergency_contact_name: emergencyName || null,
      emergency_contact_relationship: emergencyRelationship || null,
      emergency_contact_phone: emergencyPhone || null,
      updated_at: new Date().toISOString(),
    },
  };
}
