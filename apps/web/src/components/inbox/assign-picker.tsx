'use client'

import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Hint } from '@/components/ui/tooltip'
import { $t, $tp } from '@/lib/i18n'
import { useInbox } from '@/lib/store/inbox'
import { cn } from '@/lib/utils'
import type { Agent, Conversation } from '@chat/contracts'
import { Check, Search, ShieldCheck, Undo2 } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { ContactAvatar } from './labels'

/**
 * Runs `then` once every dropdown menu has left the page — its closing animation done.
 * A popover opened from a menu item before that would lose its focus to the menu's button,
 * and its Escape to the menu's layer, still on top.
 */
export function afterMenus(then: () => void): void {
  const started = Date.now()
  const wait = () => {
    // A timer, not an animation frame: a window that draws nothing runs no frames. Half a
    // second at most: a menu that never leaves does not keep the picker shut.
    const menu = document.querySelector('[data-slot="dropdown-menu-content"]')
    if (menu && Date.now() - started < 500) setTimeout(wait, 25)
    else then()
  }
  setTimeout(wait, 0)
}

/**
 * Whom to give a conversation to, found as one types — a team of a hundred is no longer a
 * menu to scroll. Yourself first, then the conversation's team, then everyone else; each
 * with the conversations they have going, to share the load. ↑ ↓ and Enter, as a command
 * palette; « Remettre dans la file » last.
 */

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

type Choice =
  | { readonly kind: 'agent'; readonly agent: Agent; readonly group: string }
  | { readonly kind: 'queue'; readonly group: string }

