import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  isRetreatPaymentBlocked,
  parsePositiveTotal,
  remainingBalance,
  retreatStatusLabel,
  sumPaidByRegistration,
} from '../payments'

const staffPagePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../app/(dashboard)/retreat-registrations/page.tsx',
)

const layoutPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../app/(dashboard)/layout.tsx',
)

const adminPagePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../app/(dashboard)/admin/page.tsx',
)

describe('parsePositiveTotal', () => {
  it('parses a stored positive total', () => {
    expect(parsePositiveTotal('150000')).toBe(150000)
    expect(parsePositiveTotal('150000.50')).toBe(150000.5)
  })

  it('returns null for missing, empty, non-numeric, or non-positive values', () => {
    expect(parsePositiveTotal(null)).toBeNull()
    expect(parsePositiveTotal('')).toBeNull()
    expect(parsePositiveTotal('   ')).toBeNull()
    expect(parsePositiveTotal('0')).toBeNull()
    expect(parsePositiveTotal('-5')).toBeNull()
    expect(parsePositiveTotal('not-a-number')).toBeNull()
  })
})

describe('remainingBalance', () => {
  it('subtracts the paid sum from a configured total', () => {
    expect(remainingBalance(100, 40)).toBe(60)
    expect(remainingBalance(100, 100)).toBe(0)
    expect(remainingBalance(100, 150)).toBe(-50)
  })

  it('returns null when total is not configured so remaining cannot be invented', () => {
    expect(remainingBalance(null, 40)).toBeNull()
  })
})

describe('isRetreatPaymentBlocked', () => {
  it('blocks payments until a positive total is stored', () => {
    expect(isRetreatPaymentBlocked(null)).toBe(true)
    expect(isRetreatPaymentBlocked('')).toBe(true)
    expect(isRetreatPaymentBlocked('0')).toBe(true)
    expect(isRetreatPaymentBlocked('150000')).toBe(false)
  })
})

describe('sumPaidByRegistration', () => {
  it('accumulates consecutive installments per registration', () => {
    const sums = sumPaidByRegistration([
      { registration_id: 'r1', amount: '40' },
      { registration_id: 'r1', amount: 10 },
      { registration_id: 'r2', amount: '25.50' },
    ])
    expect(sums.get('r1')).toBe(50)
    expect(sums.get('r2')).toBe(25.5)
    expect(sums.get('r3')).toBeUndefined()
  })
})

describe('retreatStatusLabel', () => {
  it('returns Spanish labels for each status', () => {
    expect(retreatStatusLabel('preinscrito')).toBe('Preinscrito')
    expect(retreatStatusLabel('pagos_parciales')).toBe('Pagos parciales')
    expect(retreatStatusLabel('inscrito')).toBe('Inscrito')
  })
})

describe('staff retreat page source', () => {
  it('guards with canManageRetreatRegistrations and does not use Dexie or AdminPage', () => {
    const source = readFileSync(staffPagePath, 'utf8')
    expect(source).toContain('canManageRetreatRegistrations')
    expect(source).toContain('No tiene permisos para acceder a esta sección')
    expect(source).toContain('getRetreatTotalCost')
    expect(source).toContain('retreat_payments')
    expect(source).toContain('recorded_by')
    expect(source).not.toMatch(/from ['"]@\/lib\/sync\/db['"]/)
    expect(source).not.toContain('AdminPage')
    expect(source).not.toMatch(/useRealtime|hydrateFromRemote/)
  })

  it('shows a cost editor only for canManageUsers', () => {
    const source = readFileSync(staffPagePath, 'utf8')
    expect(source).toContain('canManageUsers')
    expect(source).toContain('setRetreatTotalCost')
  })
})

describe('dashboard nav source', () => {
  it('exposes Retiro for canManageRetreatRegistrations', () => {
    const source = readFileSync(layoutPath, 'utf8')
    expect(source).toContain("href: '/retreat-registrations'")
    expect(source).toContain("label: 'Retiro'")
    expect(source).toContain('canManageRetreatRegistrations(role)')
  })
})

describe('admin page isolation', () => {
  it('does not bury retreat payments or total cost on AdminPage', () => {
    const source = readFileSync(adminPagePath, 'utf8')
    expect(source).not.toContain('retreat.youth.total_cost')
    expect(source).not.toContain('retreat_payments')
    expect(source).not.toContain('retreat_registrations')
  })
})
