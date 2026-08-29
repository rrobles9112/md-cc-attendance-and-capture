import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UsersPanel, type ManagedUser } from '../UsersPanel'
import { CONFLICT_EMAIL_MESSAGE_ES } from '@/lib/admin/user-store'

const createAdminUser = vi.hoisted(() => vi.fn())
const updateAdminUser = vi.hoisted(() => vi.fn())
const deleteAdminUser = vi.hoisted(() => vi.fn())
const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())

vi.mock('@/lib/admin/user-api', () => ({
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
  ROLE_LABELS: {
    super_admin: 'Super Admin',
    leader: 'Líder',
    server: 'Servidor',
  },
}))

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}))

const users: ManagedUser[] = [
  {
    id: 'self',
    full_name: 'Test Super Admin',
    role: 'super_admin',
    is_active: true,
    created_at: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'leader-1',
    full_name: 'Test Leader',
    role: 'leader',
    is_active: true,
    created_at: '2026-08-02T00:00:00.000Z',
  },
]

describe('UsersPanel', () => {
  const onChanged = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    createAdminUser.mockResolvedValue({ id: 'new' })
    updateAdminUser.mockResolvedValue(undefined)
    deleteAdminUser.mockResolvedValue(undefined)
    vi.stubGlobal('confirm', vi.fn(() => true))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('creates a user from the admin form', async () => {
    render(<UsersPanel users={users} currentUserId="self" onChanged={onChanged} />)

    fireEvent.click(screen.getByRole('button', { name: 'Crear usuario' }))
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ana Leader' } })
    fireEvent.change(screen.getByLabelText('Correo'), { target: { value: 'leader@church.com' } })
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'secure-pass' } })
    fireEvent.change(screen.getByLabelText('Rol'), { target: { value: 'leader' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))

    await waitFor(() => {
      expect(createAdminUser).toHaveBeenCalledWith({
        full_name: 'Ana Leader',
        email: 'leader@church.com',
        password: 'secure-pass',
        role: 'leader',
      })
    })
    expect(onChanged).toHaveBeenCalled()
  })

  it('edits another user and refuses to delete the signed-in account', async () => {
    render(<UsersPanel users={users} currentUserId="self" onChanged={onChanged} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Editar' })[1])
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Leader Two' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => {
      expect(updateAdminUser).toHaveBeenCalledWith('leader-1', {
        full_name: 'Leader Two',
        role: 'leader',
        is_active: true,
      })
    })

    expect((screen.getAllByRole('button', { name: 'Eliminar' })[0] as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getAllByRole('button', { name: 'Eliminar' })[1])
    await waitFor(() => {
      expect(deleteAdminUser).toHaveBeenCalledWith('leader-1')
    })
  })

  it('shows the es-CO conflict toast and keeps the create form open when the email is already registered', async () => {
    createAdminUser.mockRejectedValue(new Error(CONFLICT_EMAIL_MESSAGE_ES))
    render(<UsersPanel users={users} currentUserId="self" onChanged={onChanged} />)

    fireEvent.click(screen.getByRole('button', { name: 'Crear usuario' }))
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ana Leader' } })
    fireEvent.change(screen.getByLabelText('Correo'), { target: { value: 'leader@church.com' } })
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'secure-pass' } })
    fireEvent.change(screen.getByLabelText('Rol'), { target: { value: 'leader' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledTimes(1)
    })
    expect(toastError).toHaveBeenCalledWith(CONFLICT_EMAIL_MESSAGE_ES)
    expect(toastError).not.toHaveBeenCalledWith('Error al crear el usuario')
    expect(onChanged).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Correo') as HTMLInputElement).value).toBe('leader@church.com')
    expect((screen.getByLabelText('Nombre') as HTMLInputElement).value).toBe('Ana Leader')
  })
})
