import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const submitRetreatPreinscriptionMock = vi.hoisted(() => vi.fn())
const toastSuccessMock = vi.hoisted(() => vi.fn())
const toastErrorMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/retreat/submit-adapter', () => ({
  submitRetreatPreinscription: submitRetreatPreinscriptionMock,
}))

vi.mock('@/lib/retreat/constants', () => ({
  RETREAT_EVENT_KEY: 'retiro-juvenil-octubre-2026',
  RETREAT_PAGE_HEADING: 'Retiro Juvenil Octubre 2026',
  RETREAT_PAGE_DESCRIPTION: 'Complete el formulario para preinscribirse al retiro juvenil.',
  RETREAT_SUBMIT_LABEL: 'Preinscribirme al retiro',
  RETREAT_SUBMITTING_LABEL: 'Enviando preinscripción...',
  RETREAT_SUCCESS_MESSAGE: 'Preinscripción enviada exitosamente',
  RETREAT_ERROR_MESSAGE: 'Error al enviar la preinscripción',
  RETREAT_PERSONAL_DESCRIPTION: 'Información de contacto para la preinscripción al retiro',
}))

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
    warning: vi.fn(),
  },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('lucide-react', async () => {
  const actual = await vi.importActual<typeof import('lucide-react')>('lucide-react')
  return {
    ...actual,
    UserPlus: (props: unknown) => {
      const p = props as Record<string, unknown>
      return (
        <span data-testid="user-plus" {...(p as object)}>
          +
        </span>
      )
    },
  }
})

// CaptureForm dependencies — mirror CaptureForm.adapter.test.tsx mocks
const membersAddMock = vi.hoisted(() => vi.fn())
const enqueueMock = vi.hoisted(() => vi.fn())
const logGeneralConsentMock = vi.hoisted(() => vi.fn())
const logSensitiveConsentMock = vi.hoisted(() => vi.fn())
const findDuplicateMembersMock = vi.hoisted(() => vi.fn())
const markDuplicateFlagMock = vi.hoisted(() => vi.fn())
const rpcMock = vi.hoisted(() => vi.fn())
const getSessionMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/sync/db', () => ({
  db: {
    members: { add: membersAddMock },
    whatsapp_numbers: { add: vi.fn() },
    social_media: { add: vi.fn() },
  },
}))

vi.mock('@/lib/sync/queue', () => ({
  enqueue: enqueueMock,
}))

vi.mock('@/lib/audit/consent-logger', () => ({
  logGeneralConsent: logGeneralConsentMock,
  logSensitiveConsent: logSensitiveConsentMock,
  logConsentEvent: vi.fn(),
}))

vi.mock('@/lib/sync/conflict', () => ({
  findDuplicateMembers: findDuplicateMembersMock,
  markDuplicateFlag: markDuplicateFlagMock,
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: getSessionMock },
    rpc: rpcMock,
  }),
}))

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

function fillRequiredIdentity() {
  fireEvent.change(screen.getByLabelText(/Nombre completo/), {
    target: { value: 'Ana Pérez' },
  })
  fireEvent.change(screen.getByLabelText(/Teléfono/), {
    target: { value: '3001234567' },
  })
  fireEvent.change(screen.getByLabelText(/Correo electrónico/), {
    target: { value: 'ana@example.com' },
  })
  fireEvent.click(screen.getByLabelText(/He leído y acepto/))
}

import { RetreatPreinscriptionCreate } from '../RetreatPreinscriptionCreate'

