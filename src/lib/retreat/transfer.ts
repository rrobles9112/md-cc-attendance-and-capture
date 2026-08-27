/**
 * Transfer eligibility helper — mirrors RPC gating (spec R1+R2, design AD-002 steps 3+5).
 * Pure client-side triage for UI button enable/disable; server RPC is authoritative.
 */

export type TransferEligibility = "eligible" | "not_inscrito" | "already_transferred" | "missing_total";

export function isTransferEligible(params: {
  status: string;
  sum: number;
  total: number | null;
  transferred_at: string | null;
}): TransferEligibility {
  if (params.transferred_at !== null && params.transferred_at !== undefined) {
    return "already_transferred";
  }
  if (params.total === null || params.total <= 0 || !Number.isFinite(params.total)) {
    return "missing_total";
  }
  if (params.status !== "inscrito" || params.sum < params.total) {
    return "not_inscrito";
  }
  return "eligible";
}
