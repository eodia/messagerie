'use client'

import { Chip } from '@/components/app/chip'
import {
  PREVIOUS_LABELS,
  chartOption,
  columnTitle,
  labelsOf,
  numberText,
  rowAt,
  shapeOf,
  unitOf,
  valueText,
} from '@/lib/analytics'
import { $t, $tp, intlLocale } from '@/lib/i18n'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import type { AnalyticsSource, QueryResult, Visualization } from '@chat/contracts'
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Minus } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { EChart } from './echart'

/**
 * A question's result, drawn: a number on its own, a trend against the period before, a
 * bar towards a goal, a table, or a chart — basedb's. What a chart shows is also a table
 * away: the numbers never hang on colour alone. A click on a point, or on a group of the
 * table, gives its row: the rows behind it are a click further.
 */

/** Where a point was clicked, and the row it stands for. */
export interface PointEvent {
  readonly row: readonly unknown[]
  readonly x: number
  readonly y: number
}

const PLAIN: readonly Visualization['type'][] = ['number', 'trend', 'progress', 'table']

export function ResultView({
  result,
  viz,
  sources,
  asTable = false,
  onPoint,
  className,
}: {
  readonly result: QueryResult
  readonly viz: Visualization
  readonly sources: readonly AnalyticsSource[]
  /** The numbers behind the chart. */
  readonly asTable?: boolean
  readonly onPoint?: (event: PointEvent) => void
  readonly className?: string
}) {
  const theme = useTheme((s) => s.theme)
  const option = useMemo(
    () => (PLAIN.includes(viz.type) ? null : chartOption(result, viz, sources, theme)),
    [result, viz, sources, theme],
  )

  if (result.rows.length === 0) {
    return <Empty className={className}>{$t('Aucune ligne ne correspond.')}</Empty>
  }
  if (!asTable) {
    if (viz.type === 'number') return <NumberView result={result} viz={viz} className={className} />
    if (viz.type === 'trend') {
      return <TrendView result={result} viz={viz} sources={sources} className={className} />
    }
    if (viz.type === 'progress') {
      return <ProgressView result={result} viz={viz} className={className} />
    }
  }
  if (viz.type === 'table' || asTable || option === null) {
    return (
      <ResultTable
        result={result}
        sources={sources}
        unit={viz.unit}
        onPoint={onPoint}
        className={className}
      />
    )
  }
  return (
    <EChart
      option={option}
      className={className}
      label={$tp(result.rows.length, '{count} ligne', '{count} lignes')}
      onPoint={
        onPoint &&
        ((point) => {
          const row = rowAt(result, sources, point.name, point.series)
          if (row) onPoint({ row, x: point.x, y: point.y })
        })
      }
    />
  )
}

