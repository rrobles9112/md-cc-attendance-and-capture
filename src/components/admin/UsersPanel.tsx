'use client'

import { useState, type FormEvent } from 'react'
import type { AppRole } from '@/lib/rbac/types'
import { createAdminUser, deleteAdminUser, ROLE_LABELS, updateAdminUser } from '@/lib/admin/user-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from 'sonner'

export interface ManagedUser {
  id: string
  full_name: string
  role: string
  is_active: boolean
  created_at: string
}

interface UsersPanelProps {
  users: ManagedUser[]
  currentUserId: string | null
  onChanged: () => void
}

const EMPTY_CREATE = { full_name: '', email: '', password: '', role: 'server' as AppRole }

export function UsersPanel({ users, currentUserId, onChanged }: UsersPanelProps) {
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(EMPTY_CREATE)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<ManagedUser | null>(null)
  const [editName, setEditName] = useState('')
  const [editRole, setEditRole] = useState<AppRole>('server')
  const [editActive, setEditActive] = useState(true)

  function openEdit(user: ManagedUser) {
    setEditing(user)
    setEditName(user.full_name)
    setEditRole(user.role as AppRole)
    setEditActive(user.is_active)
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      await createAdminUser(creating)
      toast.success('Usuario creado')
      setCreating(EMPTY_CREATE)
      setShowCreate(false)
      onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al crear el usuario')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveEdit() {
    if (!editing) return
    setSaving(true)
    try {
      await updateAdminUser(editing.id, {
        full_name: editName,
        role: editRole,
        is_active: editActive,
      })
      toast.success('Usuario actualizado')
      setEditing(null)
      onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al actualizar el usuario')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(user: ManagedUser) {
    if (user.id === currentUserId) {
      toast.error('No puede eliminar su propia cuenta')
      return
    }
    if (!confirm(`¿Eliminar a ${user.full_name}? Si hay registros asociados, desactive la cuenta en su lugar.`)) {
      return
    }
    try {
      await deleteAdminUser(user.id)
      toast.success('Usuario eliminado')
      onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar el usuario')
    }
  }

  const isSelf = editing?.id === currentUserId

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" onClick={() => setShowCreate((open) => !open)}>
          {showCreate ? 'Cancelar' : 'Crear usuario'}
        </Button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="newUserName">Nombre</Label>
            <Input
              id="newUserName"
              value={creating.full_name}
              onChange={(e) => setCreating({ ...creating, full_name: e.target.value })}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="newUserEmail">Correo</Label>
            <Input
              id="newUserEmail"
              type="email"
              value={creating.email}
              onChange={(e) => setCreating({ ...creating, email: e.target.value })}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="newUserPassword">Contraseña</Label>
            <Input
              id="newUserPassword"
              type="password"
              value={creating.password}
              onChange={(e) => setCreating({ ...creating, password: e.target.value })}
              minLength={8}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="newUserRole">Rol</Label>
            <select
              id="newUserRole"
              value={creating.role}
              onChange={(e) => setCreating({ ...creating, role: e.target.value as AppRole })}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="super_admin">Super Admin</option>
              <option value="leader">Líder</option>
              <option value="server">Servidor</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={saving}>Crear</Button>
          </div>
        </form>
      )}

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
              <TableCell>{ROLE_LABELS[user.role as AppRole] ?? user.role}</TableCell>
              <TableCell className="hidden sm:table-cell">
                <Badge variant={user.is_active ? 'default' : 'destructive'}>
                  {user.is_active ? 'Activo' : 'Inactivo'}
                </Badge>
              </TableCell>
              <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                {new Date(user.created_at).toLocaleDateString('es-CO')}
              </TableCell>
              <TableCell className="space-x-2">
                <Button variant="ghost" size="sm" onClick={() => openEdit(user)}>Editar</Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={user.id === currentUserId}
                  onClick={() => handleDelete(user)}
                >
                  Eliminar
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar usuario</DialogTitle>
            <DialogDescription>Nombre, rol y estado. El rol se refleja en el JWT al volver a iniciar sesión.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="editUserName">Nombre</Label>
              <Input id="editUserName" value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="editUserRole">Rol</Label>
              <select
                id="editUserRole"
                value={editRole}
                disabled={isSelf}
                onChange={(e) => setEditRole(e.target.value as AppRole)}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="super_admin">Super Admin</option>
                <option value="leader">Líder</option>
                <option value="server">Servidor</option>
              </select>
              {isSelf && (
                <p className="text-xs text-muted-foreground">No puede cambiar su propio rol.</p>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editActive}
                disabled={isSelf}
                onChange={(e) => setEditActive(e.target.checked)}
              />
              Cuenta activa
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={handleSaveEdit} disabled={saving}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
