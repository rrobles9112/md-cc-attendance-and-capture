export type RetreatStatus = 'preinscrito' | 'pagos_parciales' | 'inscrito'

export function normalizeRetreatCostInput(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') return trimmed
  if (trimmed.includes(',')) {
    return trimmed.replace(/\./g, '').replace(',', '.')
  }
  if (/^\d{1,3}(\.\d{3})+$/.test(trimmed)) {
    return trimmed.replace(/\./g, '')
  }
  return trimmed
}

export function parsePositiveTotal(value: string | null): number | null {
  if (value === null) return null
  const normalized = normalizeRetreatCostInput(value)
  if (normalized === '') return null
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

export function remainingBalance(total: number | null, sumPaid: number): number | null {
  if (total === null) return null
  return total - sumPaid
}

export function isRetreatPaymentBlocked(storedTotal: string | null): boolean {
  return parsePositiveTotal(storedTotal) === null
}

export function sumPaidByRegistration(
  payments: Array<{ registration_id: string; amount: number | string }>,
): Map<string, number> {
  const sums = new Map<string, number>()
  for (const payment of payments) {
    const amount = typeof payment.amount === 'number' ? payment.amount : Number(payment.amount)
    const next = (sums.get(payment.registration_id) ?? 0) + (Number.isFinite(amount) ? amount : 0)
    sums.set(payment.registration_id, next)
  }
  return sums
}

export function retreatStatusLabel(status: RetreatStatus): string {
  switch (status) {
    case 'preinscrito':
      return 'Preinscrito'
    case 'pagos_parciales':
      return 'Pagos parciales'
    case 'inscrito':
      return 'Inscrito'
    default: {
      const exhaustive: never = status
      return exhaustive
    }
  }
}
