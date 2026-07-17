import Dexie, { type EntityTable } from 'dexie'

export interface Member {
  id: string
  name: string
  name_normalized: string
  phone: string
  email: string
  birthday?: string
  is_minor: boolean
  legal_rep_name?: string
  has_whatsapp: boolean
  consent_recorded: boolean
  sensitive_consent_recorded: boolean
  denomination_encrypted?: Uint8Array
  community_name_encrypted?: Uint8Array
  duplicate_flag: boolean
  created_by: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface Session {
  id: string
  name: string
  session_date: string
  created_by: string
  created_at: string
  deleted_at: string | null
}

export interface Attendance {
  id: string
  member_id: string
  session_id: string
  marked_by: string
  marked_at: string
}

export interface SocialMedia {
  id: string
  member_id: string
  platform: string
  handle: string
  created_at: string
}

export interface WhatsAppNumber {
  id: string
  member_id: string
  number: string
  is_primary_phone: boolean
  created_at: string
}

export type SyncStatus = 'pending' | 'syncing' | 'failed' | 'done' | 'offline'

export interface SyncQueueItem {
  id: string
  table_name: string
  record_id: string
  operation: 'insert' | 'update' | 'delete'
  payload: Record<string, unknown>
  status: SyncStatus
  created_at: string
  retry_count: number
  error?: string
}

const db = new Dexie('AttendanceCaptureDB') as Dexie & {
  members: EntityTable<Member, 'id'>
  sessions: EntityTable<Session, 'id'>
  attendance: EntityTable<Attendance, 'id'>
  social_media: EntityTable<SocialMedia, 'id'>
  whatsapp_numbers: EntityTable<WhatsAppNumber, 'id'>
  sync_queue: EntityTable<SyncQueueItem, 'id'>
}

db.version(1).stores({
  members: 'id, name_normalized, phone, email, deleted_at, duplicate_flag',
  sessions: 'id, session_date, deleted_at',
  attendance: 'id, member_id, session_id, [member_id+session_id]',
  social_media: 'id, member_id',
  whatsapp_numbers: 'id, member_id',
  sync_queue: 'id, status, table_name, created_at',
})

export { db }
