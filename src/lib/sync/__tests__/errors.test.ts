import { describe, it, expect } from 'vitest'
import { formatSyncError, getSyncErrorCode, isPermanentSyncError } from '../errors'

describe('formatSyncError', () => {
  it('serializes plain PostgREST error objects instead of "[object Object]"', () => {
    const err = {
      message: 'duplicate key value violates unique constraint "attendance_member_id_session_id_key"',
      code: '23505',
      details: 'Key (member_id, session_id)=(m1, s1) already exists.',
      hint: null,
    }
    const formatted = formatSyncError(err)
    expect(formatted).not.toBe('[object Object]')
    expect(formatted).toContain('duplicate key value violates unique constraint')
    expect(formatted).toContain('23505')
  })

  it('uses Error.message for Error instances', () => {
    expect(formatSyncError(new Error('Sync request timed out after 10000ms'))).toBe(
      'Sync request timed out after 10000ms',
    )
  })

  it('falls back to String() for primitives', () => {
    expect(formatSyncError('offline')).toBe('offline')
  })
})

describe('getSyncErrorCode / isPermanentSyncError', () => {
  it('extracts the Postgres code from plain error objects', () => {
    expect(getSyncErrorCode({ code: '42501', message: 'denied' })).toBe('42501')
    expect(getSyncErrorCode(new Error('boom'))).toBeUndefined()
  })

  it('classifies RLS and constraint violations as permanent', () => {
    expect(isPermanentSyncError({ code: '42501' })).toBe(true)
    expect(isPermanentSyncError({ code: '23505' })).toBe(true)
    expect(isPermanentSyncError({ code: '23503' })).toBe(true)
    expect(isPermanentSyncError({ code: '08006' })).toBe(false)
    expect(isPermanentSyncError(new Error('network'))).toBe(false)
  })
})
