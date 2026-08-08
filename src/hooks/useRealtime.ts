'use client'

import { useEffect, useRef } from 'react'
import { realtimeManager, type RealtimeCallbacks } from '@/lib/realtime/manager'

interface UseRealtimeOptions {
  table: 'members' | 'sessions' | 'attendance' | 'social_media' | 'whatsapp_numbers'
  filter?: string
  onInsert?: (record: Record<string, unknown>) => void
  onUpdate?: (record: Record<string, unknown>) => void
  onDelete?: (record: Record<string, unknown>) => void
  enabled?: boolean
}

export function useRealtime(options: UseRealtimeOptions) {
  const { table, filter, enabled = true } = options

  // Always dispatch to the latest callbacks without re-subscribing.
  // Inline arrow props (e.g. onInsert={() => load()}) get a new identity on
  // every render; listing them in the effect deps would tear down and
  // re-create the channel on every render and drop events in the gap.
  const latestRef = useRef<RealtimeCallbacks>({})
  latestRef.current = {
    onInsert: options.onInsert,
    onUpdate: options.onUpdate,
    onDelete: options.onDelete,
  }

  useEffect(() => {
    if (!enabled) return

    // Stable proxy object: identity never changes across renders, so the
    // manager can use it to track this subscriber.
    const callbacks: RealtimeCallbacks = {
      onInsert: (record) => latestRef.current.onInsert?.(record),
      onUpdate: (record) => latestRef.current.onUpdate?.(record),
      onDelete: (record) => latestRef.current.onDelete?.(record),
    }

    const channelName = realtimeManager.subscribe({ table, filter, ...callbacks })

    return () => {
      realtimeManager.unsubscribe(channelName, callbacks)
    }
  }, [table, filter, enabled])
}
