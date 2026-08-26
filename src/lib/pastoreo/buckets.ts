export type AgeBucket = "0-12" | "13-17" | "18-25" | "26-35" | "36-50" | "51+";

export function ageBucket(ageYears: number | null): AgeBucket | null {
  if (ageYears == null) return null;
  if (ageYears < 13) return "0-12";
  if (ageYears < 18) return "13-17";
  if (ageYears < 26) return "18-25";
  if (ageYears < 36) return "26-35";
  if (ageYears < 51) return "36-50";
  return "51+";
}

export function sexBucket(sex: string | null | undefined): string {
  if (sex == null || sex === "") return "No especificado";
  return sex;
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function formatDigestGroup(
  celebrants: Array<{ name: string; age: number }>,
): string {
  if (celebrants.length === 0) return "";
  return celebrants.map((c) => `${c.name} (${c.age})`).join(", ");
}
