'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useRole } from '@/hooks/useRole'
import { canCreate, canMarkAttendance, canManageUsers, canViewAudit, canExport, canManageARCO } from '@/lib/rbac/guards'
import { SyncIndicator } from '@/components/offline/SyncIndicator'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import {
  Users,
  ClipboardCheck,
  UserPlus,
  Shield,
  Download,
  Menu,
  X,
  LogOut,
} from 'lucide-react'

interface NavItem {
  href: string
  label: string
  icon: React.ElementType
  show: boolean
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { role, loading } = useRole()
  const router = useRouter()
  const pathname = usePathname()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [userName, setUserName] = useState<string>('')

  const fetchUser = useCallback(async () => {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      router.push('/')
      return
    }
    setUserName(session.user.email ?? 'Usuario')
  }, [router])

  useEffect(() => {
    fetchUser()
  }, [fetchUser])

  useEffect(() => {
    if (!loading && !role) {
      router.push('/')
    }
  }, [loading, role, router])

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
  }

  if (loading || !role) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  const navItems: NavItem[] = [
    { href: '/capture', label: 'Capturar', icon: UserPlus, show: canCreate(role) },
    { href: '/attendance', label: 'Asistencia', icon: ClipboardCheck, show: canMarkAttendance(role) },
    { href: '/members', label: 'Miembros', icon: Users, show: true },
    { href: '/export', label: 'Exportar', icon: Download, show: canExport(role) },
    { href: '/admin', label: 'Admin', icon: Shield, show: canManageUsers(role) || canViewAudit(role) || canManageARCO(role) },
  ].filter((item) => item.show)

  return (
    <div className="flex min-h-screen">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-card transition-transform md:static md:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-14 items-center justify-between border-b px-4">
          <span className="font-semibold">Asistencia y Captura</span>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="border-t p-3 space-y-2">
          <div className="flex items-center justify-between px-3">
            <span className="text-xs text-muted-foreground truncate">{userName}</span>
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium">
              {role === 'super_admin' ? 'Admin' : role === 'leader' ? 'Líder' : 'Servidor'}
            </span>
          </div>
          <SyncIndicator />
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-muted-foreground"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
            Cerrar sesión
          </Button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center gap-4 border-b px-4 md:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex-1" />
          <div className="md:hidden">
            <SyncIndicator />
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
