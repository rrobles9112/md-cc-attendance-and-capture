import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFrom = vi.hoisted(() => vi.fn());
const mockGetSession = vi.hoisted(() => vi.fn());
const mockUpsert = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: mockFrom,
    auth: { getSession: mockGetSession },
  }),
}));

import {
  RETREAT_TOTAL_COST_KEY,
  getRetreatTotalCost,
  setRetreatTotalCost,
  setSetting,
} from "../app-settings";

function mockSelectSingle(result: {
  data: { value: string } | null;
  error: unknown;
}) {
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue(result),
      }),
    }),
  });
}

describe("retreat total cost helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the retreat.youth.total_cost key", () => {
    expect(RETREAT_TOTAL_COST_KEY).toBe("retreat.youth.total_cost");
  });

  it("returns the stored string without coercing it to a number", async () => {
    mockSelectSingle({ data: { value: "150000.50" }, error: null });

    await expect(getRetreatTotalCost()).resolves.toBe("150000.50");
  });

  it("returns null when the setting is missing and does not invent a numeric default", async () => {
    mockSelectSingle({ data: null, error: { code: "PGRST116" } });

    const result = await getRetreatTotalCost();
    expect(result).toBeNull();
    expect(result).not.toBe("0");
    expect(result).not.toBe("100");
  });

  it("returns the empty stored string as-is instead of a numeric default", async () => {
    mockSelectSingle({ data: { value: "" }, error: null });

    const result = await getRetreatTotalCost();
    expect(result).toBe("");
    expect(result).not.toBe("0");
    expect(result).not.toBe("100");
  });

  it("persists the value through setSetting on retreat.youth.total_cost", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
    });
    mockUpsert.mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ upsert: mockUpsert });

    await setRetreatTotalCost("250000");

    expect(mockFrom).toHaveBeenCalledWith("app_settings");
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "retreat.youth.total_cost",
        value: "250000",
        updated_by: "user-1",
      }),
      { onConflict: "key" },
    );
  });

  // T-UNIT-1: explicit onConflict target (RED: single-arg upsert today)
  it("T-UNIT-1 calls upsert with explicit onConflict key", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
    });
    mockUpsert.mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ upsert: mockUpsert });

    await setSetting("retreat.youth.total_cost", "480000");

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "retreat.youth.total_cost",
        value: "480000",
        updated_by: "user-1",
      }),
      { onConflict: "key" },
    );
  });

  // T-UNIT-2: 42501 -> permission-denied
  it("T-UNIT-2 maps 42501 to permission-denied", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
    });
    mockUpsert.mockResolvedValue({
      error: {
        code: "42501",
        message: "new row violates row-level security policy",
      },
    });
    mockFrom.mockReturnValue({ upsert: mockUpsert });

    await expect(
      setSetting("retreat.youth.total_cost", "480000"),
    ).rejects.toMatchObject({
      code: "permission-denied",
    });
  });

  // T-UNIT-3: network failures -> network
  it.each([
    [new TypeError("fetch failed")],
    [new TypeError("Failed to fetch")],
    [Object.assign(new Error("Failed to fetch"), { name: "NetworkError" })],
  ])("T-UNIT-3 maps %s to network", async (err) => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
    });
    mockUpsert.mockRejectedValue(err);
    mockFrom.mockReturnValue({ upsert: mockUpsert });

    await expect(
      setSetting("retreat.youth.total_cost", "480000"),
    ).rejects.toMatchObject({ code: "network" });
  });

  // T-UNIT-4: no session preserved, upsert not called
  it("T-UNIT-4 rejects Not authenticated without calling upsert", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockUpsert.mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ upsert: mockUpsert });

    await expect(
      setSetting("retreat.youth.total_cost", "480000"),
    ).rejects.toThrow("Not authenticated");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  // T-UNIT-5: DPO key regression — same onConflict + 42501 mapping
  it("T-UNIT-5 DPO key uses onConflict and maps 42501", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
    });
    mockUpsert.mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ upsert: mockUpsert });

    await setSetting("dpo_contact_email", "x@y.z");

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ key: "dpo_contact_email" }),
      { onConflict: "key" },
    );

    mockUpsert.mockResolvedValue({
      error: { code: "42501", message: "denied" },
    });
    await expect(
      setSetting("dpo_contact_email", "x@y.z"),
    ).rejects.toMatchObject({
      code: "permission-denied",
    });
  });
});
