'use client'

import { cn } from '@/lib/utils'
import * as LabelPrimitive from '@radix-ui/react-label'
import type * as React from 'react'

function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'select-none text-sm font-medium leading-none text-muted-foreground',
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-60',
        className,
      )}
      {...props}
    />
  )
}

export { Label }
