import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RETREAT_PRIVACY_NOTICE_ES } from '@/lib/consent/privacy-notice'
import { RETREAT_SUBMIT_LABEL } from '@/lib/retreat/constants'
import { CaptureForm } from '../CaptureForm'

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

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

function installCheckboxPolyfills() {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', {
    writable: true,
    value: ResizeObserverStub,
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

describe('CaptureForm submit paths', () => {
  beforeEach(() => {
    installCheckboxPolyfills()
    vi.clearAllMocks()
    membersAddMock.mockResolvedValue(undefined)
    enqueueMock.mockResolvedValue(undefined)
    logGeneralConsentMock.mockResolvedValue(undefined)
    logSensitiveConsentMock.mockResolvedValue(undefined)
    findDuplicateMembersMock.mockResolvedValue([])
    markDuplicateFlagMock.mockResolvedValue(undefined)
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } })
    rpcMock.mockResolvedValue({ data: null, error: null })
  })

  it('uses Dexie and enqueue when no submitAdapter is provided', async () => {
    render(<CaptureForm />)
    fillRequiredIdentity()
    fireEvent.click(screen.getByRole('button', { name: 'Registrar miembro' }))

    await waitFor(() => {
      expect(membersAddMock).toHaveBeenCalledTimes(1)
    })
    expect(enqueueMock).toHaveBeenCalledWith(
      'members',
      expect.any(String),
      'insert',
      expect.objectContaining({
        name: 'Ana Pérez',
        phone: '3001234567',
        email: 'ana@example.com',
      }),
    )
    expect(logGeneralConsentMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('calls submitAdapter after validation and skips Dexie, enqueue, and consent logging', async () => {
    const submitAdapter = vi.fn().mockResolvedValue(undefined)
    render(<CaptureForm submitAdapter={submitAdapter} />)
    fillRequiredIdentity()
    fireEvent.click(screen.getByRole('button', { name: 'Registrar miembro' }))

    await waitFor(() => {
      expect(submitAdapter).toHaveBeenCalledTimes(1)
    })
    expect(submitAdapter).toHaveBeenCalledWith({
      name: 'Ana Pérez',
      phone: '3001234567',
      email: 'ana@example.com',
      birthday: '',
      isMinor: false,
      legalRepName: '',
      generalConsent: true,
      sensitiveConsent: false,
      denomination: '',
      communityName: '',
      hasWhatsapp: false,
      additionalWhatsapp: '',
    })
    expect(membersAddMock).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
    expect(logGeneralConsentMock).not.toHaveBeenCalled()
    expect(logSensitiveConsentMock).not.toHaveBeenCalled()
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('does not call submitAdapter when client validation fails', async () => {
    const submitAdapter = vi.fn().mockResolvedValue(undefined)
    render(<CaptureForm submitAdapter={submitAdapter} />)
    fireEvent.click(screen.getByLabelText(/He leído y acepto/))
    fireEvent.click(screen.getByRole('button', { name: 'Registrar miembro' }))

    expect(screen.getByText('El nombre es obligatorio.')).toBeInTheDocument()
    expect(submitAdapter).not.toHaveBeenCalled()
    expect(membersAddMock).not.toHaveBeenCalled()
  })

  it('shows WhatsApp card but hides social card and uses retreat copy for variant=retreat', () => {
    render(<CaptureForm variant="retreat" submitAdapter={vi.fn()} />)

    expect(screen.getByRole('button', { name: RETREAT_SUBMIT_LABEL })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Registrar miembro' })).not.toBeInTheDocument()
    expect(screen.getByText('WhatsApp')).toBeInTheDocument()
    expect(screen.queryByText('Redes sociales')).not.toBeInTheDocument()
    expect(screen.getByText(/PREINSCRIPCIÓN AL RETIRO JUVENIL/)).toBeVisible()
    expect(screen.getByText(/Contacto con el preinscrito o su representante legal/)).toBeVisible()
    expect(RETREAT_PRIVACY_NOTICE_ES).toMatch(/PREINSCRIPCIÓN AL RETIRO JUVENIL/)
  })

  it('keeps member copy and optional contact cards for the default variant', () => {
    render(<CaptureForm />)

    expect(screen.getByRole('button', { name: 'Registrar miembro' })).toBeVisible()
    expect(screen.getByText('WhatsApp')).toBeInTheDocument()
    expect(screen.getByText('Redes sociales')).toBeInTheDocument()
    expect(screen.getByText(/Registro de asistencia a actividades de la comunidad/)).toBeInTheDocument()
  })
})
