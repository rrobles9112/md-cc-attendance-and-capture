import { describe, it, expect } from "vitest";
import { canTransferRetreatToValientes } from "../guards";

describe("canTransferRetreatToValientes (PR1 T-001 RED)", () => {
  it("leader can transfer", () => {
    expect(canTransferRetreatToValientes("leader")).toBe(true);
  });
  it("super_admin can transfer", () => {
    expect(canTransferRetreatToValientes("super_admin")).toBe(true);
  });
  it("server cannot transfer", () => {
    expect(canTransferRetreatToValientes("server")).toBe(false);
  });
  it("null/undefined cannot transfer (anon proxy)", () => {
    expect(canTransferRetreatToValientes(null as any)).toBe(false);
    expect(canTransferRetreatToValientes(undefined as any)).toBe(false);
    expect(canTransferRetreatToValientes("" as any)).toBe(false);
  });
  it("reuses canCreate semantics (single line delegation)", () => {
    // must be exactly canCreate behavior, not wider than canManageRetreatRegistrations
    expect(canTransferRetreatToValientes("leader")).toBe(true);
    expect(canTransferRetreatToValientes("server")).toBe(false);
  });
});
