import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * What a screen will look like, while it comes: its bars, rows and cards in grey — shown
 * at once on a click in the sidebar (`loading.tsx`), and where a list is read. Widths
 * vary, as text does; nothing moves but the pulse.
 */

const WIDTHS = ['w-2/3', 'w-1/2', 'w-3/4', 'w-2/5', 'w-3/5', 'w-1/3']

/** The bar at the top of every screen. */
export function HeaderSkeleton() {
  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
      <Skeleton className="size-8" />
      <Skeleton className="h-4 w-40" />
      <div className="flex-1" />
      <Skeleton className="size-8" />
    </div>
  )
}

/** Rows of a list: an avatar, a name, a line under it. */
export function RowsSkeleton({
  rows = 6,
  avatar = true,
  className,
}: {
  readonly rows?: number
  readonly avatar?: boolean
  readonly className?: string
}) {
  return (
    <div className={cn('space-y-1 p-2', className)}>
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
        <div key={i} className="flex items-center gap-3 rounded-md px-2 py-2.5">
          {avatar && <Skeleton className="size-8 shrink-0 rounded-full" />}
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className={cn('h-3', WIDTHS[i % WIDTHS.length])} />
            <Skeleton className={cn('h-2.5', WIDTHS[(i + 3) % WIDTHS.length])} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** A form: labels and fields. */
export function FormSkeleton({ fields = 5 }: { readonly fields?: number }) {
  return (
    <div className="space-y-6 px-6 py-6">
      {Array.from({ length: fields }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
        <div key={i} className="space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  )
}

/** A conversation's thread: bubbles from either side. */
export function ThreadSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <Skeleton className="size-8 rounded-full" />
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-2.5 w-24" />
        </div>
      </div>
      <div className="flex-1 space-y-5 bg-surface px-6 py-6">
        {['w-64', 'w-80', 'w-56', 'w-72'].map((width, i) => (
          <div key={width} className={cn('flex', i % 2 === 1 && 'justify-end')}>
            <Skeleton className={cn('h-14 rounded-xl', width)} />
          </div>
        ))}
      </div>
      <div className="border-t p-3">
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    </div>
  )
}

/** Cards on a grid: a dashboard. */
export function CardsSkeleton({ cards = 6 }: { readonly cards?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-12">
      {Array.from({ length: cards }, (_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
          key={i}
          className={cn(
            'space-y-3 rounded-xl border bg-card p-3',
            i < 4 ? 'md:col-span-3' : i % 3 === 1 ? 'md:col-span-4' : 'md:col-span-8',
          )}
        >
          <Skeleton className="h-3 w-32" />
          <Skeleton className={i < 4 ? 'h-8 w-16' : 'h-40 w-full'} />
        </div>
      ))}
    </div>
  )
}

/** A screen of the administration: the rows on the left, the form in the middle. */
export function StudioSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <HeaderSkeleton />
      <div className="flex min-h-0 flex-1">
        <div className="w-64 shrink-0 border-r">
          <div className="p-3">
            <Skeleton className="h-8 w-full" />
          </div>
          <RowsSkeleton rows={5} avatar={false} />
        </div>
        <div className="min-w-0 flex-1">
          <FormSkeleton />
        </div>
      </div>
    </div>
  )
}

/** A screen of a list and what is chosen in it: conversations, contacts. */
export function ListSkeleton({ detail = 'thread' }: { readonly detail?: 'thread' | 'form' }) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <HeaderSkeleton />
      <div className="flex min-h-0 flex-1">
        <div className="w-80 shrink-0 border-r">
          <div className="border-b p-2.5">
            <Skeleton className="h-8 w-full" />
          </div>
          <RowsSkeleton rows={8} />
        </div>
        {detail === 'thread' ? <ThreadSkeleton /> : <FormSkeleton />}
      </div>
    </div>
  )
}

/** A screen of cards: the dashboards. */
export function DashboardSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <HeaderSkeleton />
      <div className="min-h-0 flex-1 bg-muted/30">
        <CardsSkeleton />
      </div>
    </div>
  )
}

/** The skeleton of the screen an address names: what the app starts on. */
export function ScreenSkeletonFor({ pathname }: { readonly pathname: string }) {
  if (pathname.startsWith('/tableaux-de-bord')) return <DashboardSkeleton />
  if (/^\/(parametrage|automatisations|outils|widget)/.test(pathname)) return <StudioSkeleton />
  if (/^\/(contacts|connaissance)/.test(pathname)) return <ListSkeleton detail="form" />
  return <ListSkeleton />
}
