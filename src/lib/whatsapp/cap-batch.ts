export function checkKillSwitch(whatsappEnabled: string | boolean | null): {
  blocked: boolean;
  reason?: string;
} {
  const enabled = whatsappEnabled === true || whatsappEnabled === "true";
  if (!enabled) return { blocked: true, reason: "whatsapp_disabled" };
  return { blocked: false };
}

export function checkMonthlyCap(
  sentThisMonth: number,
  cap: number = 900,
): { blocked: boolean; reason?: string; alert: boolean } {
  if (sentThisMonth >= cap)
    return { blocked: true, reason: "skipped_cap", alert: true };
  if (sentThisMonth >= 800) return { blocked: false, alert: true };
  return { blocked: false, alert: false };
}

export type DedupKey =
  | { sessionId: string; memberId: string; kind: string }
  | {
      memberId: string;
      recipientProfileId: string;
      kind: string;
      notificationDate: string;
    }
  | { memberId: string; kind: string; notificationDate: string };

export function checkIdempotency(
  key: Record<string, string>,
  existing: Record<string, string>[],
): boolean {
  return existing.some((row) =>
    Object.entries(key).every(([k, v]) => row[k] === v),
  );
}

export function chunkBatch<T>(items: T[], size: number = 50): T[][] {
  if (items.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}
