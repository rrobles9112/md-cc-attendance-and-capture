'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CaptureForm } from '@/components/forms/CaptureForm'
import { RETREAT_CREATE_DIALOG_DESCRIPTION } from '@/lib/retreat/constants'
import { submitRetreatPreinscription } from '@/lib/retreat/submit-adapter'
import { UserPlus } from 'lucide-react'

export interface RetreatPreinscriptionCreateProps {
  disabled?: boolean
  disabledTitle?: string
  onSuccess: () => void
}

export function RetreatPreinscriptionCreate({
  disabled,
  disabledTitle,
  onSuccess,
}: RetreatPreinscriptionCreateProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        size="sm"
        disabled={disabled}
        title={disabled ? disabledTitle : undefined}
        onClick={() => setOpen(true)}
      >
        <UserPlus className="mr-2 h-4 w-4" /> Nueva preinscripción
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nueva preinscripción</DialogTitle>
            <DialogDescription>{RETREAT_CREATE_DIALOG_DESCRIPTION}</DialogDescription>
          </DialogHeader>
          <CaptureForm
            variant="retreat"
            submitAdapter={submitRetreatPreinscription}
            onSuccess={() => {
              setOpen(false)
              onSuccess()
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
