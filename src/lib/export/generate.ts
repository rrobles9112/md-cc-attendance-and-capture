import * as XLSX from 'xlsx'
import { db, type Member, type SocialMedia, type WhatsAppNumber } from '@/lib/sync/db'

interface MemberExportRow {
  Nombre: string
  Teléfono: string
  Email: string
  'Fecha de Nacimiento': string
  'Es Menor': string
  'Representante Legal': string
  WhatsApp: string
  'Redes Sociales': string
  Denominación: string
  Comunidad: string
  'Fecha de Registro': string
}

export async function generateMemberExport(
  includeSensitive: boolean = false
): Promise<MemberExportRow[]> {
  const members = await db.members
    .filter((m) => m.deleted_at === null)
    .toArray()

  const socialMedia = await db.social_media.toArray()
  const whatsappNumbers = await db.whatsapp_numbers.toArray()

  const socialByMember = groupBy(socialMedia, 'member_id')
  const whatsappByMember = groupBy(whatsappNumbers, 'member_id')

  return members.map((member) => {
    const socials = socialByMember[member.id] ?? []
    const whatsapp = whatsappByMember[member.id] ?? []

    const row: MemberExportRow = {
      Nombre: member.name,
      Teléfono: member.phone,
      Email: member.email,
      'Fecha de Nacimiento': member.birthday ?? '',
      'Es Menor': member.is_minor ? 'Sí' : 'No',
      'Representante Legal': member.legal_rep_name ?? '',
      WhatsApp: formatWhatsApp(member, whatsapp),
      'Redes Sociales': formatSocialMedia(socials),
      Denominación: '',
      Comunidad: '',
      'Fecha de Registro': member.created_at,
    }

    if (includeSensitive && member.sensitive_consent_recorded) {
      // Encrypted fields would need server-side decryption
      // For client-side export, show placeholder
      row.Denominación = '[Cifrado — solicitar al administrador]'
      row.Comunidad = '[Cifrado — solicitar al administrador]'
    }

    return row
  })
}

export function exportToCSV(rows: MemberExportRow[], filename: string): void {
  const ws = XLSX.utils.json_to_sheet(rows)
  const csv = XLSX.utils.sheet_to_csv(ws, { FS: ',' })
  downloadFile(csv, `${filename}.csv`, 'text/csv;charset=utf-8;')
}

export function exportToXLSX(rows: MemberExportRow[], filename: string): void {
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Miembros')
  const xlsxData = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([xlsxData], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  downloadBlob(blob, `${filename}.xlsx`)
}

function formatWhatsApp(
  member: Member,
  whatsappNumbers: WhatsAppNumber[]
): string {
  const numbers: string[] = []
  if (member.has_whatsapp) numbers.push(member.phone)
  whatsappNumbers.forEach((w) => numbers.push(w.number))
  return numbers.join(', ')
}

function formatSocialMedia(socials: SocialMedia[]): string {
  return socials.map((s) => `${s.platform}: ${s.handle}`).join('; ')
}

function groupBy<T>(arr: T[], key: keyof T): Record<string, T[]> {
  return arr.reduce(
    (acc, item) => {
      const groupKey = String(item[key])
      if (!acc[groupKey]) acc[groupKey] = []
      acc[groupKey].push(item)
      return acc
    },
    {} as Record<string, T[]>
  )
}

function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  downloadBlob(blob, filename)
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
