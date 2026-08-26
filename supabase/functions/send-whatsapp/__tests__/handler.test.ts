import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateAuth,
  verifyCronSecret,
  constantTimeEqual,
  canTriggerManual,
  normalizeE164ForHandler,
  checkKillSwitch,
  checkMonthlyCap,
  chunkBatch,
  resolveTemplateName,
  processBatch,
  type Candidate,
} from "../handler";

describe("send-whatsapp handler — Edge contract (T-007 RED→GREEN)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("happy path: absence kind with consent+phone → POST graph.facebook.com with absence_followup", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ messages: [{ id: "wamid.123" }] }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const candidates: Candidate[] = [
      {
        member_id: "m1",
        session_id: "s1",
        phoneRaw: "+573001234567",
        whatsappOptIn: true,
        optOutAt: null,
        consentRows: [{ consent_type: "whatsapp_messaging" }],
        name: "Ana",
      },
    ];
    const result = await processBatch(candidates, "absence", "absence_followup", {
      whatsappEnabled: "true",
      whatsappToken: "tok",
      phoneNumberId: "123",
      sentThisMonth: 0,
      existingKeys: [],
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    const url = firstCall[0];
    expect(url).toContain("graph.facebook.com/v20.0/123/messages");
    const body = JSON.parse(firstCall[1].body as string);
    expect(body.template.name).toBe("absence_followup");
    expect(body.template.language.code).toBe("es_CO");
  });

  it("kill switch blocks when whatsapp_enabled=false", async () => {
    const fetchMock = vi.fn();
    const candidates: Candidate[] = [
      { member_id: "m1", session_id: "s1", phoneRaw: "+573001234567", whatsappOptIn: true, optOutAt: null, consentRows: [{ consent_type: "whatsapp_messaging" }] },
    ];
    const result = await processBatch(candidates, "absence", "absence_followup", {
      whatsappEnabled: "false",
      whatsappToken: "tok",
      phoneNumberId: "123",
      sentThisMonth: 0,
      existingKeys: [],
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.skipped_cap).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("missing creds D2 returns failed with D2 error and no provider call", async () => {
    const fetchMock = vi.fn();
    const candidates: Candidate[] = [
      { member_id: "m1", phoneRaw: "+573001234567", whatsappOptIn: true, optOutAt: null, consentRows: [{ consent_type: "whatsapp_messaging" }] },
      { member_id: "m2", phoneRaw: "+573001234568", whatsappOptIn: true, optOutAt: null, consentRows: [{ consent_type: "whatsapp_messaging" }] },
    ];
    const result = await processBatch(candidates, "absence", "absence_followup", {
      whatsappEnabled: "true",
      whatsappToken: null,
      phoneNumberId: "",
      sentThisMonth: 0,
      existingKeys: [],
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.failed).toBe(2);
    expect(result.errors[0].error).toMatch(/D2 pending/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cap exceeded returns skipped_cap", async () => {
    const fetchMock = vi.fn();
    const candidates: Candidate[] = [
      { member_id: "m1", phoneRaw: "+573001234567", whatsappOptIn: true, optOutAt: null, consentRows: [{ consent_type: "whatsapp_messaging" }] },
    ];
    const result = await processBatch(candidates, "absence", "absence_followup", {
      whatsappEnabled: "true",
      whatsappToken: "tok",
      phoneNumberId: "123",
      sentThisMonth: 900,
      monthlyCap: 900,
      existingKeys: [],
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.skipped_cap).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("invalid phone → skipped_invalid_phone", async () => {
    const fetchMock = vi.fn();
    const candidates: Candidate[] = [
      { member_id: "m1", phoneRaw: "+57 300-abc", whatsappOptIn: true, optOutAt: null, consentRows: [{ consent_type: "whatsapp_messaging" }] },
      { member_id: "m2", phoneRaw: null, whatsappOptIn: true, optOutAt: null, consentRows: [{ consent_type: "whatsapp_messaging" }] },
    ];
    const result = await processBatch(candidates, "absence", "absence_followup", {
      whatsappEnabled: "true",
      whatsappToken: "tok",
      phoneNumberId: "123",
      sentThisMonth: 0,
      existingKeys: [],
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.skipped_invalid_phone).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no consent → skipped_no_consent", async () => {
    const fetchMock = vi.fn();
    const candidates: Candidate[] = [
      { member_id: "m1", phoneRaw: "+573001234567", whatsappOptIn: false, optOutAt: null, consentRows: [{ consent_type: "whatsapp_messaging" }] },
      { member_id: "m2", phoneRaw: "+573001234567", whatsappOptIn: true, optOutAt: "2026-01-01T00:00:00Z", consentRows: [{ consent_type: "whatsapp_messaging" }] },
      { member_id: "m3", phoneRaw: "+573001234567", whatsappOptIn: true, optOutAt: null, consentRows: [] },
    ];
    const result = await processBatch(candidates, "absence", "absence_followup", {
      whatsappEnabled: "true",
      whatsappToken: "tok",
      phoneNumberId: "123",
      sentThisMonth: 0,
      existingKeys: [],
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.skipped_no_consent).toBe(3);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("duplicate (dedup key exists) → skipped_duplicate", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const candidates: Candidate[] = [
      { member_id: "m1", session_id: "s1", phoneRaw: "+573001234567", whatsappOptIn: true, optOutAt: null, consentRows: [{ consent_type: "whatsapp_messaging" }] },
    ];
    const result = await processBatch(candidates, "absence", "absence_followup", {
      whatsappEnabled: "true",
      whatsappToken: "tok",
      phoneNumberId: "123",
      sentThisMonth: 0,
      existingKeys: [{ session_id: "s1", member_id: "m1", kind: "absence" }],
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.skipped_duplicate).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("auth 401 when missing JWT / x-cron-secret", () => {
    expect(validateAuth({}).ok).toBe(false);
    expect(validateAuth({ authorization: "Bearer service_role-token" }).ok).toBe(false);
    expect(validateAuth({ authorization: "Bearer service_role-token", "x-cron-secret": "s3cr3t" }).ok).toBe(true);
    expect(validateAuth({ authorization: "Bearer eyJhbGciOi..." }).ok).toBe(true);
  });

  it("batch 120 → 50/50/20 chunking aggregated", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ messages: [{ id: "wamid.x" }] }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const candidates: Candidate[] = Array.from({ length: 120 }, (_, i) => ({
      member_id: `m${i}`,
      session_id: `s${i}`,
      phoneRaw: "+573001234567",
      whatsappOptIn: true,
      optOutAt: null,
      consentRows: [{ consent_type: "whatsapp_messaging" }],
    }));
    // verify chunkBatch helper
    const chunks = chunkBatch(candidates, 50);
    expect(chunks.length).toBe(3);
    expect(chunks[0].length).toBe(50);
    expect(chunks[1].length).toBe(50);
    expect(chunks[2].length).toBe(20);

    const result = await processBatch(candidates, "absence", "absence_followup", {
      whatsappEnabled: "true",
      whatsappToken: "tok",
      phoneNumberId: "123",
      sentThisMonth: 0,
      existingKeys: [],
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.sent).toBe(120);
    expect(fetchMock).toHaveBeenCalledTimes(120);
  });

  it("403 when leader/server role check for manual shepherding (canTriggerManual)", () => {
    expect(canTriggerManual("super_admin", "shepherding_checkin")).toBe(true);
    expect(canTriggerManual("leader", "shepherding_checkin")).toBe(true);
    expect(canTriggerManual("server", "shepherding_checkin")).toBe(false);
    expect(canTriggerManual(null, "shepherding_checkin")).toBe(false);
  });

  it("constant-time secret compare", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(verifyCronSecret("s3cr3t", "s3cr3t")).toBe(true);
    expect(verifyCronSecret("s3cr3t", "wrong")).toBe(false);
  });

  it("normalizeE164ForHandler validates E.164 and null on invalid", () => {
    expect(normalizeE164ForHandler("+573001234567")).toBe("+573001234567");
    expect(normalizeE164ForHandler("+57 300 123 4567")).toBe("+573001234567");
    expect(normalizeE164ForHandler("+57 300-abc")).toBe(null);
    expect(normalizeE164ForHandler(null)).toBe(null);
    expect(normalizeE164ForHandler("")).toBe(null);
  });

  it("resolveTemplateName uses kind mapping and override", () => {
    expect(resolveTemplateName({ kind: "absence" })).toBe("absence_followup");
    expect(resolveTemplateName({ kind: "birthday" })).toBe("birthday_staff_digest");
    expect(resolveTemplateName({ kind: "shepherding_checkin" })).toBe("shepherding_checkin");
    expect(resolveTemplateName({ kind: "absence", template_name: "custom" })).toBe("custom");
  });

  it("checkKillSwitch and checkMonthlyCap helpers", () => {
    expect(checkKillSwitch("false").blocked).toBe(true);
    expect(checkKillSwitch("true").blocked).toBe(false);
    expect(checkMonthlyCap(900, 900).blocked).toBe(true);
    expect(checkMonthlyCap(800, 900).blocked).toBe(false);
    expect(checkMonthlyCap(800, 900).alert).toBe(true);
  });

  it("birthday dedup per recipient — second staffer not duplicate for first", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ messages: [{ id: "wamid.b" }] }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const candidates: Candidate[] = [
      { member_id: "m1", phoneRaw: "+573001234567", whatsappOptIn: true, optOutAt: null, consentRows: [{ consent_type: "whatsapp_messaging" }], notificationDate: "2026-08-25", recipient_profile_id: "p1" },
    ];
    const result = await processBatch(candidates, "birthday", "birthday_staff_digest", {
      whatsappEnabled: "true",
      whatsappToken: "tok",
      phoneNumberId: "123",
      sentThisMonth: 0,
      existingKeys: [{ member_id: "m1", recipient_profile_id: "p2", kind: "birthday", notification_date: "2026-08-25" }],
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    // different recipient → not duplicate
    expect(result.sent).toBe(1);
  });
});
