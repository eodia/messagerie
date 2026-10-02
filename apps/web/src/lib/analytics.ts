import type {
  AggregateFunction,
  AnalyticsSource,
  BuilderQuery,
  ColumnType,
  FilterOperator,
  QueryResult,
  TimeUnit,
  Visualization,
  VisualizationType,
} from '@chat/contracts'
import type { EChartsOption } from 'echarts'
import { $t, intlLocale, msg } from './i18n'

/**
 * The dashboards' words and charts (D22): what the builder offers, said in French; a
 * result read as dimensions and measures; the chart drawn from it, in the categorical
 * palette — fixed order, each theme its own steps.
 */

export const PALETTE = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
} as const

/**
 * Values whose colour says something — a mood, a verdict: theirs whatever their rank, the
 * status hues kept for them. Each light and dark.
 */
const MEANINGFUL: Readonly<Record<string, readonly [string, string]>> = {
  negative: ['#e34948', '#e66767'],
  rejected: ['#e34948', '#e66767'],
  positive: ['#1baf7a', '#199e70'],
  accepted: ['#1baf7a', '#199e70'],
  neutral: ['#a1a1aa', '#71717a'],
  edited: ['#eda100', '#c98500'],
}

const INK = {
  light: { text: '#71717a', strong: '#18181b', line: '#e4e4e7', surface: '#ffffff' },
  dark: { text: '#a1a1aa', strong: '#f4f4f5', line: '#27272a', surface: '#18181b' },
} as const

export const AGGREGATE_LABELS: Readonly<Record<AggregateFunction, string>> = {
  count: msg('Nombre de lignes'),
  distinct: msg('Nombre de valeurs distinctes'),
  sum: msg('Somme'),
  avg: msg('Moyenne'),
  median: msg('Médiane'),
  min: msg('Minimum'),
  max: msg('Maximum'),
  share: msg('Part des « oui » (%)'),
}

/** What each aggregate asks of its column. */
export const AGGREGATE_TYPES: Readonly<Record<AggregateFunction, readonly ColumnType[] | null>> = {
  count: null,
  distinct: ['text', 'number', 'date', 'boolean'],
  sum: ['number'],
  avg: ['number'],
  median: ['number'],
  min: ['number', 'date'],
  max: ['number', 'date'],
  share: ['boolean'],
}

export const UNIT_LABELS: Readonly<Record<TimeUnit, string>> = {
  hour: msg('par heure'),
  day: msg('par jour'),
  week: msg('par semaine'),
  month: msg('par mois'),
  year: msg('par année'),
  weekday: msg('par jour de la semaine'),
  hour_of_day: msg('par heure de la journée'),
}

export const OPERATORS_BY_TYPE: Readonly<Record<ColumnType, readonly FilterOperator[]>> = {
  text: ['is', 'is_not', 'contains', 'empty', 'not_empty'],
  number: ['gt', 'lt', 'between', 'empty', 'not_empty'],
  date: ['last', 'gt', 'lt', 'between', 'empty', 'not_empty'],
  boolean: ['true', 'false'],
}

export const OPERATOR_LABELS: Readonly<Record<FilterOperator, string>> = {
  is: msg('est'),
  is_not: msg('n’est pas'),
  contains: msg('contient'),
  empty: msg('est vide'),
  not_empty: msg('n’est pas vide'),
  gt: msg('après / plus de'),
  lt: msg('avant / moins de'),
  between: msg('entre'),
  last: msg('dans les derniers'),
  true: msg('oui'),
  false: msg('non'),
}

export const VIZ_LABELS: Readonly<Record<VisualizationType, string>> = {
  number: msg('Nombre'),
  table: msg('Tableau'),
  bar: msg('Barres'),
  row: msg('Barres horizontales'),
  line: msg('Courbe'),
  area: msg('Aire'),
  pie: msg('Camembert'),
}

/** A new question: the last thirty days, counted day by day — a chart at once. */
export const emptyQuery = (source = 'conversations'): BuilderQuery => ({
  source,
  filters: [{ column: 'created_at', op: 'last', values: ['30', 'days'] }],
  aggregations: [{ fn: 'count' }],
  breakouts: [{ column: 'created_at', unit: 'day' }],
})

// ── Values, said ────────────────────────────────────────────────────────────

const UNITS: readonly TimeUnit[] = [
  'hour',
  'day',
  'week',
  'month',
  'year',
  'weekday',
  'hour_of_day',
]

/** The unit a result column was grouped by: `created_at_day` → `day`. */
export function unitOf(column: string): TimeUnit | null {
  for (const unit of [...UNITS].sort((a, b) => b.length - a.length)) {
    if (column.endsWith(`_${unit}`)) return unit
  }
  return null
}

