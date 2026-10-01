'use client'

import { Chip, ColorBadge } from '@/components/app/chip'
import { InboxGlyph } from '@/components/app/look'
import { ResizablePanel } from '@/components/app/resizable-panel'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Hint } from '@/components/ui/tooltip'
import { $t, $tp, formatCount, msg } from '@/lib/i18n'
import { type InboxFilter, inInbox, matchesFilter, useInbox } from '@/lib/store/inbox'
import { type Sort, matchesFilters, sorted, useListFilters } from '@/lib/store/list-filters'
import { inboxTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { Agent, ConversationSummary, InboxItem } from '@chat/contracts'
import {
  ArrowUp,
  BadgeCheck,
  ChevronsUp,
  Clock,
  Frown,
  Inbox,
  Paperclip,
  Search,
  Sparkles,
} from 'lucide-react'
import { type RefObject, useLayoutEffect, useMemo } from 'react'
import { ContactAvatar, StateChip } from './labels'
import { ActiveFilters, FiltersButton } from './list-filters'

/**
 * The filters above the list. `short` is what the list shows where the label would not fit
 * at the pane's narrowest; the filter menu, which has the room, keeps the label.
 */
const TABS: readonly {
  readonly filter: InboxFilter
  readonly label: string
  readonly short?: string
}[] = [
  { filter: 'all', label: msg('Toutes') },
  { filter: 'ai', label: msg('IA') },
  { filter: 'open', label: msg('Ouvertes') },
  { filter: 'unassigned', label: msg('Non assignées'), short: msg('En file') },
]

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

/** Accents and case aside — « emma », « Émma » and « EMMA » find the same row. */
function matchesQuery(summary: ConversationSummary, query: string): boolean {
  if (query === '') return true
  const needle = fold(query)
  return [summary.contact.name, summary.contact.email ?? '', summary.preview].some((text) =>
    fold(text).includes(needle),
  )
}

export function ConversationList({
  searchRef,
}: {
  readonly searchRef: RefObject<HTMLInputElement | null>
}) {
  const summaries = useInbox((s) => s.summaries)
  const me = useInbox((s) => s.me)
  const selectedId = useInbox((s) => s.selectedId)
  const filter = useInbox((s) => s.filter)
  const query = useInbox((s) => s.query)
  const now = useInbox((s) => s.now)
  const inbox = useInbox((s) => s.inbox)
  const inboxes = useInbox((s) => s.directory.inboxes)
  const { select, setFilter, setQuery } = useInbox.getState()
  const filters = useListFilters()

  // The filters kept in this browser, before the first paint.
  useLayoutEffect(() => useListFilters.getState().initialize(), [])

  // The chosen inbox's conversations — the tabs count within it, its filters applied.
  const inThisInbox = useMemo(() => summaries.filter((s) => inInbox(s, inbox)), [summaries, inbox])
  const narrowed = useMemo(
    () => inThisInbox.filter((s) => matchesFilters(s, filters, me, now)),
    [inThisInbox, filters, me, now],
  )
  const shown = useMemo(
    () =>
      sorted(
        narrowed.filter((s) => matchesFilter(s, filter) && matchesQuery(s, query.trim())),
        filters.sort,
        now,
      ),
    [narrowed, filter, query, filters.sort, now],
  )

  return (
    <ResizablePanel panel="list" side="left" as="section" label={$t('la liste des conversations')}>
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b px-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={$t('Rechercher une conversation…')}
            className="h-8 w-full rounded-lg border bg-muted/40 pr-2 pl-8 text-xs shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25"
          />
        </div>
        <FiltersButton rows={inThisInbox} />
      </div>

      {/* Underlined, as the inbox's other tabs: short labels and quiet counts, so that the
          row fits the pane at its narrowest. « Résolues » is in the filter menu. */}
      <Tabs
        value={filter}
        onValueChange={(value) => setFilter(value as InboxFilter)}
        className="shrink-0"
      >
        <TabsList className="h-10 w-full justify-start gap-4 px-3">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.filter} value={tab.filter} className="h-10 min-w-0 gap-1 text-xs">
              <Hint label={tab.short && $t(tab.label)}>
                <span className="truncate">{$t(tab.short ?? tab.label)}</span>
              </Hint>
              <span className="shrink-0 text-[11px] font-normal text-muted-foreground tabular-nums">
                {formatCount(narrowed.filter((s) => matchesFilter(s, tab.filter)).length)}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <ActiveFilters />

      <div className="flex-1 overflow-y-auto scroll-discret">
        {(filters.sort === 'recent' ? groupsOf(shown, now) : orderedBy(shown, filters.sort)).map(
          (group) => (
            <section key={group.key} aria-label={$t(group.label)}>
              <h3 className="sticky top-0 z-10 flex items-center gap-2 bg-background/85 px-4 pt-3 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase backdrop-blur-sm">
                {$t(group.label)}
                <span className="font-normal tabular-nums">{group.items.length}</span>
              </h3>
              <ul className="space-y-0.5 px-1.5 pb-1">
                {group.items.map((summary) => (
                  <li key={summary.id}>
                    <ConversationRow
                      summary={summary}
                      me={me}
                      inbox={inboxes.find((i) => i.id === summary.inboxId) ?? null}
                      selected={summary.id === selectedId}
                      time={inboxTime(summary.lastMessageAt, now)}
                      now={now}
                      onSelect={() => select(summary.id)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ),
        )}
        {shown.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-muted">
              <Inbox className="size-5 text-muted-foreground" />
            </span>
            <p className="max-w-56 text-sm text-muted-foreground">
              {query
                ? $t('Aucune conversation ne correspond.')
                : filter === 'unassigned'
                  ? $t('La file est vide : chaque conversation a son conseiller.')
                  : $t('Aucune conversation ici.')}
            </p>
          </div>
        )}
      </div>
    </ResizablePanel>
  )
}

export function ConversationRow({
  summary,
  me,
  inbox = null,
  selected,
  time,
  now = new Date(),
  onSelect,
}: {
  readonly summary: ConversationSummary
  readonly me: Agent | null
  /** Its inbox — its mark goes on the avatar. */
  readonly inbox?: InboxItem | null
  readonly selected: boolean
  readonly time: string
  readonly now?: Date
  readonly onSelect: () => void
}) {
  const { contact, unread, assignee } = summary
  const waiting = waitingOf(summary, now)
  const mine = summary.assigneeId !== null && summary.assigneeId === me?.id
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'group relative flex w-full gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors',
        selected ? 'bg-accent' : 'hover:bg-muted/60',
      )}
    >
      {selected && (
        <span className="absolute top-3 bottom-3 left-0 w-[3px] rounded-full bg-primary" />
      )}

      <span className="relative mt-0.5 shrink-0 self-start">
        <ContactAvatar name={contact.name} className="size-9" />
        {inbox && (
          <Hint label={inbox.name}>
            <span className="absolute -right-1 -bottom-1 flex size-[18px] items-center justify-center rounded-full bg-background ring-2 ring-background">
              <InboxGlyph look={inbox} className="size-3" dot="size-2" />
            </span>
          </Hint>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              'truncate text-[13px]',
              unread ? 'font-semibold text-foreground' : 'font-medium',
            )}
          >
            {contact.name}
          </span>
          {contact.identified && (
            <Hint label={$t('Client identifié par le site')}>
              <BadgeCheck className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            </Hint>
          )}
          <span
            className={cn(
              'ml-auto shrink-0 text-[11px] tabular-nums',
              unread ? 'font-medium text-foreground' : 'text-muted-foreground',
            )}
          >
            {time}
          </span>
        </span>

        <span className="mt-0.5 flex items-center gap-2">
          <span
            className={cn(
              'flex min-w-0 flex-1 items-center gap-1 text-xs',
              unread ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            <Said summary={summary} me={me} />
          </span>
          {unread && (
            <span className="size-2 shrink-0 rounded-full bg-primary ring-4 ring-primary/15" />
          )}
        </span>

        <span className="mt-2 flex min-w-0 items-center gap-1.5">
          <StateChip conversation={summary} className="shrink-0" />
          {summary.priority === 'urgent' || summary.priority === 'high' ? (
            <Chip tint={summary.priority === 'urgent' ? 'rose' : 'amber'} className="shrink-0">
              {summary.priority === 'urgent' ? <ChevronsUp /> : <ArrowUp />}
              {summary.priority === 'urgent' ? $t('Urgente') : $t('Haute')}
            </Chip>
          ) : null}
          {summary.sentiment === 'negative' && (
            <Hint label={$t('Sentiment négatif')}>
              <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-rose-500/15 text-rose-700 dark:text-rose-300">
                <Frown className="size-3" />
              </span>
            </Hint>
          )}
          {waiting && (
            <Hint
              label={$t('Le visiteur attend une réponse depuis {time}', { time: waiting.label })}
            >
              <span
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums',
                  waiting.level === 'late'
                    ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                    : waiting.level === 'slow'
                      ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                      : 'bg-muted text-muted-foreground',
                )}
              >
                <Clock className="size-3" />
                {waiting.label}
              </span>
            </Hint>
          )}
          <span className="flex min-w-0 items-center gap-1 overflow-hidden">
            {summary.tags.slice(0, 1).map((tag) => (
              <ColorBadge
                key={tag.label}
                color={tag.color}
                className="min-w-0 max-w-28 shrink text-[11px]"
              >
                <span className="truncate">{tag.label}</span>
              </ColorBadge>
            ))}
            {summary.tags.length > 1 && (
              <Hint
                label={summary.tags
                  .slice(1)
                  .map((t) => t.label)
                  .join(', ')}
              >
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  +{summary.tags.length - 1}
                </span>
              </Hint>
            )}
          </span>
          {assignee && (
            <Hint label={mine ? $t('À vous') : $t('Affectée à {name}', { name: assignee })}>
              <span className="ml-auto shrink-0">
                <ContactAvatar
                  name={assignee}
                  className={cn('size-5 text-[8px]', mine && 'ring-2 ring-primary/40')}
                />
              </span>
            </Hint>
          )}
        </span>
      </span>
    </button>
  )
}

