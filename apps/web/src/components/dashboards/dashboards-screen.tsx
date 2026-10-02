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
import { VIZ_LABELS } from '@/lib/analytics'
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
  DashboardFilter,
  FilterValues,
  QueryResult,
} from '@chat/contracts'
import {
  ChevronDown,
  Copy,
  Ellipsis,
  Filter,
  GripVertical,
  Heading,
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
import { CardDetail, type DetailRequest, PointMenu } from './card-detail'
import { FilterBar, FilterEditor, relinked, suggestedColumn } from './filters'
import { QuestionEditor } from './question-editor'
import { type PointEvent, ResultView } from './visualization'

/**
 * « Tableaux de bord » (D22) — basedb's: cards on a twelve-column grid, each a question
 * drawn as a number, a trend, a table or a chart, under section titles. A card's title opens
 * it whole, a point of it the rows behind. Everyone sees the shared ones; supervisors
 * arrange them, add questions — built by choosing or written in SQL —, titles and texts.
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
  filters: d.filters,
  shared: d.shared,
})

/** The filters' values a viewer chose, kept in this browser by dashboard — a convenience. */
const VALUES_KEY = (id: string) => `chat.dashboard-filters.${id}`

function storedValues(id: string): FilterValues {
  try {
    const raw = window.localStorage.getItem(VALUES_KEY(id))
    return raw ? (JSON.parse(raw) as FilterValues) : {}
  } catch {
    return {}
  }
}

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
  const [values, setValues] = useState<FilterValues>({})
  const [filterEdited, setFilterEdited] = useState<DashboardFilter | 'new' | null>(null)
  const [detail, setDetail] = useState<DetailRequest | null>(null)
  const [point, setPoint] = useState<{
    readonly card: DashboardCard
    readonly event: PointEvent
  } | null>(null)

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

  // A dashboard opened: the values this viewer chose last, else each filter's own.
  const openedId = current?.id ?? null
  useEffect(() => {
    if (openedId) setValues(storedValues(openedId))
  }, [openedId])
  const valuesShown: FilterValues = Object.fromEntries(
    (shown?.filters ?? []).map((f) => [f.id, values[f.id] ?? f.default]),
  )
  const chooseValue = (id: string, value: readonly string[]) => {
    const next = { ...values, [id]: value }
    setValues(next)
    try {
      if (current) window.localStorage.setItem(VALUES_KEY(current.id), JSON.stringify(next))
    } catch {
      // A blocked storage forgets the choice next time, nothing more.
    }
  }

  // The cards' results: the saved ones by their card, the ones being changed by their question.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run again on a dashboard, a refresh, a draft's cards
  useEffect(() => {
    if (!shown || !current) return
    let alive = true
    const cards = shown.cards.filter((c) => c.kind === 'question' && c.question)
    const savedCards = new Map(
      current.cards.map((c) => [c.id, JSON.stringify([c.question, c.links ?? []])]),
    )
    const savedFilters = JSON.stringify(current.filters)
    setRuns((r) => Object.fromEntries(cards.map((c) => [c.id, { ...r[c.id], loading: true }])))
    const queue = [...cards]
    const next = async (): Promise<void> => {
      const card = queue.shift()
      if (!card || !alive) return
      const saved =
        savedCards.get(card.id) === JSON.stringify([card.question, card.links ?? []]) &&
        savedFilters === JSON.stringify(shown.filters)
      try {
        const result = saved
          ? await api.runCard(current.id, card.id, valuesShown)
          : await api.runQuestion(card.question as NonNullable<DashboardCard['question']>, {
              filters: shown.filters,
              links: card.links ?? [],
              values: valuesShown,
            })
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
  }, [
    current?.id,
    tick,
    JSON.stringify(shown?.cards.map((c) => [c.id, c.question, c.links])),
    JSON.stringify(shown?.filters),
    JSON.stringify(valuesShown),
  ])

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
        filters: [],
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

  const addHeading = () =>
    setCards((cards) => [
      ...cards,
      {
        id: newId(),
        x: 0,
        y: below(cards),
        w: 12,
        h: 1,
        title: '',
        kind: 'heading',
        text: $t('Titre de section'),
      },
    ])

  const detailCard = detail ? shown?.cards.find((c) => c.id === detail.cardId) : undefined

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
            onClick={addHeading}
          >
            <Heading className="size-3.5" />
            {$t('Titre')}
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
          <FilterBar
            filters={shown.filters}
            values={valuesShown}
            sources={sources}
            editing={draft !== null}
            onChange={chooseValue}
            onEdit={(filter) => setFilterEdited(filter)}
            onAdd={() => setFilterEdited('new')}
          />
        )}
        {shown && (
          <Grid
            cards={shown.cards}
            filters={shown.filters}
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
            onOpen={(card) => setDetail({ cardId: card.id, focus: [], tab: 'result' })}
            onPoint={(card, event) => setPoint({ card, event })}
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
            setCards((cards) => {
              if (cards.some((c) => c.id === card.id)) {
                return cards.map((c) => (c.id === card.id ? card : c))
              }
              // A new card follows the dashboard's filters it has a column for.
              const links = (draft?.filters ?? []).flatMap((filter) => {
                const column = suggestedColumn(card, filter, sources)
                return column ? [{ filter: filter.id, column }] : []
              })
              return [...cards, links.length > 0 ? { ...card, links } : card]
            })
            setEditing(null)
          }}
        />
      )}

      {detail && detailCard && current && (
        <CardDetail
          key={JSON.stringify(detail)}
          dashboardId={current.id}
          card={detailCard}
          result={runs[detailCard.id]?.result}
          values={valuesShown}
          sources={sources}
          focus={detail.focus}
          tab={detail.tab}
          onClose={() => setDetail(null)}
        />
      )}

      {point && shown && runs[point.card.id]?.result && (
        <PointMenu
          card={point.card}
          event={point.event}
          result={runs[point.card.id]?.result as QueryResult}
          sources={sources}
          filters={shown.filters}
          onRows={(focus) => {
            setDetail({ cardId: point.card.id, focus, tab: 'rows' })
            setPoint(null)
          }}
          onFilter={(id, value) => {
            chooseValue(id, value)
            setPoint(null)
          }}
          onClose={() => setPoint(null)}
        />
      )}

      {filterEdited !== null && draft && (
        <FilterEditor
          filter={filterEdited === 'new' ? null : filterEdited}
          cards={draft.cards}
          sources={sources}
          onClose={() => setFilterEdited(null)}
          onSave={(filter, links) => {
            setDraft((d) =>
              d
                ? {
                    ...d,
                    filters: d.filters.some((f) => f.id === filter.id)
                      ? d.filters.map((f) => (f.id === filter.id ? filter : f))
                      : [...d.filters, filter],
                    cards: relinked(d.cards, filter.id, links),
                  }
                : d,
            )
            setFilterEdited(null)
          }}
          {...(filterEdited === 'new'
            ? {}
            : {
                onRemove: () => {
                  const id = filterEdited.id
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          filters: d.filters.filter((f) => f.id !== id),
                          cards: relinked(
                            d.cards,
                            id,
                            Object.fromEntries(d.cards.map((c) => [c.id, null])),
                          ),
                        }
                      : d,
                  )
                  setFilterEdited(null)
                },
              })}
        />
      )}
    </>
  )
}

