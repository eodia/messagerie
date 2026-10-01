'use client'

import { ResizablePanel } from '@/components/app/resizable-panel'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Hint } from '@/components/ui/tooltip'
import { $t, formatCount, msg } from '@/lib/i18n'
import { type InboxFilter, inInbox, matchesFilter, useInbox } from '@/lib/store/inbox'
import { inboxTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { Agent, ConversationSummary } from '@chat/contracts'
import { Inbox, ListFilter, Search } from 'lucide-react'
import { type RefObject, useMemo } from 'react'
import { ContactAvatar, StateChip } from './labels'

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

/** The last thing said, as the row previews it: who said it, then what. */
function preview(summary: ConversationSummary, me: Agent | null): string {
  if (summary.previewAuthor === 'ai') return $t('IA : {text}', { text: summary.preview })
  if (summary.previewAuthor === 'agent' && summary.previewAgent === me?.name) {
    return $t('Vous : {text}', { text: summary.preview })
  }
  return summary.preview
}

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
  const { select, setFilter, setQuery } = useInbox.getState()

  // The chosen inbox's conversations — the filters count within it.
  const inThisInbox = useMemo(() => summaries.filter((s) => inInbox(s, inbox)), [summaries, inbox])
  const shown = useMemo(
    () => inThisInbox.filter((s) => matchesFilter(s, filter) && matchesQuery(s, query.trim())),
    [inThisInbox, filter, query],
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
        <DropdownMenu>
          <Hint label={$t('Filtrer')}>
            <DropdownMenuTrigger asChild>
              <Button
                variant={filter === 'resolved' ? 'secondary' : 'ghost'}
                size="icon-sm"
                className="size-8"
              >
                <ListFilter className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
          </Hint>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{$t('Afficher')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={filter}
              onValueChange={(value) => setFilter(value as InboxFilter)}
            >
              {TABS.map((tab) => (
                <DropdownMenuRadioItem key={tab.filter} value={tab.filter}>
                  {$t(tab.label)}
                </DropdownMenuRadioItem>
              ))}
              <DropdownMenuRadioItem value="resolved">{$t('Résolues')}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
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
                {formatCount(inThisInbox.filter((s) => matchesFilter(s, tab.filter)).length)}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <ul className="flex-1 overflow-y-auto scroll-discret">
        {shown.map((summary) => (
          <li key={summary.id}>
            <ConversationRow
              summary={summary}
              me={me}
              selected={summary.id === selectedId}
              time={inboxTime(summary.lastMessageAt, now)}
              onSelect={() => select(summary.id)}
            />
          </li>
        ))}
        {shown.length === 0 && (
          <li className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-muted-foreground">
            <Inbox className="size-5" />
            {query ? $t('Aucune conversation ne correspond.') : $t('Aucune conversation ici.')}
          </li>
        )}
      </ul>
    </ResizablePanel>
  )
}

export function ConversationRow({
  summary,
  me,
  selected,
  time,
  onSelect,
}: {
  readonly summary: ConversationSummary
  readonly me: Agent | null
  readonly selected: boolean
  readonly time: string
  readonly onSelect: () => void
}) {
  const { contact, unread, assignee } = summary
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'relative flex w-full gap-3 border-b px-3 py-3 text-left transition-colors',
        selected ? 'bg-accent' : 'hover:bg-muted/50',
      )}
    >
      {selected && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}
      <ContactAvatar name={contact.name} online={summary.status !== 'resolved'} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn('truncate text-sm', unread ? 'font-semibold' : 'font-medium')}>
            {contact.name}
          </span>
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {time}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-xs',
              unread ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {preview(summary, me)}
          </span>
          {unread && <span className="size-2 shrink-0 rounded-full bg-primary" />}
        </span>
        <span className="mt-1.5 flex items-center gap-1.5">
          <StateChip conversation={summary} />
          {assignee && (
            <span className="truncate text-[11px] text-muted-foreground">
              {assignee === me?.name ? $t('Vous') : assignee}
            </span>
          )}
        </span>
      </span>
    </button>
  )
}
