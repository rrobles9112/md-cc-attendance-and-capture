'use client'

import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CaptureForm, type CaptureSubmitPayload } from '@/components/forms/CaptureForm'
import { RETREAT_CREATE_DIALOG_DESCRIPTION } from '@/lib/retreat/constants'
import {
  getMissingRetreatMemberFields,
  memberToCaptureInitialValues,
} from '@/lib/retreat/member-prefill'
import * as retreatSubmitAdapters from '@/lib/retreat/submit-adapter'
import { normalizeColombianPhoneDigits } from '@/lib/retreat/transfer'
import { db, type Member, type WhatsAppNumber } from '@/lib/sync/db'
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
  const [members, setMembers] = useState<Member[]>([])
  const [memberSearch, setMemberSearch] = useState('')
  const [selectedMember, setSelectedMember] = useState<Member | null>(null)
  const [selectedWhatsapp, setSelectedWhatsapp] = useState<WhatsAppNumber[]>([])

  useEffect(() => {
    if (!open) {
      setMemberSearch('')
      setSelectedMember(null)
      setSelectedWhatsapp([])
      return
    }
    if (typeof db.members?.filter !== 'function') return
    let cancelled = false
    void db.members
      .filter((m) => m.deleted_at === null)
      .toArray()
      .then((rows) => {
        if (!cancelled) {
          setMembers(rows.sort((a, b) => a.name.localeCompare(b.name)))
        }
      })
      .catch(() => {
        // Ignore Dexie read errors in environments without IndexedDB
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const matchingMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase()
    if (!q) return []
    const qDigits = normalizeColombianPhoneDigits(q)
    return members
      .filter((m) => {
        const nameMatch = m.name.toLowerCase().includes(q)
        const emailMatch = m.email.toLowerCase().includes(q)
        const phoneMatch =
          m.phone.includes(q) ||
          (qDigits !== '' && normalizeColombianPhoneDigits(m.phone).includes(qDigits))
        return nameMatch || emailMatch || phoneMatch
      })
      .slice(0, 5)
  }, [members, memberSearch])

  async function handleSelectMember(member: Member) {
    setSelectedMember(member)
    setMemberSearch('')
    if (typeof db.whatsapp_numbers?.where === 'function') {
      try {
        const wa = await db.whatsapp_numbers
          .where('member_id')
          .equals(member.id)
          .toArray()
        setSelectedWhatsapp(wa)
      } catch {
        setSelectedWhatsapp([])
      }
    }
  }

  const initialValues = useMemo(
    () =>
      selectedMember
        ? memberToCaptureInitialValues(selectedMember, selectedWhatsapp)
        : undefined,
    [selectedMember, selectedWhatsapp],
  )

  const missingFields = useMemo(
    () => (selectedMember ? getMissingRetreatMemberFields(selectedMember) : []),
    [selectedMember],
  )

  const handleAdapterSubmit = useMemo(() => {
    if (
      selectedMember &&
      typeof retreatSubmitAdapters.submitRetreatPreinscriptionForMember === 'function'
    ) {
      return async (payload: CaptureSubmitPayload) => {
        await retreatSubmitAdapters.submitRetreatPreinscriptionForMember(
          selectedMember.id,
          payload,
        )
        if (typeof db.members?.update === 'function') {
          await db.members.update(selectedMember.id, {
            birthday: payload.birthday || selectedMember.birthday,
            is_minor: payload.isMinor,
            legal_rep_name: payload.legalRepName || selectedMember.legal_rep_name,
            has_whatsapp: payload.hasWhatsapp || selectedMember.has_whatsapp,
            has_medical_conditions:
              payload.hasMedicalConditions ||
              Boolean(selectedMember.has_medical_conditions),
            medical_conditions:
              payload.medicalConditions || selectedMember.medical_conditions,
            medical_medications:
              payload.medicalMedications || selectedMember.medical_medications,
            medical_dosage: payload.medicalDosage || selectedMember.medical_dosage,
            emergency_contact_name:
              payload.emergencyContactName || selectedMember.emergency_contact_name,
            emergency_contact_relationship:
              payload.emergencyContactRelationship ||
              selectedMember.emergency_contact_relationship,
            emergency_contact_phone:
              payload.emergencyContactPhone || selectedMember.emergency_contact_phone,
            updated_at: new Date().toISOString(),
          })
        }
      }
    }
    return retreatSubmitAdapters.submitRetreatPreinscription
  }, [selectedMember])

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
          {members.length > 0 && (
            <div className="space-y-2 rounded-md border bg-muted/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="retreat-member-lookup" className="text-xs font-medium">
                  ¿Ya es miembro de asamblea (Valientes)? Traer sus datos sin duplicarlo
                </Label>
                {selectedMember && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedMember(null)
                      setSelectedWhatsapp([])
                    }}
                  >
                    Limpiar selección
                  </Button>
                )}
              </div>
              {selectedMember ? (
                <div className="space-y-1 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">
                      Miembro vinculado: {selectedMember.name}
                    </Badge>
                    <span className="text-muted-foreground">
                      {selectedMember.phone} · {selectedMember.email}
                    </span>
                  </div>
                  {missingFields.length > 0 ? (
                    <p className="text-amber-800">
                      Complete los datos faltantes si aplica:{' '}
                      <span className="font-medium">{missingFields.join(', ')}</span>.
                    </p>
                  ) : (
                    <p className="text-emerald-800">
                      Todos los datos del miembro fueron precargados.
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <Input
                    id="retreat-member-lookup"
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="Buscar miembro existente por nombre, teléfono o correo…"
                  />
                  {matchingMembers.length > 0 && (
                    <div className="divide-y rounded-md border bg-background">
                      {matchingMembers.map((member) => (
                        <button
                          key={member.id}
                          type="button"
                          onClick={() => void handleSelectMember(member)}
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-muted"
                        >
                          <span className="font-medium">{member.name}</span>
                          <span className="text-muted-foreground">
                            {member.phone} · {member.email}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          <CaptureForm
            variant="retreat"
            initialValues={initialValues}
            submitAdapter={handleAdapterSubmit}
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
