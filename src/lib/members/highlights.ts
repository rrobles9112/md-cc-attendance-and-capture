import type { Member } from "@/lib/sync/db";
import { calendarDateInChurchTimezone } from "@/lib/datetime/church-timezone";

export interface MemberHighlight {
  id: string;
  name: string;
  /** Birthday: day of month. New members: unused (always 0). */
  day: number;
  /** Birthday: original `birthday` value. New members: original `created_at` value. */
  date: string;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns the calendar date exactly `days` before `date`, computed with
 * UTC-safe date arithmetic (no local timezone involvement).
 */
function shiftCalendarDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Parses a 'YYYY-MM-DD' string and validates it as a real calendar date.
 * Returns the (year, month, day) tuple or null when malformed or invalid.
 */
function parseIsoDate(
  value: string | undefined | null,
): [number, number, number] | null {
  if (!value || !ISO_DATE_PATTERN.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return [year, month, day];
}

function isNotDeleted(member: Member): boolean {
  return member.deleted_at === null || member.deleted_at === undefined;
}

/**
 * Members whose birthday falls in the calendar month of `today`, sorted by
 * day ascending. Invalid or incomplete birthdays (not 'YYYY-MM-DD' or not a
 * real calendar date) are excluded. Soft-deleted members are excluded as an
 * extra defense even though callers typically filter them already.
 */
export function getBirthdaysOfMonth(
  members: Member[],
  today: string = calendarDateInChurchTimezone(),
): MemberHighlight[] {
  const currentMonth = parseIsoDate(today)?.[1];
  if (currentMonth === undefined) return [];

  return members
    .filter(isNotDeleted)
    .map((member) => {
      const parsed = parseIsoDate(member.birthday);
      if (!parsed || parsed[1] !== currentMonth) return null;
      return {
        id: member.id,
        name: member.name,
        day: parsed[2],
        date: member.birthday as string,
      } satisfies MemberHighlight;
    })
    .filter((highlight): highlight is MemberHighlight => highlight !== null)
    .sort((a, b) => a.day - b.day);
}

/**
 * Members registered within the last `days` calendar days, inclusive of both
 * endpoints: a member counts as new when
 * `cutoff <= createdDate <= today`, where `createdDate` is the date part of
 * `created_at` (first 10 chars) and `cutoff` is the calendar date exactly
 * `days - 1` days before `today` (e.g. for days = 30, cutoff = today - 29).
 * Future registrations and soft-deleted members are excluded. Results are
 * sorted by `created_at` descending (newest first). Cutoff arithmetic is
 * UTC-safe calendar math, never local-time `toISOString`.
 */
export function getNewMembers(
  members: Member[],
  today: string = calendarDateInChurchTimezone(),
  days = 30,
): MemberHighlight[] {
  const todayParsed = parseIsoDate(today);
  if (!todayParsed || days < 1) return [];
  const cutoff = shiftCalendarDate(today, -(days - 1));

  return members
    .filter(isNotDeleted)
    .map((member) => {
      const createdDate = member.created_at.slice(0, 10);
      const parsed = parseIsoDate(createdDate);
      if (!parsed) return null;
      // Inclusive calendar window: cutoff <= createdDate <= today.
      if (createdDate < cutoff || createdDate > today) return null;
      return {
        id: member.id,
        name: member.name,
        day: 0,
        date: member.created_at,
      } satisfies MemberHighlight;
    })
    .filter((highlight): highlight is MemberHighlight => highlight !== null)
    .sort((a, b) => b.date.localeCompare(a.date));
}
