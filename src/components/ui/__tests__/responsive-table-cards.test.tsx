import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { UsersPanel, type ManagedUser } from '@/components/admin/UsersPanel'
import { ChronicTable } from '@/components/pastoreo/ChronicTable'
import type { ChronicRow } from '@/lib/pastoreo/queries'

function setViewportCompact(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

const sampleUsers: ManagedUser[] = [
  {
    id: 'u-1',
    full_name: 'María Fernanda Ruiz',
    role: 'leader',
    is_active: true,
    created_at: '2026-08-01T12:00:00Z',
  },
]

const sampleChronicRows: ChronicRow[] = [
  {
    id: 'm-1',
    name: 'Juan Camilo',
    ageYears: 24,
    ageBucket: '21-25',
    sex: 'M',
    lastAttendedDate: '2026-07-10',
    missedStreak: 4,
    waNumberMasked: '***4567',
  },
]

describe('Responsive Card view for shadcn/ui tables on mobile, tablet, and medium viewports', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders UsersPanel records as Cards with all columns and action buttons (botonera) on compact viewports (< 1280px)', () => {
    setViewportCompact(true)
    const onChanged = vi.fn()

    const { container } = render(
      <UsersPanel users={sampleUsers} currentUserId="admin-1" onChanged={onChanged} />,
    )

    expect(container.querySelector('table')).toBeNull()
    expect(screen.getByTestId('responsive-table-cards')).toBeInTheDocument()
    expect(screen.getByTestId('responsive-table-card')).toBeInTheDocument()

    expect(screen.getByText('María Fernanda Ruiz')).toBeInTheDocument()
    expect(screen.getByText('Rol')).toBeInTheDocument()
    expect(screen.getByText('Líder')).toBeInTheDocument()
    expect(screen.getByText('Estado')).toBeInTheDocument()
    expect(screen.getByText('Registro')).toBeInTheDocument()

    const editBtn = screen.getByRole('button', { name: 'Editar' })
    const deleteBtn = screen.getByRole('button', { name: 'Eliminar' })
    expect(editBtn).toBeInTheDocument()
    expect(deleteBtn).toBeInTheDocument()

    fireEvent.click(editBtn)
    expect(screen.getByText('Editar usuario')).toBeInTheDocument()
  })

  it('renders ChronicTable records as Cards with all columns and selection controls on compact viewports (< 1280px)', () => {
    setViewportCompact(true)

    const { container } = render(<ChronicTable rows={sampleChronicRows} />)

    expect(container.querySelector('table')).toBeNull()
    expect(screen.getByTestId('responsive-table-cards')).toBeInTheDocument()
    expect(screen.getByTestId('chronic-row')).toBeInTheDocument()

    expect(screen.getByText('Juan Camilo')).toBeInTheDocument()
    expect(screen.getByText('Edad')).toBeInTheDocument()
    expect(screen.getByText('24')).toBeInTheDocument()
    expect(screen.getByText('Sexo')).toBeInTheDocument()
    expect(screen.getByText('M')).toBeInTheDocument()
    expect(screen.getByText('Ultima asistencia')).toBeInTheDocument()
    expect(screen.getByText('2026-07-10')).toBeInTheDocument()
    expect(screen.getByText('Racha')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByTestId('phone-masked')).toHaveTextContent('***4567')
  })

  it('renders standard Table on desktop viewports (>= 1280px)', () => {
    setViewportCompact(false)

    const { container } = render(
      <UsersPanel users={sampleUsers} currentUserId="admin-1" onChanged={vi.fn()} />,
    )

    expect(container.querySelector('table')).not.toBeNull()
    expect(screen.queryByTestId('responsive-table-cards')).not.toBeInTheDocument()
  })
})
