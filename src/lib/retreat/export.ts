import * as XLSX from 'xlsx'
import { parsePositiveTotal } from './payments'
import { RETREAT_EVENT_KEY } from './constants'

export type RetreatReportRow = {
  Nombre: string
  Teléfono: string
  Email: string
  FechaNacimiento: string
  EsMenor: string
  RepresentanteLegal: string
  Estado: string
  'Pagado COP': string
  'Saldo COP': string
  PorcentajePagado: string
  'TotalRetiro COP': string
  CantidadAbonos: number
  ÚltimoAbono: string
  TransferidoAValientes: string
  FechaTransferencia: string
}

export function buildReportRows(
  registrations: Array<{
    name: string
    email: string
    phone: string
    birthday: string | null
    is_minor: boolean
    legal_rep_name: string | null
    status: string
    transferred_at: string | null
  }>,
  paymentsById: Map<string, Array<{ amount: number | string; created_at: string }>>,
  totalCostRaw: string | null,
  idOrder: string[],
): RetreatReportRow[] {
  const total = parsePositiveTotal(totalCostRaw)
  const totalLabel = total === null ? '' : total.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return idOrder.map((id, idx) => {
    const r = registrations[idx]
    const pays = paymentsById.get(id) ?? []
    let paid = 0
    let last: string | null = null
    let max = -1
    for (const p of pays) {
      const a = typeof p.amount === 'number' ? p.amount : Number(p.amount)
      if (Number.isFinite(a)) paid += a
      const t = new Date(p.created_at).getTime()
      if (!Number.isNaN(t) && t > max) {
        max = t
        last = p.created_at
      }
    }
    const remaining = total === null ? null : total - paid
    const percent = total === null || total === 0 ? null : (paid / total) * 100
    return {
      Nombre: r.name,
      Teléfono: r.phone,
      Email: r.email,
      FechaNacimiento: r.birthday ?? '',
      EsMenor: r.is_minor ? 'Sí' : 'No',
      RepresentanteLegal: r.legal_rep_name ?? '',
      Estado: r.status,
      'Pagado COP': paid.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      'Saldo COP': remaining === null ? '' : remaining.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      PorcentajePagado: percent === null ? '' : `${percent.toLocaleString('es-CO', { maximumFractionDigits: 0 })}%`,
      'TotalRetiro COP': totalLabel,
      CantidadAbonos: pays.length,
      ÚltimoAbono: last ? new Date(last).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '',
      TransferidoAValientes: r.transferred_at ? 'Sí' : 'No',
      FechaTransferencia: r.transferred_at ? new Date(r.transferred_at).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '',
    }
  })
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

export function exportRetreatToXLSX(rows: RetreatReportRow[], filename: string): void {
  if (rows.length === 0) {
    const ws = XLSX.utils.json_to_sheet([], { header: Object.keys({ Nombre: '', Teléfono: '', Email: '', FechaNacimiento: '', EsMenor: '', RepresentanteLegal: '', Estado: '', 'Pagado COP': '', 'Saldo COP': '', PorcentajePagado: '', 'TotalRetiro COP': '', CantidadAbonos: 0, ÚltimoAbono: '', TransferidoAValientes: '', FechaTransferencia: '' } as RetreatReportRow) })
    const header = `Evento: ${RETREAT_EVENT_KEY} | Generado: ${new Date().toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
    XLSX.utils.sheet_add_aoa(ws, [[header]], { origin: 'A1' })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Retiro')
    const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    downloadBlob(blob, `${filename}.xlsx`)
    return
  }
  const header = `Evento: ${RETREAT_EVENT_KEY} | Generado: ${new Date().toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
  const ws = XLSX.utils.json_to_sheet(rows, { header: Object.keys(rows[0]) as (keyof RetreatReportRow)[] })
  XLSX.utils.sheet_add_aoa(ws, [[header]], { origin: 'A1' })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Retiro')
  const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  downloadBlob(blob, `${filename}.xlsx`)
}

export function exportRetreatToCSV(rows: RetreatReportRow[], filename: string): void {
  const ws = XLSX.utils.json_to_sheet(rows)
  const csv = XLSX.utils.sheet_to_csv(ws, { FS: ',' })
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  downloadBlob(blob, `${filename}.csv`)
}

export function formatYYYYMMDD(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
