'use client'

import { cn } from '@/lib/utils'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import type * as React from 'react'

const TooltipProvider = TooltipPrimitive.Provider
const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger

function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'z-50 overflow-hidden rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background shadow-md',
          'data-[state=delayed-open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  )
}

/**
 * The app's tooltip on one element — `<Hint label={$t('…')}><Button … /></Hint>` — never a
 * native `title`, which the browser draws in its own style, after its own delay. Without a
 * label the element comes back as it is. A disabled button raises no pointer events: when the
 * tooltip must still say why, it hangs on a wrapping `<span>`.
 */
function Hint({
  label,
  side,
  align,
  children,
}: {
  readonly label: React.ReactNode
  readonly side?: React.ComponentProps<typeof TooltipPrimitive.Content>['side']
  readonly align?: React.ComponentProps<typeof TooltipPrimitive.Content>['align']
  readonly children: React.ReactElement
}) {
  if (label === undefined || label === null || label === false || label === '') return children
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} align={align} className="max-w-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export { Hint, Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
