'use client'

import { CaptureForm } from '@/components/forms/CaptureForm'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useRole } from '@/hooks/useRole'

export default function CapturePage() {
  const { loading } = useRole()

  if (loading) return null

  // This page renders for every authenticated dashboard role (super_admin,
  // leader, server). The `members_insert` RLS policy now accepts every staff
  // role (server included), so a direct navigation (bookmark, browser
  // history, PWA shortcut) no longer queues a member insert that RLS would
  // reject with 42501 and surface later as a stuck sync error badge.
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Capturar miembro</h1>
        <p className="text-muted-foreground">
          Registre los datos de un nuevo visitante o miembro
        </p>
      </div>
      <CaptureForm />
    </div>
  )
}
