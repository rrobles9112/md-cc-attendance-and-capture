import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const mockSelect = vi.hoisted(() => vi.fn())
const mockEq = vi.hoisted(() => vi.fn())
const mockOrder = vi.hoisted(() => vi.fn())
const mockRange = vi.hoisted(() => vi.fn())
const mockOr = vi.hoisted(() => vi.fn())
const mockIn = vi.hoisted(() => vi.fn())
const mockFrom = vi.hoisted(() => vi.fn())
const mockUseRole = vi.hoisted(() => vi.fn(() => ({ role: 'leader' as 'super_admin' | 'leader' | 'server', loading: false })))

vi.mock('@/hooks/useRole', () => ({
  useRole: mockUseRole,
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: mockFrom,
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'uid' } } } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  }),
}))

vi.mock('@/lib/settings/app-settings', () => ({
  getRetreatTotalCost: vi.fn().mockResolvedValue('400000'),
  setRetreatTotalCost: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/retreat-registrations',
}))

let registrationsData: unknown[] = []
let registrationsCount: number | null = 0
let paymentsData: unknown[] = []

function makeChain(table: string) {
  const chain: Record<string, unknown> = {}
  chain.select = mockSelect
  chain.eq = mockEq
  chain.order = mockOrder
  chain.range = mockRange
  chain.or = mockOr
  chain.in = mockIn

  ;(chain as unknown as { then: unknown }).then = (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) => {
    if (table === 'retreat_registrations') {
      return Promise.resolve({ data: registrationsData, count: registrationsCount, error: null }).then(
        resolve as never,
        reject as never,
      )
    }
    return Promise.resolve({ data: paymentsData, error: null }).then(
      resolve as never,
      reject as never,
    )
  }
  mockSelect.mockReturnValue(chain)
  mockEq.mockReturnValue(chain)
  mockOrder.mockReturnValue(chain)
  mockRange.mockReturnValue(chain)
  mockOr.mockReturnValue(chain)
  mockIn.mockReturnValue(chain)
  return chain
}

function installPolyfills() {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // @ts-ignore
  globalThis.ResizeObserver = ResizeObserverStub
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

const sampleRegistration = {
  id: 'reg-1',
  name: 'Ana Pérez',
  email: 'ana@example.com',
  phone: '3001234567',
  birthday: '2000-01-15',
  is_minor: false,
  legal_rep_name: null,
  status: 'preinscrito',
  created_at: '2026-08-10T10:00:00Z',
  transferred_at: null,
  transferred_member_id: null,
  member_id: null,
}

describe('retreat-registrations mutation gate (super_admin only)', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    vi.clearAllMocks()
    installPolyfills()
    registrationsData = [sampleRegistration]
    registrationsCount = 1
    paymentsData = []
    mockFrom.mockImplementation((table: string) => makeChain(table))
  })

  it('leader can list preinscriptions but cannot pay, transfer, or delete', async () => {
    mockUseRole.mockReturnValue({ role: 'leader', loading: false })
    const Page = (await import('../page')).default
    render(<Page />)
    await waitFor(() => expect(screen.getByText('Ana Pérez')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /Registrar pago/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Transferir a Valientes/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Eliminar preinscripción de Ana Pérez/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Editar preinscripción de Ana Pérez/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: /Registrar pago/i })).not.toBeInTheDocument()
  })

  it('super_admin sees payment, transfer, edit, and delete controls', async () => {
    mockUseRole.mockReturnValue({ role: 'super_admin', loading: false })
    const Page = (await import('../page')).default
    render(<Page />)
    await waitFor(() => expect(screen.getByText('Ana Pérez')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Registrar pago/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Editar preinscripción de Ana Pérez/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Eliminar preinscripción de Ana Pérez/i })).toBeInTheDocument()
  })
})
