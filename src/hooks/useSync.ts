'use client'

import { useState, useEffect, useCallback } from 'react'
import { getPendingCount, getSyncStatus, flushQueue, onOnline } from '@/lib/sync/queue'
import type { SyncStatus } from '@/lib/sync/db'

interface UseSyncReturn {
  status: SyncStatus
  pendingCount: number
  flush: () => Promise<void>
}

export function useSync(): UseSyncReturn {
  const [status, setStatus] = useState<SyncStatus>('done')
  const [pendingCount, setPendingCount] = useState(0)

  const refresh = useCallback(async () => {
    const [s, p] = await Promise.all([getSyncStatus(), getPendingCount()])
    setStatus(s)
    setPendingCount(p)
  }, [])

  const flush = useCallback(async () => {
    setStatus('syncing')
    await flushQueue()
    await refresh()
  }, [refresh])

  useEffect(() => {
    refresh()

    const unsubscribe = onOnline(() => flush())

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'flush-sync') flush()
    }
    navigator.serviceWorker?.addEventListener('message', handleMessage)

    const interval = setInterval(refresh, 10000)

    return () => {
      unsubscribe()
      navigator.serviceWorker?.removeEventListener('message', handleMessage)
      clearInterval(interval)
    }
  }, [flush, refresh])

  return { status, pendingCount, flush }
}
