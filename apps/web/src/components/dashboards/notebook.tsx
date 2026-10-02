'use client'

import { ChoiceMenu, Toggles } from '@/components/settings/field-input'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Segmented } from '@/components/ui/segmented'
import { Hint } from '@/components/ui/tooltip'
import {
  AGGREGATE_LABELS,
  AGGREGATE_TYPES,
  OPERATORS_BY_TYPE,
  OPERATOR_LABELS,
  UNIT_LABELS,
  columnTitle,
  emptyQuery,
  labelsOf,
  valueText,
} from '@/lib/analytics'
import { api } from '@/lib/api'
import { $t, $tp } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type {
  AggregateFunction,
  AnalyticsSource,
  BuilderQuery,
  ColumnType,
  FilterOperator,
  QueryAggregation,
  QueryBreakout,
  QueryFilter,
  QueryResult,
  SourceColumn,
  TimeUnit,
} from '@chat/contracts'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  ChevronLeft,
  Database,
  Hash,
  ListOrdered,
  Plus,
  Search,
  ToggleLeft,
  Type,
  X,
} from 'lucide-react'
import {
  type ButtonHTMLAttributes,
  type ReactNode,
  forwardRef,
  useEffect,
  useMemo,
  useState,
} from 'react'

/**
 * The builder of questions, as basedb's notebook: the data, its filters, what is counted by
 * what, the order and the bound — one step under the other, each coloured by what it does,
 * each choice a chip that opens where it is changed.
 */

type Tone = 'data' | 'filter' | 'summarize' | 'neutral'

const TONES: Readonly<Record<Tone, { title: string; panel: string; chip: string; empty: string }>> =
  {
    data: {
      title: 'text-sky-600 dark:text-sky-400',
      panel: 'bg-sky-500/[0.07] dark:bg-sky-400/[0.08]',
      chip: 'bg-sky-600 text-white hover:bg-sky-600/90 dark:bg-sky-500',
      empty: 'border-sky-500/40 text-sky-700 dark:text-sky-300 hover:bg-sky-500/10',
    },
    filter: {
      title: 'text-violet-600 dark:text-violet-400',
      panel: 'bg-violet-500/[0.07] dark:bg-violet-400/[0.08]',
      chip: 'bg-violet-600 text-white hover:bg-violet-600/90 dark:bg-violet-500',
      empty: 'border-violet-500/40 text-violet-700 dark:text-violet-300 hover:bg-violet-500/10',
    },
    summarize: {
      title: 'text-emerald-600 dark:text-emerald-400',
      panel: 'bg-emerald-500/[0.07] dark:bg-emerald-400/[0.08]',
      chip: 'bg-emerald-600 text-white hover:bg-emerald-600/90 dark:bg-emerald-600',
      empty: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10',
    },
    neutral: {
      title: 'text-muted-foreground',
      panel: 'bg-muted/60',
      chip: 'bg-foreground/80 text-background hover:bg-foreground/70',
      empty: 'border-border text-muted-foreground hover:bg-accent',
    },
  }

const TYPE_ICONS: Readonly<Record<ColumnType, typeof Hash>> = {
  text: Type,
  number: Hash,
  date: Calendar,
  boolean: ToggleLeft,
}

function Step({
  tone,
  title,
  children,
  onRemove,
}: {
  readonly tone: Tone
  readonly title: string
  readonly children: ReactNode
  readonly onRemove?: () => void
}) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-2">
        <h3 className={cn('text-sm font-semibold', TONES[tone].title)}>{title}</h3>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={$t('Retirer l’étape {title}', { title })}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <Panel tone={tone}>{children}</Panel>
    </section>
  )
}

function Panel({ tone, children }: { readonly tone: Tone; readonly children: ReactNode }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5 rounded-lg p-2.5', TONES[tone].panel)}>
      {children}
    </div>
  )
}

/** A choice made: opens where it is changed; its cross takes it away. */
const StepChip = forwardRef<
  HTMLButtonElement,
  {
    readonly tone: Tone
    readonly children: ReactNode
    readonly onRemove?: () => void
  } & ButtonHTMLAttributes<HTMLButtonElement>
