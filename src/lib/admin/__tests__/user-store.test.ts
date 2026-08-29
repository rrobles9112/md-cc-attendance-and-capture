import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AdminUserStoreError,
  CONFLICT_EMAIL_MESSAGE_ES,
  createSupabaseAdminStore,
  isDuplicateEmailAuthError,
} from '@/lib/admin/user-store'
import type { CreateUserInput } from '@/lib/admin/user-policy'

const createUserMock = vi.hoisted(() => vi.fn())

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      admin: {
        createUser: createUserMock,
      },
    },
  })),
}))

const INPUT: CreateUserInput = {
  full_name: 'Ana Leader',
  email: 'leader@church.com',
  password: 'secure-pass',
  role: 'leader',
}

async function createAuthUserRejection(): Promise<AdminUserStoreError> {
  const store = createSupabaseAdminStore()
  return store.createAuthUser(INPUT).then(
    () => {
      throw new Error('expected createAuthUser to reject')
    },
    (error: unknown) => error as AdminUserStoreError,
  )
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key')
  createUserMock.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('createSupabaseAdminStore createAuthUser — duplicate-email classification', () => {
  it('maps "User already registered" to conflict with the es-CO message', async () => {
    createUserMock.mockResolvedValue({
      data: { user: null },
      error: { message: 'User already registered' },
    })

    const error = await createAuthUserRejection()

    expect(error).toBeInstanceOf(AdminUserStoreError)
    expect(error.code).toBe('conflict')
    expect(error.message).toBe(CONFLICT_EMAIL_MESSAGE_ES)
  })

  it('maps code user_already_exists (wording variant) to conflict', async () => {
    createUserMock.mockResolvedValue({
      data: { user: null },
      error: {
        code: 'user_already_exists',
        message: 'AuthApiError: A user with this email address has already been registered',
      },
    })

    const error = await createAuthUserRejection()

    expect(error).toBeInstanceOf(AdminUserStoreError)
    expect(error.code).toBe('conflict')
    expect(error.message).toBe(CONFLICT_EMAIL_MESSAGE_ES)
  })

  it('maps code 422 without a password mention to conflict', async () => {
    createUserMock.mockResolvedValue({
      data: { user: null },
      error: { code: '422', message: 'Signup requires a valid email' },
    })

    const error = await createAuthUserRejection()

    expect(error).toBeInstanceOf(AdminUserStoreError)
    expect(error.code).toBe('conflict')
    expect(error.message).toBe(CONFLICT_EMAIL_MESSAGE_ES)
  })

  it('maps status 422 with an empty message to conflict', async () => {
    createUserMock.mockResolvedValue({
      data: { user: null },
      error: { status: 422, message: '' },
    })

    const error = await createAuthUserRejection()

    expect(error).toBeInstanceOf(AdminUserStoreError)
    expect(error.code).toBe('conflict')
    expect(error.message).toBe(CONFLICT_EMAIL_MESSAGE_ES)
  })
})

describe('createSupabaseAdminStore createAuthUser — non-duplicate failures stay auth_failed', () => {
  it('keeps auth_failed with the upstream message for a password 422', async () => {
    createUserMock.mockResolvedValue({
      data: { user: null },
      error: { status: 422, message: 'Password should be at least 6 characters.' },
    })

    const error = await createAuthUserRejection()

    expect(error).toBeInstanceOf(AdminUserStoreError)
    expect(error.code).toBe('auth_failed')
    expect(error.message).toBe('Password should be at least 6 characters.')
  })

  it('keeps auth_failed with the upstream message for an unrelated failure', async () => {
    createUserMock.mockResolvedValue({
      data: { user: null },
      error: { message: 'Email not confirmed', status: 500 },
    })

    const error = await createAuthUserRejection()

    expect(error).toBeInstanceOf(AdminUserStoreError)
    expect(error.code).toBe('auth_failed')
    expect(error.message).toBe('Email not confirmed')
  })

  it('falls back to the generic message when createUser returns neither error nor user', async () => {
    createUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const error = await createAuthUserRejection()

    expect(error).toBeInstanceOf(AdminUserStoreError)
    expect(error.code).toBe('auth_failed')
    expect(error.message).toBe('Could not create auth user')
  })
})

describe('isDuplicateEmailAuthError — truth table', () => {
  it('returns false for null, non-objects, and shapeless objects', () => {
    expect(isDuplicateEmailAuthError(null)).toBe(false)
    expect(isDuplicateEmailAuthError(undefined)).toBe(false)
    expect(isDuplicateEmailAuthError('User already registered')).toBe(false)
    expect(isDuplicateEmailAuthError(422)).toBe(false)
    expect(isDuplicateEmailAuthError({})).toBe(false)
  })

  it('returns true for the GoTrue duplicate-email shapes', () => {
    expect(isDuplicateEmailAuthError({ message: 'User already registered' })).toBe(true)
    expect(
      isDuplicateEmailAuthError({
        code: 'user_already_exists',
        message: 'AuthApiError: A user with this email address has already been registered',
      }),
    ).toBe(true)
    expect(isDuplicateEmailAuthError({ code: '422', message: 'Signup requires a valid email' })).toBe(true)
    expect(isDuplicateEmailAuthError({ status: 422, message: '' })).toBe(true)
  })

  it('returns false when the message mentions password, regardless of 422', () => {
    expect(
      isDuplicateEmailAuthError({ status: 422, message: 'Password should be at least 6 characters.' }),
    ).toBe(false)
    expect(
      isDuplicateEmailAuthError({ code: '422', message: 'Password should be at least 6 characters.' }),
    ).toBe(false)
  })

  it('returns false for non-422 statuses and unmatched messages', () => {
    expect(isDuplicateEmailAuthError({ message: 'Email not confirmed', status: 500 })).toBe(false)
    expect(isDuplicateEmailAuthError({ message: 'Invalid request', status: 400 })).toBe(false)
    expect(isDuplicateEmailAuthError({ code: '429', message: 'Too many requests' })).toBe(false)
  })
})

describe('createSupabaseAdminStore createAuthUser — success path', () => {
  it('resolves the created user id and maps the input onto the GoTrue call', async () => {
    createUserMock.mockResolvedValue({ data: { user: { id: 'auth-user-1' } }, error: null })

    const store = createSupabaseAdminStore()
    const created = await store.createAuthUser(INPUT)

    expect(created).toEqual({ id: 'auth-user-1' })
    expect(createUserMock).toHaveBeenCalledWith({
      email: 'leader@church.com',
      password: 'secure-pass',
      email_confirm: true,
      user_metadata: { full_name: 'Ana Leader' },
      app_metadata: { role: 'leader' },
    })
  })
})
