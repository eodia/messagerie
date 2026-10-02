'use client'

import { ChoiceMenu, Toggles } from '@/components/settings/field-input'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Hint } from '@/components/ui/tooltip'
import {
  AGGREGATE_LABELS,
  AGGREGATE_TYPES,
  OPERATORS_BY_TYPE,
  OPERATOR_LABELS,
  UNIT_LABELS,
  VIZ_LABELS,
  columnTitle,
  emptyQuery,
} from '@/lib/analytics'
import { ApiFailure, api } from '@/lib/api'
import { $t, $tp } from '@/lib/i18n'
import { messageFor } from '@/lib/messages'
import { cn } from '@/lib/utils'
import type {
  AggregateFunction,
  AnalyticsSource,
  BuilderQuery,
  DashboardCard,
  FilterOperator,
  QueryFilter,
  QueryResult,
  Question,
  SourceColumn,
  TimeUnit,
  Visualization,
  VisualizationType,
} from '@chat/contracts'
import {
  ChartArea,
  ChartBar,
  ChartBarBig,
  ChartLine,
  ChartPie,
  Hash,
  LoaderCircle,
  Plus,
  Sparkles,
  Table2,
  X,
} from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { ResultView } from './visualization'

/**
 * A card's question, written: by choosing — a source, filters, what to count, by what —
 * or in SQL over the same views, with the AI to draft it from a sentence. Its result is
 * drawn as it changes.
 */

const VIZ_ICONS: Readonly<Record<VisualizationType, ReactNode>> = {
  number: <Hash className="size-3.5" />,
  table: <Table2 className="size-3.5" />,
  bar: <ChartBar className="size-3.5" />,
  row: <ChartBarBig className="size-3.5" />,
  line: <ChartLine className="size-3.5" />,
  area: <ChartArea className="size-3.5" />,
  pie: <ChartPie className="size-3.5" />,
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

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="space-y-2 border-t pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  )
}

const choicesOf = (columns: readonly SourceColumn[]) =>
  columns.map((c) => ({ id: c.name, label: $t(c.label) }))

