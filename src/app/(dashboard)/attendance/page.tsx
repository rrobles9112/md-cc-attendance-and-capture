'use client'

import { useState, useEffect, useCallback } from 'react'
import { db, type Session } from '@/lib/sync/db'
import { useRealtime } from '@/hooks/useRealtime'
import { useCacheHydration } from '@/hooks/useCacheHydration'
import { AttendanceGrid } from '@/components/forms/AttendanceGrid'

export default function AttendancePage() {
  const [sessions, setSessions] = useState<Session[]>([])

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

  useRealtime({
    table: 'sessions',
    onInsert: () => loadSessions(),
    onUpdate: () => loadSessions(),
  })

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Asistencia</h1>
        <p className="text-muted-foreground">
          Marque la asistencia de los miembros por sesión
        </p>
      </div>
      <AttendanceGrid sessions={sessions} onSessionCreated={loadSessions} />
    </div>
  )
}
