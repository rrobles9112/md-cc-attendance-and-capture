import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Attendance, Member, Session } from '@/lib/sync/db'
import { AttendanceGrid } from '../AttendanceGrid'

const SESSION_ID = 'session-1'
const SESSION_LABEL = 'Viernes 14 Agosto — 2026-08-14'

const harness = vi.hoisted(() => ({
  members: [] as Member[],
  attendance: [] as Attendance[],
  onHydrated: null as (() => void) | null,
  attendanceOnInsert: null as (() => void) | null,
  filterCalls: 0,
  role: 'leader' as 'leader' | 'super_admin',
}))

vi.mock('@/lib/attendance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/attendance')>()
  return {
    ...actual,
    filterBySearch: (members: Member[], query: string) => {
      harness.filterCalls += 1
      return actual.filterBySearch(members, query)
    },
  }
})

vi.mock('@/hooks/useCacheHydration', () => ({
  useCacheHydration: (onHydrated: () => void) => {
    harness.onHydrated = onHydrated
  },
}))

vi.mock('@/hooks/useRealtime', () => ({
  useRealtime: (options: { table: string; onInsert?: () => void }) => {
    if (options.table === 'attendance') {
      harness.attendanceOnInsert = options.onInsert ?? null
    }
  },
}))

vi.mock('@/hooks/useRole', () => ({
  useRole: () => ({ role: harness.role, loading: false, error: null }),
}))

vi.mock('@/lib/sync/db', () => ({
  db: {
    members: {
      filter: (predicate: (member: Member) => boolean) => ({
        toArray: async () => harness.members.filter(predicate),
      }),
    },
    attendance: {
      where: (field: keyof Attendance) => ({
        equals: (value: string) => ({
          toArray: async () =>
            harness.attendance.filter((row) => row[field] === value),
        }),
      }),
    },
  },
}))

function installSelectPolyfills() {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', {
    writable: true,
    value: ResizeObserverStub,
  })
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    configurable: true,
    value: () => false,
  })
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: () => undefined,
  })
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    configurable: true,
    value: () => undefined,
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => undefined,
  })
}

function makeMember(index: number, name = `Member ${String(index).padStart(2, '0')}`): Member {
  return {
    id: `member-${index}`,
    name,
    name_normalized: name.toLowerCase(),
    phone: `555000${String(index).padStart(4, '0')}`,
    email: `member${index}@example.com`,
    is_minor: false,
    has_whatsapp: false,
    consent_recorded: true,
    sensitive_consent_recorded: false,
    duplicate_flag: false,
    created_by: 'user-1',
    created_at: '2026-08-14T00:00:00.000Z',
    updated_at: '2026-08-14T00:00:00.000Z',
    deleted_at: null,
  }
}

function makeAttendance(memberIndex: number): Attendance {
  return {
    id: `att-member-${memberIndex}`,
    member_id: `member-${memberIndex}`,
    session_id: SESSION_ID,
    marked_by: 'user-1',
    marked_at: '2026-08-14T12:00:00.000Z',
  }
}

const session: Session = {
  id: SESSION_ID,
  name: 'Viernes 14 Agosto',
  session_date: '2026-08-14',
  created_by: 'user-1',
  created_at: '2026-08-14T00:00:00.000Z',
  deleted_at: null,
}

const sessionB: Session = {
  id: 'session-2',
  name: 'Sabado 15 Agosto',
  session_date: '2026-08-15',
  created_by: 'user-1',
  created_at: '2026-08-15T00:00:00.000Z',
  deleted_at: null,
}

const SESSION_B_LABEL = 'Sabado 15 Agosto — 2026-08-15'

async function renderGridAtTwoOfTen() {
  harness.members = Array.from({ length: 10 }, (_, index) => makeMember(index + 1))
  harness.attendance = [makeAttendance(1), makeAttendance(2)]
  render(<AttendanceGrid sessions={[session]} />)

  const trigger = screen.getByRole('combobox')
  fireEvent.pointerDown(trigger)
  fireEvent.click(trigger)
  fireEvent.click(await screen.findByRole('option', { name: SESSION_LABEL }))

  await waitFor(() => {
    expect(screen.getByText('2 / 10 presentes')).toBeInTheDocument()
  })
}

