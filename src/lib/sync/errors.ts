// Supabase/PostgREST failures are plain objects ({ message, code, details,
// hint }), not Error instances. String(err) on those yields "[object Object]",
// which is what used to be stored in sync_queue.error and shown in the admin
// sync panel — hiding the real reason a local record failed to synchronize.

export function getSyncErrorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

export function formatSyncError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object') {
    const e = err as {
      message?: unknown
      code?: unknown
      details?: unknown
      hint?: unknown
    }
    if (typeof e.message === 'string' && e.message) {
      const parts = [e.message]
      if (typeof e.code === 'string' && e.code) parts.push(`[${e.code}]`)
      if (typeof e.details === 'string' && e.details) parts.push(e.details)
      if (typeof e.hint === 'string' && e.hint) parts.push(e.hint)
      return parts.join(' — ')
    }
  }
  return String(err)
}

// Postgres/PostgREST error codes that will never succeed on retry: RLS denial,
// uniqueness/FK/check violations, and malformed input. Retrying these wastes
// flush cycles and leaves the real reason hidden behind a generic "pending"
// status until the 5-attempt cap is finally hit.
const PERMANENT_POSTGRES_ERROR_CODES = new Set([
  '42501', // insufficient_privilege — row-level security policy rejected the write
  '23505', // unique_violation
  '23503', // foreign_key_violation
  '23514', // check_violation
  '22P02', // invalid_text_representation
])

export function isPermanentSyncError(err: unknown): boolean {
  const code = getSyncErrorCode(err)
  return typeof code === 'string' && PERMANENT_POSTGRES_ERROR_CODES.has(code)
}
