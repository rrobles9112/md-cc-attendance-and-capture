import { describe, it, expect } from "vitest";
import {
  escapeIlikeSearch,
  buildSearchOrFilter,
  getPaginationRange,
  RETREAT_REGISTRATIONS_SELECT,
  computeRowAbonos,
  formatPercent,
  formatLastPayment,
} from "../queries";

describe("retreat/queries — build query + abonos aggregates (PR2 T-005/T-013)", () => {
  it("escapeIlikeSearch escapes %, _, \\ , comma", () => {
    expect(escapeIlikeSearch("a%b_c\\d,e")).toBe("a\\%b\\_c\\\\d\\,e");
  });

  it("buildSearchOrFilter returns null for empty", () => {
    expect(buildSearchOrFilter("")).toBeNull();
    expect(buildSearchOrFilter("   ")).toBeNull();
  });

  it("buildSearchOrFilter builds or ilike for ana", () => {
    expect(buildSearchOrFilter("ana")).toBe(
      "name.ilike.%ana%,email.ilike.%ana%,phone.ilike.%ana%",
    );
  });

  it("buildSearchOrFilter escapes pattern", () => {
    expect(buildSearchOrFilter("a%ana")).toBe(
      "name.ilike.%a\\%ana%,email.ilike.%a\\%ana%,phone.ilike.%a\\%ana%",
    );
  });

  it("getPaginationRange page 1 size 20 => 0-19", () => {
    expect(getPaginationRange(1, 20)).toEqual({ from: 0, to: 19 });
  });

  it("getPaginationRange page 2 size 20 => 20-39", () => {
    expect(getPaginationRange(2, 20)).toEqual({ from: 20, to: 39 });
  });

  it("RETREAT_REGISTRATIONS_SELECT contains required fields", () => {
    expect(RETREAT_REGISTRATIONS_SELECT).toContain("transferred_at");
    expect(RETREAT_REGISTRATIONS_SELECT).toContain("member_id");
  });

  it("computeRowAbonos 200k+100k total 400k => 75% 2 last", () => {
    const payments = [
      { amount: 200000, created_at: "2026-08-10T10:00:00Z" },
      { amount: 100000, created_at: "2026-08-12T10:00:00Z" },
    ];
    const result = computeRowAbonos(payments, "400000");
    expect(result.paid).toBe(300000);
    expect(result.remaining).toBe(100000);
    expect(result.percent).toBe(75);
    expect(result.count).toBe(2);
    expect(result.last).toBe("2026-08-12T10:00:00Z");
  });

  it("computeRowAbonos total null => remaining null percent null", () => {
    const payments = [{ amount: 100000, created_at: "2026-08-10T10:00:00Z" }];
    const result = computeRowAbonos(payments, null);
    expect(result.remaining).toBeNull();
    expect(result.percent).toBeNull();
    expect(result.paid).toBe(100000);
  });

  it("computeRowAbonos 0 payments => paid 0", () => {
    const result = computeRowAbonos([], "400000");
    expect(result.paid).toBe(0);
    expect(result.count).toBe(0);
    expect(result.last).toBeNull();
  });

  it("formatPercent formats es-CO like 75", () => {
    expect(formatPercent(75)).toMatch(/75/);
  });

  it("formatLastPayment formats es-CO date", () => {
    const out = formatLastPayment("2026-08-12T15:00:00Z");
    expect(out).toBeTruthy();
    expect(typeof out).toBe("string");
  });
});
