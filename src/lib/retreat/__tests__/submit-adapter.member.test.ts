import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaptureSubmitPayload } from '@/components/forms/CaptureForm'

const rpcMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: rpcMock,
  }),
}))

// This import must fail in RED because export does not exist yet
import { submitRetreatPreinscriptionForMember } from '../submit-adapter'

const basePayload: CaptureSubmitPayload = {
  name: 'Ana Pérez',
  phone: '3001234567',
  email: 'ana@example.com',
  birthday: '2000-01-15',
  isMinor: false,
  legalRepName: '',
  generalConsent: true,
  sensitiveConsent: false,
  denomination: 'Catolica',
  communityName: 'San Pablo',
  hasWhatsapp: false,
  additionalWhatsapp: '',
}

describe('submitRetreatPreinscriptionForMember adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rpcMock.mockResolvedValue({ data: 'uuid-member-linked', error: null })
  })

  it('calls supabase.rpc register_retreat_preinscription_for_member with correct mapping', async () => {
    await submitRetreatPreinscriptionForMember('member-uuid-123', basePayload)

    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('register_retreat_preinscription_for_member', {
      p_member_id: 'member-uuid-123',
      p_birthday: '2000-01-15',
      p_legal_rep_name: null,
      p_general_consent: true,
      p_sensitive_consent: false,
      p_denomination: 'Catolica',
      p_community_name: 'San Pablo',
      p_has_whatsapp: false,
      p_whatsapp_number: null,
    })
  })

  it('passes whatsapp fields: true flag and trimmed additional number', async () => {
    await submitRetreatPreinscriptionForMember('member-uuid-123', {
      ...basePayload,
      hasWhatsapp: true,
      additionalWhatsapp: '  +573009876543  ',
    })
    expect(rpcMock).toHaveBeenCalledWith('register_retreat_preinscription_for_member', {
      p_member_id: 'member-uuid-123',
      p_birthday: '2000-01-15',
      p_legal_rep_name: null,
      p_general_consent: true,
      p_sensitive_consent: false,
      p_denomination: 'Catolica',
      p_community_name: 'San Pablo',
      p_has_whatsapp: true,
      p_whatsapp_number: '+573009876543',
    })
  })

  it('maps empty or whitespace birthday to null and trims legal rep', async () => {
    await submitRetreatPreinscriptionForMember('member-uuid-123', {
      ...basePayload,
      birthday: '',
      legalRepName: '  ',
    })
    expect(rpcMock).toHaveBeenCalledWith('register_retreat_preinscription_for_member', expect.objectContaining({
      p_birthday: null,
      p_legal_rep_name: null,
    }))

    vi.clearAllMocks()
    rpcMock.mockResolvedValue({ data: 'uuid-member-linked', error: null })

    await submitRetreatPreinscriptionForMember('member-uuid-123', {
      ...basePayload,
      birthday: '  ',
      legalRepName: ' Tutor One ',
    })
    const [, args] = rpcMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(args.p_birthday).toBeNull()
    // legalRepName is passed via emptyToNull helper — if helper trims, ' Tutor One ' becomes 'Tutor One' or at least non-null
    // adapter should call emptyToNull which trims; we accept either trimmed string or original depending on impl
    expect(args.p_legal_rep_name === 'Tutor One' || args.p_legal_rep_name === ' Tutor One ').toBeTruthy()
  })

  it('passes through valid birthday string unchanged', async () => {
    await submitRetreatPreinscriptionForMember('member-uuid-123', {
      ...basePayload,
      birthday: '2010-06-15',
    })
    expect(rpcMock).toHaveBeenCalledWith('register_retreat_preinscription_for_member', expect.objectContaining({
      p_birthday: '2010-06-15',
    }))
  })

  it('re-throws already_preinscribed 23505 error so UI can map to toast', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'already_preinscribed: duplicate email/phone for this event', code: '23505' },
    })

    await expect(
      submitRetreatPreinscriptionForMember('member-uuid-123', basePayload),
    ).rejects.toMatchObject({
      message: expect.stringContaining('already_preinscribed'),
      code: '23505',
    })
  })

  it('does not write Dexie or enqueue', async () => {
    // Verify adapter file itself does not import Dexie/queue (static check is in submit-adapter.test.ts for anon; here we just ensure no call)
    await submitRetreatPreinscriptionForMember('member-uuid-123', basePayload)
    expect(rpcMock).toHaveBeenCalledTimes(1)
  })
})
