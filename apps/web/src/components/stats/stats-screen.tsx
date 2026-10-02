'use client'

import { ScreenHeader } from '@/components/app/screen-header'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { $t, $tp, formatCount, intlLocale, msg } from '@/lib/i18n'
import { messageFor } from '@/lib/messages'
import { useTitle } from '@/lib/title'
import { cn } from '@/lib/utils'
import type { InboxStats } from '@chat/contracts'
import { LoaderCircle, RefreshCw, Table2 } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useState } from 'react'

/**
 * The framing's simple counters (MVP « Pilotage »): volume, resolution by the AI, time to a
 * first answer, handoffs — over the last seven days. Full dashboards are basedb's, on views
 * of the `chat` schema.
 *
 * The chart's three series take the first three slots of the categorical palette, in fixed
 * order, stepped for each theme and checked by the dataviz validator; the aqua slot is
 * under 3:1 on white, so the numbers are always a click away (legend, tooltips, table).
 */

const SERIES = [
  {
    key: 'ai',
    label: msg('Résolues par l’IA'),
    swatch: 'bg-[#2a78d6] dark:bg-[#3987e5]',
  },
  {
    key: 'handedOff',
    label: msg('Transférées'),
    swatch: 'bg-[#eb6834] dark:bg-[#d95926]',
  },
  {
    key: 'agents',
    label: msg('Traitées par les conseillers'),
    swatch: 'bg-[#1baf7a] dark:bg-[#199e70]',
  },
] as const

type Day = InboxStats['perDay'][number]

const valuesOf = (day: Day) => ({
  ai: day.ai,
  handedOff: day.handedOff,
  agents: Math.max(day.total - day.ai - day.handedOff, 0),
})

function duration(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds < 90) return $t('{n} s', { n: seconds })
  if (seconds < 5400) return $t('{n} min', { n: Math.round(seconds / 60) })
  return $t('{n} h', { n: Math.round(seconds / 360) / 10 })
}

export function StatsScreen() {
  useTitle([$t('Statistiques')])
  const [stats, setStats] = useState<InboxStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    api
      .stats()
      .then((next) => {
        setStats(next)
        setError(null)
      })
      .catch((failure: { code?: string }) => setError(failure.code ?? 'INTERNAL_ERROR'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [])

  const rate =
    stats?.aiResolutionRate === null || stats?.aiResolutionRate === undefined
      ? '—'
      : new Intl.NumberFormat(intlLocale(), { style: 'percent' }).format(stats.aiResolutionRate)

  return (
    <>
      <ScreenHeader
        tools={
          <Button variant="ghost" size="sm" onClick={load} className="h-8 gap-1.5 text-xs">
            <RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} />
            {$t('Actualiser')}
          </Button>
        }
      >
        <span className="font-medium">{$t('Statistiques')}</span>
        <span className="text-muted-foreground">· {$t('7 derniers jours')}</span>
      </ScreenHeader>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-discret">
        <div className="mx-auto max-w-5xl space-y-6 px-6 py-6">
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {messageFor(error)}
            </div>
          )}
          {!stats && !error && (
            <div className="flex justify-center py-12">
              <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {stats && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Tile label={$t('Conversations')} value={formatCount(stats.conversations)} />
                <Tile
                  label={$t('Résolution par l’IA')}
                  value={rate}
                  hint={$t('{resolved} sur {answered} conversations où l’IA a répondu', {
                    resolved: formatCount(stats.aiResolved),
                    answered: formatCount(stats.aiAnswered),
                  })}
                />
                <Tile
                  label={$t('Première réponse')}
                  value={duration(stats.medianFirstResponseSeconds)}
                  hint={$t('médiane, IA ou conseiller')}
                />
                <Tile
                  label={$t('Transferts à un conseiller')}
                  value={formatCount(stats.handedOff)}
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <Tile small label={$t('L’IA répond')} value={formatCount(stats.open.ai)} />
                <Tile
                  small
                  label={$t('En file, sans conseiller')}
                  value={formatCount(stats.open.queue)}
                />
                <Tile small label={$t('Les vôtres')} value={formatCount(stats.open.mine)} />
              </div>

              <PerDay days={stats.perDay} />
            </>
          )}
        </div>
      </div>
    </>
  )
}

function Tile({
  label,
  value,
  hint,
  small = false,
}: {
  readonly label: string
  readonly value: string
  readonly hint?: string
  readonly small?: boolean
}) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3 shadow-xs">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          'mt-1 font-semibold tracking-tight tabular-nums',
          small ? 'text-xl' : 'text-3xl',
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  )
}

