import { cn } from '@/lib/utils'
import type { CSSProperties, ReactNode } from 'react'

/**
 * The small tinted pills of basedb — its environment badges: a translucent ground, the
 * text in the same hue, darker in light mode and lighter in dark mode. Green is kept for
 * the primary action and for selection, so a status never borrows it: « Résolue » is
 * emerald, not primary.
 */
const TINTS = {
  zinc: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300',
  sky: 'bg-sky-500/15 text-sky-800 dark:text-sky-300',
  violet: 'bg-violet-500/15 text-violet-800 dark:text-violet-300',
  amber: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  rose: 'bg-rose-500/15 text-rose-800 dark:text-rose-300',
  emerald: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
} as const

export type Tint = keyof typeof TINTS

export function Chip({
  tint,
  children,
  className,
}: {
  readonly tint: Tint
  readonly children: ReactNode
  readonly className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-1.5 text-[0.7rem] font-medium [&>svg]:size-3',
        TINTS[tint],
        className,
      )}
    >
      {children}
    </span>
  )
}

/**
 * A colour chosen by someone — a tag's, in basedb — as basedb's option badges draw it:
 * the colour at 14 % for the ground, mixed into the text colour for the words, so that any
 * colour stays legible in both themes.
 */
export function tinted(color: string): CSSProperties {
  return {
    backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
    color: `color-mix(in oklab, ${color} 65%, var(--foreground))`,
  }
}

export function ColorBadge({
  color,
  children,
  className,
}: {
  readonly color: string
  readonly children: ReactNode
  readonly className?: string
}) {
  return (
    <span
      style={tinted(color)}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs [&>svg]:size-3',
        className,
      )}
    >
      {children}
    </span>
  )
}