/** The last thing said: who said it, as an icon or a name, then what — or its files. */
function Said({
  summary,
  me,
}: { readonly summary: ConversationSummary; readonly me: Agent | null }) {
  const files = summary.previewFiles
  const who =
    summary.previewAuthor === 'ai' ? (
      <Sparkles className="size-3 shrink-0 text-violet-600 dark:text-violet-300" />
    ) : summary.previewAuthor === 'agent' ? (
      <span className="shrink-0 font-medium">
        {summary.previewAgent === me?.name
          ? $t('Vous :')
          : $t('{name} :', { name: (summary.previewAgent ?? '').split(/\s+/)[0] ?? '' })}
      </span>
    ) : null
  return (
    <>
      {who}
      {files > 0 && <Paperclip className="size-3 shrink-0" />}
      <span className="truncate">
        {summary.preview ||
          (files > 0
            ? $tp(files, '{count} fichier', '{count} fichiers')
            : $t('Pas encore de message'))}
      </span>
    </>
  )
}

/**
 * How long the visitor has waited for an answer — when they spoke last, and someone other
 * than the AI is to answer. Five minutes is slow, half an hour late.
 */
function waitingOf(
  summary: ConversationSummary,
  now: Date,
): { readonly label: string; readonly level: 'fresh' | 'slow' | 'late' } | null {
  if (summary.previewAuthor !== 'visitor') return null
  if (summary.status === 'ai' || summary.status === 'resolved') return null
  const minutes = Math.floor((now.getTime() - new Date(summary.lastMessageAt).getTime()) / 60_000)
  if (minutes < 1) return null
  const label =
    minutes < 60
      ? $t('{count} min', { count: minutes })
      : minutes < 48 * 60
        ? $t('{count} h', { count: Math.floor(minutes / 60) })
        : $t('{count} j', { count: Math.floor(minutes / (24 * 60)) })
  return { label, level: minutes >= 30 ? 'late' : minutes >= 5 ? 'slow' : 'fresh' }
}

/** One group, named by the order chosen, when the rows are not read by day. */
function orderedBy(rows: readonly ConversationSummary[], sort: Sort) {
  return rows.length === 0
    ? []
    : [
        {
          key: sort,
          label:
            sort === 'waiting' ? msg('Par attente, la plus longue d’abord') : msg('Par priorité'),
          items: rows,
        },
      ]
}

const GROUPS = [
  { key: 'today', label: msg('Aujourd’hui') },
  { key: 'yesterday', label: msg('Hier') },
  { key: 'week', label: msg('Cette semaine') },
  { key: 'older', label: msg('Plus ancien') },
] as const

/** The rows by day of their last message — the list is newest first already. */
function groupsOf(rows: readonly ConversationSummary[], now: Date) {
  const day = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const today = day(now)
  const keyOf = (iso: string) => {
    const days = Math.round((today - day(new Date(iso))) / 86_400_000)
    return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 7 ? 'week' : 'older'
  }
  return GROUPS.map((group) => ({
    ...group,
    items: rows.filter((row) => keyOf(row.lastMessageAt) === group.key),
  })).filter((group) => group.items.length > 0)
}
