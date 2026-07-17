type ARCOType = 'access' | 'rectification' | 'cancellation' | 'opposition'

const DEADLINE_BUSINESS_DAYS: Record<ARCOType, number> = {
  access: 10,
  rectification: 15,
  cancellation: 15,
  opposition: 15,
}

// Colombian holidays — static list for 2026 (future enhancement: dynamic calendar)
// TODO: Integrate a holiday API or database for automatic year updates
const COLOMBIAN_HOLIDAYS_2026: string[] = [
  '2026-01-01', // Año Nuevo
  '2026-01-06', // Reyes Magos
  '2026-03-23', // San José
  '2026-04-02', // Jueves Santo
  '2026-04-03', // Viernes Santo
  '2026-04-26', // Día del Trabajo (observado)
  '2026-05-01', // Día del Trabajo
  '2026-05-18', // Ascensión
  '2026-06-08', // Corpus Christi
  '2026-06-15', // Sagrado Corazón
  '2026-06-29', // San Pedro y San Pablo
  '2026-07-20', // Independencia
  '2026-08-07', // Batalla de Boyacá
  '2026-08-17', // Asunción (observado)
  '2026-10-12', // Día de la Raza
  '2026-11-01', // Todos los Santos
  '2026-11-11', // Independencia de Cartagena
  '2026-11-25', // Inmaculada Concepción (observado)
  '2026-12-08', // Inmaculada Concepción
  '2026-12-25', // Navidad
]

function isWeekend(date: Date): boolean {
  const day = date.getDay()
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
    result.setDate(result.getDate() + 1)
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
  const today = new Date()
  if (today >= deadline) return 0

  let count = 0
  const current = new Date(today)

  while (current < deadline) {
    current.setDate(current.getDate() + 1)
    if (!isWeekend(current) && !isHoliday(current)) {
      count++
    }
  }

  return count
}
