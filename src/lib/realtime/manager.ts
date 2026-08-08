import { createClient } from '@/lib/supabase/client'
import { db } from '@/lib/sync/db'
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'

type TableName = 'members' | 'sessions' | 'attendance' | 'social_media' | 'whatsapp_numbers'

type RecordData = Record<string, unknown>

export interface RealtimeCallbacks {
  onInsert?: (record: RecordData) => void
  onUpdate?: (record: RecordData) => void
  onDelete?: (record: RecordData) => void
}

interface SubscriptionConfig extends RealtimeCallbacks {
  table: TableName
  filter?: string
}

interface ManagedChannel {
  channel: RealtimeChannel
  /** Every component subscribed to this channel; each keeps its own callbacks. */
  listeners: Set<RealtimeCallbacks>
  reconnectScheduled?: boolean
}

export class RealtimeManager {
  private channels: Map<string, ManagedChannel> = new Map()
  private supabase = createClient()

  /**
   * Subscribes to changes on a table. Components subscribing to the same
   * table/filter share a single channel, but each keeps its own callbacks.
   * Returns the channel name; pass it (plus the callbacks object) to
   * unsubscribe() when the component unmounts.
   */
  subscribe(config: SubscriptionConfig): string {
    const channelName = `db-changes-${config.table}-${config.filter ?? 'all'}`
    const callbacks: RealtimeCallbacks = {
      onInsert: config.onInsert,
      onUpdate: config.onUpdate,
      onDelete: config.onDelete,
    }

    const existing = this.channels.get(channelName)
    if (existing) {
      existing.listeners.add(callbacks)
      return channelName
    }

    const managed: ManagedChannel = {
      channel: undefined as unknown as RealtimeChannel,
      listeners: new Set([callbacks]),
    }
    managed.channel = this.createChannel(channelName, config.table, config.filter, managed)
    this.channels.set(channelName, managed)
    return channelName
  }

  private createChannel(
    channelName: string,
    table: TableName,
    filter: string | undefined,
    managed: ManagedChannel
  ): RealtimeChannel {
    const channel = this.supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          filter,
        },
        (payload: RealtimePostgresChangesPayload<RecordData>) => {
          void this.handleEvent(table, payload, managed.listeners)
        }
      )
      .subscribe((status) => {
        if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !managed.reconnectScheduled) {
          managed.reconnectScheduled = true
          setTimeout(() => {
            managed.reconnectScheduled = false
            this.reconnect(channelName, table, filter, managed)
          }, 3000)
        }
      })

    return channel
  }

  private async handleEvent(
    table: TableName,
    payload: RealtimePostgresChangesPayload<RecordData>,
    listeners: Set<RealtimeCallbacks>
  ): Promise<void> {
    const { eventType, new: newRecord, old: oldRecord } = payload

    switch (eventType) {
      case 'INSERT':
        await this.upsertLocal(table, newRecord as RecordData)
        listeners.forEach((l) => l.onInsert?.(newRecord as RecordData))
        break
      case 'UPDATE':
        await this.upsertLocal(table, newRecord as RecordData)
        listeners.forEach((l) => l.onUpdate?.(newRecord as RecordData))
        break
      case 'DELETE':
        await this.deleteLocal(table, oldRecord as RecordData)
        listeners.forEach((l) => l.onDelete?.(oldRecord as RecordData))
        break
    }
  }

  private async upsertLocal(table: TableName, record: RecordData): Promise<void> {
    switch (table) {
      case 'members':
        await db.members.put(record as unknown as import('@/lib/sync/db').Member)
        break
      case 'sessions':
        await db.sessions.put(record as unknown as import('@/lib/sync/db').Session)
        break
      case 'attendance':
        await db.attendance.put(record as unknown as import('@/lib/sync/db').Attendance)
        break
      case 'social_media':
        await db.social_media.put(record as unknown as import('@/lib/sync/db').SocialMedia)
        break
      case 'whatsapp_numbers':
        await db.whatsapp_numbers.put(record as unknown as import('@/lib/sync/db').WhatsAppNumber)
        break
    }
  }

  private async deleteLocal(table: TableName, record: RecordData): Promise<void> {
    const id = record.id as string
    if (!id) return

    switch (table) {
      case 'members':
        await db.members.delete(id)
        break
      case 'sessions':
        await db.sessions.delete(id)
        break
      case 'attendance':
        await db.attendance.delete(id)
        break
      case 'social_media':
        await db.social_media.delete(id)
        break
      case 'whatsapp_numbers':
        await db.whatsapp_numbers.delete(id)
        break
    }
  }

  private reconnect(
    channelName: string,
    table: TableName,
    filter: string | undefined,
    managed: ManagedChannel
  ): void {
    // Channel was unsubscribed while the reconnect was pending.
    if (!this.channels.has(channelName) || managed.listeners.size === 0) return

    void this.supabase.removeChannel(managed.channel)
    managed.channel = this.createChannel(channelName, table, filter, managed)
  }

  /**
   * Removes one subscriber's callbacks. The underlying channel is only torn
   * down when the last subscriber leaves, so a shared channel survives other
   * components' unmounts.
   */
  unsubscribe(channelName: string, callbacks?: RealtimeCallbacks): void {
    const managed = this.channels.get(channelName)
    if (!managed) return

    if (callbacks) {
      managed.listeners.delete(callbacks)
    } else {
      managed.listeners.clear()
    }

    if (managed.listeners.size === 0) {
      this.channels.delete(channelName)
      void this.supabase.removeChannel(managed.channel)
    }
  }

  unsubscribeAll(): void {
    for (const [name, managed] of this.channels) {
      void this.supabase.removeChannel(managed.channel)
      this.channels.delete(name)
    }
  }
}

export const realtimeManager = new RealtimeManager()