function Grid({
  cards,
  filters,
  runs,
  sources,
  editing,
  onLayout,
  onEdit,
  onChange,
  onRemove,
  onDuplicate,
  onOpen,
  onPoint,
}: {
  readonly cards: readonly DashboardCard[]
  readonly filters: readonly DashboardFilter[]
  readonly runs: Readonly<Record<string, Run>>
  readonly sources: readonly AnalyticsSource[]
  readonly editing: boolean
  readonly onLayout: (layout: Layout) => void
  readonly onEdit: (card: DashboardCard) => void
  readonly onChange: (card: DashboardCard) => void
  readonly onRemove: (id: string) => void
  readonly onDuplicate: (card: DashboardCard) => void
  readonly onOpen: (card: DashboardCard) => void
  readonly onPoint: (card: DashboardCard, event: PointEvent) => void
}) {
  const { width, containerRef, mounted } = useContainerWidth()
  const layout = useMemo(
    () =>
      cards.map((c) => ({
        i: c.id,
        x: c.x,
        y: c.y,
        w: c.w,
        h: c.h,
        minW: c.kind === 'heading' ? 4 : 2,
        minH: c.kind === 'heading' ? 1 : 2,
        ...(c.kind === 'heading' ? { maxH: 2 } : {}),
      })),
    [cards],
  )
  // A phone reads the cards one under the other.
  const narrow = !editing && width > 0 && width < 640
  const frame = (card: DashboardCard) => (
    <CardFrame
      card={card}
      followed={filters.filter((f) => card.links?.some((l) => l.filter === f.id))}
      run={runs[card.id]}
      sources={sources}
      editing={editing}
      onEdit={() => onEdit(card)}
      onChange={onChange}
      onRemove={() => onRemove(card.id)}
      onDuplicate={() => onDuplicate(card)}
      onOpen={() => onOpen(card)}
      onPoint={(event) => onPoint(card, event)}
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
  followed,
  run,
  sources,
  editing,
  onEdit,
  onChange,
  onRemove,
  onDuplicate,
  onOpen,
  onPoint,
}: {
  readonly card: DashboardCard
  /** The filters it follows. */
  readonly followed: readonly DashboardFilter[]
  readonly run: Run | undefined
  readonly sources: readonly AnalyticsSource[]
  readonly editing: boolean
  readonly onEdit: () => void
  readonly onChange: (card: DashboardCard) => void
  readonly onRemove: () => void
  readonly onDuplicate: () => void
  /** Its title clicked: the card at full size, its rows. */
  readonly onOpen: () => void
  /** A point of it clicked. */
  readonly onPoint: (event: PointEvent) => void
}) {
  const [asTable, setAsTable] = useState(false)
  const menu = (
    <CardMenu card={card} onEdit={onEdit} onDuplicate={onDuplicate} onRemove={onRemove} />
  )

  if (card.kind === 'heading') {
    return (
      <div className="flex size-full items-end gap-1 border-b-2 border-border pb-1">
        {editing && (
          <span className="card-handle mb-1.5 cursor-grab text-muted-foreground active:cursor-grabbing">
            <GripVertical className="size-4" />
          </span>
        )}
        {editing ? (
          <input
            value={card.text ?? ''}
            onChange={(e) => onChange({ ...card, text: e.target.value })}
            aria-label={$t('Titre de section')}
            className="min-w-0 flex-1 rounded bg-transparent px-1 text-xl font-semibold tracking-tight outline-none hover:bg-accent focus:bg-accent"
          />
        ) : (
          <h2 className="min-w-0 flex-1 truncate px-1 text-xl font-semibold tracking-tight">
            {card.text}
          </h2>
        )}
        {editing && menu}
      </div>
    )
  }

  const text = card.kind === 'text'
  const viz = card.question?.viz.type
  const builder = card.question?.mode === 'builder'
  const title = card.title || (text ? $t('Texte') : $t('Sans titre'))
  return (
    <section
      className={cn(
        'group flex size-full flex-col overflow-hidden rounded-xl border bg-card',
        text && !editing && 'border-transparent bg-transparent',
        editing && 'ring-primary/30 hover:ring-2',
      )}
    >
      {(!text || editing) && (
        <header className="flex shrink-0 items-center gap-1 px-3.5 pt-3 pb-1">
          {editing && (
            <span className="card-handle -ml-1.5 cursor-grab text-muted-foreground active:cursor-grabbing">
              <GripVertical className="size-4" />
            </span>
          )}
          {editing && !text ? (
            <input
              value={card.title}
              placeholder={$t('Sans titre')}
              onChange={(e) => onChange({ ...card, title: e.target.value })}
              aria-label={$t('Titre de la carte')}
              className="min-w-0 flex-1 rounded bg-transparent px-1 text-sm font-semibold outline-none hover:bg-accent focus:bg-accent"
            />
          ) : !text && card.question ? (
            <Hint label={$t('Voir le détail')}>
              <button
                type="button"
                onClick={onOpen}
                className="min-w-0 flex-1 truncate text-left text-sm font-semibold hover:text-primary"
              >
                {title}
              </button>
            </Hint>
          ) : (
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h3>
          )}
          {!editing && viz && (
            <span className="shrink-0 text-[11px] text-muted-foreground/70 opacity-0 transition-opacity group-hover:opacity-100">
              {$t(VIZ_LABELS[viz])}
            </span>
          )}
          {editing && followed.length > 0 && (
            <Hint
              label={$t('Suit : {filters}', { filters: followed.map((f) => f.label).join(', ') })}
            >
              <span className="flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                <Filter className="size-3" />
                {followed.length}
              </span>
            </Hint>
          )}
          {viz && !['table', 'number', 'trend', 'progress'].includes(viz) && (
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
          {editing && menu}
        </header>
      )}
      <div className={cn('min-h-0 flex-1 px-3.5 pb-3', viz === 'table' && 'px-1 pb-1')}>
        {text ? (
          editing ? (
            <Textarea
              value={card.text ?? ''}
              onChange={(e) => onChange({ ...card, text: e.target.value })}
              placeholder={$t('Une explication, une consigne…')}
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
              {...(builder && !editing ? { onPoint } : {})}
            />
          </div>
        ) : viz === 'number' || viz === 'trend' ? (
          <div className="space-y-2 pt-2">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-3 w-40" />
          </div>
        ) : (
          <Skeleton className="size-full" />
        )}
      </div>
    </section>
  )
}

function CardMenu({
  card,
  onEdit,
  onDuplicate,
  onRemove,
}: {
  readonly card: DashboardCard
  readonly onEdit: () => void
  readonly onDuplicate: () => void
  readonly onRemove: () => void
}) {
  return (
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
        {card.kind === 'question' && (
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
        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onRemove}>
          <Trash2 />
          {$t('Retirer la carte')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