function PerDay({ days }: { readonly days: readonly Day[] }) {
  const [table, setTable] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...days.map((d) => d.total))
  const weekday = new Intl.DateTimeFormat(intlLocale(), { weekday: 'short', day: 'numeric' })
  const labelOf = (day: string) => weekday.format(new Date(`${day}T12:00:00`))
  const ticks = [max, Math.round(max / 2), 0].filter((t, i, all) => all.indexOf(t) === i)

  return (
    <section className="rounded-xl border bg-card shadow-xs">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{$t('Conversations par jour')}</h2>
        <ul className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className={cn('size-2.5 rounded-sm', s.swatch)} />
              {$t(s.label)}
            </li>
          ))}
        </ul>
        <Button
          variant={table ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setTable((t) => !t)}
          className="ml-auto h-7 gap-1.5 px-2 text-xs"
        >
          <Table2 className="size-3.5" />
          {$t('Tableau')}
        </Button>
      </header>

      {table ? (
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">{$t('Jour')}</th>
              {SERIES.map((s) => (
                <th key={s.key} className="px-4 py-2 text-right font-medium">
                  {$t(s.label)}
                </th>
              ))}
              <th className="px-4 py-2 text-right font-medium">{$t('Total')}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {days.map((day) => {
              const values = valuesOf(day)
              return (
                <tr key={day.day}>
                  <td className="px-4 py-2">{labelOf(day.day)}</td>
                  {SERIES.map((s) => (
                    <td key={s.key} className="px-4 py-2 text-right tabular-nums">
                      {values[s.key]}
                    </td>
                  ))}
                  <td className="px-4 py-2 text-right font-medium tabular-nums">{day.total}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : (
        <div className="px-4 pt-4 pb-3">
          <div className="relative flex h-48 gap-2 pl-8">
            {/* Recessive grid: three lines, labelled on the left. */}
            {ticks.map((tick) => (
              <div
                key={tick}
                className="pointer-events-none absolute right-0 left-8 border-t border-border/70"
                style={{ bottom: `${(tick / max) * 100}%` }}
              >
                <span className="absolute -top-2 -left-8 w-6 text-right text-[10px] text-muted-foreground tabular-nums">
                  {tick}
                </span>
              </div>
            ))}
            {days.map((day, index) => {
              const values = valuesOf(day)
              const segments = SERIES.filter((s) => values[s.key] > 0)
              return (
                <div
                  key={day.day}
                  role="img"
                  aria-label={`${labelOf(day.day)} : ${SERIES.map((s) => `${$t(s.label)} ${values[s.key]}`).join(', ')}`}
                  onMouseEnter={() => setHover(index)}
                  onMouseLeave={() => setHover(null)}
                  className="relative flex flex-1 flex-col justify-end"
                >
                  {/* The mark, thin, in its column: stacked from the baseline, 2px apart. */}
                  <div
                    className="mx-auto flex w-full max-w-10 flex-col-reverse gap-[2px]"
                    style={{ height: `${(day.total / max) * 100}%` }}
                  >
                    {segments.map((s, at) => (
                      <div
                        key={s.key}
                        className={cn(s.swatch, at === segments.length - 1 && 'rounded-t-[4px]')}
                        style={{ flexGrow: values[s.key], flexBasis: 0 }}
                      />
                    ))}
                  </div>
                  {hover === index && (
                    <Tooltip bottom={`calc(${(day.total / max) * 100}% + 8px)`}>
                      <div className="mb-1 font-medium">{labelOf(day.day)}</div>
                      {SERIES.map((s) => (
                        <div key={s.key} className="flex items-center gap-2">
                          <span className={cn('size-2 rounded-sm', s.swatch)} />
                          <span className="flex-1">{$t(s.label)}</span>
                          <span className="tabular-nums">{values[s.key]}</span>
                        </div>
                      ))}
                      <div className="mt-1 border-t border-background/20 pt-1 text-right tabular-nums">
                        {$tp(day.total, '{count} conversation', '{count} conversations')}
                      </div>
                    </Tooltip>
                  )}
                </div>
              )
            })}
          </div>
          <div className="mt-2 flex gap-2 pl-8">
            {days.map((day) => (
              <div key={day.day} className="flex-1 text-center text-[11px] text-muted-foreground">
                {labelOf(day.day)}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

/** basedb's tooltip: inverted, no arrow — just above the bar it tells about. */
function Tooltip({ children, bottom }: { readonly children: ReactNode; readonly bottom: string }) {
  return (
    <div
      style={{ bottom }}
      className="pointer-events-none absolute left-1/2 z-10 w-52 -translate-x-1/2 rounded-md bg-foreground px-2.5 py-2 text-xs text-background shadow-md"
    >
      {children}
    </div>
  )
}
