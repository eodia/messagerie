'use client'

import { Chip, ColorBadge } from '@/components/app/chip'
import { Lit } from '@/components/app/lit'
import { InboxGlyph } from '@/components/app/look'
import { ResizablePanel } from '@/components/app/resizable-panel'
import { Kbd } from '@/components/ui/kbd'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Hint } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import {
  type ListQuery,
  holds,
  parseListQuery,
  saysAll,
  searchConversations,
  wordsLit,
} from '@/lib/conversation-search'
import { $t, $tp, formatCount, msg } from '@/lib/i18n'
import { plainOf } from '@/lib/rich-text'
import { excerpt } from '@/lib/search'
import { type InboxFilter, inInbox, matchesFilter, useInbox } from '@/lib/store/inbox'
import { type Sort, matchesFilters, sorted, useListFilters } from '@/lib/store/list-filters'
import { inboxTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { Agent, ConversationSummary, InboxItem, MessageHit } from '@chat/contracts'
import {
  ArrowUp,
  BadgeCheck,
  ChevronsUp,
  Clock,
  Frown,
  Inbox,
  LoaderCircle,
  Paperclip,
  Search,
  Sparkles,
  StickyNote,
  X,
} from 'lucide-react'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ContactAvatar, StateChip } from './labels'
import { ActiveFilters, FiltersButton } from './list-filters'
import { TypingDots } from './messages'

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
  const typing = useInbox((s) => s.typing)
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
        narrowed.filter((s) => matchesFilter(s, filter)),
        filters.sort,
        now,
      ),
    [narrowed, filter, filters.sort, now],
  )

  // Searching: the palette's way, across the tabs — a resolved conversation is found too.
  // The inbox and the filters chosen still hold.
  const searching = query.trim() !== ''
  const asked = useMemo(() => parseListQuery(query), [query])
  const results = useMemo(
    () => (searching ? searchConversations(narrowed, asked, me, inboxes) : []),
    [searching, narrowed, asked, me, inboxes],
  )
  const { hits, loading } = useMessageHits(searching ? asked.text : '')
  const deeper = useMemo(
    () => inMessages(hits, results, narrowed, asked, me),
    [hits, results, narrowed, asked, me],
  )
  const found = useMemo(() => [...results, ...deeper.map((d) => d.summary)], [results, deeper])
  /** The newest message found in each conversation. */
  const hitOf = useMemo(() => {
    const first = new Map<string, MessageHit>()
    for (const hit of hits) if (!first.has(hit.conversationId)) first.set(hit.conversationId, hit)
    return first
  }, [hits])
  const [active, setActive] = useState(0)
  const [focused, setFocused] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new search starts at the top
  useEffect(() => setActive(0), [query])
  useEffect(() => {
    if (!searching) return
    scroller.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [active, searching])

  // « / » anywhere but in a field: to the search, as in a mail client.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]'))
        return
      event.preventDefault()
      searchRef.current?.focus()
      searchRef.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [searchRef])

  function onSearchKey(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      if (query === '') event.currentTarget.blur()
      else setQuery('')
      event.preventDefault()
      return
    }
    if (!searching || found.length === 0) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((i) => Math.min(Math.max(i + step, 0), found.length - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const chosen = found[Math.min(active, found.length - 1)]
      if (chosen) select(chosen.id)
    }
  }

  const row = (summary: ConversationSummary, search: RowSearch = {}) => (
    <ConversationRow
      summary={summary}
      me={me}
      inbox={inboxes.find((i) => i.id === summary.inboxId) ?? null}
      selected={summary.id === selectedId}
      typing={typing[summary.id] === true}
      time={inboxTime(search.hit?.at ?? summary.lastMessageAt, now)}
      now={now}
      onSelect={() => select(summary.id)}
      {...search}
    />
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
            onKeyDown={onSearchKey}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={$t('Rechercher une conversation…')}
            className="h-8 w-full rounded-lg border bg-muted/40 pr-7 pl-8 text-xs shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25"
          />
          {query ? (
            <Hint label={$t('Effacer la recherche')}>
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  searchRef.current?.focus()
                }}
                className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </Hint>
          ) : (
            !focused && (
              <Kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">/</Kbd>
            )
          )}
        </div>
        <FiltersButton rows={inThisInbox} />
      </div>

      {focused && !searching && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-2 text-[11px] text-muted-foreground">
          {$t('Un nom, un email, des mots d’un message.')}
          <span className="inline-flex items-center gap-1">
            <Kbd>#</Kbd>
            {$t('étiquette')}
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd>@</Kbd>
            {$t('conseiller')}
          </span>
        </p>
      )}

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

      <div ref={scroller} className="flex-1 overflow-y-auto scroll-discret">
        {searching ? (
          <>
            {results.length > 0 && (
              <Group label={$t('Conversations')} count={results.length}>
                {results.map((summary, index) => {
                  // Found by an older message: that message, rather than the last one.
                  const hit = hitOf.get(summary.id)
                  const told = hit && !saysAll(summary.preview, asked.tokens) ? hit : undefined
                  return (
                    <li key={summary.id}>
                      {row(summary, {
                        lit: asked.tokens,
                        tagged: asked.tags,
                        hit: told,
                        active: index === active,
                        index,
                      })}
                    </li>
                  )
                })}
              </Group>
            )}
            {deeper.length > 0 && (
              <Group label={$t('Dans les messages')} count={deeper.length}>
                {deeper.map(({ summary, hit }, i) => (
                  <li key={summary.id}>
                    {row(summary, {
                      lit: asked.tokens,
                      tagged: asked.tags,
                      hit,
                      active: results.length + i === active,
                      index: results.length + i,
                    })}
                  </li>
                ))}
              </Group>
            )}
            {loading && (
              <p className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
                <LoaderCircle className="size-3.5 animate-spin" />
                {$t('Recherche dans les messages…')}
              </p>
            )}
            {found.length === 0 && !loading && (
              <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
                <span className="flex size-11 items-center justify-center rounded-2xl bg-muted">
                  <Search className="size-5 text-muted-foreground" />
                </span>
                <p className="max-w-60 text-sm text-muted-foreground">
                  {$t('Aucune conversation ne correspond.')}
                </p>
                <p className="max-w-60 text-xs text-muted-foreground">
                  {$t('La recherche tient compte de la boîte et des filtres choisis.')}
                </p>
              </div>
            )}
          </>
        ) : (
          (filters.sort === 'recent' ? groupsOf(shown, now) : orderedBy(shown, filters.sort)).map(
            (group) => (
              <Group key={group.key} label={$t(group.label)} count={group.items.length}>
                {group.items.map((summary) => (
                  <li key={summary.id}>{row(summary)}</li>
                ))}
              </Group>
            ),
          )
        )}
        {!searching && shown.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-muted">
              <Inbox className="size-5 text-muted-foreground" />
            </span>
            <p className="max-w-56 text-sm text-muted-foreground">
              {filter === 'unassigned'
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
  typing = false,
  time,
  now = new Date(),
  onSelect,
  lit = [],
  tagged = [],
  hit,
  active = false,
  index,
}: RowSearch & {
  readonly summary: ConversationSummary
  readonly me: Agent | null
  /** Its inbox — its mark goes on the avatar. */
  readonly inbox?: InboxItem | null
  readonly selected: boolean
  /** The visitor is writing: that, rather than the last thing said. */
  readonly typing?: boolean
  readonly time: string
  readonly now?: Date
  readonly onSelect: () => void
}) {
  const { contact, unread, assignee } = summary
  // Searching: the tags that answer it first, lit.
  const words = [...lit, ...tagged]
  const tags =
    words.length === 0
      ? summary.tags
      : [...summary.tags].sort(
          (a, b) => wordsLit(b.label, words).size - wordsLit(a.label, words).size,
        )
  const waiting = waitingOf(summary, now)
  const mine = summary.assigneeId !== null && summary.assigneeId === me?.id
  return (
    <button
      type="button"
      onClick={onSelect}
      data-index={index}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'group relative flex w-full gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors',
        selected ? 'bg-accent' : 'hover:bg-muted/60',
        active && !selected && 'bg-muted/70',
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
            <Lit text={contact.name} tokens={lit} />
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
            {typing ? (
              <span className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
                <TypingDots className="text-muted-foreground" />
                <span className="truncate">{$t('En train d’écrire…')}</span>
              </span>
            ) : hit ? (
              <Found hit={hit} tokens={lit} />
            ) : (
              <Said summary={summary} me={me} tokens={lit} />
            )}
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
            {tags.slice(0, 1).map((tag) => (
              <ColorBadge
                key={tag.label}
                color={tag.color}
                className="min-w-0 max-w-28 shrink text-[11px]"
              >
                <span className="truncate">
                  <Lit text={tag.label} lit={wordsLit(tag.label, words)} />
                </span>
              </ColorBadge>
            ))}
            {tags.length > 1 && (
              <Hint
                label={tags
                  .slice(1)
                  .map((t) => t.label)
                  .join(', ')}
              >
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  +{tags.length - 1}
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
  tokens = [],
}: {
  readonly summary: ConversationSummary
  readonly me: Agent | null
  readonly tokens?: readonly string[]
}) {
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
        {summary.preview ? (
          <Excerpt text={plainOf(summary.preview)} tokens={tokens} />
        ) : files > 0 ? (
          $tp(files, '{count} fichier', '{count} fichiers')
        ) : (
          $t('Pas encore de message')
        )}
      </span>
    </>
  )
}

/** A message found deeper in the conversation: who said it, and its words around the match. */
function Found({ hit, tokens }: { readonly hit: MessageHit; readonly tokens: readonly string[] }) {
  return (
    <>
      {hit.author === 'ai' ? (
        <Sparkles className="size-3 shrink-0 text-violet-600 dark:text-violet-300" />
      ) : hit.author === 'note' ? (
        <StickyNote className="size-3 shrink-0" />
      ) : null}
      <span className="truncate">
        <Excerpt text={plainOf(hit.body)} tokens={tokens} />
      </span>
    </>
  )
}

/** A text cut around what was found in it, the match lit. */
function Excerpt({ text, tokens }: { readonly text: string; readonly tokens: readonly string[] }) {
  if (tokens.length === 0) return <>{text}</>
  const cut = excerpt(text, tokens, 72).text
  return <Lit text={cut} lit={wordsLit(cut, tokens)} />
}

/** What a row shows of a search: the words lit, the message found, the row under the keys. */
interface RowSearch {
  readonly lit?: readonly string[]
  /** The tags asked with `#`: lit, and shown first. */
  readonly tagged?: readonly string[]
  /** Found in this message, deeper than the last one. */
  readonly hit?: MessageHit
  readonly active?: boolean
  readonly index?: number
}

function Group({
  label,
  count,
  children,
}: { readonly label: string; readonly count: number; readonly children: ReactNode }) {
  return (
    <section aria-label={label}>
      <h3 className="sticky top-0 z-10 flex items-center gap-2 bg-background/85 px-4 pt-3 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase backdrop-blur-sm">
        {label}
        <span className="font-normal tabular-nums">{count}</span>
      </h3>
      <ul className="space-y-0.5 px-1.5 pb-1">{children}</ul>
    </section>
  )
}

/** The server's part, once the typing pauses: the messages that say the words. */
function useMessageHits(text: string): {
  readonly hits: readonly MessageHit[]
  readonly loading: boolean
} {
  const [hits, setHits] = useState<readonly MessageHit[]>([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    const typed = text.trim()
    if (typed.length < 3) {
      setHits([])
      setLoading(false)
      return
    }
    setLoading(true)
    let stale = false
    const timer = setTimeout(() => {
      api
        .search(typed)
        .catch(() => [] as MessageHit[])
        .then((found) => {
          if (stale) return
          setHits(found)
          setLoading(false)
        })
    }, 250)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [text])
  return { hits, loading }
}

/**
 * The conversations found by their messages and not already by the rest — the first
 * message found for each, the newest. The inbox, the filters, `#` and `@` hold for them too.
 */
function inMessages(
  hits: readonly MessageHit[],
  listed: readonly ConversationSummary[],
  rows: readonly ConversationSummary[],
  query: ListQuery,
  me: Agent | null,
): { readonly summary: ConversationSummary; readonly hit: MessageHit }[] {
  if (query.text.trim().length < 3) return []
  const seen = new Set(listed.map((s) => s.id))
  const byId = new Map(rows.map((s) => [s.id, s]))
  const out: { summary: ConversationSummary; hit: MessageHit }[] = []
  for (const hit of hits) {
    const summary = byId.get(hit.conversationId)
    if (!summary || seen.has(summary.id) || !holds(summary, query, me)) continue
    seen.add(summary.id)
    out.push({ summary, hit })
  }
  return out
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
