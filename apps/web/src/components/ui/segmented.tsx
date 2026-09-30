'use client'

import { cn } from '@/lib/utils'
import * as ToggleGroup from '@radix-ui/react-toggle-group'
import type { ReactNode } from 'react'

/**
 * One choice among a few, all in view — the options side by side in a muted well, the
 * chosen one raised. Radix's toggle group underneath: arrows move, Space chooses, and a
 * choice cannot be emptied.
 */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  disabled = false,
  className,
  'aria-label': ariaLabel,
}: {
  readonly value: T
  readonly onValueChange: (value: T) => void
  readonly options: readonly { readonly value: T; readonly label: ReactNode }[]
  readonly disabled?: boolean
  readonly className?: string
  readonly 'aria-label': string
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onValueChange(next as T)
      }}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn('inline-flex h-8 items-center gap-0.5 rounded-md bg-muted p-0.5', className)}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          className={cn(
            'inline-flex h-7 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] px-2.5 text-xs font-medium text-muted-foreground transition-colors',
            'hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            'disabled:pointer-events-none disabled:opacity-50',
            'data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs',
          )}
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}
