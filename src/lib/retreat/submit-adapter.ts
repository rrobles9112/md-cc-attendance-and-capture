import type { CaptureSubmitPayload } from '@/components/forms/CaptureForm'
import { createClient } from '@/lib/supabase/client'

function emptyToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export async function submitRetreatPreinscriptionForMember(
  memberId: string,
  payload: CaptureSubmitPayload,
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('register_retreat_preinscription_for_member', {
    p_member_id: memberId,
    p_birthday: emptyToNull(payload.birthday),
    p_legal_rep_name: emptyToNull(payload.legalRepName),
    p_general_consent: payload.generalConsent,
    p_sensitive_consent: payload.sensitiveConsent,
    p_denomination: payload.denomination,
    p_community_name: payload.communityName,
  })
  if (error) {
    throw error
  }
}

export async function submitRetreatPreinscription(
  payload: CaptureSubmitPayload,
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('register_retreat_preinscription', {
    p_name: payload.name,
    p_phone: payload.phone,
    p_email: payload.email,
    p_birthday: emptyToNull(payload.birthday),
    p_legal_rep_name: emptyToNull(payload.legalRepName),
    p_general_consent: payload.generalConsent,
    p_sensitive_consent: payload.sensitiveConsent,
    p_denomination: payload.denomination,
    p_community_name: payload.communityName,
  })

  if (error) {
    throw error
  }
}