installSelectPolyfills()

describe('AttendanceGrid', () => {
  beforeEach(() => {
    harness.members = []
    harness.attendance = []
    harness.onHydrated = null
    harness.attendanceOnInsert = null
    harness.filterCalls = 0
    harness.role = 'leader'
  })

  it('counter updates after hydration refreshes both members and attendance', async () => {
    await renderGridAtTwoOfTen()

    harness.members = [
      ...Array.from({ length: 9 }, (_, index) => makeMember(index + 1)),
      makeMember(10, 'Hydrated Member'),
    ]
    harness.attendance = [makeAttendance(1), makeAttendance(2), makeAttendance(3)]

    expect(harness.onHydrated).toEqual(expect.any(Function))
    harness.onHydrated?.()

    await waitFor(() => {
      expect(screen.getByText('3 / 10 presentes')).toBeInTheDocument()
    })
    expect(screen.getByText('Hydrated Member')).toBeInTheDocument()
  })

  it('realtime attendance INSERT updates counter from 2/10 to 3/10', async () => {
    await renderGridAtTwoOfTen()

    harness.attendance = [makeAttendance(1), makeAttendance(2), makeAttendance(3)]

    expect(harness.attendanceOnInsert).toEqual(expect.any(Function))
    harness.attendanceOnInsert?.()

    await waitFor(() => {
      expect(screen.getByText('3 / 10 presentes')).toBeInTheDocument()
    })
  })

  it('denominator stays constant during search', async () => {
    await renderGridAtTwoOfTen()

    fireEvent.change(screen.getByPlaceholderText('Buscar miembro...'), {
      target: { value: 'Member 01' },
    })

    await waitFor(() => {
      expect(screen.getByText('Member 01')).toBeInTheDocument()
    })
    expect(screen.queryByText('Member 02')).not.toBeInTheDocument()
    expect(screen.getByText('1 / 10 presentes')).toBeInTheDocument()
  })

  it('input remains responsive during rapid typing', async () => {
    await renderGridAtTwoOfTen()
    const search = screen.getByPlaceholderText('Buscar miembro...')

    fireEvent.change(search, { target: { value: 'a' } })
    expect(search).toHaveValue('a')
    fireEvent.change(search, { target: { value: 'ab' } })
    expect(search).toHaveValue('ab')
    fireEvent.change(search, { target: { value: 'abc' } })
    expect(search).toHaveValue('abc')

    await waitFor(() => {
      expect(screen.getByText('No se encontraron miembros')).toBeInTheDocument()
    })
  })

  it('memoized filter avoids unnecessary recomputation', async () => {
    await renderGridAtTwoOfTen()
    const callsAfterLoad = harness.filterCalls
    expect(callsAfterLoad).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Nueva sesión' }))

    expect(screen.getByLabelText('Nombre de la sesión')).toBeInTheDocument()
    expect(harness.filterCalls).toBe(callsAfterLoad)
  })

  it('shows empty-registry copy when no members exist', async () => {
    harness.members = []
    harness.attendance = []
    render(<AttendanceGrid sessions={[session]} />)

    fireEvent.pointerDown(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: SESSION_LABEL }))

    await waitFor(() => {
      expect(screen.getByText('No hay miembros registrados')).toBeInTheDocument()
    })
  })

  it('pagination resets on new search', async () => {
    harness.members = Array.from({ length: 60 }, (_, index) => makeMember(index + 1))
    harness.attendance = [makeAttendance(1), makeAttendance(2)]
    render(<AttendanceGrid sessions={[session]} />)

    fireEvent.pointerDown(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: SESSION_LABEL }))

    await waitFor(() => {
      expect(screen.getByText('2 / 60 presentes')).toBeInTheDocument()
    })
    expect(screen.getAllByRole('checkbox')).toHaveLength(50)
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
    await waitFor(() => {
      expect(screen.getAllByRole('checkbox')).toHaveLength(60)
    })

    fireEvent.change(screen.getByPlaceholderText('Buscar miembro...'), {
      target: { value: 'Member 01' },
    })

    await waitFor(() => {
      expect(screen.getByText('Member 01')).toBeInTheDocument()
    })
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument()
  })

  it('session switch resets visible count', async () => {
    harness.members = Array.from({ length: 60 }, (_, index) => makeMember(index + 1))
    harness.attendance = [makeAttendance(1)]
    render(<AttendanceGrid sessions={[session, sessionB]} />)

    fireEvent.pointerDown(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: SESSION_LABEL }))

    await waitFor(() => {
      expect(screen.getAllByRole('checkbox')).toHaveLength(50)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
    await waitFor(() => {
      expect(screen.getAllByRole('checkbox')).toHaveLength(60)
    })

    fireEvent.pointerDown(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: SESSION_B_LABEL }))

    await waitFor(() => {
      expect(screen.getAllByRole('checkbox')).toHaveLength(50)
    })
    expect(screen.getByRole('button', { name: 'Cargar más' })).toBeInTheDocument()
  })

  it('search change resets pagination', async () => {
    harness.members = Array.from({ length: 60 }, (_, index) => makeMember(index + 1))
    harness.attendance = []
    render(<AttendanceGrid sessions={[session]} />)

    fireEvent.pointerDown(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: SESSION_LABEL }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cargar más' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
    await waitFor(() => {
      expect(screen.getAllByRole('checkbox')).toHaveLength(60)
    })

    fireEvent.change(screen.getByPlaceholderText('Buscar miembro...'), {
      target: { value: 'Member' },
    })

    await waitFor(() => {
      expect(screen.getAllByRole('checkbox')).toHaveLength(50)
    })
    expect(screen.getByRole('button', { name: 'Cargar más' })).toBeInTheDocument()
  })

  it('denominator excludes soft-deleted members', async () => {
    harness.members = [
      ...Array.from({ length: 10 }, (_, index) => makeMember(index + 1)),
      { ...makeMember(99, 'Deleted User'), deleted_at: '2026-08-01T00:00:00.000Z' },
    ]
    harness.attendance = [makeAttendance(1)]
    render(<AttendanceGrid sessions={[session]} />)

    fireEvent.pointerDown(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: SESSION_LABEL }))

    await waitFor(() => {
      expect(screen.getByText('1 / 10 presentes')).toBeInTheDocument()
    })
    expect(screen.queryByText('Deleted User')).not.toBeInTheDocument()
  })

  it('soft-deleted member is excluded from search results', async () => {
    harness.members = [
      makeMember(1, 'Ana García'),
      { ...makeMember(2, 'Deleted User'), deleted_at: '2026-08-01T00:00:00.000Z' },
    ]
    harness.attendance = []
    render(<AttendanceGrid sessions={[session]} />)

    fireEvent.pointerDown(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: SESSION_LABEL }))

    await waitFor(() => {
      expect(screen.getByText('Ana García')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('Buscar miembro...'), {
      target: { value: 'deleted' },
    })

    await waitFor(() => {
      expect(screen.getByText('No se encontraron miembros')).toBeInTheDocument()
    })
    expect(screen.queryByText('Deleted User')).not.toBeInTheDocument()
  })

  it('counter shows total even when partially loaded', async () => {
    harness.members = Array.from({ length: 60 }, (_, index) => makeMember(index + 1))
    harness.attendance = Array.from({ length: 10 }, (_, index) => makeAttendance(index + 1))
    render(<AttendanceGrid sessions={[session]} />)

    fireEvent.pointerDown(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: SESSION_LABEL }))

    await waitFor(() => {
      expect(screen.getByText('10 / 60 presentes')).toBeInTheDocument()
    })
    expect(screen.getAllByRole('checkbox')).toHaveLength(50)
  })

  it('super_admin and leader see the same counter', async () => {
    harness.role = 'leader'
    await renderGridAtTwoOfTen()
    expect(screen.getByText('2 / 10 presentes')).toBeInTheDocument()
    cleanup()

    harness.role = 'super_admin'
    await renderGridAtTwoOfTen()
    expect(screen.getByText('2 / 10 presentes')).toBeInTheDocument()
  })
})