export function AssignPicker({
  conversation,
  open,
  onOpenChange,
  children,
  anchor = false,
  align = 'end',
  hint,
}: {
  readonly conversation: Pick<Conversation, 'id' | 'assigneeId' | 'teamId'>
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** What opens it — or what it hangs from, with `anchor`. */
  readonly children: ReactNode
  /** The children only place it: something else opens it (a menu item). */
  readonly anchor?: boolean
  readonly align?: 'start' | 'end'
  /** A tooltip on what opens it — an icon alone says nothing. */
  readonly hint?: string
}) {
  const agents = useInbox((s) => s.agents)
  const me = useInbox((s) => s.me)
  const summaries = useInbox((s) => s.summaries)
  const teams = useInbox((s) => s.directory.teams)
  const { assign } = useInbox.getState()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
  }, [open])

  // What each agent has going: their open conversations.
  const load = useMemo(() => {
    const going = new Map<string, number>()
    for (const s of summaries) {
      if (s.assigneeId && s.status !== 'resolved') {
        going.set(s.assigneeId, (going.get(s.assigneeId) ?? 0) + 1)
      }
    }
    return going
  }, [summaries])

  const teamName = teams.find((t) => t.id === conversation.teamId)?.name ?? null
  const needle = fold(query.trim())
  const choices = useMemo((): Choice[] => {
    const found = agents.filter(
      (a) => needle === '' || fold(`${a.name} ${a.email ?? ''}`).includes(needle),
    )
    const mine = found.filter((a) => a.id === me?.id)
    const inTeam = found.filter(
      (a) => a.id !== me?.id && conversation.teamId && a.teamIds?.includes(conversation.teamId),
    )
    const others = found.filter((a) => a.id !== me?.id && !inTeam.includes(a))
    return [
      ...mine.map((agent) => ({ kind: 'agent' as const, agent, group: $t('Vous') })),
      ...inTeam.map((agent) => ({
        kind: 'agent' as const,
        agent,
        group: $t('Équipe {name}', { name: teamName ?? '' }),
      })),
      ...others.map((agent) => ({
        kind: 'agent' as const,
        agent,
        group: inTeam.length > 0 ? $t('Autres conseillers') : $t('Conseillers'),
      })),
      ...(needle === '' && conversation.assigneeId !== null
        ? [{ kind: 'queue' as const, group: '' }]
        : []),
    ]
  }, [agents, needle, me, conversation.teamId, conversation.assigneeId, teamName])

  // The active choice stays in view as the arrows move it.
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function choose(choice: Choice | undefined) {
    if (!choice) return
    void assign(conversation.id, choice.kind === 'queue' ? null : choice.agent.id)
    onOpenChange(false)
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((a) => Math.min(a + 1, choices.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(choices[active])
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {anchor ? (
        <PopoverAnchor asChild>{children}</PopoverAnchor>
      ) : hint ? (
        <Hint label={hint}>
          <PopoverTrigger asChild>{children}</PopoverTrigger>
        </Hint>
      ) : (
        <PopoverTrigger asChild>{children}</PopoverTrigger>
      )}
      <PopoverContent align={align} className="w-80 p-0">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            // biome-ignore lint/a11y/noAutofocus: the field the agent opened the list for
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            placeholder={$t('Affecter à… (nom ou adresse)')}
            aria-label={$t('Chercher un conseiller')}
            className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {$tp(agents.length, '{count} conseiller', '{count} conseillers')}
          </span>
        </div>
        <ul ref={list} className="max-h-80 overflow-y-auto p-1 scroll-discret">
          {choices.map((choice, index) => {
            const first = index === 0 || choices[index - 1]?.group !== choice.group
            return (
              <li key={choice.kind === 'queue' ? 'queue' : choice.agent.id}>
                {first && choice.group && (
                  <div className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    {choice.group}
                  </div>
                )}
                {choice.kind === 'queue' ? (
                  <button
                    type="button"
                    data-index={index}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(choice)}
                    className={cn(
                      'mt-1 flex w-full items-center gap-2.5 rounded-md border-t px-2 py-2 text-left text-sm text-muted-foreground',
                      index === active && 'bg-accent text-foreground',
                    )}
                  >
                    <Undo2 className="size-4" />
                    {$t('Remettre dans la file')}
                  </button>
                ) : (
                  <AgentChoice
                    agent={choice.agent}
                    index={index}
                    active={index === active}
                    current={choice.agent.id === conversation.assigneeId}
                    you={choice.agent.id === me?.id}
                    going={load.get(choice.agent.id) ?? 0}
                    query={query.trim()}
                    onHover={() => setActive(index)}
                    onChoose={() => choose(choice)}
                  />
                )}
              </li>
            )
          })}
          {choices.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              {$t('Aucun conseiller ne correspond.')}
            </li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

function AgentChoice({
  agent,
  index,
  active,
  current,
  you,
  going,
  query,
  onHover,
  onChoose,
}: {
  readonly agent: Agent
  readonly index: number
  readonly active: boolean
  readonly current: boolean
  readonly you: boolean
  readonly going: number
  readonly query: string
  readonly onHover: () => void
  readonly onChoose: () => void
}) {
  return (
    <button
      type="button"
      data-index={index}
      aria-current={current ? 'true' : undefined}
      onMouseEnter={onHover}
      onClick={onChoose}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left',
        active && 'bg-accent',
      )}
    >
      <ContactAvatar name={agent.name} className="size-7 text-[10px]" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm">
          <span className="truncate font-medium">
            <Highlight text={agent.name} query={query} />
          </span>
          {you && <span className="shrink-0 text-xs text-muted-foreground">{$t('(vous)')}</span>}
          {agent.role === 'supervisor' && (
            <ShieldCheck className="size-3.5 shrink-0 text-violet-600 dark:text-violet-300" />
          )}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {agent.email ? <Highlight text={agent.email} query={query} /> : $t('Sans adresse')}
        </span>
      </span>
      <span
        className={cn(
          'shrink-0 rounded-md px-1.5 py-0.5 text-[11px] tabular-nums',
          going === 0
            ? 'text-muted-foreground'
            : going >= 5
              ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
              : 'bg-muted text-muted-foreground',
        )}
      >
        {going === 0 ? $t('libre') : $tp(going, '{count} en cours', '{count} en cours')}
      </span>
      {current && <Check className="size-4 shrink-0 text-primary" />}
    </button>
  )
}

/** The typed letters, marked where they are found — accents aside. */
function Highlight({ text, query }: { readonly text: string; readonly query: string }) {
  if (query === '') return <>{text}</>
  const at = fold(text).indexOf(fold(query))
  if (at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-primary/20 text-foreground">
        {text.slice(at, at + query.length)}
      </mark>
      {text.slice(at + query.length)}
    </>
  )
}
