import { createClient } from '@/lib/supabase/client'
import { db } from '@/lib/sync/db'
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'

type TableName = 'members' | 'sessions' | 'attendance' | 'social_media' | 'whatsapp_numbers'

interface SubscriptionConfig {
  table: TableName
  filter?: string
  onInsert?: (record: Record<string, unknown>) => void
  onUpdate?: (record: Record<string, unknown>) => void
  onDelete?: (record: Record<string, unknown>) => void
}

export class RealtimeManager {
  private channels: Map<string, RealtimeChannel> = new Map()
  private supabase = createClient()

  subscribe(config: SubscriptionConfig): RealtimeChannel {
    const channelName = `db-changes-${config.table}-${config.filter ?? 'all'}`

    if (this.channels.has(channelName)) {
      return this.channels.get(channelName)!
    }

    const channel = this.supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: config.table,
          filter: config.filter,
        },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          this.handleEvent(config.table, payload, config)
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          this.reconnect(config)
        }
      })

    this.channels.set(channelName, channel)
    return channel
  }

  private async handleEvent(
    table: TableName,
    payload: RealtimePostgresChangesPayload<Record<string, unknown>>,
    config: SubscriptionConfig
  ): Promise<void> {
    const { eventType, new: newRecord, old: oldRecord } = payload

    switch (eventType) {
      case 'INSERT':
        await this.upsertLocal(table, newRecord as Record<string, unknown>)
        config.onInsert?.(newRecord as Record<string, unknown>)
        break
      case 'UPDATE':
        await this.upsertLocal(table, newRecord as Record<string, unknown>)
        config.onUpdate?.(newRecord as Record<string, unknown>)
        break
      case 'DELETE':
        await this.deleteLocal(table, oldRecord as Record<string, unknown>)
        config.onDelete?.(oldRecord as Record<string, unknown>)
        break
    }
  }

  private async upsertLocal(table: TableName, record: Record<string, unknown>): Promise<void> {
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

  private async deleteLocal(table: TableName, record: Record<string, unknown>): Promise<void> {
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

  private reconnect(config: SubscriptionConfig): void {
    const channelName = `db-changes-${config.table}-${config.filter ?? 'all'}`
    this.channels.delete(channelName)
    setTimeout(() => this.subscribe(config), 3000)
  }

  unsubscribe(channelName: string): void {
    const channel = this.channels.get(channelName)
    if (channel) {
      this.supabase.removeChannel(channel)
      this.channels.delete(channelName)
    }
  }

  unsubscribeAll(): void {
    for (const [name, channel] of this.channels) {
      this.supabase.removeChannel(channel)
      this.channels.delete(name)
    }
  }
}

export const realtimeManager = new RealtimeManager()
