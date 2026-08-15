import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
}))

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
  useRole: () => ({ role: null, loading: false, error: null }),
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
})
