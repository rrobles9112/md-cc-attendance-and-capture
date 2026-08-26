import { describe, it, expect } from "vitest";
import {
  checkMonthlyCap,
  checkKillSwitch,
  checkIdempotency,
  chunkBatch,
} from "@/lib/whatsapp/cap-batch";

describe("whatsapp/cap-batch — cap, kill-switch, idempotency, batching", () => {
  it("cap 900 blocks, 800 triggers alert, below passes", () => {
    expect(checkMonthlyCap(900, 900)).toMatchObject({
      blocked: true,
      reason: "skipped_cap",
      alert: true,
    });
    expect(checkMonthlyCap(901, 900)).toMatchObject({
      blocked: true,
      reason: "skipped_cap",
      alert: true,
    });
    expect(checkMonthlyCap(899, 900)).toMatchObject({
      blocked: false,
      alert: true,
    });
    expect(checkMonthlyCap(800, 900)).toMatchObject({ alert: true });
    expect(checkMonthlyCap(799, 900)).toMatchObject({ alert: false });
  });

  it("whatsapp_enabled=false → early return (kill-switch)", () => {
    expect(checkKillSwitch("false")).toEqual({
      blocked: true,
      reason: "whatsapp_disabled",
    });
    expect(checkKillSwitch("true")).toEqual({ blocked: false });
    expect(checkKillSwitch(false)).toEqual({
      blocked: true,
      reason: "whatsapp_disabled",
    });
    expect(checkKillSwitch(null)).toEqual({
      blocked: true,
      reason: "whatsapp_disabled",
    });
  });

  it("idempotency: (session_id,member_id,kind) duplicate blocks", () => {
    const existing = [{ session_id: "s1", member_id: "m1", kind: "absence" }];
    expect(
      checkIdempotency(
        { session_id: "s1", member_id: "m1", kind: "absence" },
        existing,
      ),
    ).toBe(true);
    expect(
      checkIdempotency(
        { session_id: "s2", member_id: "m1", kind: "absence" },
        existing,
      ),
    ).toBe(false);
  });

  it("idempotency: (member_id,recipient_profile_id,kind,notification_date) birthday", () => {
    const existing = [
      {
        member_id: "m1",
        recipient_profile_id: "p1",
        kind: "birthday",
        notification_date: "2026-08-25",
      },
    ];
    expect(
      checkIdempotency(
        {
          member_id: "m1",
          recipient_profile_id: "p1",
          kind: "birthday",
          notification_date: "2026-08-25",
        },
        existing,
      ),
    ).toBe(true);
    expect(
      checkIdempotency(
        {
          member_id: "m1",
          recipient_profile_id: "p2",
          kind: "birthday",
          notification_date: "2026-08-25",
        },
        existing,
      ),
    ).toBe(false);
  });

  it("batch chunking: 120 → 50/50/20", () => {
    const ids = Array.from({ length: 120 }, (_, i) => `m${i}`);
    const chunks = chunkBatch(ids, 50);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(50);
    expect(chunks[1]).toHaveLength(50);
    expect(chunks[2]).toHaveLength(20);
  });

  it("batch chunking: 50 → single chunk, 0 → empty", () => {
    expect(
      chunkBatch(
        Array.from({ length: 50 }, (_, i) => `m${i}`),
        50,
      ),
    ).toHaveLength(1);
    expect(chunkBatch([], 50)).toHaveLength(0);
  });
});
