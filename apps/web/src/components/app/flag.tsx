'use client'

import 'flag-icons/css/flag-icons.min.css'
import { countryName } from '@/lib/place'
import { cn } from '@/lib/utils'

/**
 * A country's flag, drawn — not the emoji, which Windows writes as two letters. Only the
 * flags shown are fetched.
 */
export function Flag({
  country,
  className,
}: {
  readonly country: string | null
  readonly className?: string
}) {
  const code = country?.toLowerCase() ?? ''
  if (!/^[a-z]{2}$/.test(code)) return null
  return (
    <span
      role="img"
      aria-label={countryName(code)}
      className={cn(
        'fi',
        `fi-${code}`,
        'shrink-0 rounded-[2px] bg-cover ring-1 ring-border',
        className,
      )}
    />
  )
}
