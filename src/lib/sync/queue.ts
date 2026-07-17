import { db, type SyncQueueItem, type SyncStatus } from './db'
import { createClient } from '@/lib/supabase/client'

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export async function enqueue(
  tableName: string,
  recordId: string,
  operation: SyncQueueItem['operation'],
  payload: Record<string, unknown>
): Promise<void> {
  await db.sync_queue.add({
    id: uuid(),
    table_name: tableName,
    record_id: recordId,
    operation,
    payload,
    status: 'pending',
    created_at: new Date().toISOString(),
    retry_count: 0,
  })
}

export async function flushQueue(): Promise<{ succeeded: number; failed: number }> {
  const pending = await db.sync_queue
    .where('status')
    .anyOf(['pending', 'failed'])
    .sortBy('created_at')

  if (pending.length === 0) return { succeeded: 0, failed: 0 }

  const supabase = createClient()
  let succeeded = 0
  let failed = 0

  for (const item of pending) {
    await db.sync_queue.update(item.id, { status: 'syncing' })

    try {
      const table = supabase.from(item.table_name)

      switch (item.operation) {
        case 'insert':
          const { error: insertErr } = await table.upsert(item.payload)
          if (insertErr) throw insertErr
          break
        case 'update':
          const { error: updateErr } = await table.update(item.payload).eq('id', item.record_id)
          if (updateErr) throw updateErr
          break
        case 'delete':
          const { error: deleteErr } = await table.delete().eq('id', item.record_id)
          if (deleteErr) throw deleteErr
          break
      }

      await db.sync_queue.update(item.id, { status: 'done' })
      succeeded++
    } catch (err) {
      const newRetry = item.retry_count + 1
      await db.sync_queue.update(item.id, {
        status: newRetry >= 5 ? 'failed' : ('pending' as SyncStatus),
        retry_count: newRetry,
        error: err instanceof Error ? err.message : String(err),
      })
      failed++
    }
  }

  return { succeeded, failed }
}

export function onOnline(callback: () => void): () => void {
  const handler = () => {
    if (navigator.onLine) callback()
  }
  window.addEventListener('online', handler)
  return () => window.removeEventListener('online', handler)
}

export async function getPendingCount(): Promise<number> {
  return db.sync_queue.where('status').anyOf(['pending', 'failed']).count()
}

export async function getSyncStatus(): Promise<SyncStatus> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 'offline' as SyncStatus

  const syncing = await db.sync_queue.where('status').equals('syncing').count()
  if (syncing > 0) return 'syncing'

  const failed = await db.sync_queue.where('status').equals('failed').count()
  if (failed > 0) return 'failed'

  const pending = await db.sync_queue.where('status').equals('pending').count()
  if (pending > 0) return 'syncing'

  return 'done'
}
