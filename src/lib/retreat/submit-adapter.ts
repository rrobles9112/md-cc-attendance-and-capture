import type { CaptureSubmitPayload } from "@/components/forms/CaptureForm";
import { createClient } from "@/lib/supabase/client";

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export const RETREAT_DUPLICATE_MESSAGE =
  "Ya existe una preinscripción con ese email/teléfono para este retiro.";

export type UserFacingError = Error & { userFacing: true };

export function isUserFacingError(value: unknown): value is UserFacingError {
  return (
    value instanceof Error &&
    (value as { userFacing?: unknown }).userFacing === true
  );
}

function toUserFacingError(message: string): UserFacingError {
  return Object.assign(new Error(message), { userFacing: true as const });
}

export function mapRetreatSubmitError(error: {
  message?: string;
  code?: string;
}): Error {
  const code = error.code ?? "";
  const message = error.message ?? "";
  if (
    code === "23505" ||
    message.includes("already_preinscribed") ||
    message.includes("duplicate")
  ) {
    return toUserFacingError(RETREAT_DUPLICATE_MESSAGE);
  }
  return new Error(message || "Error al registrar la preinscripción");
}

export async function submitRetreatPreinscriptionForMember(
  memberId: string,
  payload: CaptureSubmitPayload,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc(
    "register_retreat_preinscription_for_member",
    {
      p_member_id: memberId,
      p_birthday: emptyToNull(payload.birthday),
      p_legal_rep_name: emptyToNull(payload.legalRepName),
      p_general_consent: payload.generalConsent,
      p_sensitive_consent: payload.sensitiveConsent,
      p_denomination: payload.denomination,
      p_community_name: payload.communityName,
      p_has_whatsapp: payload.hasWhatsapp,
      p_whatsapp_number: payload.additionalWhatsapp.trim() || null,
      p_has_medical_conditions: payload.hasMedicalConditions,
      p_medical_conditions: emptyToNull(payload.medicalConditions),
      p_medical_medications: emptyToNull(payload.medicalMedications),
      p_medical_dosage: emptyToNull(payload.medicalDosage),
    },
  );
  if (error) {
    throw mapRetreatSubmitError(error);
  }
}

export async function submitRetreatPreinscription(
  payload: CaptureSubmitPayload,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("register_retreat_preinscription", {
    p_name: payload.name,
    p_phone: payload.phone,
    p_email: payload.email,
    p_birthday: emptyToNull(payload.birthday),
    p_legal_rep_name: emptyToNull(payload.legalRepName),
    p_general_consent: payload.generalConsent,
    p_sensitive_consent: payload.sensitiveConsent,
    p_denomination: payload.denomination,
    p_community_name: payload.communityName,
    p_has_whatsapp: payload.hasWhatsapp,
    p_whatsapp_number: payload.additionalWhatsapp.trim() || null,
    p_has_medical_conditions: payload.hasMedicalConditions,
    p_medical_conditions: emptyToNull(payload.medicalConditions),
    p_medical_medications: emptyToNull(payload.medicalMedications),
    p_medical_dosage: emptyToNull(payload.medicalDosage),
  });

  if (error) {
    throw mapRetreatSubmitError(error);
  }
}
