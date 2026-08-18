'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useRole } from '@/hooks/useRole'
import { canManageRetreatRegistrations, canManageUsers } from '@/lib/rbac/guards'
import { RETREAT_EVENT_KEY } from '@/lib/retreat/constants'
import {
  isRetreatPaymentBlocked,
  parsePositiveTotal,
  remainingBalance,
  retreatStatusLabel,
  sumPaidByRegistration,
  type RetreatStatus,
} from '@/lib/retreat/payments'
import { getRetreatTotalCost, setRetreatTotalCost } from '@/lib/settings/app-settings'
import { createClient } from '@/lib/supabase/client'

interface RetreatRegistrationRow {
  id: string
  name: string
  email: string
  phone: string
  status: RetreatStatus
}

interface RetreatPaymentRow {
  registration_id: string
  amount: number | string
}

function isRetreatStatus(value: string): value is RetreatStatus {
  return value === 'preinscrito' || value === 'pagos_parciales' || value === 'inscrito'
}

function statusBadgeVariant(status: RetreatStatus): 'outline' | 'secondary' | 'default' {
  switch (status) {
    case 'preinscrito':
      return 'outline'
    case 'pagos_parciales':
      return 'secondary'
    case 'inscrito':
      return 'default'
    default: {
      const exhaustive: never = status
      return exhaustive
    }
  }
}

function formatAmount(value: number): string {
  return value.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function RetreatRegistrationsPage() {
  const { role, loading } = useRole()
  const [registrations, setRegistrations] = useState<RetreatRegistrationRow[]>([])
  const [paidByRegistration, setPaidByRegistration] = useState<Map<string, number>>(new Map())
  const [storedTotal, setStoredTotal] = useState<string | null>(null)
  const [costDraft, setCostDraft] = useState('')
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({})
  const [savingPaymentId, setSavingPaymentId] = useState<string | null>(null)
  const [savingCost, setSavingCost] = useState(false)

  const loadData = useCallback(async () => {
    const supabase = createClient()
    const [registrationsResult, paymentsResult, total] = await Promise.all([
      supabase
        .from('retreat_registrations')
        .select('id, name, email, phone, status')
        .eq('event_key', RETREAT_EVENT_KEY)
        .order('name'),
      supabase.from('retreat_payments').select('registration_id, amount'),
      getRetreatTotalCost(),
    ])

    const rows = (registrationsResult.data ?? [])
      .filter((row): row is RetreatRegistrationRow => isRetreatStatus(row.status))
    const payments = (paymentsResult.data ?? []) as RetreatPaymentRow[]

    setRegistrations(rows)
    setPaidByRegistration(sumPaidByRegistration(payments))
    setStoredTotal(total)
    setCostDraft(total ?? '')
  }, [])

  useEffect(() => {
    if (!role || !canManageRetreatRegistrations(role)) return
    void loadData()
  }, [role, loadData])

  if (loading) return null

  if (!role || !canManageRetreatRegistrations(role)) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground">
        No tiene permisos para acceder a esta sección
      </div>
    )
  }

  const parsedTotal = parsePositiveTotal(storedTotal)
  const paymentsBlocked = isRetreatPaymentBlocked(storedTotal)

  async function handleSaveCost() {
    setSavingCost(true)
    try {
      await setRetreatTotalCost(costDraft)
      toast.success('Costo total del retiro actualizado')
      await loadData()
    } catch {
      toast.error('Error al guardar el costo total')
    } finally {
      setSavingCost(false)
    }
  }

  async function handleRecordPayment(registrationId: string) {
    const amount = Number(amountDrafts[registrationId])
    if (!(amount > 0)) {
      toast.error('El monto de la cuota debe ser mayor que cero')
      return
    }

    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      toast.error('No hay una sesión activa')
      return
    }

    setSavingPaymentId(registrationId)
    try {
      const { error } = await supabase.from('retreat_payments').insert({
        registration_id: registrationId,
        amount,
        recorded_by: session.user.id,
      })
      if (error) throw error
      toast.success('Pago registrado')
      setAmountDrafts((current) => ({ ...current, [registrationId]: '' }))
      await loadData()
    } catch {
      toast.error('Error al registrar el pago')
    } finally {
      setSavingPaymentId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Preinscripciones al retiro</h1>
        <p className="text-muted-foreground">
          Consulte las preinscripciones y registre cuotas consecutivas
        </p>
      </div>

      {canManageUsers(role) && (
        <Card>
          <CardHeader>
            <CardTitle>Costo total del retiro</CardTitle>
            <CardDescription>
              Solo el super administrador puede configurar el valor. No se usa un precio por defecto.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label htmlFor="retreatTotalCost">Costo total (COP)</Label>
            <div className="flex gap-2">
              <Input
                id="retreatTotalCost"
                value={costDraft}
                onChange={(event) => setCostDraft(event.target.value)}
                placeholder="Ejemplo: 150000"
              />
              <Button onClick={() => void handleSaveCost()} disabled={savingCost}>
                Guardar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {paymentsBlocked && (
        <p className="text-sm text-muted-foreground">
          Los pagos están bloqueados hasta que un super administrador configure el costo total del retiro
        </p>
      )}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead className="hidden md:table-cell">Email</TableHead>
              <TableHead className="hidden sm:table-cell">Teléfono</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Pagado</TableHead>
              <TableHead>Saldo</TableHead>
              <TableHead className="w-56">Registrar pago</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {registrations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  No hay preinscripciones registradas
                </TableCell>
              </TableRow>
            ) : (
              registrations.map((registration) => {
                const sumPaid = paidByRegistration.get(registration.id) ?? 0
                const remaining = remainingBalance(parsedTotal, sumPaid)
                return (
                  <TableRow key={registration.id}>
                    <TableCell className="font-medium">{registration.name}</TableCell>
                    <TableCell className="hidden md:table-cell">{registration.email}</TableCell>
                    <TableCell className="hidden sm:table-cell">{registration.phone}</TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(registration.status)}>
                        {retreatStatusLabel(registration.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatAmount(sumPaid)}</TableCell>
                    <TableCell>
                      {remaining === null ? '—' : formatAmount(remaining)}
                    </TableCell>
                    <TableCell>
                      {paymentsBlocked ? (
                        <span className="text-xs text-muted-foreground">Pagos bloqueados</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={amountDrafts[registration.id] ?? ''}
                            onChange={(event) =>
                              setAmountDrafts((current) => ({
                                ...current,
                                [registration.id]: event.target.value,
                              }))
                            }
                            placeholder="Monto"
                            aria-label={`Monto de cuota para ${registration.name}`}
                          />
                          <Button
                            size="sm"
                            disabled={savingPaymentId === registration.id}
                            onClick={() => void handleRecordPayment(registration.id)}
                          >
                            Registrar pago
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
