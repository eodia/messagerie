'use client'

import { chartOption, columnTitle, labelsOf, numberText, shapeOf, valueText } from '@/lib/analytics'
import { $t, $tp } from '@/lib/i18n'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import type { AnalyticsSource, QueryResult, Visualization } from '@chat/contracts'
import { useMemo } from 'react'
import { EChart } from './echart'

/**
 * A question's result, drawn: a number on its own, a table, or a chart. What the chart
 * shows is also a table away — the numbers never hang on colour alone.
 */
export function ResultView({
  result,
  viz,
  sources,
  asTable = false,
  className,
}: {
  readonly result: QueryResult
  readonly viz: Visualization
  readonly sources: readonly AnalyticsSource[]
  /** The numbers behind the chart. */
  readonly asTable?: boolean
  readonly className?: string
}) {
  const theme = useTheme((s) => s.theme)
  const option = useMemo(
    () =>
      viz.type === 'number' || viz.type === 'table'
        ? null
        : chartOption(result, viz, sources, theme),
    [result, viz, sources, theme],
  )

  if (result.rows.length === 0) {
    return (
      <div
        className={cn(
          'flex size-full items-center justify-center text-xs text-muted-foreground',
          className,
        )}
      >
        {$t('Aucune ligne ne correspond.')}
      </div>
    )
  }

  if (viz.type === 'number' && !asTable) {
    const { measures } = shapeOf(result)
    const index = measures[0] ?? 0
    const value = result.rows[0]?.[index]
    return (
      <div className={cn('flex size-full flex-col justify-center', className)}>
        <div className="text-3xl font-semibold tracking-tight tabular-nums">
          {typeof value === 'number'
            ? numberText(value, viz.unit)
            : value == null
              ? '—'
              : String(value)}
        </div>
      </div>
    )
  }

  if (viz.type === 'table' || asTable || option === null) {
    return <ResultTable result={result} sources={sources} unit={viz.unit} className={className} />
  }

  return (
    <EChart
      option={option}
      className={className}
      label={$tp(result.rows.length, '{count} ligne', '{count} lignes')}
    />
  )
}

export function ResultTable({
  result,
  sources,
  unit,
  className,
}: {
  readonly result: QueryResult
  readonly sources: readonly AnalyticsSource[]
  readonly unit?: Visualization['unit']
  readonly className?: string
}) {
  const labels = useMemo(() => labelsOf(sources), [sources])
  const { measures } = shapeOf(result)
  return (
    <div className={cn('size-full overflow-auto scroll-discret', className)}>
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-background">
          <tr className="border-b">
            {result.columns.map((column, i) => (
              <th
                key={column.name}
                className={cn(
                  'px-2 py-1.5 text-left font-medium whitespace-nowrap text-muted-foreground',
                  measures.includes(i) && 'text-right',
                )}
              >
                {columnTitle(column.name, sources)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, r) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows of a result have no id
            <tr key={r} className="border-b border-border/60 last:border-0">
              {row.map((value, i) => {
                const column = result.columns[i]
                if (!column) return null
                return (
                  <td
                    key={column.name}
                    className={cn(
                      'px-2 py-1.5 whitespace-nowrap',
                      measures.includes(i) && 'text-right tabular-nums',
                    )}
                  >
                    {measures.includes(i) && typeof value === 'number'
                      ? numberText(value, unit)
                      : valueText(value, column.name, column.type, labels)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {result.truncated && (
        <p className="px-2 py-2 text-[11px] text-muted-foreground">
          {$t('Les 2 000 premières lignes seulement.')}
        </p>
      )}
    </div>
  )
}
