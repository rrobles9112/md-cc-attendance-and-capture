import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const mockSelect = vi.hoisted(() => vi.fn())
const mockEq = vi.hoisted(() => vi.fn())
const mockOrder = vi.hoisted(() => vi.fn())
const mockRange = vi.hoisted(() => vi.fn())
const mockOr = vi.hoisted(() => vi.fn())
const mockIn = vi.hoisted(() => vi.fn())
const mockLimit = vi.hoisted(() => vi.fn())
const mockFrom = vi.hoisted(() => vi.fn())
const mockRpc = vi.hoisted(() => vi.fn())
const mockUseRole = vi.hoisted(() =>
  vi.fn(() => ({ role: 'super_admin' as 'super_admin' | 'leader' | 'server', loading: false })),
)

vi.mock('@/hooks/useRole', () => ({
  useRole: mockUseRole,
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: mockFrom,
    rpc: mockRpc,
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
let membersData: unknown[] = []

function makeChain(table: string) {
  const chain: Record<string, unknown> = {}
  chain.select = mockSelect
  chain.eq = mockEq
  chain.order = mockOrder
  chain.range = mockRange
  chain.or = mockOr
  chain.in = mockIn
  chain.limit = mockLimit

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
    if (table === 'members') {
      return Promise.resolve({ data: membersData, error: null }).then(
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
  mockLimit.mockReturnValue(chain)
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

const unpaidRegistration = {
  id: 'reg-unpaid-1',
  name: 'Carlos Gómez',
  email: 'carlos@example.com',
  phone: '3009876543',
  birthday: '1998-05-10',
  is_minor: false,
  legal_rep_name: null,
  status: 'preinscrito' as const,
  created_at: '2026-08-10T10:00:00Z',
  transferred_at: null,
  transferred_member_id: null,
  member_id: null,
}

const paidRegistration = {
  id: 'reg-paid-2',
  name: 'Lucía Torres',
  email: 'lucia@example.com',
  phone: '3012223344',
  birthday: '1999-03-20',
  is_minor: false,
  legal_rep_name: null,
  status: 'inscrito' as const,
  created_at: '2026-08-10T11:00:00Z',
  transferred_at: null,
  transferred_member_id: null,
  member_id: null,
}

describe('Transferir a Valientes payment-independent confirmation checkpoint', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    vi.clearAllMocks()
    installPolyfills()
    membersData = []
    paymentsData = []
    mockFrom.mockImplementation((table: string) => makeChain(table))
    mockRpc.mockResolvedValue({ data: { member_id: 'mem-new-1' }, error: null })
  })

  it('enables Transferir a Valientes for an unpaid preinscrito and does nothing if negative option ("No, cancelar") is clicked', async () => {
    registrationsData = [unpaidRegistration]
    registrationsCount = 1

    const Page = (await import('../page')).default
    render(<Page />)

    await waitFor(() => expect(screen.getByText('Carlos Gómez')).toBeInTheDocument())

    const transferButton = screen.getByRole('button', { name: /Transferir a Valientes/i })
    expect(transferButton).not.toBeDisabled()

    fireEvent.click(transferButton)

    await waitFor(() =>
      expect(
        screen.getByText('Confirmar transferencia a Valientes sin pago total'),
      ).toBeInTheDocument(),
    )

    expect(screen.getByRole('button', { name: 'No, cancelar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sí, transferir a Valientes' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'No, cancelar' }))

    await waitFor(() =>
      expect(
        screen.queryByText('Confirmar transferencia a Valientes sin pago total'),
      ).not.toBeInTheDocument(),
    )
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('transfers an unpaid preinscrito to Valientes when affirmative option ("Sí, transferir a Valientes") is clicked', async () => {
    registrationsData = [unpaidRegistration]
    registrationsCount = 1

    const Page = (await import('../page')).default
    render(<Page />)

    await waitFor(() => expect(screen.getByText('Carlos Gómez')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Transferir a Valientes/i }))

    await waitFor(() =>
      expect(
        screen.getByText('Confirmar transferencia a Valientes sin pago total'),
      ).toBeInTheDocument(),
    )

    const confirmBtn = screen.getByRole('button', { name: 'Sí, transferir a Valientes' })
    expect(confirmBtn).not.toBeDisabled()
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('transfer_retreat_to_valientes', {
        p_registration_id: 'reg-unpaid-1',
        p_allow_unpaid: true,
        p_link_existing_member: true,
      })
    })
  })

  it('uses standard transfer flow (p_allow_unpaid: false) when registration is already fully paid (inscrito)', async () => {
    registrationsData = [paidRegistration]
    registrationsCount = 1
    paymentsData = [
      {
        id: 'pay-1',
        registration_id: 'reg-paid-2',
        amount: 400000,
        paid_at: '2026-08-15T10:00:00Z',
      },
    ]

    const Page = (await import('../page')).default
    render(<Page />)

    await waitFor(() => expect(screen.getByText('Lucía Torres')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Transferir a Valientes/i }))

    await waitFor(() =>
      expect(screen.getByText('Transferir a Valientes', { selector: 'h2' })).toBeInTheDocument(),
    )

    const consentCheckbox = screen.getByLabelText(
      /Acepto que mis datos se traten para mi incorporación al grupo Valientes/i,
    )
    fireEvent.click(consentCheckbox)

    fireEvent.click(screen.getByRole('button', { name: 'Transferir' }))

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('transfer_retreat_to_valientes', {
        p_registration_id: 'reg-paid-2',
        p_allow_unpaid: false,
        p_link_existing_member: true,
      })
    })
  })
})
