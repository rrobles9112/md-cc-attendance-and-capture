import { RETREAT_EVENT_KEY } from './constants.ts'

export const SEED_MARKER_DOMAIN = '@seed.retiro.test'
export const SEED_CONSENT_POLICY_VERSION = 'pdtp-v1.0-2026-07-17'

export type SeedBucket = 'preinscrito' | 'pagos_parciales' | 'inscrito'
export interface SeedPaymentPlan { amount: number }
export interface SeedPlan {
  index: number
  bucket: SeedBucket
  name: string
  email: string
  phone: string
  eventKey: string
  generalConsentAcceptedAt: string
  generalConsentPolicyVersion: string
  recordedBy: string
  payments: SeedPaymentPlan[]
}
export interface SeedCohortOptions {
  seed: string
  size: number
  totalCost: number
  now: string
  recordedBy: string
}

const BUCKETS: SeedBucket[] = ['preinscrito', 'pagos_parciales', 'inscrito']
const FIRST_NAMES = ['Sofía','Mateo','Valentina','Santiago','Isabella','Sebastián','Luciana','Samuel','Mariana','Nicolás','Camila','Daniel','Gabriela','Alejandro','Valeria','Juan','Lucía','David','Sara','Miguel','Ana','Carlos','Laura','Andrés','Daniela','Felipe','Catalina','Jorge','Manuela','Diego']
const LAST_NAMES = ['García','Rodríguez','Martínez','López','González','Pérez','Sánchez','Ramírez','Torres','Flores','Rivera','Gómez','Díaz','Reyes','Morales','Cruz','Ortiz','Gutiérrez','Mendoza','Vargas','Silva','Castro','Romero','Álvarez','Rojas','Ortega','Suárez','Navarro','Peña','Herrera']

function fnv1a32(str: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function mulberry32(a: number): () => number {
  return function () {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function validateOptions(options: SeedCohortOptions): void {
  if (typeof options.seed !== 'string' || options.seed.length === 0) throw new TypeError('seed must be a non-empty string')
  if (!Number.isInteger(options.size) || options.size < 1) throw new RangeError('size must be an integer >= 1')
  if (!Number.isFinite(options.totalCost) || options.totalCost <= 0) throw new RangeError('totalCost must be a positive finite number')
  if (typeof options.now !== 'string' || Number.isNaN(Date.parse(options.now))) throw new RangeError('now must be an ISO-parsable date string')
  if (typeof options.recordedBy !== 'string' || options.recordedBy.trim().length === 0) throw new TypeError('recordedBy must be a non-empty string')
}

export function summarizeBuckets(plans: SeedPlan[]): Record<SeedBucket, number> {
  const counts: Record<SeedBucket, number> = { preinscrito: 0, pagos_parciales: 0, inscrito: 0 }
  for (const p of plans) counts[p.bucket] += 1
  return counts
}

export function buildSeedCohort(options: SeedCohortOptions): SeedPlan[] {
  validateOptions(options)
  const { seed, size, totalCost, now, recordedBy } = options
  const hash = fnv1a32(seed)
  const rand = mulberry32(hash)
  const totalCents = Math.round(totalCost * 100)
  const seedTag = hash.toString(16).padStart(8, '0').slice(0, 6).toLowerCase()
  const seedDigits = String(hash % 1000).padStart(3, '0')
  function randInt(min: number, max: number): number { return Math.floor(rand() * (max - min + 1)) + min }
  const plans: SeedPlan[] = []
  for (let i = 0; i < size; i++) {
    const bucket = BUCKETS[i % 3]
    const firstName = FIRST_NAMES[randInt(0, FIRST_NAMES.length - 1)]
    const lastName = LAST_NAMES[randInt(0, LAST_NAMES.length - 1)]
    const name = `${firstName} ${lastName}`
    const email = `qa-${seedTag}-${String(i).padStart(3, '0')}${SEED_MARKER_DOMAIN}`
    const phone = `57310${seedDigits}${String(i).padStart(4, '0')}`
    let payments: SeedPaymentPlan[] = []
    if (bucket === 'preinscrito') {
      payments = []
    } else if (bucket === 'pagos_parciales') {
      const f = 0.2 + rand() * 0.6
      let target = Math.floor(totalCents * f)
      if (totalCents <= 1) target = 1
      else target = Math.max(1, Math.min(target, totalCents - 1))
      let k = randInt(1, 2)
      k = Math.min(k, target)
      if (k <= 1) payments = [{ amount: target / 100 }]
      else {
        const first = randInt(1, target - 1)
        payments = [{ amount: first / 100 }, { amount: (target - first) / 100 }]
      }
    } else {
      let k = randInt(2, 3)
      if (totalCents < k) payments = [{ amount: totalCents / 100 }]
      else if (k === 2) {
        const first = randInt(1, totalCents - 1)
        payments = [{ amount: first / 100 }, { amount: (totalCents - first) / 100 }]
      } else {
        const first = randInt(1, totalCents - 2)
        const remaining = totalCents - first
        const second = randInt(1, remaining - 1)
        const third = totalCents - first - second
        payments = [{ amount: first / 100 }, { amount: second / 100 }, { amount: third / 100 }]
      }
    }
    plans.push({ index: i, bucket, name, email: email.toLowerCase(), phone, eventKey: RETREAT_EVENT_KEY, generalConsentAcceptedAt: now, generalConsentPolicyVersion: SEED_CONSENT_POLICY_VERSION, recordedBy, payments })
  }
  return plans
}
