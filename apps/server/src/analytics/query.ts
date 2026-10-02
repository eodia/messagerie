import type {
  AggregateFunction,
  BuilderQuery,
  ColumnType,
  FilterOperator,
  QueryAggregation,
  QueryBreakout,
  QueryFilter,
  Question,
  AnalyticsSource as Source,
  TimeUnit,
  Visualization,
} from '@chat/contracts'
import { Refusal } from '../refusal.js'
import { sourceOf } from './catalog.js'

/**
 * A question built by choosing, made SQL (D22): every name taken from the catalogue,
 * every value a parameter. What the builder cannot say is written in SQL instead.
 */

const MAX_FILTERS = 20
const MAX_AGGREGATIONS = 6
const MAX_BREAKOUTS = 2
export const ROW_LIMIT = 2000
const SQL_MAX = 20_000

const AGGREGATES: readonly AggregateFunction[] = [
  'count',
  'distinct',
  'sum',
  'avg',
  'median',
  'min',
  'max',
  'share',
]
const UNITS: readonly TimeUnit[] = [
  'hour',
  'day',
  'week',
  'month',
  'year',
  'weekday',
  'hour_of_day',
]
const OPERATORS: readonly FilterOperator[] = [
  'is',
  'is_not',
  'contains',
  'empty',
  'not_empty',
  'gt',
  'lt',
  'between',
  'last',
  'at',
  'true',
  'false',
]
const VIZ = ['number', 'trend', 'progress', 'table', 'bar', 'row', 'line', 'area', 'pie'] as const

function invalid(reason: string): never {
  throw new Refusal('QUERY_INVALID', 400, { reason })
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

function columnOf(source: Source, name: unknown): { name: string; type: ColumnType } {
  const column = source.columns.find((c) => c.name === name)
  if (!column) invalid('column')
  return column
}

function readVisualization(raw: unknown): Visualization {
  const value = record(raw)
  const type = VIZ.includes(value.type as (typeof VIZ)[number])
    ? (value.type as Visualization['type'])
    : 'table'
  const unit = ['%', 's', '€', ''].includes(value.unit as string)
    ? (value.unit as Visualization['unit'])
    : ''
  const goal = Number(value.goal)
  const goalLabel = typeof value.goalLabel === 'string' ? value.goalLabel.trim().slice(0, 60) : ''
  return {
    type,
    ...(value.stacked === true ? { stacked: true } : {}),
    ...(unit ? { unit } : {}),
    ...(Number.isFinite(goal) && goal !== 0 && value.goal !== undefined ? { goal } : {}),
    ...(goalLabel ? { goalLabel } : {}),
    ...(value.invert === true ? { invert: true } : {}),
  }
}

export function readBuilder(raw: unknown): BuilderQuery {
  const value = record(raw)
  const source = sourceOf(String(value.source))
  if (!source) invalid('source')
  const list = (v: unknown, max: number) => {
    if (v === undefined) return []
    if (!Array.isArray(v) || v.length > max) invalid('list')
    return v
  }
  const filters = list(value.filters, MAX_FILTERS).map((f): QueryFilter => {
    const filter = record(f)
    const column = columnOf(source, filter.column).name
    if (!OPERATORS.includes(filter.op as FilterOperator)) invalid('operator')
    const values = list(filter.values, 50).map((v) => String(v).slice(0, 200))
    if (
      filter.op === 'at' &&
      (columnOf(source, column).type !== 'date' || !UNITS.includes(values[0] as TimeUnit))
    ) {
      invalid('operator')
    }
    return { column, op: filter.op as FilterOperator, values }
  })
  const aggregations = list(value.aggregations, MAX_AGGREGATIONS).map((a): QueryAggregation => {
    const aggregation = record(a)
    if (!AGGREGATES.includes(aggregation.fn as AggregateFunction)) invalid('aggregate')
    const fn = aggregation.fn as AggregateFunction
    if (fn === 'count') return { fn }
    return { fn, column: columnOf(source, aggregation.column).name }
  })
  const breakouts = list(value.breakouts, MAX_BREAKOUTS).map((b): QueryBreakout => {
    const breakout = record(b)
    const column = columnOf(source, breakout.column)
    if (column.type === 'date') {
      const unit = UNITS.includes(breakout.unit as TimeUnit) ? (breakout.unit as TimeUnit) : 'day'
      return { column: column.name, unit }
    }
    return { column: column.name }
  })
  const sort = record(value.sort)
  const limit = Number(value.limit)
  return {
    source: source.key,
    filters,
    aggregations,
    breakouts,
    ...(typeof sort.column === 'string' && sort.column.length <= 80
      ? { sort: { column: sort.column, desc: sort.desc === true } }
      : {}),
    ...(Number.isInteger(limit) && limit > 0 ? { limit: Math.min(limit, ROW_LIMIT) } : {}),
  }
}

/** A question as stored: its query or its SQL, and how it is drawn. */
export function readQuestion(raw: unknown): Question {
  const value = record(raw)
  const viz = readVisualization(value.viz)
  if (value.mode === 'sql') {
    const sql = typeof value.sql === 'string' ? value.sql.trim() : ''
    if (sql === '' || sql.length > SQL_MAX) invalid('sql')
    return { mode: 'sql', sql, viz }
  }
  return { mode: 'builder', query: readBuilder(value.query), viz }
}

// ── The SQL ─────────────────────────────────────────────────────────────────

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`

export interface Compiled {
  readonly text: string
  readonly values: readonly unknown[]
}

function timeExpression(column: string, unit: TimeUnit, zone: string): string {
  const local = `(${quote(column)} AT TIME ZONE ${zone})`
  switch (unit) {
    case 'weekday':
      return `extract(isodow from ${local})::int`
    case 'hour_of_day':
      return `extract(hour from ${local})::int`
    default:
      return `date_trunc('${unit}', ${local})`
  }
}

/**
 * The group a result gave back, as Postgres wrote it: a `timestamp` read by this process as
 * its own local time, then sent as ISO — its local clock again, to compare with the group.
 */
function wallTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) invalid('value')
  const two = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`
}

