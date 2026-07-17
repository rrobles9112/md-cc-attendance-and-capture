'use client'

import { useEffect, useRef } from 'react'
import { realtimeManager } from '@/lib/realtime/manager'

interface UseRealtimeOptions {
  table: 'members' | 'sessions' | 'attendance' | 'social_media' | 'whatsapp_numbers'
  filter?: string
  onInsert?: (record: Record<string, unknown>) => void
  onUpdate?: (record: Record<string, unknown>) => void
  onDelete?: (record: Record<string, unknown>) => void
  enabled?: boolean
}

export function useRealtime(options: UseRealtimeOptions) {
  const { table, filter, onInsert, onUpdate, onDelete, enabled = true } = options
  const channelNameRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled) return

    const channelName = `db-changes-${table}-${filter ?? 'all'}`
    channelNameRef.current = channelName

    realtimeManager.subscribe({
      table,
      filter,
      onInsert,
      onUpdate,
      onDelete,
    })

    return () => {
      if (channelNameRef.current) {
        realtimeManager.unsubscribe(channelNameRef.current)
        channelNameRef.current = null
      }
    }
  }, [table, filter, enabled, onInsert, onUpdate, onDelete])
}
