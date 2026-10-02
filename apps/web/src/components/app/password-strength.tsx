'use client'

import { $t, msg } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * How strong a password reads, as it is typed — dblumi's gauge: four segments, three
 * levels, from its length and the kinds of characters it mixes. Under the minimum, weak
 * whatever it mixes. A hint, not a rule: the server refuses only what is too short.
 */

type Level = 'weak' | 'fair' | 'strong'

const LEVELS: Readonly<
  Record<Level, { label: string; bar: string; text: string; filled: number }>
> = {
  weak: {
    label: msg('Faible'),
    bar: 'bg-rose-500',
    text: 'text-rose-600 dark:text-rose-400',
    filled: 1,
  },
  fair: {
    label: msg('Correct'),
    bar: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
    filled: 2,
  },
  strong: {
    label: msg('Fort'),
    bar: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
    filled: 4,
  },
}

const SEGMENTS = 4

export function strengthOf(password: string, min: number): Level {
  if (password.length < min) return 'weak'
  let score = 0
  if (password.length >= 8) score++
  if (password.length >= 12) score++
  if (/[a-z]/.test(password)) score++
  if (/[A-Z]/.test(password)) score++
  if (/[0-9]/.test(password)) score++
  if (/[^a-zA-Z0-9]/.test(password)) score++
  return score <= 2 ? 'weak' : score <= 4 ? 'fair' : 'strong'
}

export function PasswordStrength({
  password,
  min,
}: {
  readonly password: string
  readonly min: number
}) {
  if (password === '') return null
  const level = LEVELS[strengthOf(password, min)]
  return (
    <div className="flex items-center gap-2" aria-live="polite">
      <div className="flex flex-1 gap-1" aria-hidden="true">
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed segments
            key={i}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors',
              i < level.filled ? level.bar : 'bg-muted',
            )}
          />
        ))}
      </div>
      <span className={cn('text-[11px] font-medium tracking-wide uppercase', level.text)}>
        {$t(level.label)}
      </span>
    </div>
  )
}
