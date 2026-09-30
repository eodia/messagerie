'use client'

import { cn } from '@/lib/utils'
import { type ReactNode, useSyncExternalStore } from 'react'

const subscribeNothing = () => () => {}

/** ⌘ on a Mac, Ctrl elsewhere — read on the client only, where the platform is known. */
export function useModKey(): string {
  return useSyncExternalStore(
    subscribeNothing,
    () => (/Mac|iPhone|iPad/u.test(navigator.userAgent) ? '⌘' : 'Ctrl'),
    () => 'Ctrl',
  )
}

/**
 * A key, drawn as one. `inverse` is for a tooltip, whose dark ground the muted key would
 * vanish into.
 */
export function Kbd({
  children,
  inverse = false,
  className,
}: {
  readonly children: ReactNode
  readonly inverse?: boolean
  readonly className?: string
}) {
  return (
    <kbd
      className={cn(
        'pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center gap-0.5 rounded border px-1 font-mono text-[0.65rem] font-medium',
        inverse
          ? 'border-background/25 bg-background/15 text-background'
          : 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
