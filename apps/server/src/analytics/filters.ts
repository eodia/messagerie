import type {
  AnalyticsSource,
  CardLink,
  ColumnType,
  DashboardFilter,
  DashboardFilterKind,
  FilterValues,
  QueryFilter,
  Question,
} from '@chat/contracts'
import { Refusal } from '../refusal.js'
import { sourceOf } from './catalog.js'

/**
 * A dashboard's filters (D22, basedb's parameters): a period, values to pick, a text —
 * each tied, or not, to a card on a column of its question. A value given replaces what
 * the card filters on that column: a dashboard on ninety days shows ninety, whatever the
 * card was saved with. A question in SQL follows none.
 */

const MAX_FILTERS = 8
const ID = /^[a-z0-9]{1,20}$/i
const KINDS: readonly DashboardFilterKind[] = ['period', 'choice', 'text']
const PERIOD_UNITS = ['days', 'weeks', 'months'] as const

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const strings = (value: unknown, max: number): string[] =>
  Array.isArray(value)
    ? value
        .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
        .map((v) => String(v).slice(0, 200))
        .slice(0, max)
    : []

/** The column types a filter of each kind bears on. */
export const FITS: Readonly<Record<DashboardFilterKind, readonly ColumnType[]>> = {
  period: ['date'],
  choice: ['text', 'boolean'],
  text: ['text'],
}

export function readFilters(raw: unknown): DashboardFilter[] {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_FILTERS) : []
  const seen = new Set<string>()
  return list.flatMap((item): DashboardFilter[] => {
    const value = record(item)
    const id = typeof value.id === 'string' && ID.test(value.id) ? value.id : null
    const kind = KINDS.includes(value.kind as DashboardFilterKind)
      ? (value.kind as DashboardFilterKind)
      : null
    if (!id || !kind || seen.has(id)) return []
    seen.add(id)
    const label = typeof value.label === 'string' ? value.label.trim().slice(0, 60) : ''
    const source = kind === 'choice' ? sourceOf(String(value.source)) : undefined
    const column = source?.columns.find(
      (c) => c.name === value.column && FITS.choice.includes(c.type),
    )
    return [
      {
        id,
        label: label || id,
        kind,
        ...(source && column ? { source: source.key, column: column.name } : {}),
        default: strings(value.default, 50),
      },
    ]
  })
}

/** A card's links: to filters that exist, on columns of its source that fit them. */
export function readLinks(
  raw: unknown,
  filters: readonly DashboardFilter[],
  question: Question | undefined,
): CardLink[] {
  if (!question || question.mode !== 'builder' || !Array.isArray(raw)) return []
  const source = sourceOf(question.query.source)
  if (!source) return []
  const seen = new Set<string>()
  return raw.flatMap((item): CardLink[] => {
    const value = record(item)
    const filter = filters.find((f) => f.id === value.filter)
    const column = source.columns.find((c) => c.name === value.column)
    if (!filter || !column || !FITS[filter.kind].includes(column.type) || seen.has(filter.id)) {
      return []
    }
    seen.add(filter.id)
    return [{ filter: filter.id, column: column.name }]
  })
}

export function readValues(raw: unknown): FilterValues {
  const value = record(raw)
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => ID.test(key))
      .slice(0, MAX_FILTERS)
      .map(([key, v]) => [key, strings(v, 50)]),
  )
}

/** A filter's value made a condition of the builder — or nothing, when it has none. */
function conditionOf(
  filter: DashboardFilter,
  column: string,
  value: readonly string[],
): QueryFilter | null {
  const given = value.filter((v) => v !== '')
  if (given.length === 0) return null
  switch (filter.kind) {
    case 'period': {
      const [amount, unit] = given
      if (amount === 'between') {
        return given[1] && given[2] ? { column, op: 'between', values: [given[1], given[2]] } : null
      }
      const n = Number(amount)
      if (!Number.isInteger(n) || n < 1) return null
      const known = PERIOD_UNITS.includes(unit as (typeof PERIOD_UNITS)[number]) ? unit : 'days'
      return { column, op: 'last', values: [String(n), known as string] }
    }
    case 'choice':
      return { column, op: 'is', values: given }
    case 'text':
      return { column, op: 'contains', values: [given[0] as string] }
  }
}

/**
 * The question as the dashboard's filters make it: for each filter tied to the card and
 * given a value, the card's own filters on that column give way to it.
 */
export function withFilters(
  question: Question,
  links: readonly CardLink[] | undefined,
  filters: readonly DashboardFilter[],
  values: FilterValues,
): Question {
  if (question.mode !== 'builder' || !links || links.length === 0) return question
  let conditions = [...question.query.filters]
  for (const link of links) {
    const filter = filters.find((f) => f.id === link.filter)
    if (!filter) continue
    const condition = conditionOf(filter, link.column, values[filter.id] ?? filter.default)
    if (!condition) continue
    conditions = [...conditions.filter((c) => c.column !== link.column), condition]
  }
  return { ...question, query: { ...question.query, filters: conditions } }
}

/** Where a `choice` filter's values come from, checked. */
export function valuesSource(raw: unknown): {
  readonly source: AnalyticsSource
  readonly column: string
} {
  const value = record(raw)
  const source = sourceOf(String(value.source))
  const column = source?.columns.find(
    (c) => c.name === value.column && FITS.choice.includes(c.type),
  )
  if (!source || !column) throw new Refusal('QUERY_INVALID', 400, { reason: 'column' })
  return { source, column: column.name }
}
