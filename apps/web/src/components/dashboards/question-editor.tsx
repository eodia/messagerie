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
  Sparkles,
  Table2,
  Target,
  TrendingUp,
} from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { Notebook } from './notebook'
import { ResultView } from './visualization'

/**
 * A card's question, written: by choosing — a source, filters, what to count, by what —
 * or in SQL over the same views, with the AI to draft it from a sentence. Its result is
 * drawn as it changes.
 */

const VIZ_ICONS: Readonly<Record<VisualizationType, ReactNode>> = {
  number: <Hash className="size-3.5" />,
  trend: <TrendingUp className="size-3.5" />,
  progress: <Target className="size-3.5" />,
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
          <aside className="w-[400px] shrink-0 overflow-y-auto border-r px-4 py-4 scroll-discret">
            {question.mode === 'builder' ? (
              <Notebook
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
              {viz.type === 'trend' && (
                <label htmlFor="question-invert" className="flex items-center gap-2 text-xs">
                  <Switch
                    id="question-invert"
                    checked={viz.invert === true}
                    onCheckedChange={(invert) => setViz({ invert })}
                  />
                  {$t('Une baisse est une bonne nouvelle')}
                </label>
              )}
              {viz.type === 'progress' && (
                <>
                  <Input
                    type="number"
                    value={viz.goal ?? ''}
                    onChange={(e) => {
                      const goal = Number(e.target.value)
                      setViz({
                        goal: e.target.value === '' || !Number.isFinite(goal) ? undefined : goal,
                      })
                    }}
                    placeholder={$t('Objectif')}
                    aria-label={$t('Objectif')}
                    className="h-7 w-28 text-xs"
                  />
                  <Input
                    value={viz.goalLabel ?? ''}
                    onChange={(e) => setViz({ goalLabel: e.target.value || undefined })}
                    placeholder={$t('Nom de l’objectif')}
                    aria-label={$t('Nom de l’objectif')}
                    className="h-7 w-36 text-xs"
                  />
                </>
              )}
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
