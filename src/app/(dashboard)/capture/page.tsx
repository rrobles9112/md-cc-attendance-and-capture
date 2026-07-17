'use client'

import { CaptureForm } from '@/components/forms/CaptureForm'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function CapturePage() {
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
