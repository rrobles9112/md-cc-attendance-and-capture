/**
 * Transfer eligibility helper — mirrors RPC gating (spec R1+R2, design AD-002 steps 3+5).
 * Pure client-side triage for UI button enable/disable; server RPC is authoritative.
 */

export type TransferEligibility = "eligible" | "not_inscrito" | "already_transferred" | "missing_total";

/**
 * Strips non-digits and removes the leading Colombian '57' country code when
 * a 12-digit phone number is provided, yielding a canonical 10-digit string so
 * '+573001234567' in `members` and '3001234567' in `retreat_registrations` match.
 */
export function normalizeColombianPhoneDigits(raw: string | null | undefined): string {
  const digits = (raw ?? "").trim().replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("57")) {
    return digits.slice(2);
  }
  return digits;
}

export interface TransferMemberCandidate {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  pastoral_group?: string | null;
}

export interface TransferMemberMatch {
  id: string;
  name: string;
  isAlreadyLinked: boolean;
  isAlreadyValientes: boolean;
}

export function findMatchingActiveMemberForTransfer(
  registration: {
    email?: string | null;
    phone?: string | null;
    member_id?: string | null;
  },
  candidates: TransferMemberCandidate[],
): TransferMemberMatch | null {
  const targetEmail = (registration.email ?? "").trim().toLowerCase();
  const targetPhone = normalizeColombianPhoneDigits(registration.phone);
  const linkedId = registration.member_id ?? null;

  if (linkedId) {
    const linked = candidates.find((c) => c.id === linkedId);
    if (linked) {
      return {
        id: linked.id,
        name: linked.name,
        isAlreadyLinked: true,
        isAlreadyValientes: linked.pastoral_group === "Valientes",
      };
    }
  }

  for (const candidate of candidates) {
    const candEmail = (candidate.email ?? "").trim().toLowerCase();
    const candPhone = normalizeColombianPhoneDigits(candidate.phone);
    const emailMatches = targetEmail !== "" && candEmail === targetEmail;
    const phoneMatches = targetPhone !== "" && candPhone === targetPhone;
    if (emailMatches || phoneMatches) {
      return {
        id: candidate.id,
        name: candidate.name,
        isAlreadyLinked: linkedId !== null && candidate.id === linkedId,
        isAlreadyValientes: candidate.pastoral_group === "Valientes",
      };
    }
  }

  return null;
}

export function requiresUnpaidTransferCheckpoint(status: string): boolean {
  return status !== "inscrito";
}

export function isTransferEligible(params: {
  status: string;
  sum: number;
  total: number | null;
  transferred_at: string | null;
  allowUnpaid?: boolean;
}): TransferEligibility {
  if (params.transferred_at !== null && params.transferred_at !== undefined) {
    return "already_transferred";
  }
  if (params.allowUnpaid === true) {
    return "eligible";
  }
  if (params.total === null || params.total <= 0 || !Number.isFinite(params.total)) {
    return "missing_total";
  }
  if (params.status !== "inscrito" || params.sum < params.total) {
    return "not_inscrito";
  }
  return "eligible";
}
