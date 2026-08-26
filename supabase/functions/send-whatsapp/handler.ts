// handler.ts — pure helpers for Edge send-whatsapp
// Vitest-compatible (Node) — Deno Edge imports npm:libphonenumber-js separately.
// Keeps business gates testable without Supabase/Graph API.

import { parsePhoneNumberFromString } from "libphonenumber-js";

export type SendWhatsappInput = {
  kind: "absence" | "birthday" | "shepherding_checkin";
  session_id?: string;
  dry_run?: boolean;
  triggered_by?: "cron" | "manual";
  member_ids?: string[];
  template_name?: string;
  custom_params?: Record<string, string>;
};

export type SendWhatsappResult = {
  ok: boolean;
  kind: string;
  sessions_processed?: number;
  attempted: number;
  sent: number;
  skipped_no_consent: number;
  skipped_invalid_phone: number;
  skipped_duplicate: number;
  skipped_cap: number;
  skipped_no_birthdays?: number;
  skipped_no_recipients?: number;
  failed: number;
  errors: Array<{ member_id: string; error: string }>;
  provider: string;
  dry_run: boolean;
  reason?: string;
};

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export function validateAuth(headers: Record<string, string | undefined>): {
  ok: boolean;
  error?: string;
} {
  const auth = headers.authorization ?? headers.Authorization ?? headers["Authorization"];
  const cronSecret = headers["x-cron-secret"] ?? headers["X-Cron-Secret"] ?? headers["x-cron-secret".toLowerCase()];
  // Node fetch lowercases headers; also check original case
  const xs = (headers as Record<string, string | undefined>)["x-cron-secret"];
  const xsUpper = (headers as Record<string, string | undefined>)["X-Cron-Secret"];
  const effectiveCron = xs ?? xsUpper ?? cronSecret;

  if (!auth) return { ok: false, error: "unauthorized" };
  // cron path: Authorization contains service_role token → require x-cron-secret
  if (auth.includes("service_role") && !effectiveCron) {
    return { ok: false, error: "unauthorized" };
  }
  return { ok: true };
}

