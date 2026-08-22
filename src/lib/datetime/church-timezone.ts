export const CHURCH_TIMEZONE = 'America/Bogota'

/**
 * Returns the current calendar date ('YYYY-MM-DD') in the church timezone.
 * Used as the canonical "session date" reference across the app.
 */
export function calendarDateInChurchTimezone(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CHURCH_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}
