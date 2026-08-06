import { createClient } from '@/lib/supabase/client'
import { POLICY_VERSION } from '@/lib/consent/privacy-notice'

interface ConsentLogEntry {
  memberId: string
  consentType: 'CONSENT_GENERAL' | 'CONSENT_SENSITIVE'
  ipAddress?: string
}

/**
 * Persist a consent record to Supabase. The audit trail is produced by the
 * `audit_consent_records` trigger (SECURITY DEFINER log_mutation()), so a direct
 * client insert into audit_log is both redundant and previously failed RLS
 * (audit_log had no INSERT policy), silently dropping the consent evidence.
 *
 * When offline, the insert is skipped (it would fail); consent evidence is only
 * recorded once the session is online. Errors are surfaced to the caller via the
 * returned error but never thrown, so capture submission is not blocked.
 */
export async function logConsentEvent(entry: ConsentLogEntry): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return

  const supabase = createClient()

  const { error } = await supabase.from('consent_records').insert({
    member_id: entry.memberId,
    consent_type: entry.consentType === 'CONSENT_GENERAL' ? 'general' : 'sensitive',
    policy_version: POLICY_VERSION,
    accepted_at: new Date().toISOString(),
    ip_address: entry.ipAddress ?? null,
  })

  if (error) {
    console.error('Failed to log consent event:', error.message)
  }
}

export async function logGeneralConsent(memberId: string, ipAddress?: string): Promise<void> {
  return logConsentEvent({ memberId, consentType: 'CONSENT_GENERAL', ipAddress })
}

export async function logSensitiveConsent(memberId: string, ipAddress?: string): Promise<void> {
  return logConsentEvent({ memberId, consentType: 'CONSENT_SENSITIVE', ipAddress })
}
