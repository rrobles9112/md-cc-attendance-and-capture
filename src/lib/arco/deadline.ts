type ARCOType = 'access' | 'rectification' | 'cancellation' | 'opposition'

const DEADLINE_BUSINESS_DAYS: Record<ARCOType, number> = {
  access: 10,
  rectification: 15,
  cancellation: 15,
  opposition: 15,
}

// Colombian holidays — observed dates for 2026 (future enhancement: dynamic calendar).
// Per Law 51 of 1983, religious/civic holidays that do not fall on Monday are moved to the
// following Monday ("puente festivo"). Fixed (non-movable) holidays are:
// Año Nuevo (Jan 1), Día del Trabajo (May 1), Independencia (Jul 20),
// Batalla de Boyacá (Aug 7), Inmaculada Concepción (Dec 8), Navidad (Dec 25).
// TODO: Integrate a holiday API or database for automatic year updates.
const COLOMBIAN_HOLIDAYS_2026: string[] = [
  '2026-01-01', // Año Nuevo (fixed)
  '2026-01-12', // Reyes Magos (observed; moved from Jan 6, Tue)
  '2026-03-23', // San José (observed; moved from Mar 19, Thu)
  '2026-04-02', // Jueves Santo
  '2026-04-03', // Viernes Santo
  '2026-05-01', // Día del Trabajo (fixed)
  '2026-05-18', // Ascensión (observed; moved from May 14, Thu)
  '2026-06-08', // Corpus Christi (observed; moved from Jun 4, Thu)
  '2026-06-15', // Sagrado Corazón (observed; moved from Jun 12, Fri)
  '2026-06-29', // San Pedro y San Pablo (Monday)
  '2026-07-20', // Independencia (fixed)
  '2026-08-07', // Batalla de Boyacá (fixed)
  '2026-08-17', // Asunción (observed; moved from Aug 15, Sat)
  '2026-10-12', // Día de la Raza (Monday)
  '2026-11-02', // Todos los Santos (observed; moved from Nov 1, Sun)
  '2026-11-16', // Independencia de Cartagena (observed; moved from Nov 11, Wed)
  '2026-12-08', // Inmaculada Concepción (fixed)
  '2026-12-25', // Navidad (fixed)
]

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay()
  return day === 0 || day === 6
}

function isHoliday(date: Date): boolean {
  const dateStr = date.toISOString().split('T')[0]
  return COLOMBIAN_HOLIDAYS_2026.includes(dateStr)
}

function addBusinessDays(startDate: Date, days: number): Date {
  const result = new Date(startDate)
  let added = 0

  while (added < days) {
    result.setUTCDate(result.getUTCDate() + 1)
    if (!isWeekend(result) && !isHoliday(result)) {
      added++
    }
  }

  return result
}

export function calculateDeadline(requestDate: Date, type: ARCOType): Date {
  const businessDays = DEADLINE_BUSINESS_DAYS[type]
  return addBusinessDays(requestDate, businessDays)
}

export function isOverdue(deadline: Date): boolean {
  return new Date() > deadline
}

export function getBusinessDaysRemaining(deadline: Date): number {
  const now = new Date()
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  if (todayUtc >= deadline) return 0

  let count = 0
  const current = new Date(todayUtc)

  while (current < deadline) {
    current.setUTCDate(current.getUTCDate() + 1)
    if (!isWeekend(current) && !isHoliday(current)) {
      count++
    }
  }

  return count
}
