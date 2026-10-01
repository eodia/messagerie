'use client'

import type { Agent, ConversationSummary, Priority, Sentiment } from '@chat/contracts'
import { create } from 'zustand'

/**
 * What the conversation list narrows to beyond its tabs: tags, people, priority, mood,
 * team, site, what is unread or kept waiting — and the order it is read in. Kept in this
 * browser, as the panes' widths: an agent who works the « Sinistre » tag finds it again.
 */

export type Sort = 'recent' | 'waiting' | 'priority'

export interface ListFilters {
  /** Agent ids, and `me` and `none` (the queue). Empty: anyone. */
  readonly assignees: readonly string[]
  readonly tags: readonly string[]
  /** `any`: one of the tags; `all`: every one. */
  readonly tagMode: 'any' | 'all'
  readonly priorities: readonly Priority[]
  readonly sentiments: readonly Sentiment[]
  readonly teams: readonly string[]
  readonly sites: readonly string[]
  readonly unread: boolean
  readonly identified: boolean
  /** Minutes the visitor has waited for an answer, at least; null: no matter. */
  readonly waiting: 5 | 30 | null
  readonly sort: Sort
}

export const NO_FILTERS: ListFilters = {
  assignees: [],
  tags: [],
  tagMode: 'any',
  priorities: [],
  sentiments: [],
  teams: [],
  sites: [],
  unread: false,
  identified: false,
  waiting: null,
  sort: 'recent',
}

const KEY = 'chat.list.filters'

/** How many filters narrow the list — the sort is no filter. */
export function activeCount(f: ListFilters): number {
  return (
    (f.assignees.length > 0 ? 1 : 0) +
    (f.tags.length > 0 ? 1 : 0) +
    (f.priorities.length > 0 ? 1 : 0) +
    (f.sentiments.length > 0 ? 1 : 0) +
    (f.teams.length > 0 ? 1 : 0) +
    (f.sites.length > 0 ? 1 : 0) +
    (f.unread ? 1 : 0) +
    (f.identified ? 1 : 0) +
    (f.waiting !== null ? 1 : 0)
  )
}

/** Minutes the visitor has waited — they spoke last, and someone other than the AI answers. */
export function waitedMinutes(s: ConversationSummary, now: Date): number | null {
  if (s.previewAuthor !== 'visitor' || s.status === 'ai' || s.status === 'resolved') return null
  return Math.floor((now.getTime() - new Date(s.lastMessageAt).getTime()) / 60_000)
}

export function matchesFilters(
  s: ConversationSummary,
  f: ListFilters,
  me: Agent | null,
  now: Date,
): boolean {
  if (f.assignees.length > 0) {
    const ok = f.assignees.some((a) =>
      a === 'none'
        ? s.assigneeId === null
        : a === 'me'
          ? s.assigneeId !== null && s.assigneeId === me?.id
          : s.assigneeId === a,
    )
    if (!ok) return false
  }
  if (f.tags.length > 0) {
    const has = (label: string) => s.tags.some((t) => t.label === label)
    if (f.tagMode === 'all' ? !f.tags.every(has) : !f.tags.some(has)) return false
  }
  if (f.priorities.length > 0 && !f.priorities.includes(s.priority)) return false
  if (f.sentiments.length > 0 && (s.sentiment === null || !f.sentiments.includes(s.sentiment)))
    return false
  if (f.teams.length > 0 && (s.teamId === null || !f.teams.includes(s.teamId))) return false
  if (f.sites.length > 0 && !f.sites.includes(s.site)) return false
  if (f.unread && !s.unread) return false
  if (f.identified && !s.contact.identified) return false
  if (f.waiting !== null && (waitedMinutes(s, now) ?? -1) < f.waiting) return false
  return true
}

const RANK: Readonly<Record<Priority, number>> = { urgent: 0, high: 1, normal: 2, low: 3 }

/** The rows in the order chosen — the newest first, unless told otherwise. */
export function sorted(
  rows: readonly ConversationSummary[],
  sort: Sort,
  now: Date,
): ConversationSummary[] {
  const recent = (a: ConversationSummary, b: ConversationSummary) =>
    b.lastMessageAt.localeCompare(a.lastMessageAt)
  if (sort === 'priority') {
    return [...rows].sort((a, b) => RANK[a.priority] - RANK[b.priority] || recent(a, b))
  }
  if (sort === 'waiting') {
    // The longest wait first; those nobody waits on after, newest first.
    return [...rows].sort((a, b) => {
      const wa = waitedMinutes(a, now)
      const wb = waitedMinutes(b, now)
      if (wa !== null && wb !== null) return wb - wa
      if (wa !== null) return -1
      if (wb !== null) return 1
      return recent(a, b)
    })
  }
  return [...rows].sort(recent)
}

function read(): ListFilters {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return NO_FILTERS
    const stored = JSON.parse(raw) as Partial<ListFilters>
    const strings = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
    return {
      assignees: strings(stored.assignees),
      tags: strings(stored.tags),
      tagMode: stored.tagMode === 'all' ? 'all' : 'any',
      priorities: strings(stored.priorities).filter((p): p is Priority =>
        ['urgent', 'high', 'normal', 'low'].includes(p),
      ),
      sentiments: strings(stored.sentiments).filter((p): p is Sentiment =>
        ['positive', 'neutral', 'negative'].includes(p),
      ),
      teams: strings(stored.teams),
      sites: strings(stored.sites),
      unread: stored.unread === true,
      identified: stored.identified === true,
      waiting: stored.waiting === 5 || stored.waiting === 30 ? stored.waiting : null,
      sort: stored.sort === 'waiting' || stored.sort === 'priority' ? stored.sort : 'recent',
    }
  } catch {
    return NO_FILTERS
  }
}

interface FiltersState extends ListFilters {
  initialize: () => void
  set: (patch: Partial<ListFilters>) => void
  /** Adds a value to a list filter, or takes it off. */
  toggle: <K extends 'assignees' | 'tags' | 'priorities' | 'sentiments' | 'teams' | 'sites'>(
    key: K,
    value: ListFilters[K][number],
  ) => void
  /** Every filter off; the sort stays. */
  clear: () => void
}

function keep(filters: ListFilters): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(filters))
  } catch {
    // Forgotten at the next visit, nothing more.
  }
}

const valuesOf = (state: FiltersState): ListFilters => ({
  assignees: state.assignees,
  tags: state.tags,
  tagMode: state.tagMode,
  priorities: state.priorities,
  sentiments: state.sentiments,
  teams: state.teams,
  sites: state.sites,
  unread: state.unread,
  identified: state.identified,
  waiting: state.waiting,
  sort: state.sort,
})

export const useListFilters = create<FiltersState>((set, get) => {
  const save = (patch: Partial<ListFilters>) => {
    set(patch)
    keep(valuesOf(get()))
  }
  return {
    ...NO_FILTERS,
    initialize: () => set(read()),
    set: save,
    toggle: (key, value) => {
      const current = get()[key] as readonly string[]
      save({
        [key]: current.includes(value as string)
          ? current.filter((v) => v !== value)
          : [...current, value],
      } as Partial<ListFilters>)
    },
    clear: () => save({ ...NO_FILTERS, sort: get().sort }),
  }
})
