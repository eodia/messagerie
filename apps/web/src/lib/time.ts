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

/**
 * When a conversation on hold comes back, as short as can be read: `15:30` today,
 * `demain 09:00`, `lun. 09:00` within the week, `12 oct. 09:00` after.
 */
export function wakeLabel(iso: string, now: Date): string {
  const at = new Date(iso)
  const days = Math.round((startOfDay(at) - startOfDay(now)) / DAY)
  const time = clockTime(iso)
  if (days <= 0) return time
  if (days === 1) return $t('demain {time}', { time })
  const day = new Intl.DateTimeFormat(
    intlLocale(),
    days < 7 ? { weekday: 'short' } : { day: 'numeric', month: 'short' },
  ).format(at)
  return `${day} ${time}`
}

/** The usual times to put a conversation on hold until, from `now` — none twice. */
export function snoozeChoices(
  now: Date,
): readonly { readonly key: string; readonly label: string; readonly until: Date }[] {
  const morning = (days: number) => {
    const at = new Date(now)
    at.setDate(at.getDate() + days)
    at.setHours(9, 0, 0, 0)
    return at
  }
  const later = new Date(now.getTime() + 3 * 3600_000)
  later.setMinutes(Math.ceil(later.getMinutes() / 15) * 15, 0, 0)
  const toMonday = (8 - now.getDay()) % 7 || 7
  const all = [
    { key: 'later', label: $t('Dans 3 heures'), until: later },
    { key: 'tomorrow', label: $t('Demain matin'), until: morning(1) },
    { key: 'monday', label: $t('Lundi matin'), until: morning(toMonday) },
    { key: 'week', label: $t('Dans une semaine'), until: morning(7) },
  ]
  return all.filter(
    (choice, i) => all.findIndex((c) => c.until.getTime() === choice.until.getTime()) === i,
  )
}

/** `12 sept. 2026` in the reader's language. */
export function dayLabel(iso: string): string {
  return new Intl.DateTimeFormat(intlLocale(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso))
}
