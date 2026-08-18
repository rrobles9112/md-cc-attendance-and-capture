'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { db } from '@/lib/sync/db'
import { enqueue } from '@/lib/sync/queue'
import { validateGeneralConsent, validateMinorFields, checkMinorStatus } from '@/lib/consent/validation'
import { PRIVACY_NOTICE_ES, RETREAT_PRIVACY_NOTICE_ES, SENSITIVE_DATA_NOTICE_ES } from '@/lib/consent/privacy-notice'
import { logGeneralConsent, logSensitiveConsent } from '@/lib/audit/consent-logger'
import { findDuplicateMembers, markDuplicateFlag } from '@/lib/sync/conflict'
import { createClient } from '@/lib/supabase/client'
import {
  RETREAT_ERROR_MESSAGE,
  RETREAT_PERSONAL_DESCRIPTION,
  RETREAT_SUBMIT_LABEL,
  RETREAT_SUBMITTING_LABEL,
  RETREAT_SUCCESS_MESSAGE,
} from '@/lib/retreat/constants'
import { toast } from 'sonner'
import { Plus, X } from 'lucide-react'

interface SocialMediaEntry {
  platform: string
  handle: string
}

const SOCIAL_PLATFORMS = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'x', label: 'X' },
  { value: 'other', label: 'Otro' },
]

export type CaptureFormVariant = 'member' | 'retreat'

export type CaptureSubmitPayload = {
  name: string
  phone: string
  email: string
  birthday: string
  isMinor: boolean
  legalRepName: string
  generalConsent: boolean
  sensitiveConsent: boolean
  denomination: string
  communityName: string
}

export interface CaptureFormProps {
  onSuccess?: () => void
  variant?: CaptureFormVariant
  submitAdapter?: (payload: CaptureSubmitPayload) => Promise<void>
}

function captureFormConfig(variant: CaptureFormVariant) {
  switch (variant) {
    case 'member':
      return {
        personalDescription: 'Información de contacto del miembro',
        submitLabel: 'Registrar miembro',
        submittingLabel: 'Registrando...',
        successToast: 'Miembro registrado exitosamente',
        errorToast: 'Error al registrar el miembro',
        privacyNotice: PRIVACY_NOTICE_ES,
        showOptionalContactCards: true,
      }
    case 'retreat':
      return {
        personalDescription: RETREAT_PERSONAL_DESCRIPTION,
        submitLabel: RETREAT_SUBMIT_LABEL,
        submittingLabel: RETREAT_SUBMITTING_LABEL,
        successToast: RETREAT_SUCCESS_MESSAGE,
        errorToast: RETREAT_ERROR_MESSAGE,
        privacyNotice: RETREAT_PRIVACY_NOTICE_ES,
        showOptionalContactCards: false,
      }
    default: {
      const exhaustive: never = variant
      throw new Error(`Unhandled CaptureForm variant: ${String(exhaustive)}`)
    }
  }
}

