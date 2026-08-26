import {
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

const E164_RE = /^\+[1-9]\d{7,14}$/;

export function isValidE164(e164: string): boolean {
  return E164_RE.test(e164);
}

/**
 * Normalize a raw phone string to E.164 using libphonenumber-js with CO default.
 * Returns null when input is null/empty/invalid.
 * Logs a warning (console.warn) when E.164 is valid but not +57 (Colombia scope).
 */
export function normalizeE164(
  raw: string | null | undefined,
  defaultRegion: CountryCode = "CO",
): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  try {
    const parsed = parsePhoneNumberFromString(trimmed, defaultRegion);
    if (!parsed || !parsed.isValid()) return null;
    const e164 = parsed.format("E.164");
    if (!E164_RE.test(e164)) return null;
    if (!e164.startsWith("+57")) {
      // business warning — still return the value, caller decides on +57 gate
      console.warn(`[phone] E.164 valid but not +57: ${e164}`);
    }
    return e164;
  } catch {
    return null;
  }
}

export function maskPhone(e164: string | null | undefined): string {
  if (!e164 || e164.trim() === "") return "***";
  const trimmed = e164.trim();
  const last4 = trimmed.slice(-4);
  return `***${last4}`;
}
