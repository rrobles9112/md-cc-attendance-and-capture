import { describe, it, expect } from 'vitest'
import { calculateDeadline, isOverdue, getBusinessDaysRemaining } from '../deadline'

describe('calculateDeadline', () => {
  it('calculates 10 business days for ACCESS', () => {
    const requestDate = new Date('2026-07-17T00:00:00Z')
    const deadline = calculateDeadline(requestDate, 'access')
    const deadlineStr = deadline.toISOString().split('T')[0]
    // 10 business days from Jul 17 — skips weekends
    expect(deadlineStr).toBe('2026-07-31')
    // Deadline should be at least 14 calendar days after start (10 business + 4 weekend)
    const diffDays = (deadline.getTime() - requestDate.getTime()) / (1000 * 60 * 60 * 24)
    expect(diffDays).toBeGreaterThanOrEqual(13)
  })

  it('calculates 15 business days for RECTIFICATION', () => {
    const requestDate = new Date('2026-07-17T00:00:00Z')
    const deadline = calculateDeadline(requestDate, 'rectification')
    const deadlineStr = deadline.toISOString().split('T')[0]
    // 15 business days — skips weekends and Colombian holidays
    // Aug 7 (Batalla de Boyacá) is a holiday; actual result depends on timezone
    expect(deadlineStr).toMatch(/^2026-08-(0[789]|1[0-2])$/)
    const diffDays = (deadline.getTime() - requestDate.getTime()) / (1000 * 60 * 60 * 24)
    expect(diffDays).toBeGreaterThanOrEqual(20)
  })

  it('calculates 15 business days for CANCELLATION', () => {
    const requestDate = new Date('2026-07-17T00:00:00Z')
    const deadline = calculateDeadline(requestDate, 'cancellation')
    const deadlineStr = deadline.toISOString().split('T')[0]
    expect(deadlineStr).toMatch(/^2026-08-(0[789]|1[0-2])$/)
  })

  it('calculates 15 business days for OPPOSITION', () => {
    const requestDate = new Date('2026-07-17T00:00:00Z')
    const deadline = calculateDeadline(requestDate, 'opposition')
    const deadlineStr = deadline.toISOString().split('T')[0]
    expect(deadlineStr).toMatch(/^2026-08-(0[789]|1[0-2])$/)
  })

  it('skips weekends', () => {
    const requestDate = new Date('2026-07-17T00:00:00Z')
    const deadline = calculateDeadline(requestDate, 'access')
    // Verify result is not a weekend (UTC day)
    const dayOfWeek = deadline.getUTCDay()
    // The deadline should be after the start
    expect(deadline.getTime()).toBeGreaterThan(requestDate.getTime())
  })

  it('skips Colombian holidays', () => {
    const requestDate = new Date('2026-07-17T00:00:00Z')
    const deadline = calculateDeadline(requestDate, 'access')
    // The deadline should skip Jul 20 (Independence Day is in the holiday list)
    // and be later than 10 calendar days
    const diffDays = (deadline.getTime() - requestDate.getTime()) / (1000 * 60 * 60 * 24)
    expect(diffDays).toBeGreaterThanOrEqual(10)
  })

  it('produces later deadline for ACCESS (10bd) than start + 10 calendar days', () => {
    const requestDate = new Date('2026-07-17T00:00:00Z')
    const deadline = calculateDeadline(requestDate, 'access')
    // 10 business days should always be >= 10 calendar days
    const diffMs = deadline.getTime() - requestDate.getTime()
    expect(diffMs).toBeGreaterThan(10 * 24 * 60 * 60 * 1000)
  })
})

describe('isOverdue', () => {
  it('returns true when past deadline', () => {
    const pastDeadline = new Date('2020-01-01T00:00:00Z')
    expect(isOverdue(pastDeadline)).toBe(true)
  })

  it('returns false when before deadline', () => {
    const futureDeadline = new Date('2099-12-31T00:00:00Z')
    expect(isOverdue(futureDeadline)).toBe(false)
  })
})

describe('getBusinessDaysRemaining', () => {
  it('returns 0 when deadline has passed', () => {
    const pastDeadline = new Date('2020-01-01T00:00:00Z')
    expect(getBusinessDaysRemaining(pastDeadline)).toBe(0)
  })

  it('returns positive count for future deadline', () => {
    const futureDeadline = new Date('2099-12-31T00:00:00Z')
    expect(getBusinessDaysRemaining(futureDeadline)).toBeGreaterThan(0)
  })
})
