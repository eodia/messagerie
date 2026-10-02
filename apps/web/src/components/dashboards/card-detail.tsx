'use client'

import { Chip } from '@/components/app/chip'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { type FocusPart, VIZ_LABELS, focusOf } from '@/lib/analytics'
import { ApiFailure, api } from '@/lib/api'
import { $t, $tp } from '@/lib/i18n'
import { messageFor } from '@/lib/messages'
import type {
  AnalyticsSource,
  DashboardCard,
  DashboardFilter,
  FilterValues,
  QueryResult,
} from '@chat/contracts'
import { Filter, Rows3, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { type PointEvent, ResultTable, ResultView } from './visualization'

/**
 * A card opened from its title (D22) — basedb's exploration, kept to reading: its result
 * at full size, its numbers, and the rows behind it, under the dashboard's filters. A point
 * clicked opens the rows of that point; each condition it adds is a chip to take away.
 */

export type DetailTab = 'result' | 'table' | 'rows'

export interface DetailRequest {
  readonly cardId: string
  readonly focus: readonly FocusPart[]
  readonly tab: DetailTab
}

/** The most rows the detail reads — the server's bound. */
const DETAIL_ROWS = 500

export function CardDetail({
  dashboardId,
  card,
  result,
  values,
  sources,
  focus: firstFocus,
  tab: firstTab,
  onClose,
}: {
  readonly dashboardId: string
  readonly card: DashboardCard
  /** The card's result, as the dashboard shows it. */
  readonly result: QueryResult | undefined
  readonly values: FilterValues
  readonly sources: readonly AnalyticsSource[]
  readonly focus: readonly FocusPart[]
  readonly tab: DetailTab
  readonly onClose: () => void
}) {
  const question = card.question
  const builder = question?.mode === 'builder'
  const chart = question !== undefined && question.viz.type !== 'table'
  const [tab, setTab] = useState<DetailTab>(firstTab === 'result' && !chart ? 'table' : firstTab)
  const [focus, setFocus] = useState<readonly FocusPart[]>(firstFocus)
  const [rows, setRows] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const source = builder ? sources.find((s) => s.key === question.query.source) : undefined

  // The rows, read again as the conditions change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the conditions' text is the key
  useEffect(() => {
    if (tab !== 'rows' || !builder) return
    let alive = true
    setRows(null)
    setError(null)
    api
      .cardDetail(dashboardId, card.id, {
        values,
        rows: true,
        focus: focus.map((f) => f.filter),
      })
      .then(
        (next) => alive && setRows(next),
        (failure) =>
          alive &&
          setError(messageFor(failure instanceof ApiFailure ? failure.code : 'INTERNAL_ERROR')),
      )
    return () => {
      alive = false
    }
  }, [tab, JSON.stringify(focus), JSON.stringify(values)])

  const openRows = builder
    ? (event: PointEvent) => {
        if (!result) return
        setFocus(focusOf(result, event.row, sources))
        setTab('rows')
      }
    : undefined

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[85vh] max-w-[min(1100px,96vw)] flex-col gap-0 p-0 sm:max-w-[min(1100px,96vw)]">
        <DialogHeader className="shrink-0 space-y-0.5 border-b px-5 pt-4 pb-0">
          <DialogTitle className="pr-8 text-base">{card.title || $t('Sans titre')}</DialogTitle>
          <DialogDescription className="text-xs">
            {[
              source ? $t(source.label) : $t('Requête SQL'),
              question && $t(VIZ_LABELS[question.viz.type]),
            ]
              .filter(Boolean)
              .join(' · ')}
          </DialogDescription>
          <Tabs value={tab} onValueChange={(v) => setTab(v as DetailTab)} className="mt-2">
            <TabsList>
              {chart && <TabsTrigger value="result">{$t('Graphique')}</TabsTrigger>}
              <TabsTrigger value="table">{$t('Chiffres')}</TabsTrigger>
              {builder && <TabsTrigger value="rows">{$t('Lignes')}</TabsTrigger>}
            </TabsList>
          </Tabs>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          {tab === 'rows' ? (
            <>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b px-5 py-2">
                {focus.map((part, i) => (
                  <Chip
                    key={`${part.column}-${i}`}
                    tint="violet"
                    className="h-6 gap-1 pr-1 text-xs"
                  >
                    <Filter />
                    {part.label}
                    <button
                      type="button"
                      onClick={() => setFocus(focus.filter((_, j) => j !== i))}
                      aria-label={$t('Retirer « {label} »', { label: part.label })}
                      className="rounded-full p-0.5 hover:bg-violet-500/20"
                    >
                      <X className="size-3" />
                    </button>
                  </Chip>
                ))}
                {focus.length === 0 && (
                  <span className="text-xs text-muted-foreground">
                    {$t('Toutes les lignes de la carte, sous les filtres du tableau de bord.')}
                  </span>
                )}
                <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
                  {rows &&
                    (rows.rows.length >= DETAIL_ROWS
                      ? $t('Les {count} premières lignes', { count: DETAIL_ROWS })
                      : $tp(rows.rows.length, '{count} ligne', '{count} lignes'))}
                </span>
              </div>
              <div className="min-h-0 flex-1">
                {error ? (
                  <p className="m-5 text-sm text-destructive">{error}</p>
                ) : rows ? (
                  <ResultTable result={rows} sources={sources} />
                ) : (
                  <div className="space-y-2 p-5">
                    {Array.from({ length: 8 }, (_, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
                      <Skeleton key={i} className="h-6 w-full" />
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : result && question ? (
            <div className="min-h-0 flex-1 p-5">
              <ResultView
                result={result}
                viz={question.viz}
                sources={sources}
                asTable={tab === 'table'}
                onPoint={openRows}
              />
            </div>
          ) : (
            <Skeleton className="m-5 flex-1" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * A point clicked on a card: the rows behind it, or the dashboard filtered by its value —
 * when one of its filters is tied to the card on that column.
 */
export function PointMenu({
  card,
  event,
  result,
  sources,
  filters,
  onRows,
  onFilter,
  onClose,
}: {
  readonly card: DashboardCard
  readonly event: PointEvent
  readonly result: QueryResult
  readonly sources: readonly AnalyticsSource[]
  readonly filters: readonly DashboardFilter[]
  readonly onRows: (focus: readonly FocusPart[]) => void
  readonly onFilter: (filter: string, value: readonly string[]) => void
  readonly onClose: () => void
}) {
  const focus = focusOf(result, event.row, sources)
  const filtering = focus.flatMap((part) => {
    if (part.value === null || part.value === undefined || part.filter.op === 'at') return []
    const link = card.links?.find((l) => l.column === part.column)
    const filter = filters.find((f) => f.id === link?.filter && f.kind === 'choice')
    return filter ? [{ filter, part }] : []
  })
  return (
    <Popover open onOpenChange={(open) => !open && onClose()}>
      <PopoverAnchor asChild>
        <span
          className="pointer-events-none fixed size-px"
          style={{ left: event.x, top: event.y }}
        />
      </PopoverAnchor>
      <PopoverContent className="w-64 p-1">
        {focus.length > 0 && (
          <p className="truncate px-2 pt-1 pb-1.5 text-[11px] text-muted-foreground">
            {focus.map((f) => f.label).join(' · ')}
          </p>
        )}
        <button
          type="button"
          onClick={() => onRows(focus)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
        >
          <Rows3 className="size-3.5 text-muted-foreground" />
          {$t('Voir ces lignes')}
        </button>
        {filtering.map(({ filter, part }) => (
          <button
            key={filter.id}
            type="button"
            onClick={() => onFilter(filter.id, [String(part.value)])}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
          >
            <Filter className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {$t('Filtrer le tableau : {label}', { label: part.label })}
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
