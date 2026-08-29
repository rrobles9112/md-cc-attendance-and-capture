import { fireEvent, render, screen } from '@testing-library/react'
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

describe('CaptureForm initialValues prefill', () => {
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

  it('prefills name, phone, email, birthday from initialValues and keeps inputs editable', () => {
    const submitAdapter = vi.fn().mockResolvedValue(undefined)
    render(
      <CaptureForm
        variant="retreat"
        initialValues={{
          name: 'Ana',
          phone: '3001234567',
          email: 'ana@example.com',
          birthday: '2000-05-10',
          legalRepName: '',
        }}
        submitAdapter={submitAdapter}
      />,
    )

    const nameInput = screen.getByLabelText(/Nombre completo/) as HTMLInputElement
    const phoneInput = screen.getByLabelText(/Teléfono/) as HTMLInputElement
    const emailInput = screen.getByLabelText(/Correo electrónico/) as HTMLInputElement
    const birthdayInput = screen.getByLabelText(/Fecha de nacimiento/) as HTMLInputElement

    expect(nameInput.value).toBe('Ana')
    expect(phoneInput.value).toBe('3001234567')
    expect(emailInput.value).toBe('ana@example.com')
    expect(birthdayInput.value).toBe('2000-05-10')

    // editable after prefill
    fireEvent.change(nameInput, { target: { value: 'Ana Updated' } })
    expect(nameInput.value).toBe('Ana Updated')
  })

  it('forces generalConsent and sensitiveConsent to false even when initialValues says true', () => {
    const submitAdapter = vi.fn().mockResolvedValue(undefined)
    render(
      <CaptureForm
        variant="retreat"
        initialValues={{
          name: 'Ana',
          phone: '3001234567',
          email: 'ana@example.com',
          birthday: '2000-05-10',
          generalConsent: true,
          sensitiveConsent: true,
        } as unknown as Record<string, unknown>}
        submitAdapter={submitAdapter}
      />,
    )

    // Radix Checkbox renders as button with aria-checked; use toBeChecked matcher which handles both
    expect(screen.getByRole('checkbox', { name: /He leído y acepto/ })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Acepto proporcionar datos sensibles/ })).not.toBeChecked()
  })

  it('toggling sensitiveConsent reveals denomination and communityName inputs', () => {
    const submitAdapter = vi.fn().mockResolvedValue(undefined)
    render(
      <CaptureForm
        variant="retreat"
        initialValues={{
          name: 'Ana',
          phone: '3001234567',
          email: 'ana@example.com',
        }}
        submitAdapter={submitAdapter}
      />,
    )

    expect(screen.queryByLabelText(/Denominación religiosa/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Nombre de la comunidad/)).not.toBeInTheDocument()

    const sensitiveConsent = screen.getByLabelText(/Acepto proporcionar datos sensibles/)
    fireEvent.click(sensitiveConsent)

    expect(screen.getByLabelText(/Denominación religiosa/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Nombre de la comunidad/)).toBeInTheDocument()
  })

  it('retreat variant shows RETREAT_PRIVACY_NOTICE_ES, WhatsApp card, and hides the social card', () => {
    const submitAdapter = vi.fn().mockResolvedValue(undefined)
    render(
      <CaptureForm
        variant="retreat"
        initialValues={{ name: 'Ana' }}
        submitAdapter={submitAdapter}
      />,
    )

    expect(screen.getByRole('button', { name: RETREAT_SUBMIT_LABEL })).toBeInTheDocument()
    expect(screen.getByText(/PREINSCRIPCIÓN AL RETIRO JUVENIL/)).toBeInTheDocument()
    expect(RETREAT_PRIVACY_NOTICE_ES).toMatch(/PREINSCRIPCIÓN AL RETIRO JUVENIL/)
    expect(screen.getByText('WhatsApp')).toBeInTheDocument()
    expect(screen.queryByText('Redes sociales')).not.toBeInTheDocument()
  })

  it('prefills hasWhatsapp from initialValues', () => {
    const submitAdapter = vi.fn().mockResolvedValue(undefined)
    render(
      <CaptureForm
        variant="retreat"
        initialValues={{ name: 'Ana', hasWhatsapp: true }}
        submitAdapter={submitAdapter}
      />,
    )

    expect(
      screen.getByRole('checkbox', { name: /El número principal tiene WhatsApp/ }),
    ).toBeChecked()
  })

  it('without initialValues form mounts empty (existing behavior)', () => {
    const submitAdapter = vi.fn().mockResolvedValue(undefined)
    render(<CaptureForm variant="retreat" submitAdapter={submitAdapter} />)

    expect((screen.getByLabelText(/Nombre completo/) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/Teléfono/) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/Correo electrónico/) as HTMLInputElement).value).toBe('')
  })
})