describe('RetreatPreinscriptionCreate', () => {
  beforeEach(() => {
    installPolyfills()
    vi.clearAllMocks()
    membersAddMock.mockResolvedValue(undefined)
    enqueueMock.mockResolvedValue(undefined)
    logGeneralConsentMock.mockResolvedValue(undefined)
    logSensitiveConsentMock.mockResolvedValue(undefined)
    findDuplicateMembersMock.mockResolvedValue([])
    markDuplicateFlagMock.mockResolvedValue(undefined)
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } })
    rpcMock.mockResolvedValue({ data: null, error: null })
    submitRetreatPreinscriptionMock.mockResolvedValue(undefined)
    toastSuccessMock.mockClear()
    toastErrorMock.mockClear()
  })

  it('disabled + disabledTitle → button disabled with that title, click does not open dialog', async () => {
    const onSuccess = vi.fn()
    render(<RetreatPreinscriptionCreate disabled disabledTitle="Requiere conexión" onSuccess={onSuccess} />)
    const button = screen.getByRole('button', { name: /Nueva preinscripción/i })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', 'Requiere conexión')
    fireEvent.click(button)
    // Dialog should not open — privacy copy / dialog title absent
    expect(screen.queryByText('Registre una preinscripción al retiro juvenil. La persona quedará como Preinscrito con sus sellos de consentimiento (Ley 1581 pdtp-v1.0-2026-07-17).')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('click opens dialog mounting CaptureForm with variant="retreat" and submitRetreatPreinscription as submitAdapter (assert props; retreat privacy copy visible)', async () => {
    const onSuccess = vi.fn()
    render(<RetreatPreinscriptionCreate onSuccess={onSuccess} />)
    const button = screen.getByRole('button', { name: /Nueva preinscripción/i })
    fireEvent.click(button)
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
    // Dialog copy es-CO — heading is distinct from toolbar button
    expect(screen.getByRole('heading', { name: 'Nueva preinscripción' })).toBeInTheDocument()
    expect(screen.getByText('Registre una preinscripción al retiro juvenil. La persona quedará como Preinscrito con sus sellos de consentimiento (Ley 1581 pdtp-v1.0-2026-07-17).')).toBeInTheDocument()
    // CaptureForm mounted with retreat variant: retreat privacy copy visible
    expect(screen.getByText(/PREINSCRIPCIÓN AL RETIRO JUVENIL/)).toBeInTheDocument()
    // Retreat submit label visible (proves variant=retreat)
    expect(screen.getByRole('button', { name: 'Preinscribirme al retiro' })).toBeInTheDocument()
    // The public adapter is the mocked submitRetreatPreinscription — not yet called until submit
    expect(submitRetreatPreinscriptionMock).not.toHaveBeenCalled()
  })

  it('adapter success → success toast + form reset + dialog closed + onSuccess called exactly once', async () => {
    submitRetreatPreinscriptionMock.mockResolvedValue(undefined)
    const onSuccess = vi.fn()
    render(<RetreatPreinscriptionCreate onSuccess={onSuccess} />)
    fireEvent.click(screen.getByRole('button', { name: /Nueva preinscripción/i }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    fillRequiredIdentity()
    fireEvent.click(screen.getByRole('button', { name: 'Preinscribirme al retiro' }))
    await waitFor(() => expect(submitRetreatPreinscriptionMock).toHaveBeenCalledTimes(1))
    expect(submitRetreatPreinscriptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Ana Pérez',
        phone: '3001234567',
        email: 'ana@example.com',
        generalConsent: true,
      }),
    )
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith('Preinscripción enviada exitosamente'))
    // Dialog closed
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onSuccess).toHaveBeenCalledTimes(1)
    // Form reset — reopen and verify inputs empty
    fireEvent.click(screen.getByRole('button', { name: /Nueva preinscripción/i }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect((screen.getByLabelText(/Nombre completo/) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/Teléfono/) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/Correo electrónico/) as HTMLInputElement).value).toBe('')
  })

  it('adapter failure → error toast + dialog still open + entered values retained + onSuccess not called', async () => {
    submitRetreatPreinscriptionMock.mockRejectedValue(new Error('boom'))
    const onSuccess = vi.fn()
    render(<RetreatPreinscriptionCreate onSuccess={onSuccess} />)
    fireEvent.click(screen.getByRole('button', { name: /Nueva preinscripción/i }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    fillRequiredIdentity()
    fireEvent.click(screen.getByRole('button', { name: 'Preinscribirme al retiro' }))
    await waitFor(() => expect(submitRetreatPreinscriptionMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('Error al enviar la preinscripción'))
    // Dialog still open
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // Entered values retained
    expect((screen.getByLabelText(/Nombre completo/) as HTMLInputElement).value).toBe('Ana Pérez')
    expect((screen.getByLabelText(/Teléfono/) as HTMLInputElement).value).toBe('3001234567')
    expect((screen.getByLabelText(/Correo electrónico/) as HTMLInputElement).value).toBe('ana@example.com')
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('default props → enabled button, no title attribute', async () => {
    const onSuccess = vi.fn()
    render(<RetreatPreinscriptionCreate onSuccess={onSuccess} />)
    const button = screen.getByRole('button', { name: /Nueva preinscripción/i })
    expect(button).not.toBeDisabled()
    expect(button.getAttribute('title')).toBeNull()
    fireEvent.click(button)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Nueva preinscripción' })).toBeInTheDocument()
  })
})
