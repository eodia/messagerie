import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/** basedb's empty state: a tile, a title, a sentence, and what to do next. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  actions,
}: {
  readonly icon: LucideIcon
  readonly title: string
  readonly children: ReactNode
  readonly actions?: ReactNode
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-muted">
          <Icon className="size-6 text-muted-foreground" />
        </div>
        <h2 className="mt-4 text-lg font-semibold tracking-tight">{title}</h2>
        <div className="mt-2 text-sm text-muted-foreground">{children}</div>
        {actions && <div className="mt-5 flex justify-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}
