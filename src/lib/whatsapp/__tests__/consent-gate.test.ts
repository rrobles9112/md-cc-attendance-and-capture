import { describe, it, expect } from "vitest";
import { canSendWhatsapp } from "@/lib/whatsapp/consent-gate";

describe("whatsapp/consent-gate — Ley 1581 triple gate", () => {
  it("blocks when whatsapp_opt_in is false", () => {
    const result = canSendWhatsapp({
      whatsappOptIn: false,
      whatsappOptOutAt: null,
      consentRows: [{ consent_type: "whatsapp_messaging" }],
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("skipped_no_consent");
  });

  it("blocks when opt_out_at is NOT NULL even if opt_in true", () => {
    const result = canSendWhatsapp({
      whatsappOptIn: true,
      whatsappOptOutAt: "2026-08-20T10:00:00Z",
      consentRows: [{ consent_type: "whatsapp_messaging" }],
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("skipped_no_consent");
  });

  it("blocks when no consent_records whatsapp_messaging row", () => {
    const result = canSendWhatsapp({
      whatsappOptIn: true,
      whatsappOptOutAt: null,
      consentRows: [],
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("skipped_no_consent");
  });

  it("blocks when consent is different type (personal_data only)", () => {
    const result = canSendWhatsapp({
      whatsappOptIn: true,
      whatsappOptOutAt: null,
      consentRows: [{ consent_type: "personal_data" }],
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("skipped_no_consent");
  });

  it("allows when all three gates pass", () => {
    const result = canSendWhatsapp({
      whatsappOptIn: true,
      whatsappOptOutAt: null,
      consentRows: [{ consent_type: "whatsapp_messaging" }],
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeNull();
  });

  it("staff variant: requires profiles.whatsapp_opt_in + whatsapp_number + consent", () => {
    const blocked = canSendWhatsapp({
      whatsappOptIn: false,
      whatsappOptOutAt: null,
      consentRows: [{ consent_type: "whatsapp_messaging" }],
      whatsappNumber: "+573001234567",
    });
    expect(blocked.allowed).toBe(false);

    const noPhone = canSendWhatsapp({
      whatsappOptIn: true,
      whatsappOptOutAt: null,
      consentRows: [{ consent_type: "whatsapp_messaging" }],
      whatsappNumber: null,
    });
    // staff without phone should be blocked (invalid phone downstream, but gate may also block)
    // we assert not allowed OR at least phone validation would fail
    expect(
      noPhone.allowed === false ||
        noPhone.reason === "skipped_invalid_phone" ||
        noPhone.reason === "skipped_no_consent",
    ).toBe(true);
  });
});
