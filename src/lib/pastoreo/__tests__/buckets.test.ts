import { describe, it, expect } from "vitest";
import {
  ageBucket,
  sexBucket,
  isLeapYear,
  formatDigestGroup,
} from "@/lib/pastoreo/buckets";

describe("pastoreo/buckets — age buckets, sex, leap year", () => {
  it("age_bucket CASE: 5→0-12, 15→13-17, 22→18-25, 30→26-35, 40→36-50, 60→51+", () => {
    expect(ageBucket(5)).toBe("0-12");
    expect(ageBucket(15)).toBe("13-17");
    expect(ageBucket(22)).toBe("18-25");
    expect(ageBucket(30)).toBe("26-35");
    expect(ageBucket(40)).toBe("36-50");
    expect(ageBucket(60)).toBe("51+");
  });

  it("age_bucket NULL returns null", () => {
    expect(ageBucket(null)).toBeNull();
  });

  it("age bucket boundaries: 12→0-12, 13→13-17, 18→18-25, 26→26-35, 36→36-50, 51→51+", () => {
    expect(ageBucket(12)).toBe("0-12");
    expect(ageBucket(13)).toBe("13-17");
    expect(ageBucket(18)).toBe("18-25");
    expect(ageBucket(26)).toBe("26-35");
    expect(ageBucket(36)).toBe("36-50");
    expect(ageBucket(51)).toBe("51+");
  });

  it('sex bucket: M/F/other/prefer_not_to_say pass through, NULL→"No especificado"', () => {
    expect(sexBucket("M")).toBe("M");
    expect(sexBucket("F")).toBe("F");
    expect(sexBucket("other")).toBe("other");
    expect(sexBucket("prefer_not_to_say")).toBe("prefer_not_to_say");
    expect(sexBucket(null)).toBe("No especificado");
    expect(sexBucket(undefined)).toBe("No especificado");
  });

  it("isLeapYear helper", () => {
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2027)).toBe(false);
    expect(isLeapYear(2028)).toBe(true);
  });

  it("Feb29 on Feb28 non-leap inclusion: isLeapYear guard for digest query", () => {
    // Feb 29 birthday in non-leap year should match Feb 28
    const isLeap2027 = isLeapYear(2027);
    expect(isLeap2027).toBe(false);
    // caller will do: if (!isLeapYear(y) && month===2 && day===28) include Feb29 births
  });

  it('digest grouping: "Ana (40), Luis (22)" with age_today', () => {
    const group = formatDigestGroup([
      { name: "Ana", age: 40 },
      { name: "Luis", age: 22 },
    ]);
    expect(group).toBe("Ana (40), Luis (22)");
  });

  it("digest grouping empty returns empty string", () => {
    expect(formatDigestGroup([])).toBe("");
  });

  it("digest grouping single celebrant", () => {
    expect(formatDigestGroup([{ name: "Marta", age: 35 }])).toBe("Marta (35)");
  });
});
