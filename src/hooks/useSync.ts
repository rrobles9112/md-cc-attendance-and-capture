'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { getPendingCount, getSyncStatus, flushQueue, onOnline } from '@/lib/sync/queue'
import { hydrateFromRemote } from '@/lib/sync/hydrate'
import type { SyncStatus } from '@/lib/sync/db'

interface UseSyncReturn {
  status: SyncStatus
  pendingCount: number
  flush: () => Promise<void>
  hydrate: () => Promise<void>
}

const STATUS_REFRESH_MS = 10_000
const AUTO_FLUSH_MS = 30_000

export function useSync(): UseSyncReturn {
  const [status, setStatus] = useState<SyncStatus>('syncing')
  const [pendingCount, setPendingCount] = useState(0)
  const flushingRef = useRef(false)
  const hydratingRef = useRef(false)

  const refresh = useCallback(async () => {
    const [s, p] = await Promise.all([getSyncStatus(), getPendingCount()])
    setStatus(s)
    setPendingCount(p)
  }, [])

  const hydrate = useCallback(async () => {
    if (hydratingRef.current) return
    hydratingRef.current = true
    setStatus('syncing')
    try {
      await hydrateFromRemote()
      await refresh()
    } finally {
      hydratingRef.current = false
    }
  }, [refresh])

  const flush = useCallback(async () => {
    if (flushingRef.current) return
    flushingRef.current = true
    setStatus('syncing')
    try {
      // Pull remote first so local cache is not stale before/while pushing.
      await hydrateFromRemote()
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

    const bootstrap = async () => {
      if (disposed) return
      await hydrate()
      if (disposed) return
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        const pending = await getPendingCount()
        if (!disposed && pending > 0) await flush()
      }
    }

    void bootstrap()

    const unsubscribe = onOnline(() => {
      void flush()
    })

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'flush-sync') void flush()
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
  }, [flush, hydrate, refresh])

  return { status, pendingCount, flush, hydrate }
}
