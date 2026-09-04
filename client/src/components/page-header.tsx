import type { ReactNode } from 'react'

export function PageHeader({
  title,
  description,
  actions,
  divider = true,
}: {
  title: string
  description?: string
  actions?: ReactNode
  divider?: boolean
}) {
  return (
    <div className={`mb-4 sm:mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between ${divider ? 'border-b pb-3 sm:pb-5' : ''}`}>
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight sm:text-2xl truncate">{title}</h1>
        {description && (
          <p className="mt-0.5 max-w-3xl text-xs sm:text-sm text-muted-foreground leading-relaxed">{description}</p>
        )}
      </div>
      {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end shrink-0">{actions}</div>}
    </div>
  )
}
