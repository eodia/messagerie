import type { Closure, OpeningSlot } from './settings.js'

/**
 * Whether agents answer right now on a site, and when they next will — in the SITE's time
 * zone, not the server's: a site in Paris opens at 9 in Paris, summer and winter alike.
 */

export interface Availability {
  /** Agents answer now. */
  readonly open: boolean
  /** The exceptional closure in force today, if any. */
  readonly closure: Closure | null
  /** When agents next answer; null when nothing opens within two weeks. */
  readonly nextOpening: Date | null
}

const WEEKDAY: Readonly<Record<string, number>> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
}

interface LocalTime {
  /** `YYYY-MM-DD` */
  readonly date: string
  readonly weekday: number
  readonly minutes: number
}

const formats = new Map<string, Intl.DateTimeFormat>()
function formatIn(timezone: string): Intl.DateTimeFormat {
  let format = formats.get(timezone)
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    })
    formats.set(timezone, format)
  }
  return format
}

function localTime(at: Date, timezone: string): LocalTime {
  const parts = Object.fromEntries(
    formatIn(timezone)
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  )
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAY[parts.weekday ?? 'Mon'] ?? 1,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  }
}

/** The instant a wall-clock time of `timezone` names — right across a change of hour. */
function instantOf(date: string, minutes: number, timezone: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  const wall = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, 0, minutes)
  let guess = wall
  for (let pass = 0; pass < 2; pass++) {
    const seen = localTime(new Date(guess), timezone)
    const [y, m, d] = seen.date.split('-').map(Number)
    const shown = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, seen.minutes)
    guess += wall - shown
  }
  return new Date(guess)
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days))
    .toISOString()
    .slice(0, 10)
}

const closureOn = (closures: readonly Closure[], date: string): Closure | null =>
  closures.find((c) => c.from <= date && date <= c.to) ?? null

/**
 * Without any slot, a site has no opening hours: agents are taken to answer at all times —
 * a new site answers until someone sets its hours.
 */
export function availability(
  slots: readonly OpeningSlot[],
  closures: readonly Closure[],
  timezone: string,
  now: Date = new Date(),
): Availability {
  const today = localTime(now, timezone)
  const closure = closureOn(closures, today.date)
  if (slots.length === 0) {
    return { open: closure === null, closure, nextOpening: closure === null ? now : null }
  }
  const open =
    closure === null &&
    slots.some(
      (s) => s.days.includes(today.weekday) && s.opens <= today.minutes && today.minutes < s.closes,
    )
  if (open) return { open, closure, nextOpening: now }

  for (let offset = 0; offset < 15; offset++) {
    const date = addDays(today.date, offset)
    if (closureOn(closures, date)) continue
    const weekday = ((today.weekday - 1 + offset) % 7) + 1
    const opens = slots
      .filter((s) => s.days.includes(weekday) && (offset > 0 || s.opens > today.minutes))
      .map((s) => s.opens)
      .sort((a, b) => a - b)[0]
    if (opens !== undefined) return { open, closure, nextOpening: instantOf(date, opens, timezone) }
  }
  return { open, closure, nextOpening: null }
}