export function CaptureForm({
  onSuccess,
  variant = 'member',
  submitAdapter,
}: CaptureFormProps) {
  const copy = captureFormConfig(variant)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [birthday, setBirthday] = useState('')
  const [isMinor, setIsMinor] = useState(false)
  const [legalRepName, setLegalRepName] = useState('')

  const [generalConsent, setGeneralConsent] = useState(false)
  const [sensitiveConsent, setSensitiveConsent] = useState(false)
  const [denomination, setDenomination] = useState('')
  const [communityName, setCommunityName] = useState('')

  const [hasWhatsapp, setHasWhatsapp] = useState(false)
  const [additionalWhatsapp, setAdditionalWhatsapp] = useState('')

  const [showSocialMedia, setShowSocialMedia] = useState(false)
  const [socialMedia, setSocialMedia] = useState<SocialMediaEntry[]>([])

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const handleBirthdayChange = useCallback((value: string) => {
    setBirthday(value)
    if (value) {
      const result = checkMinorStatus(new Date(value))
      setIsMinor(result.isMinor)
      if (!result.isMinor) {
        setLegalRepName('')
      }
    } else {
      setIsMinor(false)
      setLegalRepName('')
    }
  }, [])

  function addSocialMedia() {
    setSocialMedia([...socialMedia, { platform: 'instagram', handle: '' }])
  }

  function removeSocialMedia(index: number) {
    setSocialMedia(socialMedia.filter((_, i) => i !== index))
  }

  function updateSocialMedia(index: number, field: keyof SocialMediaEntry, value: string) {
    const updated = [...socialMedia]
    updated[index] = { ...updated[index], [field]: value }
    setSocialMedia(updated)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrors({})

    const newErrors: Record<string, string> = {}

    if (!name.trim()) newErrors.name = 'El nombre es obligatorio.'
    if (!phone.trim()) newErrors.phone = 'El teléfono es obligatorio.'
    if (!email.trim()) newErrors.email = 'El correo es obligatorio.'

    const consentResult = validateGeneralConsent(generalConsent)
    if (!consentResult.valid) {
      newErrors.consent = consentResult.error!
    }

    if (isMinor) {
      const minorResult = validateMinorFields(isMinor, legalRepName)
      if (!minorResult.valid) {
        newErrors.legalRep = minorResult.error!
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    setSubmitting(true)

    try {
      const payload: CaptureSubmitPayload = {
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        birthday,
        isMinor,
        legalRepName: isMinor ? legalRepName.trim() : '',
        generalConsent,
        sensitiveConsent,
        denomination,
        communityName,
      }

      if (submitAdapter) {
        await submitAdapter(payload)
        toast.success(copy.successToast)
        resetForm()
        onSuccess?.()
        return
      }

      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const memberId = crypto.randomUUID()
      const now = new Date().toISOString()
      const nameNormalized = name.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ')

      const duplicates = await findDuplicateMembers(name, phone, email)
      const hasDuplicate = duplicates.length > 0

      await db.members.add({
        id: memberId,
        name: name.trim(),
        name_normalized: nameNormalized,
        phone: phone.trim(),
        email: email.trim(),
        birthday: birthday || undefined,
        is_minor: isMinor,
        legal_rep_name: isMinor ? legalRepName.trim() : undefined,
        has_whatsapp: hasWhatsapp,
        consent_recorded: true,
        sensitive_consent_recorded: sensitiveConsent,
        duplicate_flag: hasDuplicate,
        created_by: session?.user?.id ?? '',
        created_at: now,
        updated_at: now,
        deleted_at: null,
      })

      await enqueue('members', memberId, 'insert', {
        id: memberId,
        name: name.trim(),
        name_normalized: nameNormalized,
        phone: phone.trim(),
        email: email.trim(),
        birthday: birthday || null,
        is_minor: isMinor,
        legal_rep_name: isMinor ? legalRepName.trim() : null,
        has_whatsapp: hasWhatsapp,
        consent_recorded: true,
        sensitive_consent_recorded: sensitiveConsent,
        duplicate_flag: hasDuplicate,
        created_by: session?.user?.id ?? null,
        created_at: now,
        updated_at: now,
      })

      await logGeneralConsent(memberId)

      if (sensitiveConsent) {
        await logSensitiveConsent(memberId)
      }

      if (hasWhatsapp && additionalWhatsapp.trim()) {
        const whatsappId = crypto.randomUUID()
        await db.whatsapp_numbers.add({
          id: whatsappId,
          member_id: memberId,
          number: additionalWhatsapp.trim(),
          is_primary_phone: false,
          created_at: now,
        })
        await enqueue('whatsapp_numbers', whatsappId, 'insert', {
          id: whatsappId,
          member_id: memberId,
          number: additionalWhatsapp.trim(),
          is_primary_phone: false,
          created_at: now,
        })
      }

      if (showSocialMedia) {
        for (const sm of socialMedia.filter((s) => s.handle.trim())) {
          const smId = crypto.randomUUID()
          await db.social_media.add({
            id: smId,
            member_id: memberId,
            platform: sm.platform,
            handle: sm.handle.trim(),
            created_at: now,
          })
          await enqueue('social_media', smId, 'insert', {
            id: smId,
            member_id: memberId,
            platform: sm.platform,
            handle: sm.handle.trim(),
            created_at: now,
          })
        }
      }

      if (hasDuplicate) {
        await markDuplicateFlag(memberId)
      }

      toast.success(copy.successToast)
      if (hasDuplicate) {
        toast.warning('Se detectó un posible duplicado. El administrador revisará el registro.')
      }

      resetForm()
      onSuccess?.()
    } catch (err) {
      toast.error(copy.errorToast)
      console.error('Capture error:', err)
    } finally {
      setSubmitting(false)
    }
  }

  function resetForm() {
    setName('')
    setPhone('')
    setEmail('')
    setBirthday('')
    setIsMinor(false)
    setLegalRepName('')
    setGeneralConsent(false)
    setSensitiveConsent(false)
    setDenomination('')
    setCommunityName('')
    setHasWhatsapp(false)
    setAdditionalWhatsapp('')
    setShowSocialMedia(false)
    setSocialMedia([])
    setErrors({})
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Datos personales</CardTitle>
          <CardDescription>{copy.personalDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre completo *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Juan Pérez"
                className={errors.name ? 'border-destructive' : ''}
              />
              {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Teléfono *</Label>
              <Input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+573001234567"
                className={errors.phone ? 'border-destructive' : ''}
              />
              {errors.phone && <p className="text-xs text-destructive">{errors.phone}</p>}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="email">Correo electrónico *</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="correo@ejemplo.com"
                className={errors.email ? 'border-destructive' : ''}
              />
              {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="birthday">Fecha de nacimiento</Label>
              <Input
                id="birthday"
                type="date"
                value={birthday}
                onChange={(e) => handleBirthdayChange(e.target.value)}
              />
            </div>
          </div>

          {isMinor && (
            <div className="space-y-2">
              <Label htmlFor="legalRep">Nombre del representante legal *</Label>
              <Input
                id="legalRep"
                value={legalRepName}
                onChange={(e) => setLegalRepName(e.target.value)}
                placeholder="Nombre del padre/madre/tutor"
                className={errors.legalRep ? 'border-destructive' : ''}
              />
              {errors.legalRep && <p className="text-xs text-destructive">{errors.legalRep}</p>}
              <Badge variant="outline" className="bg-amber-50 text-amber-800">
                Menor de edad — se requiere autorización del representante legal
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {copy.showOptionalContactCards && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>WhatsApp</CardTitle>
              <CardDescription>Información de WhatsApp (opcional)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="hasWhatsapp"
                  checked={hasWhatsapp}
                  onCheckedChange={(checked) => setHasWhatsapp(checked === true)}
                />
                <Label htmlFor="hasWhatsapp">El número principal tiene WhatsApp</Label>
              </div>
              <div className="space-y-2">
                <Label htmlFor="additionalWhatsapp">Número adicional de WhatsApp</Label>
                <Input
                  id="additionalWhatsapp"
                  type="tel"
                  value={additionalWhatsapp}
                  onChange={(e) => setAdditionalWhatsapp(e.target.value)}
                  placeholder="+573009876543"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Redes sociales</CardTitle>
                  <CardDescription>Perfiles en redes sociales (opcional)</CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowSocialMedia(!showSocialMedia)}
                >
                  {showSocialMedia ? 'Ocultar' : 'Agregar'}
                </Button>
              </div>
            </CardHeader>
            {showSocialMedia && (
              <CardContent className="space-y-3">
                {socialMedia.map((sm, index) => (
                  <div key={index} className="flex items-end gap-2">
                    <div className="w-32 space-y-1">
                      {index === 0 && <Label>Plataforma</Label>}
                      <select
                        value={sm.platform}
                        onChange={(e) => updateSocialMedia(index, 'platform', e.target.value)}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                      >
                        {SOCIAL_PLATFORMS.map((p) => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex-1 space-y-1">
                      {index === 0 && <Label>Usuario</Label>}
                      <Input
                        value={sm.handle}
                        onChange={(e) => updateSocialMedia(index, 'handle', e.target.value)}
                        placeholder="@usuario"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeSocialMedia(index)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addSocialMedia}>
                  <Plus className="mr-2 h-4 w-4" />
                  Agregar red social
                </Button>
              </CardContent>
            )}
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Datos religiosos (sensibles)</CardTitle>
          <CardDescription>
            Esta información es considerada sensible según la Ley 1581 de 2012
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md bg-muted p-4 text-sm">
            <p className="whitespace-pre-line">{SENSITIVE_DATA_NOTICE_ES}</p>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="sensitiveConsent"
              checked={sensitiveConsent}
              onCheckedChange={(checked) => setSensitiveConsent(checked === true)}
            />
            <Label htmlFor="sensitiveConsent" className="font-medium">
              Acepto proporcionar datos sensibles de forma voluntaria
            </Label>
          </div>
          {sensitiveConsent && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="denomination">Denominación religiosa</Label>
                <Input
                  id="denomination"
                  value={denomination}
                  onChange={(e) => setDenomination(e.target.value)}
                  placeholder="Católica, Evangélica, etc."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="communityName">Nombre de la comunidad</Label>
                <Input
                  id="communityName"
                  value={communityName}
                  onChange={(e) => setCommunityName(e.target.value)}
                  placeholder="Comunidad San Pablo"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Consentimiento general</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md bg-muted p-4 text-sm max-h-48 overflow-y-auto">
            <p className="whitespace-pre-line">{copy.privacyNotice}</p>
          </div>
          <div className="flex items-start space-x-2">
            <Checkbox
              id="generalConsent"
              checked={generalConsent}
              onCheckedChange={(checked) => setGeneralConsent(checked === true)}
              className={errors.consent ? 'border-destructive' : ''}
            />
            <Label htmlFor="generalConsent" className="font-medium leading-tight">
              He leído y acepto el aviso de privacidad y autorizo el tratamiento de mis datos personales *
            </Label>
          </div>
          {errors.consent && <p className="text-xs text-destructive">{errors.consent}</p>}
        </CardContent>
      </Card>

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? copy.submittingLabel : copy.submitLabel}
      </Button>
    </form>
  )
}
