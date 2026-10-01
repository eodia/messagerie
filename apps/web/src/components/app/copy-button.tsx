'use client'

import { Hint } from '@/components/ui/tooltip'
import { $t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Check, Copy } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'

/** Copies `text` to the clipboard, and says so: the icon turns to a check for a moment. */
export function useCopy(text: string): { readonly copied: boolean; readonly copy: () => void } {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return {
    copied,
    copy: () => {
      void navigator.clipboard?.writeText(text).then(() => {
        setCopied(true)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), 1600)
      })
    },
  }
}

/**
 * A small copy button, quiet until hovered — or labelled (« Copier »), where copying is the
 * point of the place it sits in.
 */
export function CopyButton({
  text,
  label = $t('Copier'),
  children,
  className,
}: {
  readonly text: string
  readonly label?: string
  /** A visible label beside the icon; none for the icon alone. */
  readonly children?: ReactNode
  readonly className?: string
}) {
  const { copied, copy } = useCopy(text)
  const Icon = copied ? Check : Copy
  return (
    <Hint label={copied ? $t('Copié') : label}>
      <button
        type="button"
        onClick={copy}
        aria-label={label}
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
          children ? 'h-7 px-2 text-xs font-medium' : 'size-6 justify-center',
          copied && 'text-emerald-700 dark:text-emerald-400',
          className,
        )}
      >
        <Icon
          key={String(copied)}
          className="size-3.5 animate-in zoom-in-75 duration-200"
          aria-hidden="true"
        />
        {children && <span aria-live="polite">{copied ? $t('Copié') : children}</span>}
      </button>
    </Hint>
  )
}
