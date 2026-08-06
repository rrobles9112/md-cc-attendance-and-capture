'use client'

import { CaptureForm } from '@/components/forms/CaptureForm'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useRole } from '@/hooks/useRole'
import { canCreate } from '@/lib/rbac/guards'

export default function CapturePage() {
  const { role, loading } = useRole()

  if (loading) return null

  // The sidebar already hides this route for roles without canCreate, but a
  // direct navigation (bookmark, browser history, PWA shortcut) would still
  // reach this page. Without this guard the form silently queues a member
  // insert that the `members_insert` RLS policy always rejects with 42501,
  // which only surfaces later as a stuck "Error de sincronización" badge.
  if (!role || !canCreate(role)) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground">
        No tiene permisos para acceder a esta sección
      </div>
    )
  }

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
