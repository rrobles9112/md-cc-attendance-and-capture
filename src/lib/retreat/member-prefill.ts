import type { CaptureFormInitialValues } from "@/components/forms/CaptureForm";
import type { Member, WhatsAppNumber } from "@/lib/sync/db";

/**
 * Converts an assembly Member (and optional additional WhatsApp rows) into
 * CaptureFormInitialValues for retreat preinscription so all captured member
 * fields are reused without re-entering or re-creating the member.
 */
export function memberToCaptureInitialValues(
  member: Pick<
    Member,
    | "name"
    | "phone"
    | "email"
    | "birthday"
    | "is_minor"
    | "legal_rep_name"
    | "has_whatsapp"
    | "emergency_contact_name"
    | "emergency_contact_relationship"
    | "emergency_contact_phone"
    | "has_medical_conditions"
    | "medical_conditions"
    | "medical_medications"
    | "medical_dosage"
  >,
  whatsappNumbers: Pick<WhatsAppNumber, "number" | "is_primary_phone">[] = [],
): CaptureFormInitialValues {
  const additionalWa =
    whatsappNumbers.find((w) => !w.is_primary_phone)?.number ??
    whatsappNumbers[0]?.number ??
    "";

  return {
    name: member.name,
    phone: member.phone,
    email: member.email,
    birthday: member.birthday ?? "",
    isMinor: member.is_minor,
    legalRepName: member.legal_rep_name ?? "",
    hasWhatsapp: member.has_whatsapp,
    additionalWhatsapp: additionalWa,
    hasMedicalConditions: Boolean(member.has_medical_conditions),
    medicalConditions: member.medical_conditions ?? "",
    medicalMedications: member.medical_medications ?? "",
    medicalDosage: member.medical_dosage ?? "",
    emergencyContactName: member.emergency_contact_name ?? "",
    emergencyContactRelationship: member.emergency_contact_relationship ?? "",
    emergencyContactPhone: member.emergency_contact_phone ?? "",
  };
}

/**
 * Identifies fields on an existing assembly Member that are not yet populated
 * and may need completion when registering for a retreat.
 */
export function getMissingRetreatMemberFields(
  member: Pick<
    Member,
    | "birthday"
    | "is_minor"
    | "legal_rep_name"
    | "emergency_contact_name"
    | "emergency_contact_relationship"
    | "emergency_contact_phone"
    | "has_medical_conditions"
    | "medical_conditions"
  >,
): string[] {
  const missing: string[] = [];

  if (!member.birthday || member.birthday.trim() === "") {
    missing.push("Fecha de nacimiento");
  }
  if (member.is_minor && (!member.legal_rep_name || member.legal_rep_name.trim() === "")) {
    missing.push("Representante legal");
  }
  if (
    !member.emergency_contact_name?.trim() ||
    !member.emergency_contact_relationship?.trim() ||
    !member.emergency_contact_phone?.trim()
  ) {
    missing.push("Contacto de emergencia");
  }
  if (!member.has_medical_conditions && !member.medical_conditions?.trim()) {
    missing.push("Salud / condiciones médicas (si aplica)");
  }

  return missing;
}
