export type ConsentRow = { consent_type: string };

export type ConsentGateInput = {
  whatsappOptIn: boolean;
  whatsappOptOutAt: string | null;
  consentRows: ConsentRow[];
  whatsappNumber?: string | null;
};

export type ConsentGateResult = {
  allowed: boolean;
  reason: "skipped_no_consent" | "skipped_invalid_phone" | null;
};

export function canSendWhatsapp(input: ConsentGateInput): ConsentGateResult {
  if (!input.whatsappOptIn)
    return { allowed: false, reason: "skipped_no_consent" };
  if (input.whatsappOptOutAt != null)
    return { allowed: false, reason: "skipped_no_consent" };

  const hasWhatsappConsent = input.consentRows.some(
    (r) => r.consent_type === "whatsapp_messaging",
  );
  if (!hasWhatsappConsent)
    return { allowed: false, reason: "skipped_no_consent" };

  // Staff variant: if whatsappNumber explicitly provided as null/empty, treat as invalid phone gate
  if ("whatsappNumber" in input && input.whatsappNumber !== undefined) {
    const n = input.whatsappNumber;
    if (n == null || n.trim() === "") {
      return { allowed: false, reason: "skipped_invalid_phone" };
    }
  }

  return { allowed: true, reason: null };
}
