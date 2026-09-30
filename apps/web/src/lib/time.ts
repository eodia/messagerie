import { $t, intlLocale } from './i18n'

/**
 * Times as an inbox shows them: the hour for today, « Hier » for yesterday, a number of
 * days after that. Always relative to a `now` the caller passes, so that a list drawn
 * once reads the same from its first row to its last.
 */

const DAY = 24 * 60 * 60 * 1000

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** `10:24` in the reader's language. */
export function clockTime(iso: string): string {
  return new Intl.DateTimeFormat(intlLocale(), { hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  )
}

/** `10:24`, `Hier`, `3 j` — the right-hand column of a conversation row. */
export function inboxTime(iso: string, now: Date): string {
  const days = Math.round((startOfDay(now) - startOfDay(new Date(iso))) / DAY)
  if (days <= 0) return clockTime(iso)
  if (days === 1) return $t('Hier')
  return $t('{count} j', { count: days })
}

/** `12 sept. 2026` in the reader's language. */
export function dayLabel(iso: string): string {
  return new Intl.DateTimeFormat(intlLocale(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso))
}