function Empty({
  children,
  className,
}: { readonly children: ReactNode; readonly className?: string }) {
  return (
    <div
      className={cn(
        'flex size-full items-center justify-center text-center text-xs text-muted-foreground',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** The first measure of a result: its column's place. */
const measureOf = (result: QueryResult) => shapeOf(result).measures[0]

function said(value: unknown, unit: Visualization['unit']): string {
  if (typeof value === 'number') return numberText(value, unit)
  return value === null || value === undefined ? '—' : String(value)
}

/** One number, as large as its card lets it be. */
function NumberView({
  result,
  viz,
  className,
}: {
  readonly result: QueryResult
  readonly viz: Visualization
  readonly className?: string
}) {
  const index = measureOf(result) ?? 0
  // Grouped, the number is the last group's: this week's, this month's.
  const value = result.rows[result.rows.length - 1]?.[index]
  return (
    <div className={cn('@container flex size-full flex-col justify-center', className)}>
      <p className="truncate text-3xl font-semibold tracking-tight tabular-nums @[200px]:text-4xl @[360px]:text-5xl">
        {said(value, viz.unit)}
      </p>
    </div>
  )
}

/** Its last period, and how it compares with the one before — up or down, good or bad. */
function TrendView({
  result,
  viz,
  sources,
  className,
}: {
  readonly result: QueryResult
  readonly viz: Visualization
  readonly sources: readonly AnalyticsSource[]
  readonly className?: string
}) {
  const labels = useMemo(() => labelsOf(sources), [sources])
  const measure = measureOf(result)
  const time = result.columns.findIndex((c) => {
    const unit = unitOf(c.name)
    return unit !== null && unit !== 'weekday' && unit !== 'hour_of_day'
  })
  if (measure === undefined || time < 0) {
    return <NumberView result={result} viz={viz} className={className} />
  }
  const rows = result.rows.filter((r) => r[time] !== null && r[time] !== undefined)
  const last = rows[rows.length - 1]
  const previous = rows[rows.length - 2]
  const timeColumn = result.columns[time] as QueryResult['columns'][number]
  const current = typeof last?.[measure] === 'number' ? (last[measure] as number) : null
  if (!last || current === null) {
    return <Empty className={className}>{$t('Aucune valeur pour la dernière période.')}</Empty>
  }
  const before = typeof previous?.[measure] === 'number' ? (previous[measure] as number) : null
  const unit = unitOf(timeColumn.name)
  const previousLabel =
    (unit && PREVIOUS_LABELS[unit] ? $t(PREVIOUS_LABELS[unit]) : null) ??
    (previous ? valueText(previous[time], timeColumn.name, timeColumn.type, labels) : '')
  return (
    <div className={cn('@container flex size-full flex-col justify-center gap-1', className)}>
      <p className="truncate text-3xl font-semibold tracking-tight tabular-nums @[200px]:text-4xl @[360px]:text-5xl">
        {numberText(current, viz.unit)}
      </p>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
        <span>{valueText(last[time], timeColumn.name, timeColumn.type, labels)}</span>
        {before !== null && (
          <Delta
            current={current}
            previous={before}
            label={previousLabel}
            unit={viz.unit}
            invert={viz.invert === true}
          />
        )}
      </div>
    </div>
  )
}

function Delta({
  current,
  previous,
  label,
  unit,
  invert,
}: {
  readonly current: number
  readonly previous: number
  readonly label: string
  readonly unit: Visualization['unit']
  /** A fall is good news: a delay, a handoff. */
  readonly invert: boolean
}) {
  const flat = current === previous
  const up = current > previous
  const good = invert ? !up : up
  const change = previous === 0 ? null : (current - previous) / Math.abs(previous)
  const Icon = flat ? Minus : up ? ArrowUp : ArrowDown
  return (
    <span className="flex flex-wrap items-center gap-x-1">
      <Chip tint={flat ? 'zinc' : good ? 'emerald' : 'rose'} className="tabular-nums">
        <Icon aria-label={flat ? $t('stable') : up ? $t('en hausse') : $t('en baisse')} />
        {change === null
          ? '—'
          : `${new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 1 }).format(Math.abs(change * 100))} %`}
      </Chip>
      <span>{$t('vs {label} : {previous}', { label, previous: numberText(previous, unit) })}</span>
    </span>
  )
}

/** A bar towards a goal. */
function ProgressView({
  result,
  viz,
  className,
}: {
  readonly result: QueryResult
  readonly viz: Visualization
  readonly className?: string
}) {
  const index = measureOf(result)
  if (index === undefined)
    return <Empty className={className}>{$t('Aucune mesure à afficher.')}</Empty>
  const goal = typeof viz.goal === 'number' && viz.goal !== 0 ? viz.goal : null
  if (goal === null) {
    return (
      <Empty className={className}>{$t('Fixez un objectif dans les réglages du graphique.')}</Empty>
    )
  }
  const value = Number(result.rows[result.rows.length - 1]?.[index] ?? 0)
  const share = Math.max(0, Math.min(1, value / goal))
  const reached = value >= goal
  return (
    <div className={cn('flex size-full flex-col justify-center gap-2', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-2xl font-semibold tracking-tight tabular-nums">
          {numberText(value, viz.unit)}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {Math.round((value / goal) * 100)} %
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div
          className={cn(
            'h-full rounded-full transition-[width]',
            reached ? 'bg-emerald-500' : 'bg-primary',
          )}
          style={{ width: `${share * 100}%` }}
        />
      </div>
      <div className="flex flex-wrap justify-between gap-x-3 text-[11px] text-muted-foreground">
        <span>
          {reached
            ? $t('Objectif atteint')
            : $t('Reste {left}', { left: numberText(goal - value, viz.unit) })}
        </span>
        <span>
          {viz.goalLabel || $t('Objectif')} {numberText(goal, viz.unit)}
        </span>
      </div>
    </div>
  )
}

// ── Tables ──────────────────────────────────────────────────────────────────

const compare = (a: unknown, b: unknown) => {
  if (a === b) return 0
  if (a === null || a === undefined) return 1
  if (b === null || b === undefined) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), intlLocale(), { numeric: true })
}

/**
 * The rows, as a reader likes them: the header stays as they scroll, a click on a column
 * sorts by it — up, down, back as they came —, numbers to the right.
 */
export function ResultTable({
  result,
  sources,
  unit,
  onPoint,
  className,
}: {
  readonly result: QueryResult
  readonly sources: readonly AnalyticsSource[]
  readonly unit?: Visualization['unit']
  readonly onPoint?: (event: PointEvent) => void
  readonly className?: string
}) {
  const labels = useMemo(() => labelsOf(sources), [sources])
  const { measures } = shapeOf(result)
  const grouped = measures.length > 0 && measures.length < result.columns.length
  const [sort, setSort] = useState<{ readonly index: number; readonly desc: boolean } | null>(null)
  const rows = useMemo(() => {
    const indexed = result.rows.map((row, i) => ({ row, i }))
    if (sort === null) return indexed
    return [...indexed].sort(
      (x, y) => (sort.desc ? -1 : 1) * compare(x.row[sort.index], y.row[sort.index]),
    )
  }, [result, sort])
  const numeric = (i: number) =>
    measures.includes(i) || (result.columns[i]?.type === 'number' && !grouped)

  return (
    <div className={cn('size-full overflow-auto scroll-discret', className)}>
      <table className="w-full border-separate border-spacing-0 text-xs">
        <thead className="sticky top-0 z-10 bg-card">
          <tr>
            {result.columns.map((column, i) => {
              const sorted = sort?.index === i ? sort : null
              return (
                <th
                  key={column.name}
                  aria-sort={sorted ? (sorted.desc ? 'descending' : 'ascending') : undefined}
                  className={cn(
                    'border-b px-2.5 py-2 text-left font-medium whitespace-nowrap text-muted-foreground',
                    numeric(i) && 'text-right',
                  )}
                >
                  <button
                    type="button"
                    className={cn(
                      'inline-flex items-center gap-1 rounded hover:text-foreground',
                      sorted && 'text-foreground',
                    )}
                    onClick={() =>
                      setSort((s) =>
                        s?.index !== i
                          ? { index: i, desc: numeric(i) }
                          : s.desc === numeric(i)
                            ? { index: i, desc: !s.desc }
                            : null,
                      )
                    }
                  >
                    {columnTitle(column.name, sources)}
                    {sorted ? (
                      sorted.desc ? (
                        <ChevronDown className="size-3" />
                      ) : (
                        <ChevronUp className="size-3" />
                      )
                    ) : (
                      <ChevronDown className="size-3 opacity-0" aria-hidden="true" />
                    )}
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ row, i: r }) => (
            <tr key={r} className="group/row hover:bg-muted/50">
              {row.map((value, i) => {
                const column = result.columns[i]
                if (!column) return null
                const opens = onPoint !== undefined && grouped && !measures.includes(i)
                const text =
                  measures.includes(i) && typeof value === 'number'
                    ? numberText(value, unit)
                    : valueText(value, column.name, column.type, labels)
                return (
                  <td
                    key={column.name}
                    className={cn(
                      'max-w-72 truncate border-b border-border/60 px-2.5 py-1.5 group-last/row:border-0',
                      numeric(i) && 'text-right tabular-nums',
                      (value === null || value === undefined) && 'text-muted-foreground/70',
                    )}
                  >
                    {opens ? (
                      <button
                        type="button"
                        className="max-w-full truncate text-left hover:text-primary hover:underline"
                        onClick={(e) => onPoint({ row, x: e.clientX, y: e.clientY })}
                      >
                        {text}
                      </button>
                    ) : (
                      text
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {result.truncated && (
        <p className="px-2.5 py-2 text-[11px] text-muted-foreground">
          {$t('Les 2 000 premières lignes seulement.')}
        </p>
      )}
    </div>
  )
}
