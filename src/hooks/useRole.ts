'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { AppRole } from '@/lib/rbac/types'

interface UseRoleReturn {
  role: AppRole | null
  loading: boolean
  error: Error | null
}

export function useRole(): UseRoleReturn {
  const [role, setRole] = useState<AppRole | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    const supabase = createClient()

    async function fetchRole() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          setRole(null)
          return
        }

        const jwtRole = session.user.app_metadata?.role as AppRole | undefined
        if (jwtRole && ['super_admin', 'leader', 'server'].includes(jwtRole)) {
          setRole(jwtRole)
          return
        }

        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', session.user.id)
          .single()

        if (profile?.role) {
          setRole(profile.role as AppRole)
        }
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)))
      } finally {
        setLoading(false)
      }
    }

    fetchRole()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      fetchRole()
    })

    return () => subscription.unsubscribe()
  }, [])

  return { role, loading, error }
}
