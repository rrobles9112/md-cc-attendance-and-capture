import { db, type SyncQueueItem, type SyncStatus } from './db'
import { createClient } from '@/lib/supabase/client'
import { getHydrationPhase, hasHydratedThisSession } from './hydrate'

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

const FLUSH_TIMEOUT_MS = 10_000

// Postgres/PostgREST error codes that will never succeed on retry: RLS denial,
// uniqueness/FK/check violations, and malformed input. Retrying these wastes
// flush cycles and leaves the real reason hidden behind a generic "pending"
// status until the 5-attempt cap is finally hit.
const PERMANENT_POSTGRES_ERROR_CODES = new Set([
  '42501', // insufficient_privilege — row-level security policy rejected the write
  '23505', // unique_violation
  '23503', // foreign_key_violation
  '23514', // check_violation
  '22P02', // invalid_text_representation
])

function isPermanentSyncError(err: unknown): boolean {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? (err as { code?: unknown }).code
      : undefined
  return typeof code === 'string' && PERMANENT_POSTGRES_ERROR_CODES.has(code)
}

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Sync request timed out after ${ms}ms`)),
      ms
    )
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
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
  await db.sync_queue
    .where('status')
    .equals('syncing')
    .modify({ status: 'pending' })

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
          const { error: insertErr } = await withTimeout(
            table.upsert(item.payload),
            FLUSH_TIMEOUT_MS
          )
          if (insertErr) throw insertErr
          break
        case 'update':
          const { error: updateErr } = await withTimeout(
            table.update(item.payload).eq('id', item.record_id),
            FLUSH_TIMEOUT_MS
          )
          if (updateErr) throw updateErr
          break
        case 'delete':
          const { error: deleteErr } = await withTimeout(
            table.delete().eq('id', item.record_id),
            FLUSH_TIMEOUT_MS
          )
          if (deleteErr) throw deleteErr
          break
      }

      await db.sync_queue.update(item.id, { status: 'done' })
      succeeded++
    } catch (err) {
      const permanent = isPermanentSyncError(err)
      const newRetry = item.retry_count + 1
      await db.sync_queue.update(item.id, {
        status: permanent || newRetry >= 5 ? 'failed' : ('pending' as SyncStatus),
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

export async function getFailedQueueItems(): Promise<SyncQueueItem[]> {
  return db.sync_queue.where('status').equals('failed').sortBy('created_at')
}

/**
 * Remove a permanently failed queue item (e.g. an RLS-rejected insert made by
 * a user without permission). This does not touch the local Dexie record it
 * was queued from — callers that need to discard the underlying record too
 * should delete that separately.
 */
export async function discardQueueItem(id: string): Promise<void> {
  await db.sync_queue.delete(id)
}

/** Reset a failed item back to pending so the next flush retries it. */
export async function retryQueueItem(id: string): Promise<void> {
  await db.sync_queue.update(id, { status: 'pending' as SyncStatus, retry_count: 0, error: undefined })
}

export async function getSyncStatus(): Promise<SyncStatus> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 'offline' as SyncStatus

  const hydration = getHydrationPhase()
  if (hydration === 'syncing' || (hydration === 'idle' && !hasHydratedThisSession())) {
    return 'syncing'
  }

  const syncing = await db.sync_queue.where('status').equals('syncing').count()
  if (syncing > 0) return 'syncing'

  const failed = await db.sync_queue.where('status').equals('failed').count()
  if (failed > 0) return 'failed'

  const pending = await db.sync_queue.where('status').equals('pending').count()
  if (pending > 0) return 'syncing'

  // Empty outbound queue is not "synced" until a successful remote pull this session.
  if (hydration === 'failed' && !hasHydratedThisSession()) {
    return 'failed'
  }

  if (!hasHydratedThisSession()) {
    return 'syncing'
  }

  return 'done'
}
