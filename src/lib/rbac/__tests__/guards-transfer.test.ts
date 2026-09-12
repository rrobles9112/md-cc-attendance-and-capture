import { describe, it, expect } from "vitest";
import { canTransferRetreatToValientes } from "../guards";

describe("canTransferRetreatToValientes", () => {
  it("leader cannot transfer (super_admin-only mutation)", () => {
    expect(canTransferRetreatToValientes("leader")).toBe(false);
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
  it("is narrower than canManageRetreatRegistrations (view stays open)", () => {
    expect(canTransferRetreatToValientes("leader")).toBe(false);
    expect(canTransferRetreatToValientes("server")).toBe(false);
  });
});