const aliasOf = (a: QueryAggregation) => (a.fn === 'count' ? 'count' : `${a.fn}_${a.column}`)
const breakoutAlias = (b: QueryBreakout) => (b.unit ? `${b.column}_${b.unit}` : b.column)

/** The builder's question as SQL over its view, in `timeZone`. */
export function compile(query: BuilderQuery, timeZone: string): Compiled {
  const source = sourceOf(query.source)
  if (!source) invalid('source')
  const values: unknown[] = []
  const param = (value: unknown) => {
    values.push(value)
    return `$${values.length}`
  }
  // The reader's time zone, a parameter once — and only when a date asks for it: an unused
  // parameter is one Postgres cannot type.
  let zoneParam: string | null = null
  const zone = () => {
    zoneParam ??= `${param(timeZone)}::text`
    return zoneParam
  }
  const typeOf = (name: string) => columnOf(source, name).type

  const where = query.filters.map((f) => {
    const col = quote(f.column)
    const type = typeOf(f.column)
    const cast = type === 'number' ? '::float8' : type === 'date' ? '::timestamptz' : ''
    const first = f.values[0] ?? ''
    switch (f.op) {
      case 'is':
        return type === 'text'
          ? `${col} = any(${param(f.values)}::text[])`
          : `${col} = ${param(first)}${cast}`
      case 'is_not':
        return type === 'text'
          ? `(${col} is null or not (${col} = any(${param(f.values)}::text[])))`
          : `${col} is distinct from ${param(first)}${cast}`
      case 'contains':
        return `${col}::text ilike ${param(`%${first.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)}`
      case 'empty':
        return `${col} is null`
      case 'not_empty':
        return `${col} is not null`
      case 'gt':
        return `${col} > ${param(first)}${cast}`
      case 'lt':
        return `${col} < ${param(first)}${cast}`
      case 'between':
        return `${col} between ${param(first)}${cast} and ${param(f.values[1] ?? first)}${cast}`
      case 'last': {
        const amount = Math.max(1, Math.min(Number(first) || 1, 3650))
        const unit = { days: 'day', weeks: 'week', months: 'month' }[f.values[1] ?? 'days'] ?? 'day'
        // Whole days: from the start of the day N−1 days ago, in the reader's time zone.
        return unit === 'day'
          ? `${col} >= (date_trunc('day', now() AT TIME ZONE ${zone()}) - (${param(amount - 1)}::int * interval '1 day')) AT TIME ZONE ${zone()}`
          : `${col} >= now() - (${param(amount)}::int * interval '1 ${unit}')`
      }
      case 'at': {
        const unit = first as TimeUnit
        const group = timeExpression(f.column, unit, zone())
        const given = f.values[1] ?? ''
        if (unit === 'weekday' || unit === 'hour_of_day') return `${group} = ${param(given)}::int`
        return `${group} = ${param(wallTime(given))}::timestamp`
      }
      case 'true':
        return `${col} is true`
      case 'false':
        return `${col} is not true`
    }
    return invalid('operator')
  })

  const view = `analytics.${quote(source.key)}`
  const whereSql = where.length > 0 ? ` where ${where.join(' and ')}` : ''
  const limit = Math.min(query.limit ?? ROW_LIMIT, ROW_LIMIT)

  // Rows as they are: no count, no grouping.
  if (query.aggregations.length === 0 && query.breakouts.length === 0) {
    const columns = source.columns.map((c) => quote(c.name)).join(', ')
    const order =
      query.sort && source.columns.some((c) => c.name === query.sort?.column)
        ? ` order by ${quote(query.sort.column)} ${query.sort.desc ? 'desc' : 'asc'} nulls last`
        : source.columns.some((c) => c.name === 'created_at')
          ? ' order by "created_at" desc'
          : ''
    return { text: `select ${columns} from ${view}${whereSql}${order} limit ${limit}`, values }
  }

  const aggregations: readonly QueryAggregation[] =
    query.aggregations.length > 0 ? query.aggregations : [{ fn: 'count' }]
  const groups = query.breakouts.map((b) =>
    b.unit ? timeExpression(b.column, b.unit, zone()) : quote(b.column),
  )
  const measures = aggregations.map((a) => {
    const col = a.column ? quote(a.column) : ''
    const expression = {
      count: 'count(*)',
      distinct: `count(distinct ${col})`,
      sum: `sum(${col})`,
      avg: `avg(${col})`,
      median: `percentile_cont(0.5) within group (order by ${col})`,
      min: `min(${col})`,
      max: `max(${col})`,
      share: `round(100.0 * avg((${col})::int), 1)`,
    }[a.fn]
    return `${expression} as ${quote(aliasOf(a))}`
  })
  const select = [
    ...groups.map((g, i) => `${g} as ${quote(breakoutAlias(query.breakouts[i] as QueryBreakout))}`),
    ...measures,
  ]
  const groupSql =
    groups.length > 0 ? ` group by ${groups.map((_, i) => String(i + 1)).join(', ')}` : ''
  const aliases = [...query.breakouts.map(breakoutAlias), ...aggregations.map(aliasOf)]
  const timed = query.breakouts[0]?.unit !== undefined
  const order =
    query.sort && aliases.includes(query.sort.column)
      ? ` order by ${quote(query.sort.column)} ${query.sort.desc ? 'desc' : 'asc'} nulls last`
      : groups.length === 0
        ? ''
        : timed
          ? ' order by 1'
          : ` order by ${groups.length + 1} desc nulls last`
  return {
    text: `select ${select.join(', ')} from ${view}${whereSql}${groupSql}${order} limit ${limit}`,
    values,
  }
}

const literal = (value: unknown): string =>
  Array.isArray(value)
    ? `array[${value.map(literal).join(', ')}]`
    : typeof value === 'number'
      ? String(value)
      : `'${String(value).replace(/'/g, "''")}'`

/** The builder's SQL with its values written in — to read, or to start a SQL question from. */
export function inlined(query: Compiled): string {
  return query.text.replace(/\$(\d+)/g, (all, n: string) => {
    const index = Number(n) - 1
    return index < query.values.length ? literal(query.values[index]) : all
  })
}
