'use client'

import { useEffect, useRef } from 'react'
import { onCacheHydrated, type HydrateResult } from '@/lib/sync/hydrate'

/**
 * Re-run a local-cache loader whenever remote hydration finishes successfully.
 * Keeps members / attendance / export screens in sync after the first pull.
 */
export function useCacheHydration(onHydrated: (result: HydrateResult) => void): void {
  const onHydratedRef = useRef(onHydrated)
  onHydratedRef.current = onHydrated

  useEffect(() => {
    return onCacheHydrated((result) => {
      if (result.ok && !result.skipped) {
        onHydratedRef.current(result)
      }
    })
  }, [])
}
