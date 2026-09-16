import {
  checkMinorStatus,
  validateMinorFields,
} from "@/lib/consent/validation";

export type RetreatRegistrationUpdateInput = {
  name: string;
  phone: string;
  email: string;
  birthday: string;
  legalRepName: string;
  hasWhatsapp: boolean;
  whatsappNumber: string;
  hasMedicalConditions: boolean;
  medicalConditions: string;
  medicalMedications: string;
  medicalDosage: string;
};

export type RetreatRegistrationUpdatePayload = {
  name: string;
  phone: string;
  email: string;
  birthday: string | null;
  is_minor: boolean;
  legal_rep_name: string | null;
  has_whatsapp: boolean;
  whatsapp_number: string | null;
  has_medical_conditions: boolean;
  medical_conditions: string | null;
  medical_medications: string | null;
  medical_dosage: string | null;
};

export type RetreatUpdateResult =
  | { ok: true; payload: RetreatRegistrationUpdatePayload }
  | { ok: false; error: string };

export type RetreatPersistResult = { ok: true } | { ok: false; error: string };

export type RetreatUpdatePersistFn = (
  payload: RetreatRegistrationUpdatePayload,
) => Promise<{
  data: Array<{ id: string }> | null;
  error: { message: string; code?: string } | null;
}>;

export function buildRetreatRegistrationUpdate(
  input: RetreatRegistrationUpdateInput,
): RetreatUpdateResult {
  const name = input.name.trim();
  const phone = input.phone.trim();
  const email = input.email.trim().toLowerCase();
  const whatsappNumber = input.whatsappNumber.trim();

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
  const isMinor = birthday
    ? checkMinorStatus(new Date(birthday)).isMinor
    : false;
  const legalRep = input.legalRepName.trim();
  const minorCheck = validateMinorFields(isMinor, legalRep);
  if (!minorCheck.valid) {
    return {
      ok: false,
      error: minorCheck.error ?? "El representante legal es obligatorio",
    };
  }

  const hasMedicalConditions = input.hasMedicalConditions;
  const medicalConditions = input.medicalConditions.trim();
  if (hasMedicalConditions && !medicalConditions) {
    return { ok: false, error: "Indique las condiciones médicas" };
  }
  const medicalMedications = input.medicalMedications.trim();
  const medicalDosage = input.medicalDosage.trim();

  return {
    ok: true,
    payload: {
      name,
      phone,
      email,
      birthday: birthday || null,
      is_minor: isMinor,
      legal_rep_name: isMinor ? legalRep : null,
      has_whatsapp: input.hasWhatsapp,
      whatsapp_number: whatsappNumber || null,
      has_medical_conditions: hasMedicalConditions,
      medical_conditions: hasMedicalConditions
        ? medicalConditions || null
        : null,
      medical_medications: hasMedicalConditions
        ? medicalMedications || null
        : null,
      medical_dosage: hasMedicalConditions ? medicalDosage || null : null,
    },
  };
}

export function mapRetreatUpdateError(error: {
  message?: string;
  code?: string;
}): string {
  const code = error.code ?? "";
  const message = error.message ?? "";
  if (
    code === "23505" ||
    message.includes("already_preinscribed") ||
    message.includes("duplicate")
  ) {
    return "Ya existe una preinscripción con ese email/teléfono para este retiro.";
  }
  if (code === "42501" || message.includes("not_authorized")) {
    return "No tiene permisos para editar esta preinscripción";
  }
  return "Error al actualizar la preinscripción";
}

export async function applyRetreatRegistrationUpdate(
  input: RetreatRegistrationUpdateInput,
  persist: RetreatUpdatePersistFn,
): Promise<RetreatPersistResult> {
  const built = buildRetreatRegistrationUpdate(input);
  if (!built.ok) {
    return built;
  }
  const { data, error } = await persist(built.payload);
  if (error) {
    return { ok: false, error: mapRetreatUpdateError(error) };
  }
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: "No tiene permisos para editar esta preinscripción",
    };
  }
  return { ok: true };
}
