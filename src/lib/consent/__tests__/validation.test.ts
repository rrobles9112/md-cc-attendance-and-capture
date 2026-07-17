import { describe, it, expect } from 'vitest'
import {
  validateGeneralConsent,
  validateSensitiveConsent,
  checkMinorStatus,
  validateMinorFields,
} from '../validation'

describe('validateGeneralConsent', () => {
  it('returns invalid when unchecked', () => {
    const result = validateGeneralConsent(false)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('obligatorio')
  })

  it('returns valid when checked', () => {
    const result = validateGeneralConsent(true)
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })
})

describe('validateSensitiveConsent', () => {
  it('returns valid when unchecked (optional)', () => {
    const result = validateSensitiveConsent(false)
    expect(result.valid).toBe(true)
  })

  it('returns valid when checked', () => {
    const result = validateSensitiveConsent(true)
    expect(result.valid).toBe(true)
  })
})

describe('checkMinorStatus', () => {
  it('detects minor (under 18)', () => {
    const recent = new Date()
    recent.setFullYear(recent.getFullYear() - 10)
    const result = checkMinorStatus(recent)
    expect(result.isMinor).toBe(true)
    expect(result.requiresLegalRep).toBe(true)
  })

  it('detects adult (18+)', () => {
    const adult = new Date()
    adult.setFullYear(adult.getFullYear() - 25)
    const result = checkMinorStatus(adult)
    expect(result.isMinor).toBe(false)
    expect(result.requiresLegalRep).toBe(false)
  })

  it('detects exactly 18 as adult', () => {
    const exactly18 = new Date()
    exactly18.setFullYear(exactly18.getFullYear() - 18)
    const result = checkMinorStatus(exactly18)
    expect(result.isMinor).toBe(false)
    expect(result.requiresLegalRep).toBe(false)
  })

  it('detects almost 18 as minor', () => {
    const almost18 = new Date()
    almost18.setFullYear(almost18.getFullYear() - 18)
    almost18.setDate(almost18.getDate() + 1)
    const result = checkMinorStatus(almost18)
    expect(result.isMinor).toBe(true)
    expect(result.requiresLegalRep).toBe(true)
  })
})

describe('validateMinorFields', () => {
  it('returns valid for non-minor without legal rep', () => {
    const result = validateMinorFields(false)
    expect(result.valid).toBe(true)
  })

  it('returns invalid for minor without legal rep', () => {
    const result = validateMinorFields(true)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('representante legal')
  })

  it('returns invalid for minor with empty legal rep', () => {
    const result = validateMinorFields(true, '  ')
    expect(result.valid).toBe(false)
  })

  it('returns valid for minor with legal rep', () => {
    const result = validateMinorFields(true, 'María Pérez')
    expect(result.valid).toBe(true)
  })
})