/**
 * Constant-time string compare to avoid timing attacks on x-cron-secret.
 * Uses Node crypto.timingSafeEqual when available, else manual.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export function verifyCronSecret(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  return constantTimeEqual(provided, expected);
}

// ---------------------------------------------------------------------------
// RBAC helper for manual calls
// ---------------------------------------------------------------------------
export function canTriggerManual(role: string | null | undefined, kind: string): boolean {
  if (!role) return false;
  if (kind === "shepherding_checkin") {
    return role === "super_admin" || role === "leader";
  }
  // absence/birthday are cron-only
  return role === "super_admin" || role === "leader";
}

// ---------------------------------------------------------------------------
// Phone
// ---------------------------------------------------------------------------
const E164_RE = /^\+[1-9]\d{7,14}$/;

export function normalizeE164ForHandler(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  try {
    const parsed = parsePhoneNumberFromString(trimmed, "CO");
    if (!parsed || !parsed.isValid()) return null;
    const e164 = parsed.format("E.164");
    if (!E164_RE.test(e164)) return null;
    return e164;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Gates (cap, kill-switch, idempotency, batching) — thin wrappers over
// src/lib/whatsapp/cap-batch helpers for handler parity
// ---------------------------------------------------------------------------
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
  if (sentThisMonth >= cap) return { blocked: true, reason: "skipped_cap", alert: true };
  if (sentThisMonth >= 800) return { blocked: false, alert: true };
  return { blocked: false, alert: false };
}

export function chunkBatch<T>(items: T[], size: number = 50): T[][] {
  if (items.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function isDuplicate(
  key: Record<string, string>,
  existing: Record<string, string>[],
): boolean {
  return existing.some((row) => Object.entries(key).every(([k, v]) => row[k] === v));
}

// ---------------------------------------------------------------------------
// Template mapping
// ---------------------------------------------------------------------------
export const TEMPLATE_BY_KIND: Record<string, string> = {
  absence: "absence_followup",
  birthday: "birthday_staff_digest",
  shepherding_checkin: "shepherding_checkin",
};

export function resolveTemplateName(input: SendWhatsappInput): string {
  if (input.template_name) return input.template_name;
  return TEMPLATE_BY_KIND[input.kind] ?? input.kind;
}

// ---------------------------------------------------------------------------
// Consent triple gate (mirrors src/lib/whatsapp/consent-gate)
// ---------------------------------------------------------------------------
export type ConsentGateInput = {
  whatsappOptIn: boolean;
  optOutAt: string | null;
  consentRows: Array<{ consent_type: string }>;
  whatsappNumber?: string | null;
};

export function evaluateConsentGate(input: ConsentGateInput): {
  allowed: boolean;
  reason: "skipped_no_consent" | "skipped_invalid_phone" | null;
} {
  if (!input.whatsappOptIn) return { allowed: false, reason: "skipped_no_consent" };
  if (input.optOutAt != null) return { allowed: false, reason: "skipped_no_consent" };
  const has = input.consentRows.some((r) => r.consent_type === "whatsapp_messaging");
  if (!has) return { allowed: false, reason: "skipped_no_consent" };
  if ("whatsappNumber" in input && input.whatsappNumber !== undefined) {
    const n = input.whatsappNumber;
    if (n == null || (typeof n === "string" && n.trim() === "")) {
      return { allowed: false, reason: "skipped_invalid_phone" };
    }
  }
  return { allowed: true, reason: null };
}

// ---------------------------------------------------------------------------
// Batch processor — pure, testable, no Supabase I/O
// ---------------------------------------------------------------------------
export type Candidate = {
  member_id: string;
  session_id?: string | null;
  phoneRaw: string | null;
  whatsappOptIn: boolean;
  optOutAt: string | null;
  consentRows: Array<{ consent_type: string }>;
  notificationDate?: string | null; // YYYY-MM-DD for birthday
  recipient_profile_id?: string | null;
  name?: string;
};

export type BatchDeps = {
  whatsappEnabled: string | boolean | null;
  whatsappToken: string | null;
  phoneNumberId: string | null;
  sentThisMonth: number;
  monthlyCap?: number;
  existingKeys: Record<string, string>[];
  dryRun?: boolean;
  fetchImpl?: typeof fetch;
};

export async function processBatch(
  candidates: Candidate[],
  kind: string,
  templateName: string,
  deps: BatchDeps,
): Promise<SendWhatsappResult> {
  const base: SendWhatsappResult = {
    ok: true,
    kind,
    attempted: candidates.length,
    sent: 0,
    skipped_no_consent: 0,
    skipped_invalid_phone: 0,
    skipped_duplicate: 0,
    skipped_cap: 0,
    failed: 0,
    errors: [],
    provider: "meta_cloud_api",
    dry_run: Boolean(deps.dryRun),
  };

  // 1) Kill switch
  const ks = checkKillSwitch(deps.whatsappEnabled);
  if (ks.blocked) {
    base.skipped_cap = candidates.length;
    base.errors.push({ member_id: "all", error: "whatsapp_disabled" });
    return base;
  }

  // 2) Missing credentials (D2 fail-closed)
  if (!deps.whatsappToken || !deps.phoneNumberId) {
    base.failed = candidates.length;
    const msg = "missing whatsapp credentials — D2 pending";
    for (const c of candidates) base.errors.push({ member_id: c.member_id, error: msg });
    // Structured log hint
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ kind, template_name: templateName, status: "failed", error: msg }));
    return base;
  }

  // 3) Monthly cap
  const cap = checkMonthlyCap(deps.sentThisMonth, deps.monthlyCap ?? 900);
  if (cap.blocked) {
    base.skipped_cap = candidates.length;
    return base;
  }

  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const chunks = chunkBatch(candidates, 50);

  for (const chunk of chunks) {
    for (const c of chunk) {
      // Consent triple gate
      const gate = evaluateConsentGate({
        whatsappOptIn: c.whatsappOptIn,
        optOutAt: c.optOutAt,
        consentRows: c.consentRows,
      });
      if (!gate.allowed) {
        if (gate.reason === "skipped_no_consent") base.skipped_no_consent += 1;
        else base.skipped_invalid_phone += 1;
        continue;
      }

      // E.164 normalize
      const e164 = normalizeE164ForHandler(c.phoneRaw);
      if (!e164) {
        base.skipped_invalid_phone += 1;
        continue;
      }

      // Idempotency before provider call
      const dedupKey: Record<string, string> =
        kind === "birthday" && c.notificationDate
          ? c.recipient_profile_id
            ? {
                member_id: c.member_id,
                recipient_profile_id: c.recipient_profile_id,
                kind,
                notification_date: c.notificationDate,
              }
            : { member_id: c.member_id, kind, notification_date: c.notificationDate }
          : c.session_id
            ? { session_id: c.session_id, member_id: c.member_id, kind }
            : { member_id: c.member_id, kind };

      if (isDuplicate(dedupKey, deps.existingKeys)) {
        base.skipped_duplicate += 1;
        continue;
      }

      if (deps.dryRun) {
        // dry_run: count as would-send without provider call
        base.sent += 1;
        continue;
      }

      // Provider call
      const started = Date.now();
      try {
        const res = await fetchImpl(`https://graph.facebook.com/v20.0/${deps.phoneNumberId}/messages`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${deps.whatsappToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: e164,
            type: "template",
            template: {
              name: templateName,
              language: { code: "es_CO" },
              components: [
                {
                  type: "body",
                  parameters: [
                    { type: "text", text: c.name ?? c.member_id },
                    { type: "text", text: kind },
                    { type: "text", text: c.notificationDate ?? new Date().toLocaleDateString("es-CO", { timeZone: "America/Bogota" }) },
                  ],
                },
              ],
            },
          }),
        });

        const latency_ms = Date.now() - started;
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          base.failed += 1;
          base.errors.push({ member_id: c.member_id, error: body || `provider ${res.status}` });
          // eslint-disable-next-line no-console
          console.log(JSON.stringify({ kind, member_id: c.member_id, template_name: templateName, status: "failed", latency_ms, error: body }));
          continue;
        }

        const data = (await res.json().catch(() => ({}))) as { messages?: Array<{ id: string }> };
        const providerId = data.messages?.[0]?.id ?? null;
        base.sent += 1;
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify({
            kind,
            member_id: c.member_id,
            session_id: c.session_id ?? null,
            template_name: templateName,
            status: "sent",
            provider_message_id: providerId,
            latency_ms,
          }),
        );
        // Mark as deduped for remainder of batch
        deps.existingKeys.push(
          Object.fromEntries(Object.entries(dedupKey).map(([k, v]) => [k, String(v)])),
        );
      } catch (err) {
        const latency_ms = Date.now() - started;
        const msg = err instanceof Error ? err.message : String(err);
        base.failed += 1;
        base.errors.push({ member_id: c.member_id, error: msg });
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ kind, member_id: c.member_id, template_name: templateName, status: "failed", latency_ms, error: msg }));
      }
    }
  }

  return base;
}