const WEEKDAYS = [
  msg('lundi'),
  msg('mardi'),
  msg('mercredi'),
  msg('jeudi'),
  msg('vendredi'),
  msg('samedi'),
  msg('dimanche'),
]

export function durationText(seconds: number): string {
  if (seconds < 90) return $t('{n} s', { n: Math.round(seconds) })
  if (seconds < 5400) return $t('{n} min', { n: Math.round(seconds / 60) })
  if (seconds < 172_800) return $t('{n} h', { n: Math.round(seconds / 360) / 10 })
  return $t('{n} j', { n: Math.round(seconds / 8640) / 10 })
}

export function numberText(value: number, unit: Visualization['unit'] = ''): string {
  if (unit === 's') return durationText(value)
  const formatted = new Intl.NumberFormat(intlLocale(), {
    maximumFractionDigits: Math.abs(value) < 10 ? 2 : Math.abs(value) < 1000 ? 1 : 0,
  }).format(value)
  if (unit === '%') return `${formatted} %`
  if (unit === '€') return `${formatted} €`
  return formatted
}

/** A value of a column, as a reader says it: a status's label, a day, a weekday. */
export function valueText(
  value: unknown,
  column: string,
  type: ColumnType,
  labels: ReadonlyMap<string, ReadonlyMap<string, string>>,
): string {
  if (value === null || value === undefined) return $t('(vide)')
  const unit = unitOf(column)
  if (unit === 'weekday') return $t(WEEKDAYS[Number(value) - 1] ?? String(value))
  if (unit === 'hour_of_day') return $t('{n} h', { n: Number(value) })
  if (type === 'date' || unit) {
    const date = new Date(String(value))
    if (Number.isNaN(date.getTime())) return String(value)
    const options: Intl.DateTimeFormatOptions =
      unit === 'month'
        ? { month: 'short', year: 'numeric' }
        : unit === 'year'
          ? { year: 'numeric' }
          : unit === 'hour'
            ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
            : unit === 'day' || unit === 'week'
              ? { day: 'numeric', month: 'short' }
              : { dateStyle: 'medium', timeStyle: 'short' }
    const said = new Intl.DateTimeFormat(intlLocale(), options).format(date)
    return unit === 'week' ? $t('sem. du {date}', { date: said }) : said
  }
  if (type === 'boolean') return value === true ? $t('oui') : $t('non')
  if (typeof value === 'number') return numberText(value)
  const label = labels.get(column)?.get(String(value))
  return label ? $t(label) : String(value)
}

/** The value labels of every source column, by its name: `status` → `ai` → « Avec l’IA ». */
export function labelsOf(sources: readonly AnalyticsSource[]): Map<string, Map<string, string>> {
  const labels = new Map<string, Map<string, string>>()
  for (const source of sources) {
    for (const column of source.columns) {
      if (!column.values) continue
      const known = labels.get(column.name) ?? new Map()
      for (const v of column.values) known.set(v.value, v.label)
      labels.set(column.name, known)
    }
  }
  return labels
}

/** A result column's title: its source column's label, or what an aggregate says. */
export function columnTitle(column: string, sources: readonly AnalyticsSource[]): string {
  if (column === 'count') return $t('Nombre')
  const unit = unitOf(column)
  const base = unit ? column.slice(0, -(unit.length + 1)) : column
  const [fn, ...rest] = base.split('_')
  if (fn && fn in AGGREGATE_LABELS && rest.length > 0) {
    const named = columnTitle(rest.join('_'), sources)
    return `${$t(AGGREGATE_LABELS[fn as AggregateFunction])} · ${named}`
  }
  for (const source of sources) {
    const found = source.columns.find((c) => c.name === base)
    if (found) return unit ? `${$t(found.label)} (${$t(UNIT_LABELS[unit])})` : $t(found.label)
  }
  return column.replace(/_/g, ' ')
}

// ── The chart ───────────────────────────────────────────────────────────────

interface Shape {
  readonly dimensions: number[]
  readonly measures: number[]
}

/** Which columns name things and which are measured: the numbers last, as grouped. */
export function shapeOf(result: QueryResult): Shape {
  const dimensions: number[] = []
  const measures: number[] = []
  result.columns.forEach((column, index) => {
    const timeGroup = unitOf(column.name) === 'weekday' || unitOf(column.name) === 'hour_of_day'
    if (column.type === 'number' && !timeGroup) measures.push(index)
    else dimensions.push(index)
  })
  return { dimensions, measures }
}

