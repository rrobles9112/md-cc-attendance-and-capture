'use client'

import { useState, useEffect, useCallback } from 'react'
import { db, type Session } from '@/lib/sync/db'
import { generateMemberExport, exportToCSV, exportToXLSX } from '@/lib/export/generate'
import { useCacheHydration } from '@/hooks/useCacheHydration'
import { useRole } from '@/hooks/useRole'
import { canExport } from '@/lib/rbac/guards'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { Download, FileSpreadsheet, FileText } from 'lucide-react'

export default function ExportPage() {
  const { role } = useRole()
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [exporting, setExporting] = useState(false)
  const [arcoMemberId, setArcoMemberId] = useState('')

  const loadSessions = useCallback(async () => {
    const allSessions = await db.sessions
      .filter((s) => s.deleted_at === null)
      .toArray()
    setSessions(allSessions.sort((a, b) =>
      new Date(b.session_date).getTime() - new Date(a.session_date).getTime()
    ))
  }, [])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  useCacheHydration(() => {
    void loadSessions()
  })

  async function handleExportMembers(format: 'csv' | 'xlsx') {
    setExporting(true)
    try {
      const rows = await generateMemberExport(role === 'super_admin')
      if (rows.length === 0) {
        toast.warning('No hay miembros para exportar')
        return
      }
      const filename = `miembros_${new Date().toISOString().split('T')[0]}`
      if (format === 'csv') {
        exportToCSV(rows, filename)
      } else {
        exportToXLSX(rows, filename)
      }
      toast.success(`Exportación completada: ${rows.length} registros`)
    } catch {
      toast.error('Error al exportar')
    } finally {
      setExporting(false)
    }
  }

  async function handleExportAttendance(format: 'csv' | 'xlsx') {
    setExporting(true)
    try {
      let attendanceRecords = await db.attendance.toArray()

      if (selectedSessionId && selectedSessionId !== 'all') {
        attendanceRecords = attendanceRecords.filter((a) => a.session_id === selectedSessionId)
      }

      if (dateFrom || dateTo) {
        const sessionMap = new Map(sessions.map((s) => [s.id, s]))
        attendanceRecords = attendanceRecords.filter((a) => {
          const session = sessionMap.get(a.session_id)
          if (!session) return false
          if (dateFrom && session.session_date < dateFrom) return false
          if (dateTo && session.session_date > dateTo) return false
          return true
        })
      }

      if (attendanceRecords.length === 0) {
        toast.warning('No hay registros de asistencia para exportar')
        return
      }

      const members = await db.members.toArray()
      const memberMap = new Map(members.map((m) => [m.id, m]))
      const sessionMap = new Map(sessions.map((s) => [s.id, s]))

      const rows = attendanceRecords.map((a) => {
        const member = memberMap.get(a.member_id)
        const session = sessionMap.get(a.session_id)
        return {
          'Miembro': member?.name ?? 'Desconocido',
          'Sesión': session?.name ?? 'Desconocida',
          'Fecha sesión': session?.session_date ?? '',
          'Marcado': new Date(a.marked_at).toLocaleString('es-CO'),
        }
      })

      const filename = `asistencia_${new Date().toISOString().split('T')[0]}`
      const ws = (await import('xlsx')).utils.json_to_sheet(rows)
      const wb = (await import('xlsx')).utils.book_new()
      ;(await import('xlsx')).utils.book_append_sheet(wb, ws, 'Asistencia')

      if (format === 'csv') {
        const csv = (await import('xlsx')).utils.sheet_to_csv(ws)
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
        downloadBlob(blob, `${filename}.csv`)
      } else {
        const data = (await import('xlsx')).write(wb, { bookType: 'xlsx', type: 'array' })
        const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
        downloadBlob(blob, `${filename}.xlsx`)
      }

      toast.success(`Exportación completada: ${rows.length} registros`)
    } catch {
      toast.error('Error al exportar asistencia')
    } finally {
      setExporting(false)
    }
  }

  async function handleArcoExport() {
    if (!arcoMemberId.trim()) {
      toast.error('Ingrese el ID del miembro')
      return
    }
    setExporting(true)
    try {
      const member = await db.members.get(arcoMemberId.trim())
      if (!member) {
        toast.error('Miembro no encontrado')
        return
      }

      const socialMedia = await db.social_media.where('member_id').equals(member.id).toArray()
      const whatsappNumbers = await db.whatsapp_numbers.where('member_id').equals(member.id).toArray()
      const attendance = await db.attendance.where('member_id').equals(member.id).toArray()
      const sessions = await db.sessions.toArray()
      const sessionMap = new Map(sessions.map((s) => [s.id, s]))

      const exportData = {
        'Datos personales': {
          Nombre: member.name,
          Teléfono: member.phone,
          Email: member.email,
          'Fecha de nacimiento': member.birthday ?? 'No registrada',
          'Es menor': member.is_minor ? 'Sí' : 'No',
          'Representante legal': member.legal_rep_name ?? 'N/A',
          WhatsApp: member.has_whatsapp ? 'Sí' : 'No',
          'Consentimiento general': member.consent_recorded ? 'Sí' : 'No',
          'Consentimiento sensible': member.sensitive_consent_recorded ? 'Sí' : 'No',
          'Fecha de registro': member.created_at,
        },
        'Redes sociales': socialMedia.map((sm) => ({
          Plataforma: sm.platform,
          Usuario: sm.handle,
        })),
        'Números WhatsApp adicionales': whatsappNumbers.map((wa) => ({
          Número: wa.number,
        })),
        'Historial de asistencia': attendance.map((a) => ({
          Sesión: sessionMap.get(a.session_id)?.name ?? 'Desconocida',
          Fecha: sessionMap.get(a.session_id)?.session_date ?? '',
          'Marcado': new Date(a.marked_at).toLocaleString('es-CO'),
        })),
      }

      const ws = (await import('xlsx')).utils.json_to_sheet([exportData['Datos personales']])
      const wb = (await import('xlsx')).utils.book_new()
      ;(await import('xlsx')).utils.book_append_sheet(wb, ws, 'Datos personales')

      if (socialMedia.length > 0) {
        const smWs = (await import('xlsx')).utils.json_to_sheet(exportData['Redes sociales'])
        ;(await import('xlsx')).utils.book_append_sheet(wb, smWs, 'Redes sociales')
      }
      if (attendance.length > 0) {
        const attWs = (await import('xlsx')).utils.json_to_sheet(exportData['Historial de asistencia'])
        ;(await import('xlsx')).utils.book_append_sheet(wb, attWs, 'Asistencia')
      }

      const data = (await import('xlsx')).write(wb, { bookType: 'xlsx', type: 'array' })
      const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      downloadBlob(blob, `arco_${member.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`)

      toast.success('Exportación ARCO completada')
    } catch {
      toast.error('Error en la exportación ARCO')
    } finally {
      setExporting(false)
    }
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (!role || !canExport(role)) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground">
        No tiene permisos para acceder a esta sección
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Exportar datos</h1>
        <p className="text-muted-foreground">
          Descargue datos de miembros y asistencia en formato CSV o XLSX
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Exportar miembros</CardTitle>
          <CardDescription>Descargar lista completa de miembros</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => handleExportMembers('csv')}
            disabled={exporting}
          >
            <FileText className="mr-2 h-4 w-4" />
            CSV
          </Button>
          <Button
            variant="outline"
            onClick={() => handleExportMembers('xlsx')}
            disabled={exporting}
          >
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            XLSX
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Exportar asistencia</CardTitle>
          <CardDescription>Filtre por sesión o rango de fechas</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Sesión</Label>
              <Select value={selectedSessionId} onValueChange={setSelectedSessionId}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {sessions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dateFrom">Desde</Label>
              <Input
                id="dateFrom"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dateTo">Hasta</Label>
              <Input
                id="dateTo"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => handleExportAttendance('csv')}
              disabled={exporting}
            >
              <FileText className="mr-2 h-4 w-4" />
              CSV
            </Button>
            <Button
              variant="outline"
              onClick={() => handleExportAttendance('xlsx')}
              disabled={exporting}
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              XLSX
            </Button>
          </div>
        </CardContent>
      </Card>

      {role === 'super_admin' && (
        <Card>
          <CardHeader>
            <CardTitle>Exportación ARCO (sujeto individual)</CardTitle>
            <CardDescription>
              Exportar todos los datos de un miembro específico (derecho de acceso)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="arcoMemberId">ID del miembro</Label>
              <Input
                id="arcoMemberId"
                value={arcoMemberId}
                onChange={(e) => setArcoMemberId(e.target.value)}
                placeholder="UUID del miembro"
              />
            </div>
            <Button onClick={handleArcoExport} disabled={exporting}>
              <Download className="mr-2 h-4 w-4" />
              Exportar datos del miembro
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
