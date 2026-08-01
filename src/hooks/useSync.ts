'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { getPendingCount, getSyncStatus, flushQueue, onOnline } from '@/lib/sync/queue'
import type { SyncStatus } from '@/lib/sync/db'

interface UseSyncReturn {
  status: SyncStatus
  pendingCount: number
  flush: () => Promise<void>
}

const STATUS_REFRESH_MS = 10_000
const AUTO_FLUSH_MS = 30_000

export function useSync(): UseSyncReturn {
  const [status, setStatus] = useState<SyncStatus>('done')
  const [pendingCount, setPendingCount] = useState(0)
  const flushingRef = useRef(false)

  const refresh = useCallback(async () => {
    const [s, p] = await Promise.all([getSyncStatus(), getPendingCount()])
    setStatus(s)
    setPendingCount(p)
  }, [])

  const flush = useCallback(async () => {
    if (flushingRef.current) return
    flushingRef.current = true
    setStatus('syncing')
    try {
      await flushQueue()
      await refresh()
    } finally {
      flushingRef.current = false
    }
  }, [refresh])

  useEffect(() => {
    let disposed = false

    const safeRefresh = async () => {
      if (!disposed) await refresh()
    }

    void safeRefresh()

    const unsubscribe = onOnline(() => flush())

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'flush-sync') flush()
    }
    navigator.serviceWorker?.addEventListener('message', handleMessage)

    const statusInterval = setInterval(() => void safeRefresh(), STATUS_REFRESH_MS)

    const flushInterval = setInterval(async () => {
      if (disposed || flushingRef.current) return
      if (typeof navigator === 'undefined' || !navigator.onLine) return
      const pending = await getPendingCount()
      if (disposed || pending === 0) return
      await flush()
    }, AUTO_FLUSH_MS)

    return () => {
      disposed = true
      unsubscribe()
      navigator.serviceWorker?.removeEventListener('message', handleMessage)
      clearInterval(statusInterval)
      clearInterval(flushInterval)
    }
  }, [flush, refresh])

  return { status, pendingCount, flush }
}
