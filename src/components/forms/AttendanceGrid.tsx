'use client'

import { useState, useEffect, useCallback, useDeferredValue, useMemo } from 'react'
import { db, type Member, type Session, type Attendance } from '@/lib/sync/db'
import { enqueue } from '@/lib/sync/queue'
import { useRealtime } from '@/hooks/useRealtime'
import { useCacheHydration } from '@/hooks/useCacheHydration'
import { useRole } from '@/hooks/useRole'
import { canManageAttendanceSessions } from '@/lib/rbac/guards'
import { softDelete } from '@/lib/delete/soft-delete'
import { Pencil, Trash2 } from 'lucide-react'
import { resolveAttendanceConflict } from '@/lib/sync/conflict'
import {
  countPresent,
  excludeOrphanedAttendance,
  filterBySearch,
  PAGE_SIZE,
  paginateMembers,
} from '@/lib/attendance'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from 'sonner'

interface AttendanceGridProps {
  sessions: Session[]
  onSessionCreated?: () => void
}

export function AttendanceGrid({ sessions, onSessionCreated }: AttendanceGridProps) {
  const { role } = useRole()
  const [selectedSessionId, setSelectedSessionId] = useState<string>('')
  const [members, setMembers] = useState<Member[]>([])
  const [attendanceMap, setAttendanceMap] = useState<Record<string, Attendance>>({})
  const [search, setSearch] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [newSessionName, setNewSessionName] = useState('')
  const [newSessionDate, setNewSessionDate] = useState(new Date().toISOString().split('T')[0])
  const [showNewSession, setShowNewSession] = useState(false)
  const [editingSession, setEditingSession] = useState<Session | null>(null)
  const [editName, setEditName] = useState('')
  const [editDate, setEditDate] = useState('')

  const canManageSessions = !!role && canManageAttendanceSessions(role)

  const loadMembers = useCallback(async () => {
    const allMembers = await db.members
      .filter((m) => m.deleted_at === null)
      .toArray()
    setMembers(allMembers.sort((a, b) => a.name.localeCompare(b.name)))
  }, [])

  const loadAttendance = useCallback(async () => {
    if (!selectedSessionId) {
      setAttendanceMap({})
      return
    }
    const records = await db.attendance
      .where('session_id')
      .equals(selectedSessionId)
      .toArray()
    const activeMemberIds = new Set(members.map((member) => member.id))
    setAttendanceMap(excludeOrphanedAttendance(records, activeMemberIds))
  }, [members, selectedSessionId])

  useEffect(() => {
    loadMembers()
  }, [loadMembers])

  useEffect(() => {
    loadAttendance()
  }, [loadAttendance])

  useCacheHydration(() => {
    void loadMembers()
    void loadAttendance()
  })

  useRealtime({
    table: 'attendance',
    onInsert: () => loadAttendance(),
    onUpdate: () => loadAttendance(),
    onDelete: () => loadAttendance(),
    enabled: !!selectedSessionId,
  })

  useRealtime({
    table: 'members',
    onInsert: () => loadMembers(),
    onUpdate: () => loadMembers(),
    onDelete: () => loadMembers(),
  })

  async function handleToggleAttendance(memberId: string) {
    if (!selectedSessionId) return

    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    const now = new Date().toISOString()
    const existing = attendanceMap[memberId]

    if (existing) {
      await db.attendance.delete(existing.id)
      setAttendanceMap((prev) => {
        const next = { ...prev }
        delete next[memberId]
        return next
      })
      await enqueue('attendance', existing.id, 'delete', { id: existing.id })
    } else {
      const attendanceId = crypto.randomUUID()
      await resolveAttendanceConflict(memberId, selectedSessionId, session.user.id, now)
      const record: Attendance = {
        id: attendanceId,
        member_id: memberId,
        session_id: selectedSessionId,
        marked_by: session.user.id,
        marked_at: now,
      }
      setAttendanceMap((prev) => ({ ...prev, [memberId]: record }))
      await enqueue('attendance', attendanceId, 'insert', {
        id: attendanceId,
        member_id: memberId,
        session_id: selectedSessionId,
        marked_by: session.user.id,
        marked_at: now,
      })
    }
  }

  async function handleCreateSession() {
    if (!newSessionName.trim()) {
      toast.error('El nombre de la sesión es obligatorio')
      return
    }

    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    const sessionId = crypto.randomUUID()
    const now = new Date().toISOString()

    await db.sessions.add({
      id: sessionId,
      name: newSessionName.trim(),
      session_date: newSessionDate,
      created_by: session.user.id,
      created_at: now,
      deleted_at: null,
    })

    await enqueue('sessions', sessionId, 'insert', {
      id: sessionId,
      name: newSessionName.trim(),
      session_date: newSessionDate,
      created_by: session.user.id,
      created_at: now,
    })

    setNewSessionName('')
    setShowNewSession(false)
    setSelectedSessionId(sessionId)
    toast.success('Sesión creada exitosamente')
    onSessionCreated?.()
  }

  function handleStartEditSession() {
    const session = sessions.find((s) => s.id === selectedSessionId)
    if (!session) return
    setEditingSession(session)
    setEditName(session.name)
    setEditDate(session.session_date)
  }

  // Sessions have no updated_at column; a partial update payload (name +
  // session_date) is enqueued and replayed as a targeted UPDATE by the sync
  // worker. Only super_admin reaches these handlers (canManageSessions gate).
  async function handleSaveSession() {
    if (!editingSession) return
    if (!editName.trim()) {
      toast.error('El nombre de la sesión es obligatorio')
      return
    }
    try {
      await db.sessions.update(editingSession.id, { name: editName.trim(), session_date: editDate })
      await enqueue('sessions', editingSession.id, 'update', {
        name: editName.trim(),
        session_date: editDate,
      })
      toast.success('Sesión actualizada')
      setEditingSession(null)
      onSessionCreated?.()
    } catch {
      toast.error('Error al actualizar la sesión')
    }
  }

  // Soft delete locally + enqueue the deleted_at stamp; the remote
  // sessions_update RLS policy (super_admin only) applies the same change.
  async function handleDeleteSession() {
    if (!selectedSessionId) return
    if (!confirm('¿Está seguro de eliminar esta sesión? Esta acción no se puede deshacer.')) return
    try {
      await softDelete('sessions', selectedSessionId)
      await enqueue('sessions', selectedSessionId, 'update', {
        deleted_at: new Date().toISOString(),
      })
      toast.success('Sesión eliminada')
      setSelectedSessionId('')
      onSessionCreated?.()
    } catch {
      toast.error('Error al eliminar la sesión')
    }
  }

  const deferredSearch = useDeferredValue(search)
  const filteredMembers = useMemo(
    () => filterBySearch(members, deferredSearch),
    [members, deferredSearch],
  )
  const visibleMembers = useMemo(
    () => paginateMembers(filteredMembers, visibleCount),
    [filteredMembers, visibleCount],
  )

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [deferredSearch, selectedSessionId])

  const markedCount = countPresent(filteredMembers, attendanceMap)

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <Label>Sesión</Label>
          <Select value={selectedSessionId} onValueChange={setSelectedSessionId}>
            <SelectTrigger>
              <SelectValue placeholder="Seleccionar sesión" />
            </SelectTrigger>
            <SelectContent>
              {sessions.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} — {s.session_date}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canManageSessions && (
          <Button variant="outline" onClick={() => setShowNewSession(!showNewSession)}>
            {showNewSession ? 'Cancelar' : 'Nueva sesión'}
          </Button>
        )}
        {canManageSessions && selectedSessionId && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleStartEditSession}>
              <Pencil className="mr-1 h-4 w-4" /> Editar
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="text-destructive hover:text-destructive"
              title="Eliminar"
              aria-label="Eliminar sesión"
              onClick={() => void handleDeleteSession()}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {editingSession && (
        <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="editSessionName">Nombre de la sesión</Label>
            <Input
              id="editSessionName"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Viernes 18 Julio"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="editSessionDate">Fecha</Label>
            <Input
              id="editSessionDate"
              type="date"
              value={editDate}
              onChange={(e) => setEditDate(e.target.value)}
            />
          </div>
          <Button onClick={() => void handleSaveSession()}>Guardar</Button>
          <Button variant="outline" onClick={() => setEditingSession(null)}>
            Cancelar
          </Button>
        </div>
      )}

      {showNewSession && (
        <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="sessionName">Nombre de la sesión</Label>
            <Input
              id="sessionName"
              value={newSessionName}
              onChange={(e) => setNewSessionName(e.target.value)}
              placeholder="Viernes 18 Julio"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sessionDate">Fecha</Label>
            <Input
              id="sessionDate"
              type="date"
              value={newSessionDate}
              onChange={(e) => setNewSessionDate(e.target.value)}
            />
          </div>
          <Button onClick={handleCreateSession}>Crear</Button>
        </div>
      )}

      {selectedSessionId && (
        <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Input
                placeholder="Buscar miembro..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-64"
              />
            </div>
            <Badge variant="outline">
              {markedCount} / {members.length} presentes
            </Badge>
          </div>

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Presente</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead className="hidden sm:table-cell">Teléfono</TableHead>
                  <TableHead className="hidden md:table-cell">Email</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMembers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      {deferredSearch.trim()
                        ? 'No se encontraron miembros'
                        : 'No hay miembros registrados'}
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleMembers.map((member) => {
                    const isMarked = !!attendanceMap[member.id]
                    return (
                      <TableRow
                        key={member.id}
                        className={isMarked ? 'bg-green-50' : ''}
                      >
                        <TableCell>
                          <Checkbox
                            checked={isMarked}
                            onCheckedChange={() => handleToggleAttendance(member.id)}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{member.name}</TableCell>
                        <TableCell className="hidden sm:table-cell">{member.phone}</TableCell>
                        <TableCell className="hidden md:table-cell">{member.email}</TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
          {filteredMembers.length > visibleCount && (
            <Button
              variant="outline"
              onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
            >
              Cargar más
            </Button>
          )}
        </>
      )}

      {!selectedSessionId && (
        <div className="flex h-48 items-center justify-center rounded-lg border text-muted-foreground">
          Seleccione o cree una sesión para marcar asistencia
        </div>
      )}
    </div>
  )
}
