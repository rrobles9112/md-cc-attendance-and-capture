import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureSubmitPayload } from "@/components/forms/CaptureForm";

const rpcMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());
const membersAddMock = vi.hoisted(() => vi.fn());
const enqueueMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: rpcMock,
    from: fromMock,
  }),
}));

vi.mock("@/lib/sync/db", () => ({
  db: {
    members: {
      add: membersAddMock,
    },
  },
}));

vi.mock("@/lib/sync/queue", () => ({
  enqueue: enqueueMock,
}));

import {
  RETREAT_EVENT_KEY,
  RETREAT_PAGE_HEADING,
  RETREAT_SUBMIT_LABEL,
} from "../constants";
import { submitRetreatPreinscription } from "../submit-adapter";

const adultPayload: CaptureSubmitPayload = {
  name: "Ana Pérez",
  phone: "3001234567",
  email: "ana@example.com",
  birthday: "2000-01-15",
  isMinor: false,
  legalRepName: "",
  generalConsent: true,
  sensitiveConsent: false,
  denomination: "Católica",
  communityName: "San Pablo",
  hasWhatsapp: true,
  additionalWhatsapp: "+573009876543",
  hasMedicalConditions: true,
  medicalConditions: "Asma",
  medicalMedications: "Salbutamol",
  medicalDosage: "Cada 8 horas",
};

describe("retreat constants", () => {
  it("locks the October 2026 event key and Spanish pre-registration copy", () => {
    expect(RETREAT_EVENT_KEY).toBe("retiro-juvenil-octubre-2026");
    expect(RETREAT_PAGE_HEADING).toBe("Un Corazón Nuevo");
    expect(RETREAT_SUBMIT_LABEL).toBe("Preinscribirme al retiro");
  });
});

describe("submitRetreatPreinscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcMock.mockResolvedValue({
      data: "11111111-1111-4111-8111-111111111111",
      error: null,
    });
  });

  it("calls register_retreat_preinscription with named p_ arguments only", async () => {
    await submitRetreatPreinscription(adultPayload);

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("register_retreat_preinscription", {
      p_name: "Ana Pérez",
      p_phone: "3001234567",
      p_email: "ana@example.com",
      p_birthday: "2000-01-15",
      p_legal_rep_name: null,
      p_general_consent: true,
      p_sensitive_consent: false,
      p_denomination: "Católica",
      p_community_name: "San Pablo",
      p_has_whatsapp: true,
      p_whatsapp_number: "+573009876543",
      p_has_medical_conditions: true,
      p_medical_conditions: "Asma",
      p_medical_medications: "Salbutamol",
      p_medical_dosage: "Cada 8 horas",
    });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("sends null birthday when empty and does not send money, status, or event_key", async () => {
    await submitRetreatPreinscription({
      ...adultPayload,
      birthday: "",
      legalRepName: "  ",
      hasWhatsapp: false,
      additionalWhatsapp: "   ",
    });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [, args] = rpcMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(args.p_birthday).toBeNull();
    expect(args.p_legal_rep_name).toBeNull();
    expect(args.p_has_whatsapp).toBe(false);
    expect(args.p_whatsapp_number).toBeNull();
    expect(args).not.toHaveProperty("amount");
    expect(args).not.toHaveProperty("money");
    expect(args).not.toHaveProperty("status");
    expect(args).not.toHaveProperty("event_key");
    expect(args).not.toHaveProperty("p_event_key");
    expect(args).not.toHaveProperty("p_amount");
    expect(Object.keys(args).sort()).toEqual([
      "p_birthday",
      "p_community_name",
      "p_denomination",
      "p_email",
      "p_general_consent",
      "p_has_medical_conditions",
      "p_has_whatsapp",
      "p_legal_rep_name",
      "p_medical_conditions",
      "p_medical_dosage",
      "p_medical_medications",
      "p_name",
      "p_phone",
      "p_sensitive_consent",
      "p_whatsapp_number",
    ]);
  });

  it("sends null medical details when the flag is not set", async () => {
    await submitRetreatPreinscription({
      ...adultPayload,
      hasMedicalConditions: false,
      medicalConditions: "   ",
      medicalMedications: "",
      medicalDosage: "  ",
    });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [, args] = rpcMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(args.p_has_medical_conditions).toBe(false);
    expect(args.p_medical_conditions).toBeNull();
    expect(args.p_medical_medications).toBeNull();
    expect(args.p_medical_dosage).toBeNull();
  });

  it("never imports or calls Dexie members.add or enqueue", async () => {
    const adapterPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../submit-adapter.ts",
    );
    const source = readFileSync(adapterPath, "utf8");

    expect(source).not.toMatch(/@\/lib\/sync\/db/);
    expect(source).not.toMatch(/@\/lib\/sync\/queue/);
    expect(source).not.toMatch(/db\.members\.add/);
    expect(source).not.toMatch(/\benqueue\b/);
    expect(source).not.toMatch(/from ['"]dexie['"]/);

    await submitRetreatPreinscription(adultPayload);

    expect(membersAddMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("throws when the RPC returns an error", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "name is required" },
    });

    await expect(
      submitRetreatPreinscription(adultPayload),
    ).rejects.toMatchObject({
      message: "name is required",
    });
    expect(membersAddMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});

describe("submitRetreatPreinscription duplicate mapping (024)", () => {
  it("maps raw 23505 on the event email index to a user-facing Spanish error", async () => {
    const { RETREAT_DUPLICATE_MESSAGE, isUserFacingError } = await import(
      "../submit-adapter"
    );
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "retreat_registrations_event_email_uidx"',
      },
    });

    const caught = await submitRetreatPreinscription(adultPayload).catch(
      (err: unknown) => err,
    );
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(RETREAT_DUPLICATE_MESSAGE);
    expect(isUserFacingError(caught)).toBe(true);
  });

  it("maps already_preinscribed RPC errors to the same user-facing message", async () => {
    const { RETREAT_DUPLICATE_MESSAGE, isUserFacingError } = await import(
      "../submit-adapter"
    );
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: "23505",
        message: "already_preinscribed: duplicate email/phone for this event",
      },
    });

    const caught = await submitRetreatPreinscription(adultPayload).catch(
      (err: unknown) => err,
    );
    expect((caught as Error).message).toBe(RETREAT_DUPLICATE_MESSAGE);
    expect(isUserFacingError(caught)).toBe(true);
  });

  it("rethrows non-duplicate errors untouched and not user-facing", async () => {
    const { isUserFacingError } = await import("../submit-adapter");
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "general consent is required" },
    });

    const caught = await submitRetreatPreinscription(adultPayload).catch(
      (err: unknown) => err,
    );
    expect((caught as { message: string }).message).toBe(
      "general consent is required",
    );
    expect(isUserFacingError(caught)).toBe(false);
  });
});
