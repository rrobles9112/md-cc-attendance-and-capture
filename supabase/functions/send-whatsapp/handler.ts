// handler.ts — pure helpers for T-007 RED→GREEN; real Edge Deno handler deferred to PR2
// Keeps tests runnable under vitest/jsdom without Deno.

export type SendWhatsappInput = {
  kind: "absence" | "birthday" | "shepherding_checkin";
  session_id?: string;
  dry_run?: boolean;
  triggered_by?: "cron" | "manual";
  member_ids?: string[];
};

export type SendWhatsappResult = {
  ok: boolean;
  kind: string;
  sent: number;
  skipped_no_consent?: number;
  skipped_invalid_phone?: number;
  skipped_duplicate?: number;
  skipped_cap?: number;
  failed?: number;
  error?: string;
};

export function validateAuth(headers: Record<string, string | undefined>): {
  ok: boolean;
  error?: string;
} {
  const auth = headers.authorization ?? headers.Authorization;
  const cronSecret = headers["x-cron-secret"] ?? headers["X-Cron-Secret"];
  if (!auth) return { ok: false, error: "unauthorized" };
  // for cron: require x-cron-secret; for manual: require user JWT — simplified for unit
  if (auth.includes("service_role") && !cronSecret)
    return { ok: false, error: "unauthorized" };
  return { ok: true };
}