function FilterRow({
  filter,
  source,
  onChange,
  onRemove,
}: {
  readonly filter: QueryFilter
  readonly source: AnalyticsSource
  readonly onChange: (filter: QueryFilter) => void
  readonly onRemove: () => void
}) {
  const column = source.columns.find((c) => c.name === filter.column) ?? source.columns[0]
  if (!column) return null
  const ops = OPERATORS_BY_TYPE[column.type]
  const value = (i: number) => filter.values[i] ?? ''
  const set = (i: number, v: string) => {
    const values = [...filter.values]
    values[i] = v
    onChange({ ...filter, values })
  }
  const inputType = column.type === 'date' ? 'date' : column.type === 'number' ? 'number' : 'text'
  return (
    <div className="space-y-2 rounded-lg border bg-muted/20 p-2.5">
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <ChoiceMenu
            id={`filter-${filter.column}`}
            value={column.name}
            choices={choicesOf(source.columns)}
            onChange={(name) => {
              const next = source.columns.find((c) => c.name === name)
              if (!next) return
              onChange({
                column: next.name,
                op: OPERATORS_BY_TYPE[next.type][0] as FilterOperator,
                values: next.type === 'date' ? ['30', 'days'] : [],
              })
            }}
            allowNone={false}
            disabled={false}
          />
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onRemove}
          aria-label={$t('Retirer le filtre')}
        >
          <X className="size-4" />
        </Button>
      </div>
      <ChoiceMenu
        id={`op-${filter.column}`}
        value={filter.op}
        choices={ops.map((op) => ({ id: op, label: $t(OPERATOR_LABELS[op]) }))}
        onChange={(op) =>
          op &&
          onChange({
            ...filter,
            op: op as FilterOperator,
            values: op === 'last' ? ['30', 'days'] : filter.values,
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
            value={(value(1) || 'days') as 'days' | 'weeks' | 'months'}
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
      ) : ['empty', 'not_empty', 'true', 'false'].includes(filter.op) ? null : column.values &&
        (filter.op === 'is' || filter.op === 'is_not') ? (
        <Toggles
          value={filter.values}
          choices={column.values.map((v) => ({ id: v.value, label: $t(v.label) }))}
          onChange={(values) => onChange({ ...filter, values })}
          disabled={false}
        />
      ) : (
        <div className="flex gap-1.5">
          <Input
            type={inputType}
            value={value(0)}
            onChange={(e) => set(0, e.target.value)}
            className="h-8 text-xs"
            aria-label={$t('Valeur')}
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
    </div>
  )
}

function Builder({
  query,
  sources,
  result,
  onChange,
}: {
  readonly query: BuilderQuery
  readonly sources: readonly AnalyticsSource[]
  readonly result: QueryResult | null
  readonly onChange: (query: BuilderQuery) => void
}) {
  const source = sources.find((s) => s.key === query.source) ?? sources[0]
  if (!source) return null
  const set = (patch: Partial<BuilderQuery>) => onChange({ ...query, ...patch })
  return (
    <div className="space-y-4">
      <Section title={$t('Données')}>
        <ChoiceMenu
          id="question-source"
          value={source.key}
          choices={sources.map((s) => ({ id: s.key, label: $t(s.label) }))}
          onChange={(key) => key && onChange(emptyQuery(key))}
          allowNone={false}
          disabled={false}
        />
        <p className="text-xs text-muted-foreground">{$t(source.description)}</p>
      </Section>

      <Section title={$t('Filtrer')}>
        {query.filters.map((filter, index) => (
          <FilterRow
            // biome-ignore lint/suspicious/noArrayIndexKey: filters have no id; their place is it
            key={index}
            filter={filter}
            source={source}
            onChange={(next) =>
              set({ filters: query.filters.map((f, i) => (i === index ? next : f)) })
            }
            onRemove={() => set({ filters: query.filters.filter((_, i) => i !== index) })}
          />
        ))}
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-1.5"
          onClick={() => {
            const first = source.columns[0] as SourceColumn
            set({
              filters: [
                ...query.filters,
                {
                  column: first.name,
                  op: OPERATORS_BY_TYPE[first.type][0] as FilterOperator,
                  values: first.type === 'date' ? ['30', 'days'] : [],
                },
              ],
            })
          }}
        >
          <Plus className="size-3.5" />
          {$t('Ajouter un filtre')}
        </Button>
      </Section>

      <Section title={$t('Compter')}>
        {query.aggregations.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {query.breakouts.length === 0
              ? $t('Rien : les lignes telles quelles.')
              : $t('Le nombre de lignes.')}
          </p>
        )}
        {query.aggregations.map((aggregation, index) => {
          const types = AGGREGATE_TYPES[aggregation.fn]
          const columns = types === null ? [] : source.columns.filter((c) => types.includes(c.type))
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: aggregations have no id
            <div key={index} className="flex items-center gap-1.5">
              <div className="min-w-0 flex-1">
                <ChoiceMenu
                  id={`aggregate-${index}`}
                  value={aggregation.fn}
                  choices={(Object.keys(AGGREGATE_LABELS) as AggregateFunction[]).map((fn) => ({
                    id: fn,
                    label: $t(AGGREGATE_LABELS[fn]),
                  }))}
                  onChange={(fn) => {
                    if (!fn) return
                    const allowed = AGGREGATE_TYPES[fn as AggregateFunction]
                    const column =
                      allowed === null
                        ? undefined
                        : source.columns.find((c) => allowed.includes(c.type))?.name
                    set({
                      aggregations: query.aggregations.map((a, i) =>
                        i === index
                          ? { fn: fn as AggregateFunction, ...(column ? { column } : {}) }
                          : a,
                      ),
                    })
                  }}
                  allowNone={false}
                  disabled={false}
                />
              </div>
              {types !== null && (
                <div className="min-w-0 flex-1">
                  <ChoiceMenu
                    id={`aggregate-column-${index}`}
                    value={aggregation.column ?? null}
                    choices={choicesOf(columns)}
                    onChange={(column) =>
                      column &&
                      set({
                        aggregations: query.aggregations.map((a, i) =>
                          i === index ? { ...a, column } : a,
                        ),
                      })
                    }
                    allowNone={false}
                    disabled={false}
                  />
                </div>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={$t('Retirer')}
                onClick={() =>
                  set({ aggregations: query.aggregations.filter((_, i) => i !== index) })
                }
              >
                <X className="size-4" />
              </Button>
            </div>
          )
        })}
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-1.5"
          onClick={() => set({ aggregations: [...query.aggregations, { fn: 'count' }] })}
        >
          <Plus className="size-3.5" />
          {$t('Ajouter un calcul')}
        </Button>
      </Section>

      <Section title={$t('Par')}>
        {query.breakouts.map((breakout, index) => {
          const column = source.columns.find((c) => c.name === breakout.column)
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: breakouts have no id
            <div key={index} className="flex items-center gap-1.5">
              <div className="min-w-0 flex-1">
                <ChoiceMenu
                  id={`breakout-${index}`}
                  value={breakout.column}
                  choices={choicesOf(source.columns.filter((c) => c.type !== 'number'))}
                  onChange={(name) => {
                    const next = source.columns.find((c) => c.name === name)
                    if (!next) return
                    set({
                      breakouts: query.breakouts.map((b, i) =>
                        i === index
                          ? { column: next.name, ...(next.type === 'date' ? { unit: 'day' } : {}) }
                          : b,
                      ),
                    })
                  }}
                  allowNone={false}
                  disabled={false}
                />
              </div>
              {column?.type === 'date' && (
                <div className="min-w-0 flex-1">
                  <ChoiceMenu
                    id={`breakout-unit-${index}`}
                    value={breakout.unit ?? 'day'}
                    choices={UNITS.map((u) => ({ id: u, label: $t(UNIT_LABELS[u]) }))}
                    onChange={(unit) =>
                      unit &&
                      set({
                        breakouts: query.breakouts.map((b, i) =>
                          i === index ? { ...b, unit: unit as TimeUnit } : b,
                        ),
                      })
                    }
                    allowNone={false}
                    disabled={false}
                  />
                </div>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={$t('Retirer')}
                onClick={() => set({ breakouts: query.breakouts.filter((_, i) => i !== index) })}
              >
                <X className="size-4" />
              </Button>
            </div>
          )
        })}
        {query.breakouts.length < 2 && (
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-1.5"
            onClick={() => {
              const first = source.columns.find((c) => c.type !== 'number') as SourceColumn
              set({
                breakouts: [
                  ...query.breakouts,
                  {
                    column: first.name,
                    ...(first.type === 'date' ? { unit: 'day' as const } : {}),
                  },
                ],
              })
            }}
          >
            <Plus className="size-3.5" />
            {query.breakouts.length === 0 ? $t('Regrouper par…') : $t('Puis par…')}
          </Button>
        )}
      </Section>

      <Section title={$t('Trier et limiter')}>
        <div className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1">
            <ChoiceMenu
              id="question-sort"
              value={query.sort?.column ?? null}
              choices={(result?.columns ?? []).map((c) => ({
                id: c.name,
                label: columnTitle(c.name, sources),
              }))}
              onChange={(column) => {
                const { sort: _, ...rest } = query
                onChange(
                  column ? { ...rest, sort: { column, desc: query.sort?.desc ?? true } } : rest,
                )
              }}
              allowNone
              disabled={false}
            />
          </div>
          {query.sort && (
            <Segmented
              value={query.sort.desc ? 'desc' : 'asc'}
              onValueChange={(v) =>
                query.sort && set({ sort: { ...query.sort, desc: v === 'desc' } })
              }
              options={[
                { value: 'desc', label: $t('Décroissant') },
                { value: 'asc', label: $t('Croissant') },
              ]}
              aria-label={$t('Ordre')}
            />
          )}
        </div>
        <Input
          type="number"
          min={1}
          max={2000}
          value={query.limit ?? ''}
          placeholder={$t('Toutes les lignes (2 000 au plus)')}
          onChange={(e) => {
            const { limit: _, ...rest } = query
            const n = Number(e.target.value)
            onChange(n > 0 ? { ...rest, limit: n } : rest)
          }}
          className="h-8 text-xs"
          aria-label={$t('Nombre de lignes')}
        />
      </Section>
    </div>
  )
}

export function QuestionEditor({
  card,
  sources,
  ai,
  onSave,
  onClose,
}: {
  readonly card: DashboardCard
  readonly sources: readonly AnalyticsSource[]
  /** The server has a model: « Demander à l'IA ». */
  readonly ai: boolean
  readonly onSave: (card: DashboardCard) => void
  readonly onClose: () => void
}) {
  const initial: Question = card.question ?? {
    mode: 'builder',
    query: emptyQuery(),
    viz: { type: 'bar' },
  }
  const [title, setTitle] = useState(card.title)
  const [question, setQuestion] = useState<Question>(initial)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [asking, setAsking] = useState('')
  const [assisting, setAssisting] = useState(false)
  const [asTable, setAsTable] = useState(false)
  const viz = question.viz
  const key = useMemo(
    () => JSON.stringify(question.mode === 'sql' ? question.sql : question.query),
    [question],
  )

  // The result, drawn as the question changes — once it holds still a moment.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the question's text is the key
  useEffect(() => {
    if (question.mode === 'sql' && question.sql.trim() === '') return
    const timer = setTimeout(() => {
      setRunning(true)
      api
        .runQuestion(question)
        .then((next) => {
          setResult(next)
          setError(null)
        })
        .catch((failure) => {
          const reason =
            failure instanceof ApiFailure && typeof failure.details.reason === 'string'
              ? failure.details.reason
              : null
          setError(
            reason && failure instanceof ApiFailure && failure.code === 'QUERY_INVALID'
              ? reason
              : messageFor(failure instanceof ApiFailure ? failure.code : 'INTERNAL_ERROR'),
          )
        })
        .finally(() => setRunning(false))
    }, 500)
    return () => clearTimeout(timer)
  }, [key])

  const setViz = (patch: Partial<Visualization>) =>
    setQuestion((q) => ({ ...q, viz: { ...q.viz, ...patch } }) as Question)

  const assist = async () => {
    if (asking.trim() === '') return
    setAssisting(true)
    setError(null)
    try {
      const draft = await api.assistQuestion(asking)
      setQuestion({ mode: 'sql', sql: draft.sql, viz: draft.viz })
      if (title.trim() === '') setTitle(draft.title)
    } catch (failure) {
      setError(messageFor(failure instanceof ApiFailure ? failure.code : 'INTERNAL_ERROR'))
    } finally {
      setAssisting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[88vh] max-w-[min(1200px,96vw)] flex-col gap-0 p-0 sm:max-w-[min(1200px,96vw)]">
        <DialogHeader className="shrink-0 border-b px-5 py-3">
          <DialogTitle className="sr-only">{$t('Question de la carte')}</DialogTitle>
          <DialogDescription className="sr-only">
            {$t('Ce que la carte montre, et comment.')}
          </DialogDescription>
          <div className="flex items-center gap-3 pr-8">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={$t('Titre de la carte')}
              aria-label={$t('Titre de la carte')}
              className="h-8 max-w-sm font-medium"
            />
            <Tabs
              value={question.mode}
              onValueChange={(mode) => {
                if (mode === question.mode) return
                setQuestion(
                  mode === 'sql'
                    ? { mode: 'sql', sql: result?.sql ?? '', viz }
                    : { mode: 'builder', query: emptyQuery(), viz },
                )
              }}
            >
              <TabsList>
                <TabsTrigger value="builder">{$t('Assistée')}</TabsTrigger>
                <TabsTrigger value="sql">{$t('SQL')}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          <aside className="w-[340px] shrink-0 overflow-y-auto border-r px-4 py-4 scroll-discret">
            {question.mode === 'builder' ? (
              <Builder
                query={question.query}
                sources={sources}
                result={result}
                onChange={(query) => setQuestion({ ...question, query })}
              />
            ) : (
              <div className="space-y-4">
                {ai && (
                  <Section title={$t('Demander à l’IA')}>
                    <Textarea
                      rows={3}
                      value={asking}
                      onChange={(e) => setAsking(e.target.value)}
                      placeholder={$t(
                        'Le taux de résolution par l’IA, semaine après semaine, sur trois mois',
                      )}
                      className="text-sm"
                      aria-label={$t('Votre question, en français')}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full gap-1.5"
                      disabled={assisting || asking.trim() === ''}
                      onClick={() => void assist()}
                    >
                      {assisting ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="size-3.5" />
                      )}
                      {$t('Écrire la requête')}
                    </Button>
                  </Section>
                )}
                <Section title={$t('Requête')}>
                  <Textarea
                    rows={14}
                    value={question.sql}
                    onChange={(e) => setQuestion({ ...question, sql: e.target.value })}
                    spellCheck={false}
                    className="font-mono text-xs"
                    aria-label={$t('Requête SQL')}
                    placeholder="select date_trunc('day', created_at) as jour, count(*) as conversations&#10;from conversations&#10;group by 1 order by 1"
                  />
                  <p className="text-xs text-muted-foreground">
                    {$t(
                      'Un seul SELECT sur les vues : conversations, messages, ai_runs, ai_feedback, tags, contacts, automation_runs. En lecture seule, quinze secondes au plus.',
                    )}
                  </p>
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">
                      {$t('Les colonnes des vues')}
                    </summary>
                    <div className="mt-2 space-y-2">
                      {sources.map((s) => (
                        <div key={s.key}>
                          <div className="font-mono font-medium">{s.key}</div>
                          <div className="font-mono text-[11px] text-muted-foreground">
                            {s.columns.map((c) => c.name).join(', ')}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                </Section>
              </div>
            )}
          </aside>

          <main className="flex min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
              <Segmented
                value={viz.type}
                onValueChange={(type) => setViz({ type })}
                options={(Object.keys(VIZ_LABELS) as VisualizationType[]).map((type) => ({
                  value: type,
                  label: (
                    <Hint label={$t(VIZ_LABELS[type])}>
                      <span className="flex items-center">{VIZ_ICONS[type]}</span>
                    </Hint>
                  ),
                }))}
                aria-label={$t('Graphique')}
              />
              <div className="w-36">
                <ChoiceMenu
                  id="question-unit"
                  value={viz.unit ?? ''}
                  choices={[
                    { id: '', label: $t('Sans unité') },
                    { id: '%', label: $t('Pourcentage') },
                    { id: 's', label: $t('Durée (secondes)') },
                    { id: '€', label: $t('Euros') },
                  ]}
                  onChange={(unit) => setViz({ unit: (unit ?? '') as Visualization['unit'] })}
                  allowNone={false}
                  disabled={false}
                />
              </div>
              {(viz.type === 'bar' || viz.type === 'row' || viz.type === 'area') && (
                <label htmlFor="question-stacked" className="flex items-center gap-2 text-xs">
                  <Switch
                    id="question-stacked"
                    checked={viz.stacked === true}
                    onCheckedChange={(stacked) => setViz({ stacked })}
                  />
                  {$t('Empilées')}
                </label>
              )}
              <div className="flex-1" />
              {result && (
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {$tp(result.rows.length, '{count} ligne', '{count} lignes')} · {result.ms} ms
                </span>
              )}
              <Button
                variant={asTable ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs"
                onClick={() => setAsTable((t) => !t)}
              >
                <Table2 className="size-3.5" />
                {$t('Tableau')}
              </Button>
            </div>
            <div className="relative min-h-0 flex-1 p-4">
              {error && (
                <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 font-mono text-xs text-destructive">
                  {error}
                </p>
              )}
              {result ? (
                <div
                  className={cn('size-full transition-opacity', (error || running) && 'opacity-40')}
                >
                  <ResultView result={result} viz={viz} sources={sources} asTable={asTable} />
                </div>
              ) : running ? (
                <Skeleton className="size-full" />
              ) : (
                !error && (
                  <p className="pt-10 text-center text-sm text-muted-foreground">
                    {question.mode === 'sql'
                      ? $t('Écrivez une requête, ou demandez-la à l’IA.')
                      : $t('Le résultat s’affiche ici.')}
                  </p>
                )
              )}
            </div>
          </main>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {$t('Annuler')}
          </Button>
          <Button
            size="sm"
            disabled={question.mode === 'sql' && question.sql.trim() === ''}
            onClick={() => onSave({ ...card, kind: 'question', title: title.trim(), question })}
          >
            {$t('Enregistrer la carte')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
