import type { Metadata } from 'next'
import {
  RETREAT_PAGE_DESCRIPTION,
  RETREAT_PAGE_HEADING,
} from '@/lib/retreat/constants'

export const metadata: Metadata = {
  title: RETREAT_PAGE_HEADING,
  description: RETREAT_PAGE_DESCRIPTION,
}

export default function RetreatLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return children
}
