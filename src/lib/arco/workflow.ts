import { createClient } from '@/lib/supabase/client'
import { calculateDeadline } from './deadline'

type ARCOType = 'access' | 'rectification' | 'cancellation' | 'opposition'
type ARCOStatus = 'pending' | 'in_progress' | 'fulfilled' | 'overdue'

interface ARCORequest {
  id: string
  member_id: string | null
  request_type: ARCOType
  status: ARCOStatus
  deadline: string
  fulfilled_at: string | null
  notes: string | null
  created_at: string
}

interface CreateARCOInput {
  type: ARCOType
  memberId?: string
  subject: string
  details: string
}

export async function createARCORequest(input: CreateARCOInput): Promise<ARCORequest> {
  const supabase = createClient()
  const now = new Date()
  const deadline = calculateDeadline(now, input.type)

  const { data, error } = await supabase
    .from('arco_requests')
    .insert({
      member_id: input.memberId ?? null,
      request_type: input.type.toUpperCase(),
      status: 'pending',
      deadline: deadline.toISOString().split('T')[0],
      notes: `Solicitante: ${input.subject}\nDetalles: ${input.details}`,
    })
    .select()
    .single()

  if (error) throw error
  return data as ARCORequest
}

export async function fulfillARCORequest(
  requestId: string,
  notes?: string
): Promise<void> {
  const supabase = createClient()

  const { error } = await supabase
    .from('arco_requests')
    .update({
      status: 'fulfilled',
      fulfilled_at: new Date().toISOString(),
      notes: notes ?? null,
    })
    .eq('id', requestId)
    .in('status', ['pending', 'in_progress'])

  if (error) throw error
}

export async function updateARCOStatus(
  requestId: string,
  status: ARCOStatus,
  notes?: string
): Promise<void> {
  const supabase = createClient()

  const updates: Record<string, unknown> = { status }
  if (notes) updates.notes = notes
  if (status === 'fulfilled') updates.fulfilled_at = new Date().toISOString()

  const { error } = await supabase
    .from('arco_requests')
    .update(updates)
    .eq('id', requestId)

  if (error) throw error
}

export async function getPendingARCORequests(): Promise<ARCORequest[]> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('arco_requests')
    .select('*')
    .in('status', ['pending', 'in_progress'])
    .order('deadline', { ascending: true })

  if (error) throw error
  return (data ?? []) as ARCORequest[]
}

export async function checkOverdueRequests(): Promise<ARCORequest[]> {
  const supabase = createClient()
  const today = new Date().toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('arco_requests')
    .select('*')
    .in('status', ['pending', 'in_progress'])
    .lt('deadline', today)

  if (error) throw error

  const overdue = (data ?? []) as ARCORequest[]
  for (const req of overdue) {
    await updateARCOStatus(req.id, 'overdue')
  }

  return overdue
}
