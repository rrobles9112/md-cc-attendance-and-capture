import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Hoisted mocks — follow pagination.test.tsx page-mock pattern
const mockSelect = vi.hoisted(() => vi.fn())
const mockEq = vi.hoisted(() => vi.fn())
const mockOrder = vi.hoisted(() => vi.fn())
const mockRange = vi.hoisted(() => vi.fn())
const mockOr = vi.hoisted(() => vi.fn())
const mockIn = vi.hoisted(() => vi.fn())
const mockFrom = vi.hoisted(() => vi.fn())
const mockUseRole = vi.hoisted(() => vi.fn(() => ({ role: 'leader' as const, loading: false })))

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

describe('retreat-registrations create-preinscription gate (PR #4 T-403)', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    vi.clearAllMocks()
    installPolyfills()
    registrationsData = []
    registrationsCount = 0
    paymentsData = []
    mockFrom.mockImplementation((table: string) => makeChain(table))
    mockUseRole.mockReturnValue({ role: 'leader', loading: false })
  })

  it('(a) authorized role → \"Nueva preinscripción\" button is present in the no-print toolbar — RED against current page (button does not exist yet)', async () => {
    mockUseRole.mockReturnValue({ role: 'leader', loading: false })
    const Page = (await import('../page')).default
    render(<Page />)
    // Wait for page to finish loading (role gate resolved)
    await waitFor(() => expect(mockSelect).toHaveBeenCalled())
    const button = await screen.findByRole('button', { name: /Nueva preinscripción/i })
    expect(button).toBeInTheDocument()
    // Must be inside the no-print toolbar so it is excluded from printed output
    const toolbar = button.closest('.no-print')
    expect(toolbar).not.toBeNull()
  })

  it("(b) role 'server' → button present in the no-print toolbar AND no permission notice — retreat module open to all staff roles (018 product decision)", async () => {
    mockUseRole.mockReturnValue({ role: 'server', loading: false } as never)
    const Page = (await import('../page')).default
    render(<Page />)
    // Page renders for server — permission notice must be gone
    await waitFor(() => expect(mockSelect).toHaveBeenCalled())
    expect(screen.queryByText('No tiene permisos para acceder a esta sección')).not.toBeInTheDocument()
    // Button must be present inside the no-print toolbar
    const button = await screen.findByRole('button', { name: /Nueva preinscripción/i })
    const toolbar = button.closest('.no-print')
    expect(toolbar).not.toBeNull()
  })
})