export function chartOption(
  result: QueryResult,
  viz: Visualization,
  sources: readonly AnalyticsSource[],
  theme: 'light' | 'dark',
): EChartsOption | null {
  const { dimensions, measures } = shapeOf(result)
  if (measures.length === 0 || result.rows.length === 0) return null
  const labels = labelsOf(sources)
  const ink = INK[theme]
  const colors = [...PALETTE[theme]]
  const col = (i: number) => result.columns[i] as QueryResult['columns'][number]
  const say = (row: readonly unknown[], i: number) =>
    valueText(row[i], col(i).name, col(i).type, labels)
  const format = (value: unknown) =>
    typeof value === 'number' ? numberText(value, viz.unit) : String(value ?? '')
  const axisText = { color: ink.text, fontSize: 11 }
  const tooltip = {
    trigger: viz.type === 'pie' ? ('item' as const) : ('axis' as const),
    backgroundColor: ink.strong,
    borderWidth: 0,
    textStyle: { color: ink.surface, fontSize: 12 },
    valueFormatter: (value: unknown) => format(value),
  }

  if (viz.type === 'pie') {
    const d = dimensions[0]
    const m = measures[0] as number
    return {
      color: colors,
      tooltip,
      legend: { bottom: 0, type: 'scroll', textStyle: axisText, icon: 'circle', itemWidth: 8 },
      series: [
        {
          type: 'pie',
          radius: ['45%', '72%'],
          center: ['50%', '45%'],
          // A 2px surface gap between the parts.
          itemStyle: { borderColor: ink.surface, borderWidth: 2, borderRadius: 4 },
          label: { show: false },
          data: result.rows.map((row) => {
            const meaning = d === undefined ? undefined : MEANINGFUL[String(row[d])]
            return {
              name: d === undefined ? '' : say(row, d),
              value: Number(row[m] ?? 0),
              ...(meaning ? { itemStyle: { color: meaning[theme === 'dark' ? 1 : 0] } } : {}),
            }
          }),
        },
      ],
    }
  }

  const horizontal = viz.type === 'row'
  const category = dimensions[0]
  const categories = [
    ...new Set(result.rows.map((row) => (category === undefined ? '' : say(row, category)))),
  ]
  let series: { name: string; data: (number | null)[] }[]
  const second = dimensions[1]
  if (second !== undefined && measures.length === 1) {
    // One series per value of the second dimension — pivoted.
    const m = measures[0] as number
    const keys = [...new Set(result.rows.map((row) => say(row, second)))]
    series = keys.map((key) => ({
      name: key,
      data: categories.map((c) => {
        const row = result.rows.find(
          (r) => (category === undefined ? '' : say(r, category)) === c && say(r, second) === key,
        )
        return row ? Number(row[m] ?? 0) : null
      }),
    }))
  } else {
    series = measures.map((m) => ({
      name: columnTitle(col(m).name, sources),
      data: result.rows.map((row) => (row[m] === null ? null : Number(row[m]))),
    }))
  }
  const line = viz.type === 'line' || viz.type === 'area'
  // One series of bars over values that mean something: each bar in its value's colour.
  const meanings =
    series.length === 1 && category !== undefined && !line
      ? result.rows.map((row) => MEANINGFUL[String(row[category])])
      : []
  const painted = (data: (number | null)[]) =>
    meanings.some(Boolean)
      ? data.map((value, i) => {
          const meaning = meanings[i]
          return meaning
            ? { value, itemStyle: { color: meaning[theme === 'dark' ? 1 : 0] } }
            : value
        })
      : data
  const valueAxis = {
    type: 'value' as const,
    axisLabel: { ...axisText, formatter: (v: number) => format(v) },
    splitLine: { lineStyle: { color: ink.line } },
  }
  const categoryAxis = {
    type: 'category' as const,
    data: horizontal ? [...categories].reverse() : categories,
    axisLabel: { ...axisText, hideOverlap: true },
    axisLine: { lineStyle: { color: ink.line } },
    axisTick: { show: false },
  }
  return {
    color: colors,
    tooltip,
    legend:
      series.length > 1
        ? {
            top: 0,
            type: 'scroll',
            textStyle: axisText,
            icon: 'roundRect',
            itemWidth: 10,
            itemHeight: 10,
          }
        : undefined,
    grid: { left: 8, right: 16, top: series.length > 1 ? 32 : 12, bottom: 8, containLabel: true },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    series: series.map((s) => ({
      name: s.name,
      type: line ? ('line' as const) : ('bar' as const),
      data: horizontal ? [...painted(s.data)].reverse() : painted(s.data),
      stack: viz.stacked ? 'all' : undefined,
      smooth: line ? 0.25 : undefined,
      symbolSize: line ? 6 : undefined,
      lineStyle: line ? { width: 2 } : undefined,
      areaStyle: viz.type === 'area' ? { opacity: 0.15 } : undefined,
      barMaxWidth: 28,
      // Thin marks, rounded at their end, 2px apart when stacked.
      itemStyle: line
        ? undefined
        : {
            borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0],
            borderColor: viz.stacked ? ink.surface : undefined,
            borderWidth: viz.stacked ? 1 : 0,
          },
    })),
  }
}
