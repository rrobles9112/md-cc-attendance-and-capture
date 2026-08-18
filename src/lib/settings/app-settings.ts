import { createClient } from '@/lib/supabase/client'

export async function getSetting(key: string): Promise<string | null> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .single()

  if (error || !data) return null
  return data.value
}

export async function setSetting(key: string, value: string): Promise<void> {
  const supabase = createClient()

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')

  const { error } = await supabase
    .from('app_settings')
    .upsert({
      key,
      value,
      updated_by: session.user.id,
      updated_at: new Date().toISOString(),
    })

  if (error) throw error
}

export async function getDpoContactEmail(): Promise<string> {
  const email = await getSetting('dpo_contact_email')
  return email ?? ''
}

export const RETREAT_TOTAL_COST_KEY = 'retreat.youth.total_cost'

export async function getRetreatTotalCost(): Promise<string | null> {
  return getSetting(RETREAT_TOTAL_COST_KEY)
}

export async function setRetreatTotalCost(value: string): Promise<void> {
  await setSetting(RETREAT_TOTAL_COST_KEY, value)
}
