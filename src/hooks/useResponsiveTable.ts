'use client'

import { useEffect, useState } from 'react'

export const COMPACT_TABLE_MEDIA_QUERY = '(max-width: 1279px)'

export function useIsCompactTableViewport(
  query: string = COMPACT_TABLE_MEDIA_QUERY,
): boolean {
  const [isCompactViewport, setIsCompactViewport] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false
    }
    return Boolean(window.matchMedia(query)?.matches)
  })
  const [isPrinting, setIsPrinting] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }
    const mediaQueryList = window.matchMedia(query)
    if (!mediaQueryList) return

    setIsCompactViewport(Boolean(mediaQueryList.matches))

    const handleChange = (event: MediaQueryListEvent) => {
      setIsCompactViewport(Boolean(event.matches))
    }

    if (typeof mediaQueryList.addEventListener === 'function') {
      mediaQueryList.addEventListener('change', handleChange)
    } else if (typeof mediaQueryList.addListener === 'function') {
      mediaQueryList.addListener(handleChange)
    }

    const handleBeforePrint = () => setIsPrinting(true)
    const handleAfterPrint = () => setIsPrinting(false)
    window.addEventListener('beforeprint', handleBeforePrint)
    window.addEventListener('afterprint', handleAfterPrint)

    return () => {
      if (typeof mediaQueryList.removeEventListener === 'function') {
        mediaQueryList.removeEventListener('change', handleChange)
      } else if (typeof mediaQueryList.removeListener === 'function') {
        mediaQueryList.removeListener(handleChange)
      }
      window.removeEventListener('beforeprint', handleBeforePrint)
      window.removeEventListener('afterprint', handleAfterPrint)
    }
  }, [query])

  if (isPrinting) return false
  return isCompactViewport
}
