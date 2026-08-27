'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Search } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import {
  RETREAT_REGISTRATIONS_SELECT,
  buildSearchOrFilter,
  computeRowAbonos,
  getPaginationRange,
} from '@/lib/retreat/queries'
import { getRetreatTotalCost, setRetreatTotalCost } from '@/lib/settings/app-settings'
import { createClient } from '@/lib/supabase/client'

interface RetreatRegistrationRow {
  id: string
  name: string
  email: string
  phone: string
  birthday: string | null
  is_minor: boolean
  legal_rep_name: string | null
  status: RetreatStatus
  created_at: string
  transferred_at: string | null
  transferred_member_id: string | null
  member_id: string | null
}

interface RetreatPaymentRow {
  registration_id: string
  amount: number | string
  created_at: string
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

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}

export default function RetreatRegistrationsPage() {
  const { role, loading } = useRole()
  const [registrations, setRegistrations] = useState<RetreatRegistrationRow[]>([])
  const [payments, setPayments] = useState<RetreatPaymentRow[]>([])
  const [paidByRegistration, setPaidByRegistration] = useState<Map<string, number>>(new Map())
  const [storedTotal, setStoredTotal] = useState<string | null>(null)
  const [costDraft, setCostDraft] = useState('')
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({})
  const [savingPaymentId, setSavingPaymentId] = useState<string | null>(null)
  const [savingCost, setSavingCost] = useState(false)
  const [tab, setTab] = useState<'todos' | 'preinscrito' | 'inscrito'>('todos')
  const [search, setSearch] = useState('')
  const searchDebounced = useDebouncedValue(search, 300)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [totalCount, setTotalCount] = useState(0)
  const [loadingData, setLoadingData] = useState(false)

  const loadData = useCallback(async () => {
    const supabase = createClient()
    setLoadingData(true)
    try {
      const { from, to } = getPaginationRange(page, pageSize)
      let query = supabase
        .from('retreat_registrations')
        .select(RETREAT_REGISTRATIONS_SELECT, { count: 'exact' })
        .eq('event_key', RETREAT_EVENT_KEY)
        .order('name', { ascending: true })
        .range(from, to)
      if (tab !== 'todos') query = query.eq('status', tab)
      const searchFilter = buildSearchOrFilter(searchDebounced)
      if (searchFilter) query = query.or(searchFilter)
      const [result, total] = await Promise.all([
        query as unknown as Promise<{ data: unknown[]; count: number | null; error: unknown }>,
        getRetreatTotalCost(),
      ])
      const regs = (result.data ?? []).filter(
        (row): row is RetreatRegistrationRow =>
          typeof (row as { status: unknown }).status === 'string' &&
          isRetreatStatus((row as { status: string }).status),
      ) as RetreatRegistrationRow[]
      setRegistrations(regs)
      setTotalCount(result.count ?? 0)
      setStoredTotal(total)
      setCostDraft(total ?? '')
      const ids = regs.map((r) => r.id)
      if (ids.length === 0) {
        setPayments([])
        setPaidByRegistration(new Map())
        return
      }
      const { data: pays } = (await supabase
        .from('retreat_payments')
        .select('registration_id,amount,created_at')
        .in('registration_id', ids)
        .order('created_at')) as { data: RetreatPaymentRow[] | null }
      const paymentsArr = (pays ?? []) as RetreatPaymentRow[]
      setPayments(paymentsArr)
      setPaidByRegistration(sumPaidByRegistration(paymentsArr))
    } finally {
      setLoadingData(false)
    }
  }, [page, pageSize, tab, searchDebounced])

  useEffect(() => {
    if (!role || !canManageRetreatRegistrations(role)) return
    void loadData()
  }, [role, loadData])

  useEffect(() => {
    setPage(1)
  }, [tab, searchDebounced, pageSize])

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
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const fromDisplay = totalCount === 0 ? 0 : (page - 1) * pageSize + 1
  const toDisplay = Math.min(page * pageSize, totalCount)

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
    const {
      data: { session },
    } = await supabase.auth.getSession()
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
        <p className="text-muted-foreground">Consulte las preinscripciones y registre cuotas consecutivas</p>
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

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
              <TabsList>
                <TabsTrigger value="todos" onClick={() => setTab('todos')}>
                  Todos
                </TabsTrigger>
                <TabsTrigger value="preinscrito" onClick={() => setTab('preinscrito')}>
                  Preinscritos
                </TabsTrigger>
                <TabsTrigger value="inscrito" onClick={() => setTab('inscrito')}>
                  Inscritos
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nombre, email o teléfono…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="max-w-sm pl-9"
                />
              </div>
          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="20">20 / pág</SelectItem>
              <SelectItem value="50">50 / pág</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

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
              <TableHead>% Pagado</TableHead>
              <TableHead>Último abono</TableHead>
              <TableHead className="w-56">Registrar pago</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {registrations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground">
                  No hay preinscripciones registradas
                </TableCell>
              </TableRow>
            ) : (
              registrations.map((registration) => {
                const sumPaid = paidByRegistration.get(registration.id) ?? 0
                const remaining = remainingBalance(parsedTotal, sumPaid)
                const rowPayments = payments.filter((p) => p.registration_id === registration.id)
                const abonos = computeRowAbonos(rowPayments, storedTotal)
                return (
                  <TableRow key={registration.id}>
                    <TableCell className="font-medium">
                      {registration.name}
                      {registration.transferred_at && (
                        <Badge
                          variant="secondary"
                          className="ml-2 bg-emerald-50 text-emerald-800"
                          title={new Date(registration.transferred_at).toLocaleDateString('es-CO')}
                        >
                          Transferido ✓
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{registration.email}</TableCell>
                    <TableCell className="hidden sm:table-cell">{registration.phone}</TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(registration.status)}>
                        {retreatStatusLabel(registration.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatAmount(sumPaid)}</TableCell>
                    <TableCell>{remaining === null ? '—' : formatAmount(remaining)}</TableCell>
                    <TableCell>{abonos.percent === null ? '—' : `${abonos.percent.toFixed(0)}%`}</TableCell>
                    <TableCell>
                      {abonos.last
                        ? new Date(abonos.last).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' })
                        : '—'}
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

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm text-muted-foreground">
        <div>
          Mostrando {fromDisplay}–{toDisplay} de {totalCount} · Página {page} de {totalPages}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1 || loadingData} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Anterior
          </Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages || loadingData} onClick={() => setPage((p) => p + 1)}>
            Siguiente
          </Button>
        </div>
      </div>

      <style>{`@media print{nav,.no-print{display:none}tr{break-inside:avoid}@page{margin:1cm}}`}</style>
    </div>
  )
}