>(function StepChip({ tone, children, onRemove, ...props }, ref) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center rounded-md text-xs font-medium transition-colors',
        TONES[tone].chip,
      )}
    >
      <button
        ref={ref}
        type="button"
        className="flex min-w-0 items-center gap-1.5 px-2 py-1.5"
        {...props}
      >
        {children}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={$t('Retirer')}
          className="border-l border-white/25 px-1.5 py-1.5 opacity-80 hover:opacity-100"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  )
})

/** A choice still to make. */
const AddButton = forwardRef<
  HTMLButtonElement,
  { readonly tone: Tone; readonly children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>
>(function AddButton({ tone, children, className, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1.5 text-xs font-medium transition-colors',
        TONES[tone].empty,
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
})

// ── Columns ─────────────────────────────────────────────────────────────────

function ColumnList({
  columns,
  onPick,
}: {
  readonly columns: readonly SourceColumn[]
  readonly onPick: (column: SourceColumn) => void
}) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = q === '' ? columns : columns.filter((c) => $t(c.label).toLowerCase().includes(q))
  return (
    <div className="flex max-h-80 flex-col">
      {columns.length > 8 && (
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={$t('Chercher une colonne')}
            aria-label={$t('Chercher une colonne')}
            className="h-8 pl-7 text-xs"
            autoFocus
          />
        </div>
      )}
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto scroll-discret">
        {shown.map((c) => {
          const Icon = TYPE_ICONS[c.type]
          return (
            <button
              key={c.name}
              type="button"
              onClick={() => onPick(c)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
            >
              <Icon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{$t(c.label)}</span>
            </button>
          )
        })}
        {shown.length === 0 && (
          <p className="px-2 py-2 text-xs text-muted-foreground">{$t('Aucune colonne.')}</p>
        )}
      </div>
    </div>
  )
}

// ── Saying the steps ────────────────────────────────────────────────────────

const LAST_UNITS = ['days', 'weeks', 'months'] as const

function describeFilter(
  filter: QueryFilter,
  source: AnalyticsSource,
  labels: ReadonlyMap<string, ReadonlyMap<string, string>>,
): string {
  const column = source.columns.find((c) => c.name === filter.column)
  const name = column ? $t(column.label) : filter.column
  const value = (v: string | undefined) =>
    v === undefined || v === ''
      ? '…'
      : column?.type === 'date'
        ? valueText(v, filter.column, 'date', labels).replace(/,? 00:00$/, '')
        : valueText(v, filter.column, 'text', labels)
  switch (filter.op) {
    case 'last': {
      const n = Number(filter.values[0]) || 1
      const unit = filter.values[1] ?? 'days'
      const said =
        unit === 'weeks'
          ? $tp(n, 'la dernière semaine', 'les {count} dernières semaines')
          : unit === 'months'
            ? $tp(n, 'le dernier mois', 'les {count} derniers mois')
            : $tp(n, 'aujourd’hui', 'les {count} derniers jours')
      return `${name} : ${said}`
    }
    case 'true':
    case 'false':
      return `${name} : ${$t(OPERATOR_LABELS[filter.op])}`
    case 'empty':
    case 'not_empty':
      return `${name} ${$t(OPERATOR_LABELS[filter.op])}`
    case 'between':
      return $t('{column} entre {from} et {to}', {
        column: name,
        from: value(filter.values[0]),
        to: value(filter.values[1]),
      })
    case 'is':
    case 'is_not': {
      const values = filter.values.map((v) => value(v))
      const shown =
        values.length > 2
          ? `${values.slice(0, 2).join(', ')} +${values.length - 2}`
          : values.join(', ') || '…'
      return `${name} ${$t(OPERATOR_LABELS[filter.op])} ${shown}`
    }
    default:
      return `${name} ${$t(OPERATOR_LABELS[filter.op])} ${value(filter.values[0])}`
  }
}

function describeAggregation(aggregation: QueryAggregation, source: AnalyticsSource): string {
  if (aggregation.fn === 'count') return $t(AGGREGATE_LABELS.count)
  const column = source.columns.find((c) => c.name === aggregation.column)
  return $t('{fn} de {column}', {
    fn: $t(AGGREGATE_LABELS[aggregation.fn]),
    column: column ? $t(column.label) : (aggregation.column ?? '…'),
  })
}

function describeBreakout(breakout: QueryBreakout, source: AnalyticsSource): string {
  const column = source.columns.find((c) => c.name === breakout.column)
  const name = column ? $t(column.label) : breakout.column
  return breakout.unit ? `${name} ${$t(UNIT_LABELS[breakout.unit])}` : name
}

// ── Popovers ────────────────────────────────────────────────────────────────

function SourcePopover({
  sources,
  value,
  onPick,
  children,
}: {
  readonly sources: readonly AnalyticsSource[]
  readonly value: string
  readonly onPick: (source: AnalyticsSource) => void
  readonly children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-80 p-1">
        {sources.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => {
              onPick(s)
              setOpen(false)
            }}
            className={cn(
              'flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent',
              s.key === value && 'bg-accent',
            )}
          >
            <span className="text-xs font-medium">{$t(s.label)}</span>
            <span className="text-[11px] text-muted-foreground">{$t(s.description)}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

const firstFilter = (column: SourceColumn): QueryFilter => ({
  column: column.name,
  op: OPERATORS_BY_TYPE[column.type][0] as FilterOperator,
  values: column.type === 'date' ? ['30', 'days'] : [],
})

/** The values a text column holds — to tick, rather than to type. */
function useValues(source: string, column: SourceColumn): readonly string[] | null {
  const [values, setValues] = useState<readonly string[] | null>(null)
  useEffect(() => {
    if (column.values || column.type !== 'text') return
    let alive = true
    api.filterValues(source, column.name).then(
      (v) => alive && setValues(v),
      () => alive && setValues([]),
    )
    return () => {
      alive = false
    }
  }, [source, column])
  return column.values ? column.values.map((v) => v.value) : values
}

function FilterForm({
  source,
  column,
  initial,
  onDone,
  onBack,
}: {
  readonly source: AnalyticsSource
  readonly column: SourceColumn
  readonly initial: QueryFilter
  readonly onDone: (filter: QueryFilter) => void
  readonly onBack?: () => void
}) {
  const [filter, setFilter] = useState<QueryFilter>(initial)
  const known = useValues(source.key, column)
  const labels = useMemo(() => labelsOf([source]), [source])
  const value = (i: number) => filter.values[i] ?? ''
  const set = (i: number, v: string) => {
    const values = [...filter.values]
    values[i] = v
    setFilter({ ...filter, values })
  }
  const inputType = column.type === 'date' ? 'date' : column.type === 'number' ? 'number' : 'text'
  const choosing =
    (filter.op === 'is' || filter.op === 'is_not') && known !== null && known.length > 0
  const bare = ['empty', 'not_empty', 'true', 'false'].includes(filter.op)
  return (
    <div className="w-72 space-y-3">
      <div className="flex items-center gap-1">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={$t('Revenir aux colonnes')}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
          </button>
        )}
        <span className="text-xs font-semibold">{$t(column.label)}</span>
      </div>
      <ChoiceMenu
        id={`op-${column.name}`}
        value={filter.op}
        choices={OPERATORS_BY_TYPE[column.type].map((op) => ({
          id: op,
          label: $t(OPERATOR_LABELS[op]),
        }))}
        onChange={(op) =>
          op &&
          setFilter({
            ...filter,
            op: op as FilterOperator,
            values: op === 'last' ? ['30', 'days'] : op === filter.op ? filter.values : [],
          })
        }
        allowNone={false}
        disabled={false}
      />
      {filter.op === 'last' ? (
        <div className="flex gap-1.5">
          <Input
            type="number"
            min={1}
            value={value(0)}
            onChange={(e) => set(0, e.target.value)}
            className="h-8 w-20 text-xs"
            aria-label={$t('Combien')}
          />
          <Segmented
            value={(value(1) || 'days') as (typeof LAST_UNITS)[number]}
            onValueChange={(v) => set(1, v)}
            options={[
              { value: 'days', label: $t('jours') },
              { value: 'weeks', label: $t('semaines') },
              { value: 'months', label: $t('mois') },
            ]}
            className="flex-1"
            aria-label={$t('Unité')}
          />
        </div>
      ) : bare ? null : choosing ? (
        <div className="max-h-48 overflow-y-auto scroll-discret">
          <Toggles
            value={filter.values}
            choices={(known ?? []).map((v) => ({
              id: v,
              label: valueText(v, column.name, 'text', labels),
            }))}
            onChange={(values) => setFilter({ ...filter, values })}
            disabled={false}
          />
        </div>
      ) : (
        <div className="flex gap-1.5">
          <Input
            type={inputType}
            value={value(0)}
            onChange={(e) => set(0, e.target.value)}
            className="h-8 text-xs"
            aria-label={$t('Valeur')}
            autoFocus
          />
          {filter.op === 'between' && (
            <Input
              type={inputType}
              value={value(1)}
              onChange={(e) => set(1, e.target.value)}
              className="h-8 text-xs"
              aria-label={$t('Jusqu’à')}
            />
          )}
        </div>
      )}
      <button
        type="button"
        onClick={() => onDone(filter)}
        className="h-8 w-full rounded-md bg-violet-600 text-xs font-medium text-white hover:bg-violet-600/90 dark:bg-violet-500"
      >
        {onBack ? $t('Ajouter le filtre') : $t('Mettre à jour le filtre')}
      </button>
    </div>
  )
}

function FilterPopover({
  source,
  filter,
  onDone,
  children,
}: {
  readonly source: AnalyticsSource
  readonly filter?: QueryFilter
  readonly onDone: (filter: QueryFilter) => void
  readonly children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const initial = filter ? source.columns.find((c) => c.name === filter.column) : undefined
  const [column, setColumn] = useState<SourceColumn | undefined>(initial)
  return (
    <Popover
      modal
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setColumn(initial)
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-auto">
        {column === undefined ? (
          <div className="w-64">
            <ColumnList columns={source.columns} onPick={setColumn} />
          </div>
        ) : (
          <FilterForm
            key={column.name}
            source={source}
            column={column}
            initial={filter && filter.column === column.name ? filter : firstFilter(column)}
            onDone={(next) => {
              onDone(next)
              setOpen(false)
            }}
            {...(filter ? {} : { onBack: () => setColumn(undefined) })}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

function AggregationPopover({
  source,
  value,
  onDone,
  children,
}: {
  readonly source: AnalyticsSource
  readonly value?: QueryAggregation
  readonly onDone: (aggregation: QueryAggregation) => void
  readonly children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [fn, setFn] = useState<AggregateFunction | null>(null)
  const types = fn === null ? null : AGGREGATE_TYPES[fn]
  return (
    <Popover
      modal
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setFn(null)
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-64">
        {fn === null || types === null ? (
          <div className="-mx-1 flex flex-col">
            <p className="px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {$t('Calcul')}
            </p>
            {(Object.keys(AGGREGATE_LABELS) as AggregateFunction[]).map((f) => {
              const needs = AGGREGATE_TYPES[f]
              const possible = needs === null || source.columns.some((c) => needs.includes(c.type))
              return (
                <button
                  key={f}
                  type="button"
                  disabled={!possible}
                  onClick={() => {
                    if (needs === null) {
                      onDone({ fn: f })
                      setOpen(false)
                    } else setFn(f)
                  }}
                  className={cn(
                    'rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-40',
                    value?.fn === f && 'bg-accent',
                  )}
                >
                  {$t(AGGREGATE_LABELS[f])}
                  {needs !== null && <span className="text-muted-foreground"> {$t('de…')}</span>}
                </button>
              )
            })}
          </div>
        ) : (
          <div>
            <button
              type="button"
              onClick={() => setFn(null)}
              className="mb-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="size-3.5" />
              {$t('{fn} de…', { fn: $t(AGGREGATE_LABELS[fn]) })}
            </button>
            <ColumnList
              columns={source.columns.filter((c) => types.includes(c.type))}
              onPick={(c) => {
                onDone({ fn, column: c.name })
                setOpen(false)
              }}
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

const UNITS: readonly TimeUnit[] = [
  'day',
  'week',
  'month',
  'hour',
  'year',
  'weekday',
  'hour_of_day',
]

function BreakoutPopover({
  source,
  onDone,
  children,
}: {
  readonly source: AnalyticsSource
  readonly onDone: (breakout: QueryBreakout) => void
  readonly children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState<SourceColumn | null>(null)
  return (
    <Popover
      modal
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setDate(null)
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-64">
        {date === null ? (
          <ColumnList
            columns={source.columns.filter((c) => c.type !== 'number')}
            onPick={(c) => {
              if (c.type === 'date') return setDate(c)
              onDone({ column: c.name })
              setOpen(false)
            }}
          />
        ) : (
          <div className="-mx-1 flex flex-col">
            <button
              type="button"
              onClick={() => setDate(null)}
              className="mb-1 flex items-center gap-1 px-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="size-3.5" />
              {$t(date.label)}
            </button>
            {UNITS.map((unit) => (
              <button
                key={unit}
                type="button"
                onClick={() => {
                  onDone({ column: date.name, unit })
                  setOpen(false)
                }}
                className="rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
              >
                {$t(UNIT_LABELS[unit])}
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function SortPopover({
  result,
  sources,
  onDone,
  children,
}: {
  readonly result: QueryResult | null
  readonly sources: readonly AnalyticsSource[]
  readonly onDone: (column: string) => void
  readonly children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-64 p-1">
        {(result?.columns ?? []).map((c) => (
          <button
            key={c.name}
            type="button"
            onClick={() => {
              onDone(c.name)
              setOpen(false)
            }}
            className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
          >
            {columnTitle(c.name, sources)}
          </button>
        ))}
        {!result && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            {$t('Les colonnes viendront avec le résultat.')}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}

// ── The notebook ────────────────────────────────────────────────────────────

export function Notebook({
  query,
  sources,
  result,
  onChange,
}: {
  readonly query: BuilderQuery
  readonly sources: readonly AnalyticsSource[]
  /** The last result: the columns to sort by. */
  readonly result: QueryResult | null
  readonly onChange: (query: BuilderQuery) => void
}) {
  const source = sources.find((s) => s.key === query.source) ?? sources[0]
  const labels = useMemo(() => labelsOf(sources), [sources])
  const [showSort, setShowSort] = useState(query.sort !== undefined)
  const [showLimit, setShowLimit] = useState(query.limit !== undefined)
  if (!source) return null
  const set = (patch: Partial<BuilderQuery>) => onChange({ ...query, ...patch })
  const without = (key: 'sort' | 'limit'): BuilderQuery => {
    const { sort, limit, ...rest } = query
    return {
      ...rest,
      ...(key !== 'sort' && sort ? { sort } : {}),
      ...(key !== 'limit' && limit !== undefined ? { limit } : {}),
    }
  }

  return (
    <div className="space-y-4">
      <Step tone="data" title={$t('Données')}>
        <SourcePopover
          sources={sources}
          value={source.key}
          onPick={(s) => s.key !== source.key && onChange(emptyQuery(s.key))}
        >
          <StepChip tone="data">
            <Database className="size-3.5" />
            {$t(source.label)}
          </StepChip>
        </SourcePopover>
      </Step>

      <Step tone="filter" title={$t('Filtre')}>
        {query.filters.map((filter, index) => (
          <FilterPopover
            // biome-ignore lint/suspicious/noArrayIndexKey: filters are edited in place, by position
            key={index}
            source={source}
            filter={filter}
            onDone={(next) =>
              set({ filters: query.filters.map((f, i) => (i === index ? next : f)) })
            }
          >
            <StepChip
              tone="filter"
              onRemove={() => set({ filters: query.filters.filter((_, i) => i !== index) })}
            >
              <span className="truncate">{describeFilter(filter, source, labels)}</span>
            </StepChip>
          </FilterPopover>
        ))}
        <FilterPopover source={source} onDone={(f) => set({ filters: [...query.filters, f] })}>
          {query.filters.length === 0 ? (
            <AddButton tone="filter">{$t('Ajouter des filtres pour préciser')}</AddButton>
          ) : (
            <AddButton tone="filter" aria-label={$t('Ajouter un filtre')}>
              <Plus className="size-3.5" />
            </AddButton>
          )}
        </FilterPopover>
      </Step>

      <section className="space-y-1.5">
        <h3 className={cn('text-sm font-semibold', TONES.summarize.title)}>{$t('Résumer')}</h3>
        <Panel tone="summarize">
          {query.aggregations.map((aggregation, index) => (
            <AggregationPopover
              // biome-ignore lint/suspicious/noArrayIndexKey: aggregates are edited in place, by position
              key={index}
              source={source}
              value={aggregation}
              onDone={(next) =>
                set({ aggregations: query.aggregations.map((a, i) => (i === index ? next : a)) })
              }
            >
              <StepChip
                tone="summarize"
                onRemove={() =>
                  set({ aggregations: query.aggregations.filter((_, i) => i !== index) })
                }
              >
                <span className="truncate">{describeAggregation(aggregation, source)}</span>
              </StepChip>
            </AggregationPopover>
          ))}
          {query.aggregations.length < 4 && (
            <AggregationPopover
              source={source}
              onDone={(a) => set({ aggregations: [...query.aggregations, a] })}
            >
              {query.aggregations.length === 0 ? (
                <AddButton tone="summarize">
                  {query.breakouts.length === 0
                    ? $t('Choisir un calcul — sinon, les lignes')
                    : $t('Choisir un calcul — sinon, le nombre')}
                </AddButton>
              ) : (
                <AddButton tone="summarize" aria-label={$t('Ajouter un calcul')}>
                  <Plus className="size-3.5" />
                </AddButton>
              )}
            </AggregationPopover>
          )}
        </Panel>
        <p className="px-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
          {$t('par')}
        </p>
        <Panel tone="summarize">
          {query.breakouts.map((breakout, index) => (
            <BreakoutPopover
              // biome-ignore lint/suspicious/noArrayIndexKey: groupings are edited in place, by position
              key={index}
              source={source}
              onDone={(next) =>
                set({ breakouts: query.breakouts.map((b, i) => (i === index ? next : b)) })
              }
            >
              <StepChip
                tone="summarize"
                onRemove={() => set({ breakouts: query.breakouts.filter((_, i) => i !== index) })}
              >
                <span className="truncate">{describeBreakout(breakout, source)}</span>
              </StepChip>
            </BreakoutPopover>
          ))}
          {query.breakouts.length < 2 && (
            <BreakoutPopover
              source={source}
              onDone={(b) => set({ breakouts: [...query.breakouts, b] })}
            >
              {query.breakouts.length === 0 ? (
                <AddButton tone="summarize">{$t('Choisir une colonne de regroupement')}</AddButton>
              ) : (
                <AddButton tone="summarize" aria-label={$t('Ajouter un regroupement')}>
                  <Plus className="size-3.5" />
                </AddButton>
              )}
            </BreakoutPopover>
          )}
        </Panel>
      </section>

      {(!showSort || !showLimit) && (
        <div className="flex gap-2">
          {!showSort && (
            <AddButton tone="neutral" onClick={() => setShowSort(true)}>
              <ArrowUpDown className="size-3.5" />
              {$t('Trier')}
            </AddButton>
          )}
          {!showLimit && (
            <AddButton tone="neutral" onClick={() => setShowLimit(true)}>
              <ListOrdered className="size-3.5" />
              {$t('Limiter')}
            </AddButton>
          )}
        </div>
      )}

      {showSort && (
        <Step
          tone="neutral"
          title={$t('Trier')}
          onRemove={() => {
            setShowSort(false)
            onChange(without('sort'))
          }}
        >
          {query.sort ? (
            <Hint label={$t('Inverser l’ordre')}>
              <StepChip
                tone="neutral"
                onClick={() =>
                  query.sort && set({ sort: { ...query.sort, desc: !query.sort.desc } })
                }
                onRemove={() => onChange(without('sort'))}
              >
                {query.sort.desc ? (
                  <ArrowDown className="size-3.5" />
                ) : (
                  <ArrowUp className="size-3.5" />
                )}
                {columnTitle(query.sort.column, sources)}
              </StepChip>
            </Hint>
          ) : (
            <SortPopover
              result={result}
              sources={sources}
              onDone={(column) => set({ sort: { column, desc: true } })}
            >
              <AddButton tone="neutral">{$t('Choisir une colonne')}</AddButton>
            </SortPopover>
          )}
        </Step>
      )}

      {showLimit && (
        <Step
          tone="neutral"
          title={$t('Limite')}
          onRemove={() => {
            setShowLimit(false)
            onChange(without('limit'))
          }}
        >
          <Input
            type="number"
            min={1}
            max={2000}
            value={query.limit ?? ''}
            placeholder={$t('Nombre de lignes')}
            onChange={(e) => {
              const n = Number(e.target.value)
              onChange(n > 0 ? { ...query, limit: Math.min(n, 2000) } : without('limit'))
            }}
            className="h-8 w-36 bg-background text-xs"
            aria-label={$t('Nombre de lignes au plus')}
          />
        </Step>
      )}
    </div>
  )
}
