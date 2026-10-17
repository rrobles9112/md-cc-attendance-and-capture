import * as React from 'react'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export interface ResponsiveTableFieldItem {
  label: React.ReactNode
  value: React.ReactNode
  fullWidth?: boolean
}

export function ResponsiveTableCards({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-testid="responsive-table-cards"
      className={cn('grid grid-cols-1 gap-3 md:grid-cols-2', className)}
      {...props}
    >
      {children}
    </div>
  )
}

export function ResponsiveTableCard({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <Card
      data-testid="responsive-table-card"
      className={cn('flex flex-col justify-between shadow-sm', className)}
      {...props}
    >
      {children}
    </Card>
  )
}

export function ResponsiveTableCardHeader({
  title,
  badges,
  leading,
  className,
}: {
  title: React.ReactNode
  badges?: React.ReactNode
  leading?: React.ReactNode
  className?: string
}) {
  return (
    <CardHeader
      className={cn(
        'flex flex-row items-start justify-between gap-2 space-y-0 p-4 pb-2',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {leading}
        <div className="truncate font-semibold leading-tight">{title}</div>
      </div>
      {badges && <div className="flex shrink-0 flex-wrap items-center gap-1">{badges}</div>}
    </CardHeader>
  )
}

export function ResponsiveTableCardFields({
  fields,
  className,
}: {
  fields: ResponsiveTableFieldItem[]
  className?: string
}) {
  return (
    <CardContent className={cn('p-4 pt-2', className)}>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        {fields.map((field, index) => (
          <div
            key={index}
            className={cn(
              'flex flex-col gap-0.5',
              field.fullWidth && 'sm:col-span-2',
            )}
          >
            <dt className="text-xs font-medium text-muted-foreground">
              {field.label}
            </dt>
            <dd className="break-words text-foreground">{field.value}</dd>
          </div>
        ))}
      </dl>
    </CardContent>
  )
}

export function ResponsiveTableCardActions({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <CardFooter
      data-testid="responsive-table-card-actions"
      className={cn(
        'flex flex-wrap items-center justify-end gap-2 border-t bg-muted/20 px-4 py-3',
        className,
      )}
      {...props}
    >
      {children}
    </CardFooter>
  )
}

export function ResponsiveTableEmpty({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      data-testid="responsive-table-empty"
      className={cn(
        'rounded-lg border p-6 text-center text-sm text-muted-foreground',
        className,
      )}
    >
      {children}
    </div>
  )
}
