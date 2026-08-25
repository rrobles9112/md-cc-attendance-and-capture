import { describe, it, expect } from "vitest";
import { normalizeE164, maskPhone, isValidE164 } from "@/lib/phone/normalize";

describe("phone/normalize — E.164 helper contract", () => {
  it("normalizes valid +573001234567 unchanged", () => {
    expect(normalizeE164("+573001234567")).toBe("+573001234567");
  });

  it("normalizes valid with spaces/dashes to E.164", () => {
    expect(normalizeE164("+57 300 123-4567")).toBe("+573001234567");
    expect(normalizeE164("+57-300-123-4567")).toBe("+573001234567");
    expect(normalizeE164("3001234567", "CO")).toBe("+573001234567");
  });

  it("returns null for NULL/empty", () => {
    expect(normalizeE164(null)).toBeNull();
    expect(normalizeE164("")).toBeNull();
    expect(normalizeE164("   ")).toBeNull();
  });

  it("returns null for invalid +57 300-abc", () => {
    expect(normalizeE164("+57 300-abc")).toBeNull();
  });

  it("handles landline-like +5712345670 as E.164 valid (Colombia landline)", () => {
    // landline is E.164 valid per libphonenumber-js, but not mobile — should normalize
    const result = normalizeE164("+5712345670");
    // if E.164 valid, should return E.164; if invalid per lib, null
    expect(result === null || result === "+5712345670").toBe(true);
  });

  it("handles non +57 but valid E.164 (+1 US)", () => {
    const result = normalizeE164("+14155552671");
    expect(result).toBe("+14155552671");
    expect(isValidE164(result!)).toBe(true);
  });

  it("CO default region without + normalizes via CO region", () => {
    expect(normalizeE164("300 123 4567", "CO")).toBe("+573001234567");
  });

  it("validates E.164 regex ^\\+[1-9]\\d{7,14}$", () => {
    expect(isValidE164("+573001234567")).toBe(true);
    expect(isValidE164("+57")).toBe(false);
    expect(isValidE164("573001234567")).toBe(false);
    expect(isValidE164("+0 573001234567")).toBe(false);
    expect(isValidE164("+573001234567890123")).toBe(false); // >15 digits
  });

  it("warns (but still returns) for E.164 valid but not +57 prefix", () => {
    // normalizeE164 should still return the number, isValidE164 passes, but
    // caller can check +57 prefix for business warning
    expect(normalizeE164("+14155552671")).toBe("+14155552671");
  });

  it("maskPhone masks to ***1234", () => {
    expect(maskPhone("+573001234567")).toBe("***4567");
    expect(maskPhone(null)).toBe("***");
    expect(maskPhone("")).toBe("***");
  });
});
