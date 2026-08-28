import { describe, it, expect } from "vitest";
import { parsePositiveTotal } from "../payments";
// isTransferEligible helper mirrors RPC gates (spec R1+R2, design AD-002 steps 4-5)
import { isTransferEligible } from "../transfer";

describe("payments-transfer (PR1 T-002 RED)", () => {
  it("parsePositiveTotal('') => null", () => {
    expect(parsePositiveTotal("")).toBeNull();
  });
  it("parsePositiveTotal('abc') => null", () => {
    expect(parsePositiveTotal("abc")).toBeNull();
  });
  it("parsePositiveTotal('0') => null", () => {
    expect(parsePositiveTotal("0")).toBeNull();
  });
  it("parsePositiveTotal('-10') => null", () => {
    expect(parsePositiveTotal("-10")).toBeNull();
  });
  it("parsePositiveTotal('400000') => 400000", () => {
    expect(parsePositiveTotal("400000")).toBe(400000);
  });
  it("isTransferEligible triage preinscrito -> not_inscrito", () => {
    expect(
      isTransferEligible({ status: "preinscrito", sum: 0, total: 400000, transferred_at: null }),
    ).toBe("not_inscrito");
  });
  it("isTransferEligible pagos_parciales 300k/400k -> not_inscrito", () => {
    expect(
      isTransferEligible({ status: "pagos_parciales", sum: 300000, total: 400000, transferred_at: null }),
    ).toBe("not_inscrito");
  });
  it("isTransferEligible inscrito 400k -> eligible", () => {
    expect(
      isTransferEligible({ status: "inscrito", sum: 400000, total: 400000, transferred_at: null }),
    ).toBe("eligible");
  });
  it("isTransferEligible transferred_at not null -> already_transferred", () => {
    expect(
      isTransferEligible({ status: "inscrito", sum: 400000, total: 400000, transferred_at: "2026-08-27T10:00:00Z" }),
    ).toBe("already_transferred");
  });
});
