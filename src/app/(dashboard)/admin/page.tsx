'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRole } from '@/hooks/useRole'
import { useSync } from '@/hooks/useSync'
import { useCacheHydration } from '@/hooks/useCacheHydration'
import { canManageUsers, canViewAudit, canManageARCO } from '@/lib/rbac/guards'
import { createClient } from '@/lib/supabase/client'
import { getDpoContactEmail, setSetting } from '@/lib/settings/app-settings'
import { getPendingARCORequests, fulfillARCORequest, updateARCOStatus } from '@/lib/arco/workflow'
import { isPurgeEligible } from '@/lib/delete/soft-delete'
import { db } from '@/lib/sync/db'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from 'sonner'

type AdminTab = 'users' | 'audit' | 'arco' | 'settings' | 'sync' | 'purge'

export default function AdminPage() {
  const { role } = useRole()
  const { status: syncStatus, pendingCount } = useSync()
  const [activeTab, setActiveTab] = useState<AdminTab>('users')
  const [users, setUsers] = useState<Array<{ id: string; full_name: string; role: string; is_active: boolean; created_at: string }>>([])
  const [auditLogs, setAuditLogs] = useState<Array<{ id: number; user_id: string; action: string; table_name: string; record_id: string; created_at: string }>>([])
  const [auditFilter, setAuditFilter] = useState({ table: '', action: '', date: '' })
  const [arcoRequests, setArcoRequests] = useState<Array<{ id: string; member_id: string | null; request_type: string; status: string; deadline: string; notes: string | null }>>([])
  const [dpoEmail, setDpoEmail] = useState('')
  const [purgeableCount, setPurgeableCount] = useState(0)

  const loadUsers = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false })
    if (data) setUsers(data)
  }, [])

  const loadAuditLogs = useCallback(async () => {
    const supabase = createClient()
    let query = supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(100)
    if (auditFilter.table) query = query.eq('table_name', auditFilter.table)
    if (auditFilter.action) query = query.eq('action', auditFilter.action)
    const { data } = await query
    if (data) setAuditLogs(data)
  }, [auditFilter])

  const loadArcoRequests = useCallback(async () => {
    try {
      const requests = await getPendingARCORequests()
      setArcoRequests(requests)
    } catch {
      setArcoRequests([])
    }
  }, [])

  const loadDpoEmail = useCallback(async () => {
    const email = await getDpoContactEmail()
    setDpoEmail(email)
  }, [])

  const loadPurgeableCount = useCallback(async () => {
    const members = await db.members.filter((m) => m.deleted_at !== null).toArray()
    const count = members.filter((m) => m.deleted_at && isPurgeEligible(m.deleted_at)).length
    setPurgeableCount(count)
  }, [])

  useEffect(() => {
    if (!role) return
    if (activeTab === 'users' && canManageUsers(role)) loadUsers()
    if (activeTab === 'audit' && canViewAudit(role)) loadAuditLogs()
    if (activeTab === 'arco' && canManageARCO(role)) loadArcoRequests()
    if (activeTab === 'settings') loadDpoEmail()
    if (activeTab === 'purge') loadPurgeableCount()
  }, [role, activeTab, loadUsers, loadAuditLogs, loadArcoRequests, loadDpoEmail, loadPurgeableCount])

  useCacheHydration(() => {
    if (activeTab === 'purge') void loadPurgeableCount()
  })

  async function handleRoleChange(userId: string, newRole: string) {
    const supabase = createClient()
    const { error } = await supabase
      .from('profiles')
      .update({ role: newRole, updated_at: new Date().toISOString() })
      .eq('id', userId)
    if (error) {
      toast.error('Error al actualizar el rol')
      return
    }
    toast.success('Rol actualizado')
    loadUsers()
  }

  async function handleSaveDpoEmail() {
    try {
      await setSetting('dpo_contact_email', dpoEmail)
      toast.success('Correo del DPO actualizado')
    } catch {
      toast.error('Error al guardar')
    }
  }

  async function handleFulfillArco(requestId: string) {
    try {
      await fulfillARCORequest(requestId)
      toast.success('Solicitud ARCO completada')
      loadArcoRequests()
    } catch {
      toast.error('Error al completar la solicitud')
    }
  }

  async function handleUpdateArcoStatus(requestId: string, status: string) {
    try {
      await updateARCOStatus(requestId, status as 'pending' | 'in_progress' | 'fulfilled' | 'overdue')
      toast.success('Estado actualizado')
      loadArcoRequests()
    } catch {
      toast.error('Error al actualizar estado')
    }
  }

  async function handlePurgeDeleted() {
    if (!confirm('¿Está seguro de eliminar permanentemente los registros marcados para purga? Esta acción no se puede deshacer.')) return
    const members = await db.members.filter((m) => m.deleted_at !== null).toArray()
    const purgeable = members.filter((m) => m.deleted_at && isPurgeEligible(m.deleted_at))
    for (const m of purgeable) {
      await db.members.delete(m.id)
    }
    toast.success(`${purgeable.length} registros eliminados permanentemente`)
    loadPurgeableCount()
  }

  if (!role || !canManageUsers(role)) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground">
        No tiene permisos para acceder a esta sección
      </div>
    )
  }

  const tabs: Array<{ id: AdminTab; label: string; show: boolean }> = [
    { id: 'users' as AdminTab, label: 'Usuarios', show: canManageUsers(role) },
    { id: 'audit' as AdminTab, label: 'Auditoría', show: canViewAudit(role) },
    { id: 'arco' as AdminTab, label: 'ARCO', show: canManageARCO(role) },
    { id: 'settings' as AdminTab, label: 'Configuración', show: canManageUsers(role) },
    { id: 'sync' as AdminTab, label: 'Sincronización', show: true },
    { id: 'purge' as AdminTab, label: 'Purga', show: canManageUsers(role) },
  ].filter((t) => t.show)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Panel de administración</h1>
        <p className="text-muted-foreground">Gestión de usuarios, auditoría y configuración</p>
      </div>

      <div className="flex flex-wrap gap-2 border-b pb-2">
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            variant={activeTab === tab.id ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {activeTab === 'users' && (
        <Card>
          <CardHeader>
            <CardTitle>Gestión de usuarios</CardTitle>
            <CardDescription>Administrar roles de usuarios del sistema</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead className="hidden sm:table-cell">Estado</TableHead>
                  <TableHead className="hidden md:table-cell">Registro</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.full_name}</TableCell>
                    <TableCell>
                      <select
                        value={user.role}
                        onChange={(e) => handleRoleChange(user.id, e.target.value)}
                        className="rounded border px-2 py-1 text-sm"
                      >
                        <option value="super_admin">Super Admin</option>
                        <option value="leader">Líder</option>
                        <option value="server">Servidor</option>
                      </select>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant={user.is_active ? 'default' : 'destructive'}>
                        {user.is_active ? 'Activo' : 'Inactivo'}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {new Date(user.created_at).toLocaleDateString('es-CO')}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm">Editar</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {activeTab === 'audit' && (
        <Card>
          <CardHeader>
            <CardTitle>Registro de auditoría</CardTitle>
            <CardDescription>Historial de cambios en el sistema</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Tabla</Label>
                <select
                  value={auditFilter.table}
                  onChange={(e) => setAuditFilter({ ...auditFilter, table: e.target.value })}
                  className="rounded border px-2 py-1 text-sm"
                >
                  <option value="">Todas</option>
                  <option value="members">Miembros</option>
                  <option value="attendance">Asistencia</option>
                  <option value="sessions">Sesiones</option>
                  <option value="consent_records">Consentimientos</option>
                  <option value="profiles">Perfiles</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Acción</Label>
                <select
                  value={auditFilter.action}
                  onChange={(e) => setAuditFilter({ ...auditFilter, action: e.target.value })}
                  className="rounded border px-2 py-1 text-sm"
                >
                  <option value="">Todas</option>
                  <option value="INSERT">Crear</option>
                  <option value="UPDATE">Actualizar</option>
                  <option value="DELETE">Eliminar</option>
                  <option value="CONSENT_GENERAL">Consentimiento general</option>
                  <option value="CONSENT_SENSITIVE">Consentimiento sensible</option>
                </select>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Acción</TableHead>
                  <TableHead>Tabla</TableHead>
                  <TableHead className="hidden sm:table-cell">Registro</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditLogs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No hay registros de auditoría
                    </TableCell>
                  </TableRow>
                ) : (
                  auditLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-sm">
                        {new Date(log.created_at).toLocaleString('es-CO')}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{log.action}</Badge>
                      </TableCell>
                      <TableCell>{log.table_name}</TableCell>
                      <TableCell className="hidden sm:table-cell font-mono text-xs">
                        {log.record_id?.slice(0, 8)}...
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {activeTab === 'arco' && (
        <Card>
          <CardHeader>
            <CardTitle>Solicitudes ARCO</CardTitle>
            <CardDescription>Acceso, Rectificación, Cancelación y Oposición</CardDescription>
          </CardHeader>
          <CardContent>
            {arcoRequests.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No hay solicitudes pendientes</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Fecha límite</TableHead>
                    <TableHead className="hidden sm:table-cell">Notas</TableHead>
                    <TableHead>Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {arcoRequests.map((req) => (
                    <TableRow key={req.id}>
                      <TableCell>
                        <Badge variant="outline">{req.request_type}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={req.status === 'overdue' ? 'destructive' : req.status === 'pending' ? 'secondary' : 'default'}
                        >
                          {req.status === 'pending' ? 'Pendiente' : req.status === 'in_progress' ? 'En proceso' : req.status === 'overdue' ? 'Vencida' : req.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {new Date(req.deadline).toLocaleDateString('es-CO')}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground max-w-xs truncate">
                        {req.notes}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => handleUpdateArcoStatus(req.id, 'in_progress')}>
                            Iniciar
                          </Button>
                          <Button size="sm" onClick={() => handleFulfillArco(req.id)}>
                            Completar
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === 'settings' && (
        <Card>
          <CardHeader>
            <CardTitle>Configuración</CardTitle>
            <CardDescription>Ajustes generales de la aplicación</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dpoEmail">Correo del DPO / Responsable de protección de datos</Label>
              <div className="flex gap-2">
                <Input
                  id="dpoEmail"
                  type="email"
                  value={dpoEmail}
                  onChange={(e) => setDpoEmail(e.target.value)}
                  placeholder="dpo@iglesia.com"
                />
                <Button onClick={handleSaveDpoEmail}>Guardar</Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Este correo se muestra en el aviso de privacidad para ejercer derechos ARCO
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'sync' && (
        <Card>
          <CardHeader>
            <CardTitle>Estado de sincronización</CardTitle>
            <CardDescription>Información sobre la cola de sincronización</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-bold">{syncStatus === 'done' ? '✓' : syncStatus === 'syncing' ? '⟳' : syncStatus === 'offline' ? '⊘' : '✗'}</p>
                <p className="text-xs text-muted-foreground">Estado</p>
                <p className="text-sm font-medium">
                  {syncStatus === 'done' ? 'Sincronizado' : syncStatus === 'syncing' ? 'Sincronizando' : syncStatus === 'offline' ? 'Sin conexión' : 'Error'}
                </p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-bold">{pendingCount}</p>
                <p className="text-xs text-muted-foreground">Pendientes</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-bold">{typeof navigator !== 'undefined' && navigator.onLine ? '✓' : '✗'}</p>
                <p className="text-xs text-muted-foreground">Red</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-bold">IDB</p>
                <p className="text-xs text-muted-foreground">Almacenamiento</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'purge' && (
        <Card>
          <CardHeader>
            <CardTitle>Purga de datos</CardTitle>
            <CardDescription>Eliminar permanentemente registros con soft-delete de más de 90 días</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border p-4">
              <p className="text-sm">
                <span className="font-medium">{purgeableCount}</span> registros elegibles para purga permanente
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Los registros eliminados se borran permanentemente de la base de datos local. La auditoría conserva un registro tumba.
              </p>
            </div>
            <Button
              variant="destructive"
              disabled={purgeableCount === 0}
              onClick={handlePurgeDeleted}
            >
              Purgar {purgeableCount} registros
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
