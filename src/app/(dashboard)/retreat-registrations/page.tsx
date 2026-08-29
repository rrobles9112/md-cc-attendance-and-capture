'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Download, Printer, Search, UserPlus } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useRole } from '@/hooks/useRole'
import { canManageRetreatRegistrations, canManageUsers, canRecordRetreatPayments, canTransferRetreatToValientes } from '@/lib/rbac/guards'
import { RETREAT_EVENT_KEY } from '@/lib/retreat/constants'
import { RetreatPreinscriptionCreate } from '@/components/retreat/RetreatPreinscriptionCreate'
import { buildReportRows, exportRetreatToXLSX, formatYYYYMMDD } from '@/lib/retreat/export'
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
import { useRouter } from 'next/navigation'

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
  const [transferTarget, setTransferTarget] = useState<RetreatRegistrationRow | null>(null)
  const [transferConsent, setTransferConsent] = useState(false)
  const [transferDup, setTransferDup] = useState<{ id: string; name: string } | null>(null)
  const [transferring, setTransferring] = useState(false)
  const [loadingExport, setLoadingExport] = useState(false)
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)
  const [hasSession, setHasSession] = useState(true)
  const router = useRouter()

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

  useEffect(() => {
    const handleOnline = () => setIsOnline(navigator.onLine)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    const supabase = createClient()
    void supabase.auth.getSession().then(({ data }) => setHasSession(!!data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setHasSession(!!session))
    return () => sub.subscription.unsubscribe()
  }, [])

  // Duplicate pre-check when the transfer dialog opens: email exact match OR
  // phone containing the digits of the registration phone. The transfer RPC
  // remains the authoritative validation; query errors surface no warning.
  useEffect(() => {
    if (!transferTarget) {
      setTransferDup(null)
      return
    }
    const email = (transferTarget.email ?? '').trim()
    const digits = (transferTarget.phone ?? '').replace(/\D/g, '')
    const ors: string[] = []
    if (email) ors.push(`email.eq.${email}`)
    if (digits) ors.push(`phone.like.%${digits}%`)
    if (ors.length === 0) {
      setTransferDup(null)
      return
    }
    let cancelled = false
    const supabase = createClient()
    void (supabase
      .from('members')
      .select('id,name')
      .or(ors.join(','))
      .limit(1) as unknown as Promise<{
        data: Array<{ id: string; name: string }> | null
        error: unknown
      }>).then(({ data }) => {
        if (!cancelled) setTransferDup(data && data.length > 0 ? data[0] : null)
      })
    return () => {
      cancelled = true
    }
  }, [transferTarget])

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
  const canRecordPayments = !!role && canRecordRetreatPayments(role)
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

  async function recordPayment(registrationId: string, amount: number): Promise<boolean> {
    // Defense in depth: the UI hides the payment cell for roles without
    // payment permission; this mirrors the retreat_payments RLS policies.
    if (!role || !canRecordRetreatPayments(role)) return false
    if (!(amount > 0)) {
      toast.error('El monto de la cuota debe ser mayor que cero')
      return false
    }
    const supabase = createClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) {
      toast.error('No hay una sesión activa')
      return false
    }
    setSavingPaymentId(registrationId)
    try {
      const { error } = await supabase.from('retreat_payments').insert({
        registration_id: registrationId,
        amount,
        recorded_by: session.user.id,
      })
      if (error) throw error
      await loadData()
      return true
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : ((err as { message?: string } | null)?.message ?? String(err))
      if (msg.includes('already fully paid')) {
        toast.error('Ya está pagado en su totalidad — no se permiten más abonos')
      } else if (msg.includes('exceeds remaining balance')) {
        toast.error('El abono excede el saldo pendiente')
      } else {
        toast.error('Error al registrar el pago')
      }
      return false
    } finally {
      setSavingPaymentId(null)
    }
  }

  async function handleRecordPayment(registrationId: string) {
    // Belt & braces with the guard trigger: fully paid rows take no more abonos.
    const target = registrations.find((r) => r.id === registrationId)
    if (target?.status === 'inscrito') return
    const ok = await recordPayment(registrationId, Number(amountDrafts[registrationId]))
    if (ok) {
      toast.success('Pago registrado')
      setAmountDrafts((current) => ({ ...current, [registrationId]: '' }))
    }
  }

  async function handleCompleteRemaining(registrationId: string) {
    const target = registrations.find((r) => r.id === registrationId)
    if (!target || target.status === 'inscrito') return
    const remaining = remainingBalance(parsedTotal, paidByRegistration.get(registrationId) ?? 0)
    if (remaining === null || remaining <= 0) return
    const ok = await recordPayment(registrationId, remaining)
    if (ok) {
      toast.success('Saldo completado')
    }
  }

      async function handleTransfer() {
        if (!transferTarget || !transferConsent) return
        setTransferring(true)
        try {
          const supabase = createClient()
          const { data, error } = (await supabase.rpc('transfer_retreat_to_valientes', {
            p_registration_id: transferTarget.id,
          })) as { data: string | null; error: { message: string; code?: string } | null }
          if (error) {
            const msg = error.message ?? ''
            const code = (error as { code?: string }).code ?? ''
            if (msg.includes('already_transferred') || code === '23505' && msg.includes('transferred')) {
              toast.error('Ya fue transferido', { action: { label: 'Ver miembro', onClick: () => router.push('/members') } })
            } else if (msg.includes('already_member') || code === '23505') {
              toast.error('Ya existe un miembro con ese email/teléfono — Ver miembro', { action: { label: 'Ver miembro', onClick: () => router.push('/members') } })
            } else if (msg.includes('not_inscrito') || code === '23514') {
              toast.error('La persona aún no está Inscrita (debe completar el pago total)')
            } else if (msg.includes('missing_total')) {
              toast.error('Costo total del retiro no configurado')
            } else if (code === '42501') {
              toast.error('No tiene permisos para transferir')
            } else {
              toast.error(`Error al transferir: ${msg}`)
            }
            return
          }
          toast.success('Transferido a Valientes', { action: { label: 'Ver miembro', onClick: () => router.push(`/members?highlight=${data}`) } })
          setTransferTarget(null)
          setTransferConsent(false)
          await loadData()
        } finally {
          setTransferring(false)
        }
      }

      async function fetchAllRetreatRows(inscritoOnly: boolean): Promise<RetreatRegistrationRow[]> {
        const supabase = createClient()
        const all: RetreatRegistrationRow[] = []
        let offset = 0
        const chunk = 1000
        while (true) {
          let q = supabase
            .from('retreat_registrations')
            .select(RETREAT_REGISTRATIONS_SELECT)
            .eq('event_key', RETREAT_EVENT_KEY)
            .order('name', { ascending: true })
            .range(offset, offset + chunk - 1)
          if (inscritoOnly) q = q.eq('status', 'inscrito')
          else if (tab !== 'todos') q = q.eq('status', tab)
          const sf = buildSearchOrFilter(searchDebounced)
          if (sf && !inscritoOnly) q = q.or(sf)
          const { data, error } = (await q) as { data: RetreatRegistrationRow[] | null; error: unknown }
          if (error) throw error
          const rows = (data ?? []) as RetreatRegistrationRow[]
          all.push(...rows)
          if (rows.length < chunk) break
          offset += chunk
        }
        return all
      }

      async function fetchPaymentsChunked(ids: string[]): Promise<RetreatPaymentRow[]> {
        if (ids.length === 0) return []
        const supabase = createClient()
        const all: RetreatPaymentRow[] = []
        const batchSize = 900
        for (let i = 0; i < ids.length; i += batchSize) {
          const batch = ids.slice(i, i + batchSize)
          const { data, error } = (await supabase
            .from('retreat_payments')
            .select('registration_id,amount,created_at')
            .in('registration_id', batch)) as { data: RetreatPaymentRow[] | null; error: unknown }
          if (error) throw error
          all.push(...((data ?? []) as RetreatPaymentRow[]))
        }
        return all
      }

      async function handleExport(inscritoOnly: boolean) {
        if (!isOnline || !hasSession) {
          toast.error('Requiere conexión')
          return
        }
        setLoadingExport(true)
        try {
          const regs = await fetchAllRetreatRows(inscritoOnly)
          const ids = regs.map((r) => r.id)
          const pays = await fetchPaymentsChunked(ids)
          const byId = new Map<string, Array<{ amount: number | string; created_at: string }>>()
          for (const p of pays) {
            const arr = byId.get(p.registration_id) ?? []
            arr.push({ amount: p.amount, created_at: p.created_at })
            byId.set(p.registration_id, arr)
          }
          const rows = buildReportRows(
            regs.map((r) => ({ name: r.name, email: r.email, phone: r.phone, birthday: r.birthday, is_minor: r.is_minor, legal_rep_name: r.legal_rep_name, status: r.status, transferred_at: r.transferred_at })),
            byId,
            storedTotal,
            ids,
          )
          const filename = inscritoOnly ? `retiro-inscritos-${formatYYYYMMDD(new Date())}` : `retiro-estado-pago-${formatYYYYMMDD(new Date())}`
          exportRetreatToXLSX(rows, filename)
          toast.success(`Reporte ${inscritoOnly ? 'inscritos' : 'estado de pago'} generado`)
        } catch {
          toast.error('Error al generar el reporte')
        } finally {
          setLoadingExport(false)
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

      <div className="no-print flex flex-wrap gap-2">
            <RetreatPreinscriptionCreate
              disabled={!isOnline || !hasSession}
              disabledTitle="Requiere conexión"
              onSuccess={() => void loadData()}
            />
            <Button variant="outline" size="sm" disabled={!isOnline || !hasSession || loadingExport} title={!isOnline || !hasSession ? 'Requiere conexión' : undefined} onClick={() => void handleExport(false)}>
          <Download className="mr-2 h-4 w-4" /> Exportar estado de pago
        </Button>
        <Button variant="secondary" size="sm" disabled={!isOnline || !hasSession || loadingExport} title={!isOnline || !hasSession ? 'Requiere conexión' : undefined} onClick={() => void handleExport(true)}>
          <Download className="mr-2 h-4 w-4" /> Exportar inscritos
        </Button>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="mr-2 h-4 w-4" /> Imprimir
        </Button>
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
              <TableHead className="w-64">Registrar pago</TableHead>
              <TableHead className="w-40">Transferir</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {registrations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground">
                  No hay preinscripciones registradas
                </TableCell>
              </TableRow>
            ) : (
              registrations.map((registration) => {
                const sumPaid = paidByRegistration.get(registration.id) ?? 0
                const remaining = remainingBalance(parsedTotal, sumPaid)
                const rowPayments = payments.filter((p) => p.registration_id === registration.id)
                const abonos = computeRowAbonos(rowPayments, storedTotal)
                const pct = parsedTotal ? Math.min(100, (sumPaid / parsedTotal) * 100) : 0
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
                        <TableCell className="w-64">
                          {registration.status === 'inscrito' ? (
                            <Badge variant="secondary" className="bg-emerald-50 text-emerald-800">
                              Pagado ✓
                            </Badge>
                          ) : paymentsBlocked ? (
                            <span className="text-xs text-muted-foreground">Pagos bloqueados</span>
                          ) : !canRecordPayments ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <div className="flex w-64 flex-col gap-1.5">
                              <div className="flex flex-wrap items-center gap-2">
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
                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={
                                    remaining === null ||
                                    remaining <= 0 ||
                                    !isOnline ||
                                    !hasSession ||
                                    savingPaymentId === registration.id
                                  }
                                  onClick={() => void handleCompleteRemaining(registration.id)}
                                >
                                  Completar saldo
                                </Button>
                              </div>
                              <div className="space-y-1">
                                <div className="h-1.5 w-full rounded bg-secondary">
                                  <div
                                    className="h-1.5 rounded bg-primary"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="text-xs text-muted-foreground">
                                  Pagado {formatAmount(sumPaid)} de{' '}
                                  {parsedTotal ? formatAmount(parsedTotal) : '—'}
                                </span>
                              </div>
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {registration.transferred_at ? (
                            <Badge variant="secondary" className="bg-emerald-50 text-emerald-800" title={new Date(registration.transferred_at).toLocaleDateString('es-CO')}>
                              Transferido ✓
                            </Badge>
                          ) : (
                            <span
                              title={
                                !isOnline || !hasSession
                                  ? 'Requiere conexión'
                                  : registration.status !== 'inscrito'
                                    ? 'Requiere estado Inscrito'
                                    : !canTransferRetreatToValientes(role)
                                      ? 'Sin permisos'
                                      : undefined
                              }
                            >
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={
                                  registration.status !== 'inscrito' ||
                                  !isOnline ||
                                  !hasSession ||
                                  !canTransferRetreatToValientes(role) ||
                                  transferring
                                }
                                onClick={() => {
                                  setTransferTarget(registration)
                                  setTransferConsent(false)
                                }}
                              >
                                <UserPlus className="mr-1 h-4 w-4" /> Transferir a Valientes
                              </Button>
                            </span>
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

          <Dialog open={!!transferTarget} onOpenChange={(open) => { if (!open) { setTransferTarget(null); setTransferConsent(false) } }}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Transferir a Valientes</DialogTitle>
                <DialogDescription>
                  Se creará un miembro en el grupo Valientes con los datos del retiro. Esta acción es irreversible. Ley 1581 pdtp-v1.0-2026-07-17
                </DialogDescription>
              </DialogHeader>
              {transferTarget && (
                <div className="space-y-2 text-sm">
                  <p><strong>Nombre:</strong> {transferTarget.name}</p>
                  <p><strong>Email:</strong> {transferTarget.email}</p>
                  <p><strong>Teléfono:</strong> {transferTarget.phone}</p>
                  <p><strong>Estado:</strong> {retreatStatusLabel(transferTarget.status)}</p>
                </div>
              )}
              {transferDup && (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  Ya existe un miembro con ese email o teléfono{transferDup.name ? `: ${transferDup.name}` : ''}
                </p>
              )}
              <div className="flex items-center space-x-2 py-2">
                <Checkbox id="transfer-consent" checked={transferConsent} onCheckedChange={(v) => setTransferConsent(v === true)} />
                <Label htmlFor="transfer-consent" className="text-sm font-normal">
                  Acepto que mis datos se traten para mi incorporación al grupo Valientes como miembro asistente (Ley 1581 pdtp-v1.0-2026-07-17)
                </Label>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setTransferTarget(null); setTransferConsent(false) }}>Cancelar</Button>
                <Button disabled={!transferConsent || transferring || !!transferDup} onClick={() => void handleTransfer()}>
                  {transferring ? 'Transfiriendo...' : 'Transferir'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <div className="print-header hidden print:block text-sm text-muted-foreground mb-4">
            Confidencial Ley 1581 — Uso interno MD CC — Evento: {RETREAT_EVENT_KEY} — Generado: {new Date().toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </div>
          <style>{`@media print{nav,.no-print{display:none}tr{break-inside:avoid}@page{margin:1cm}.print-header{display:block}}`}</style>
    </div>
  )
}
