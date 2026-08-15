'use client'

import { useState, useEffect, useCallback, useDeferredValue, useMemo } from 'react'
import { db, type Member, type Session, type Attendance } from '@/lib/sync/db'
import { enqueue } from '@/lib/sync/queue'
import { useRealtime } from '@/hooks/useRealtime'
import { useCacheHydration } from '@/hooks/useCacheHydration'
import { useRole } from '@/hooks/useRole'
import { canCreate } from '@/lib/rbac/guards'
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
        {role && canCreate(role) && (
          <Button variant="outline" onClick={() => setShowNewSession(!showNewSession)}>
            {showNewSession ? 'Cancelar' : 'Nueva sesión'}
          </Button>
        )}
      </div>

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
