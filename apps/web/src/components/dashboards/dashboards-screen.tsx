'use client'

import 'react-grid-layout/css/styles.css'
import './grid.css'
import { ScreenHeader, Slash } from '@/components/app/screen-header'
import { CardsSkeleton } from '@/components/app/skeletons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Hint } from '@/components/ui/tooltip'
import { addressOf, idOfWord, wordOf, wordsAfter } from '@/lib/address'
import { ApiFailure, api } from '@/lib/api'
import { $t } from '@/lib/i18n'
import { messageFor } from '@/lib/messages'
import { useInbox } from '@/lib/store/inbox'
import { useTitle } from '@/lib/title'
import { useAddressBar } from '@/lib/use-address-bar'
import { cn } from '@/lib/utils'
import type {
  AnalyticsSource,
  Dashboard,
  DashboardBody,
  DashboardCard,
  QueryResult,
} from '@chat/contracts'
import {
  ChevronDown,
  Copy,
  Ellipsis,
  GripVertical,
  LayoutDashboard,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Table2,
  Trash2,
  Type,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactGridLayout, {
  type Layout,
  useContainerWidth,
  verticalCompactor,
} from 'react-grid-layout'
import { QuestionEditor } from './question-editor'
import { ResultView } from './visualization'

/**
 * « Tableaux de bord » (D22) — basedb's: cards on a twelve-column grid, each a question
 * drawn as a number, a table or a chart. Everyone sees the shared ones; supervisors arrange
 * them, add questions — built by choosing or written in SQL — and texts.
 */

const BASE = '/tableaux-de-bord'
const COLUMNS = 12
const ROW_HEIGHT = 40
const AT_ONCE = 6

type Run = { readonly result?: QueryResult; readonly error?: string; readonly loading?: boolean }

const newId = () => Math.random().toString(36).slice(2, 10)

const bodyOf = (d: Dashboard | DashboardBody): DashboardBody => ({
  name: d.name,
  description: d.description,
  cards: d.cards,
  shared: d.shared,
})

/** Where a new card goes: under all the others. */
const below = (cards: readonly DashboardCard[]) => Math.max(0, ...cards.map((c) => c.y + c.h))

export function DashboardsScreen() {
  useTitle([$t('Tableaux de bord')])
  const supervisor = useInbox((s) => s.me?.role === 'supervisor')
  const [list, setList] = useState<readonly Dashboard[] | null>(null)
  const [sources, setSources] = useState<readonly AnalyticsSource[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DashboardBody | null>(null)
  const [runs, setRuns] = useState<Readonly<Record<string, Run>>>({})
  const [editing, setEditing] = useState<DashboardCard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)
  const [arrived, setArrived] = useState(false)

  const fail = (failure: unknown) =>
    setError(messageFor(failure instanceof ApiFailure ? failure.code : 'INTERNAL_ERROR'))

  const follow = useCallback((dashboards: readonly Dashboard[]) => {
    const word = wordsAfter(BASE)?.[0]
    const id = word
      ? idOfWord(
          word,
          dashboards.map((d) => d.id),
        )
      : null
    setCurrentId(id ?? dashboards[0]?.id ?? null)
  }, [])

  useEffect(() => {
    void api.analyticsSources().then(setSources, () => setSources([]))
    void api
      .dashboards()
      .then((dashboards) => {
        setList(dashboards)
        follow(dashboards)
        setArrived(true)
      })
      .catch((failure) =>
        setError(messageFor(failure instanceof ApiFailure ? failure.code : 'INTERNAL_ERROR')),
      )
  }, [follow])

  const current = list?.find((d) => d.id === currentId) ?? null
  useAddressBar(
    !arrived ? null : current ? addressOf(BASE, wordOf(current.id, current.name, 'tableau')) : BASE,
    async () => {
      if (list) follow(list)
    },
  )
  const shown: DashboardBody | null = draft ?? (current ? bodyOf(current) : null)

  // The cards' results: the saved ones by their card, the ones being changed by their question.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run again on a dashboard, a refresh, a draft's cards
  useEffect(() => {
    if (!shown || !current) return
    let alive = true
    const cards = shown.cards.filter((c) => c.kind === 'question' && c.question)
    const savedCards = new Map(current.cards.map((c) => [c.id, JSON.stringify(c.question)]))
    setRuns((r) => Object.fromEntries(cards.map((c) => [c.id, { ...r[c.id], loading: true }])))
    const queue = [...cards]
    const next = async (): Promise<void> => {
      const card = queue.shift()
      if (!card || !alive) return
      const saved = savedCards.get(card.id) === JSON.stringify(card.question)
      try {
        const result = saved
          ? await api.runCard(current.id, card.id)
          : await api.runQuestion(card.question as NonNullable<DashboardCard['question']>)
        if (alive) setRuns((r) => ({ ...r, [card.id]: { result } }))
      } catch (failure) {
        if (alive) {
          setRuns((r) => ({
            ...r,
            [card.id]: {
              error:
                failure instanceof ApiFailure && typeof failure.details.reason === 'string'
                  ? failure.details.reason
                  : messageFor(failure instanceof ApiFailure ? failure.code : 'INTERNAL_ERROR'),
            },
          }))
        }
      }
      await next()
    }
    void Promise.all(Array.from({ length: AT_ONCE }, next))
    return () => {
      alive = false
    }
  }, [current?.id, tick, JSON.stringify(shown?.cards.map((c) => [c.id, c.question]))])

  const startEditing = () => current && setDraft(bodyOf(current))

  const save = async () => {
    if (!draft || !current) return
    setBusy(true)
    try {
      const saved = await api.saveDashboard(current.id, draft)
      setList((l) => l?.map((d) => (d.id === saved.id ? saved : d)) ?? null)
      setDraft(null)
    } catch (failure) {
      fail(failure)
    } finally {
      setBusy(false)
    }
  }

  const create = async () => {
    setBusy(true)
    try {
      const made = await api.createDashboard({
        name: $t('Nouveau tableau de bord'),
        description: '',
        cards: [],
        shared: true,
      })
      setList((l) => [...(l ?? []), made])
      setCurrentId(made.id)
      setDraft(bodyOf(made))
    } catch (failure) {
      fail(failure)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!current) return
    setBusy(true)
    try {
      await api.deleteDashboard(current.id)
      const rest = (list ?? []).filter((d) => d.id !== current.id)
      setList(rest)
      setDraft(null)
      setCurrentId(rest[0]?.id ?? null)
    } catch (failure) {
      fail(failure)
    } finally {
      setBusy(false)
    }
  }

  const setCards = (edit: (cards: readonly DashboardCard[]) => readonly DashboardCard[]) =>
    setDraft((d) => (d ? { ...d, cards: edit(d.cards) } : d))

  const addQuestion = () =>
    setEditing({
      id: newId(),
      x: 0,
      y: below(draft?.cards ?? []),
      w: 6,
      h: 7,
      title: '',
      kind: 'question',
    })

  const addText = () =>
    setCards((cards) => [
      ...cards,
      { id: newId(), x: 0, y: below(cards), w: 12, h: 2, title: '', kind: 'text', text: '' },
    ])

  return (
    <>
      <ScreenHeader
        tools={
          current &&
          !draft && (
            <>
              <Hint label={$t('Actualiser')}>
                <Button variant="ghost" size="icon-sm" onClick={() => setTick((t) => t + 1)}>
                  <RefreshCw className="text-muted-foreground" />
                </Button>
              </Hint>
              {supervisor && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={startEditing}
                >
                  <Pencil className="size-3.5" />
                  {$t('Modifier')}
                </Button>
              )}
            </>
          )
        }
      >
        <span className="text-muted-foreground">{$t('Tableaux de bord')}</span>
        <Slash />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-medium hover:bg-accent"
            >
              <span className="truncate">{current?.name ?? '…'}</span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuRadioGroup
              value={currentId ?? ''}
              onValueChange={(id) => {
                setDraft(null)
                setCurrentId(id)
              }}
            >
              {list?.map((d) => (
                <DropdownMenuRadioItem key={d.id} value={d.id}>
                  <span className="truncate">{d.name}</span>
                  {!d.shared && (
                    <span className="ml-auto text-[11px] text-muted-foreground">{$t('privé')}</span>
                  )}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {supervisor && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void create()}>
                  <Plus />
                  {$t('Nouveau tableau de bord')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </ScreenHeader>

      {draft && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-primary/5 px-4 py-2">
          <Input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            aria-label={$t('Nom du tableau de bord')}
            className="h-8 w-64 bg-background font-medium"
          />
          <label htmlFor="dashboard-shared" className="flex items-center gap-2 text-xs">
            <Switch
              id="dashboard-shared"
              checked={draft.shared}
              onCheckedChange={(shared) => setDraft({ ...draft, shared })}
            />
            {$t('Visible des conseillers')}
          </label>
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 bg-background text-xs"
            onClick={addQuestion}
          >
            <Plus className="size-3.5" />
            {$t('Question')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 bg-background text-xs"
            onClick={addText}
          >
            <Type className="size-3.5" />
            {$t('Texte')}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={$t('Autres actions')}>
                <Ellipsis className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                disabled={busy}
                onSelect={() => void remove()}
              >
                <Trash2 />
                {$t('Supprimer le tableau de bord')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setDraft(null)}>
            {$t('Annuler')}
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy && <LoaderCircle className="size-3.5 animate-spin" />}
            {$t('Enregistrer')}
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto bg-muted/30 scroll-discret">
        {error && (
          <p className="m-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {list === null && !error && <CardsSkeleton />}
        {shown && (
          <Grid
            cards={shown.cards}
            runs={runs}
            sources={sources}
            editing={draft !== null}
            onLayout={(layout) =>
              setCards((cards) =>
                cards.map((card) => {
                  const item = layout.find((l) => l.i === card.id)
                  return item ? { ...card, x: item.x, y: item.y, w: item.w, h: item.h } : card
                }),
              )
            }
            onEdit={(card) => setEditing(card)}
            onChange={(card) =>
              setCards((cards) => cards.map((c) => (c.id === card.id ? card : c)))
            }
            onRemove={(id) => setCards((cards) => cards.filter((c) => c.id !== id))}
            onDuplicate={(card) =>
              setCards((cards) => [...cards, { ...card, id: newId(), y: below(cards) }])
            }
          />
        )}
        {shown && shown.cards.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <LayoutDashboard className="size-8 text-muted-foreground" />
            <p className="max-w-sm text-sm text-muted-foreground">
              {draft
                ? $t('Ajoutez une question : un nombre, un tableau, un graphique.')
                : $t('Ce tableau de bord est vide.')}
            </p>
            {draft && (
              <Button size="sm" className="gap-1.5" onClick={addQuestion}>
                <Plus className="size-4" />
                {$t('Ajouter une question')}
              </Button>
            )}
          </div>
        )}
      </div>

      {editing && (
        <QuestionEditor
          card={editing}
          sources={sources}
          ai
          onClose={() => setEditing(null)}
          onSave={(card) => {
            setCards((cards) =>
              cards.some((c) => c.id === card.id)
                ? cards.map((c) => (c.id === card.id ? card : c))
                : [...cards, card],
            )
            setEditing(null)
          }}
        />
      )}
    </>
  )
}

function Grid({
  cards,
  runs,
  sources,
  editing,
  onLayout,
  onEdit,
  onChange,
  onRemove,
  onDuplicate,
}: {
  readonly cards: readonly DashboardCard[]
  readonly runs: Readonly<Record<string, Run>>
  readonly sources: readonly AnalyticsSource[]
  readonly editing: boolean
  readonly onLayout: (layout: Layout) => void
  readonly onEdit: (card: DashboardCard) => void
  readonly onChange: (card: DashboardCard) => void
  readonly onRemove: (id: string) => void
  readonly onDuplicate: (card: DashboardCard) => void
}) {
  const { width, containerRef, mounted } = useContainerWidth()
  const layout = useMemo(
    () => cards.map((c) => ({ i: c.id, x: c.x, y: c.y, w: c.w, h: c.h, minW: 2, minH: 2 })),
    [cards],
  )
  // A phone reads the cards one under the other.
  const narrow = !editing && width > 0 && width < 640
  const frame = (card: DashboardCard) => (
    <CardFrame
      card={card}
      run={runs[card.id]}
      sources={sources}
      editing={editing}
      onEdit={() => onEdit(card)}
      onChange={onChange}
      onRemove={() => onRemove(card.id)}
      onDuplicate={() => onDuplicate(card)}
    />
  )
  const sorted = useMemo(() => [...cards].sort((a, b) => a.y - b.y || a.x - b.x), [cards])
  const layoutRef = useRef(onLayout)
  layoutRef.current = onLayout
  return (
    <div ref={containerRef} className="dashboard-grid p-4">
      {mounted && narrow && (
        <div className="space-y-3">
          {sorted.map((card) => (
            <div key={card.id} style={{ height: card.h * ROW_HEIGHT }}>
              {frame(card)}
            </div>
          ))}
        </div>
      )}
      {mounted && !narrow && cards.length > 0 && (
        <ReactGridLayout
          layout={layout}
          width={width - 32}
          gridConfig={{
            cols: COLUMNS,
            rowHeight: ROW_HEIGHT,
            margin: [12, 12],
            containerPadding: [0, 0],
          }}
          dragConfig={{ enabled: editing, handle: '.card-handle', threshold: 3 }}
          resizeConfig={{ enabled: editing, handles: ['se'] }}
          compactor={verticalCompactor}
          onLayoutChange={(next: Layout) => {
            if (editing) layoutRef.current(next)
          }}
        >
          {cards.map((card) => (
            <div key={card.id}>{frame(card)}</div>
          ))}
        </ReactGridLayout>
      )}
    </div>
  )
}

function CardFrame({
  card,
  run,
  sources,
  editing,
  onEdit,
  onChange,
  onRemove,
  onDuplicate,
}: {
  readonly card: DashboardCard
  readonly run: Run | undefined
  readonly sources: readonly AnalyticsSource[]
  readonly editing: boolean
  readonly onEdit: () => void
  readonly onChange: (card: DashboardCard) => void
  readonly onRemove: () => void
  readonly onDuplicate: () => void
}) {
  const [asTable, setAsTable] = useState(false)
  const text = card.kind === 'text'
  return (
    <div
      className={cn(
        'flex size-full flex-col rounded-xl border bg-card',
        text && !editing && 'border-transparent bg-transparent',
        editing && 'ring-1 ring-primary/20',
      )}
    >
      {(!text || editing) && (
        <div className="flex shrink-0 items-center gap-1.5 px-3 pt-2.5 pb-1">
          {editing && (
            <span className="card-handle -ml-1 cursor-grab text-muted-foreground active:cursor-grabbing">
              <GripVertical className="size-4" />
            </span>
          )}
          <h3 className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
            {card.title || (text ? $t('Texte') : $t('Sans titre'))}
          </h3>
          {!text && card.question?.viz.type !== 'table' && card.question?.viz.type !== 'number' && (
            <Hint label={asTable ? $t('Voir le graphique') : $t('Voir les chiffres')}>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-6"
                onClick={() => setAsTable((t) => !t)}
                aria-label={$t('Voir les chiffres')}
              >
                <Table2
                  className={cn('size-3.5', asTable ? 'text-foreground' : 'text-muted-foreground')}
                />
              </Button>
            </Hint>
          )}
          {editing && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-6"
                  aria-label={$t('Actions de la carte')}
                >
                  <Ellipsis className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {!text && (
                  <DropdownMenuItem onSelect={onEdit}>
                    <Pencil />
                    {$t('Modifier la question')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={onDuplicate}>
                  <Copy />
                  {$t('Dupliquer')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={onRemove}
                >
                  <Trash2 />
                  {$t('Retirer la carte')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1 px-3 pb-3">
        {text ? (
          editing ? (
            <Textarea
              value={card.text ?? ''}
              onChange={(e) => onChange({ ...card, text: e.target.value })}
              placeholder={$t('Un titre de section, une explication…')}
              className="size-full resize-none text-sm"
              aria-label={$t('Texte de la carte')}
            />
          ) : (
            <p className="text-sm whitespace-pre-wrap">{card.text}</p>
          )
        ) : run?.error ? (
          <p className="font-mono text-xs text-destructive">{run.error}</p>
        ) : run?.result && card.question ? (
          // Refreshed, the result stays, faded, until the new one comes.
          <div className={cn('size-full transition-opacity', run.loading && 'opacity-50')}>
            <ResultView
              result={run.result}
              viz={card.question.viz}
              sources={sources}
              asTable={asTable}
            />
          </div>
        ) : card.question?.viz.type === 'number' ? (
          <Skeleton className="mt-2 h-8 w-20" />
        ) : (
          <Skeleton className="size-full" />
        )}
      </div>
    </div>
  )
}
