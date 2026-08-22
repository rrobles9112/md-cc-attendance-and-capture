import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { AdminUserPolicyError, parseCreateUserInput, parseUpdateUserPatch } from '@/lib/admin/user-policy'
import { createManagedUser, deleteManagedUser, updateManagedUser } from '@/lib/admin/user-service'
import { AdminUserStoreError, createSupabaseAdminStore } from '@/lib/admin/user-store'

export const runtime = 'nodejs'

async function requireSuperAdmin(): Promise<{ id: string } | NextResponse> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const jwtRole = user.app_metadata?.role
  if (jwtRole === 'super_admin') {
    return { id: user.id }
  }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'super_admin') {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  return { id: user.id }
}

function policyStatus(code: AdminUserPolicyError['code']): number {
  switch (code) {
    case 'invalid_input':
      return 400
    case 'self_demote':
    case 'self_deactivate':
    case 'self_delete':
      return 403
    default: {
      const exhaustive: never = code
      return exhaustive
    }
  }
}

function storeStatus(code: AdminUserStoreError['code']): number {
  switch (code) {
    case 'conflict':
      return 409
    case 'auth_failed':
      return 500
    default: {
      const exhaustive: never = code
      return exhaustive
    }
  }
}

function jsonError(error: unknown): NextResponse {
  if (error instanceof AdminUserPolicyError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: policyStatus(error.code) })
  }
  if (error instanceof AdminUserStoreError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: storeStatus(error.code) })
  }
  return NextResponse.json({ error: 'Unexpected error' }, { status: 500 })
}

export async function POST(request: Request) {
  const actor = await requireSuperAdmin()
  if (actor instanceof NextResponse) return actor

  try {
    const created = await createManagedUser(
      createSupabaseAdminStore(),
      parseCreateUserInput(await request.json()),
    )
    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}

export async function PATCH(request: Request) {
  const actor = await requireSuperAdmin()
  if (actor instanceof NextResponse) return actor

  try {
    const body = await request.json() as { id?: unknown }
    if (typeof body.id !== 'string' || body.id.length === 0) {
      return NextResponse.json({ error: 'User id is required' }, { status: 400 })
    }
    await updateManagedUser(createSupabaseAdminStore(), actor.id, body.id, parseUpdateUserPatch(body))
    return NextResponse.json({ ok: true })
  } catch (error) {
    return jsonError(error)
  }
}

export async function DELETE(request: Request) {
  const actor = await requireSuperAdmin()
  if (actor instanceof NextResponse) return actor

  try {
    const userId = new URL(request.url).searchParams.get('id')
    if (!userId) {
      return NextResponse.json({ error: 'User id is required' }, { status: 400 })
    }
    await deleteManagedUser(createSupabaseAdminStore(), actor.id, userId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return jsonError(error)
  }
}
