'use client'

import { useSync } from '@/hooks/useSync'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { Loader2, WifiOff, CheckCircle2, AlertCircle } from 'lucide-react'

export function SyncIndicator() {
  const { status, pendingCount } = useSync()

  const config = {
    done: {
      label: 'Sincronizado',
      variant: 'default' as const,
      icon: CheckCircle2,
      className: 'bg-green-100 text-green-800 border-green-200',
    },
    syncing: {
      label: `Sincronizando${pendingCount > 0 ? ` (${pendingCount})` : ''}`,
      variant: 'secondary' as const,
      icon: Loader2,
      className: 'bg-blue-100 text-blue-800 border-blue-200',
    },
    offline: {
      label: `Sin conexión${pendingCount > 0 ? ` (${pendingCount} pendientes)` : ''}`,
      variant: 'outline' as const,
      icon: WifiOff,
      className: 'bg-amber-50 text-amber-800 border-amber-200',
    },
    failed: {
      label: `Error de sincronización${pendingCount > 0 ? ` (${pendingCount})` : ''}`,
      variant: 'destructive' as const,
      icon: AlertCircle,
      className: 'bg-red-100 text-red-800 border-red-200',
    },
    pending: {
      label: `Pendiente${pendingCount > 0 ? ` (${pendingCount})` : ''}`,
      variant: 'secondary' as const,
      icon: Loader2,
      className: 'bg-blue-100 text-blue-800 border-blue-200',
    },
  }

  const { label, icon: Icon, className } = config[status] ?? config.done

  return (
    <Badge
      variant="outline"
      data-testid="sync-indicator"
      data-sync-status={status}
      className={cn('gap-1.5 text-xs', className)}
    >
      <Icon
        className={cn(
          'h-3 w-3',
          status === 'syncing' && 'animate-spin'
        )}
      />
      {label}
    </Badge>
  )
}
