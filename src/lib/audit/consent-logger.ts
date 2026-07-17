import { createClient } from '@/lib/supabase/client'
import { POLICY_VERSION } from '@/lib/consent/privacy-notice'

interface ConsentLogEntry {
  memberId: string
  consentType: 'CONSENT_GENERAL' | 'CONSENT_SENSITIVE'
  ipAddress?: string
}

export async function logConsentEvent(entry: ConsentLogEntry): Promise<void> {
  const supabase = createClient()

  const { data: { session } } = await supabase.auth.getSession()

  await supabase.from('audit_log').insert({
    user_id: session?.user?.id ?? null,
    action: entry.consentType,
    table_name: 'consent_records',
    record_id: entry.memberId,
    old_value: null,
    new_value: {
      consent_type: entry.consentType === 'CONSENT_GENERAL' ? 'general' : 'sensitive',
      policy_version: POLICY_VERSION,
      accepted_at: new Date().toISOString(),
      ip_address: entry.ipAddress ?? null,
    },
  })

  await supabase.from('consent_records').insert({
    member_id: entry.memberId,
    consent_type: entry.consentType === 'CONSENT_GENERAL' ? 'general' : 'sensitive',
    policy_version: POLICY_VERSION,
    accepted_at: new Date().toISOString(),
    ip_address: entry.ipAddress ?? null,
  })
}

export async function logGeneralConsent(memberId: string, ipAddress?: string): Promise<void> {
  return logConsentEvent({ memberId, consentType: 'CONSENT_GENERAL', ipAddress })
}

export async function logSensitiveConsent(memberId: string, ipAddress?: string): Promise<void> {
  return logConsentEvent({ memberId, consentType: 'CONSENT_SENSITIVE', ipAddress })
}
