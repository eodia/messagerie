'use client'

import { $t, intlLocale } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { DAYS } from './controls'

/**
 * A week of opening hours, drawn: a line per day, a bar per slot — the one being edited in
 * the accent, the others quiet. Shared by the sites' preview and the hours'.
 */

export interface Slot {
  readonly key: string
  readonly days: readonly string[]
  /** `HH:MM` */
  readonly opens: string
  readonly closes: string
  readonly current?: boolean
}

export const minutesOf = (time: string): number | null => {
  const found = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (!found) return null
  const minutes = Number(found[1]) * 60 + Number(found[2])
  return minutes <= 24 * 60 ? minutes : null
}

/** The slots' hours per week. */
export function weeklyHours(slots: readonly Slot[]): number {
  let total = 0
  for (const slot of slots) {
    const opens = minutesOf(slot.opens)
    const closes = minutesOf(slot.closes)
    if (opens === null || closes === null || closes <= opens) continue
    total += ((closes - opens) / 60) * slot.days.length
  }
  return Math.round(total * 10) / 10
}

/** Whether the slots are open now, where the site is. */
export function openNow(slots: readonly Slot[], timeZone: string): boolean {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone || 'Europe/Paris',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date())
  } catch {
    return false
  }
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? ''
  const index = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(weekday)
  const day = DAYS[index]?.value
  const now =
    Number(parts.find((p) => p.type === 'hour')?.value ?? 0) * 60 +
    Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return slots.some((slot) => {
    const opens = minutesOf(slot.opens)
    const closes = minutesOf(slot.closes)
    return (
      day !== undefined &&
      slot.days.includes(day) &&
      opens !== null &&
      closes !== null &&
      now >= opens &&
      now < closes
    )
  })
}

export function WeekGrid({ slots }: { readonly slots: readonly Slot[] }) {
  const bounds = slots
    .flatMap((s) => [minutesOf(s.opens), minutesOf(s.closes)])
    .filter((m): m is number => m !== null)
  // The hours shown: those of the slots, rounded out to even hours, at least 08:00–19:00.
  const start = Math.max(0, Math.floor(Math.min(8 * 60, ...bounds) / 120) * 120)
  const end = Math.min(24 * 60, Math.ceil(Math.max(19 * 60, ...bounds) / 120) * 120)
  const span = end - start
  const ticks: number[] = []
  for (let t = start; t <= end; t += 120) ticks.push(t)
  const at = (minutes: number) => `${((minutes - start) / span) * 100}%`

  return (
    <div className="space-y-1.5">
      <div className="relative ml-9 h-4 text-[10px] text-muted-foreground tabular-nums">
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2" style={{ left: at(t) }}>
            {String(t / 60).padStart(2, '0')}h
          </span>
        ))}
      </div>
      {DAYS.map((day) => {
        const today = slots.filter((s) => s.days.includes(day.value))
        return (
          <div key={day.value} className="flex items-center gap-2">
            <span className="w-7 shrink-0 text-[11px] font-medium text-muted-foreground">
              {$t(day.label).slice(0, 3)}
            </span>
            <div className="relative h-6 flex-1 rounded-md bg-muted/60">
              {ticks.slice(1, -1).map((t) => (
                <span
                  key={t}
                  className="absolute inset-y-0 w-px bg-background/80"
                  style={{ left: at(t) }}
                />
              ))}
              {today.map((slot) => {
                const opens = minutesOf(slot.opens)
                const closes = minutesOf(slot.closes)
                if (opens === null || closes === null || closes <= opens) return null
                return (
                  <span
                    key={slot.key}
                    className={cn(
                      'absolute inset-y-0.5 flex items-center justify-center overflow-hidden rounded-[5px] px-1 text-[10px] font-medium whitespace-nowrap tabular-nums transition-[left,width] duration-300',
                      slot.current
                        ? 'bg-primary text-primary-foreground ring-1 ring-primary'
                        : 'bg-foreground/15 text-foreground/70',
                    )}
                    style={{ left: at(opens), width: `${((closes - opens) / span) * 100}%` }}
                  >
                    {slot.opens}–{slot.closes}
                  </span>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** A month, its closed days marked. */
export function MonthGrid({
  month,
  from,
  to,
}: {
  /** Any day of the month, `YYYY-MM-DD`. */
  readonly month: string
  readonly from: string
  readonly to: string
}) {
  const [year, monthIndex] = month.split('-').map(Number) as [number, number]
  const first = new Date(Date.UTC(year, monthIndex - 1, 1))
  const days = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate()
  const offset = (first.getUTCDay() + 6) % 7
  const title = new Intl.DateTimeFormat(intlLocale(), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(first)
  const iso = (d: number) =>
    `${year}-${String(monthIndex).padStart(2, '0')}-${String(d).padStart(2, '0')}`

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium first-letter:uppercase">{title}</div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted-foreground">
        {DAYS.map((d) => (
          <span key={d.value}>{$t(d.short)}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: offset }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the blanks before the 1st, in order
          <span key={`blank-${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const day = iso(i + 1)
          const closed = day >= from && day <= to
          const edge = day === from || day === to
          return (
            <span
              key={day}
              className={cn(
                'flex aspect-square items-center justify-center rounded-md text-xs tabular-nums transition-colors',
                closed
                  ? edge
                    ? 'bg-primary font-semibold text-primary-foreground'
                    : 'bg-primary/20 font-medium text-foreground'
                  : 'text-muted-foreground',
              )}
            >
              {i + 1}
            </span>
          )
        })}
      </div>
    </div>
  )
}
