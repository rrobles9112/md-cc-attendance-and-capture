'use client'

import { CaptureForm } from '@/components/forms/CaptureForm'
import {
  RETREAT_PAGE_DESCRIPTION,
  RETREAT_PAGE_HEADING,
} from '@/lib/retreat/constants'
import { submitRetreatPreinscription } from '@/lib/retreat/submit-adapter'

export default function RetreatPreinscriptionPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{RETREAT_PAGE_HEADING}</h1>
        <p className="text-muted-foreground">{RETREAT_PAGE_DESCRIPTION}</p>
      </div>
      <CaptureForm variant="retreat" submitAdapter={submitRetreatPreinscription} />
    </div>
  )
}
