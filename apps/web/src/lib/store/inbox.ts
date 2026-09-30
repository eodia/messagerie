'use client'

import type {
  Agent,
  Conversation,
  ConversationSummary,
  Feedback,
  InboxEvent,
} from '@chat/contracts'
import { create } from 'zustand'
import { ApiFailure, api, eventsUrl } from '../api'

/**
 * The inbox's state, fed by the chat server.
 *
 * The list is read once, then kept current by the WebSocket's signals: each one carries a
 * conversation's new summary, and the open conversation's thread is read again when it is
 * the one that changed. A socket that drops comes back by itself, and the list is read
 * again then — whatever happened meanwhile is not lost.
 */

export type InboxFilter = 'all' | 'ai' | 'open' | 'unassigned' | 'resolved'

type Status = Pick<ConversationSummary, 'status' | 'assignee'>

export function matchesFilter(conversation: Status, filter: InboxFilter): boolean {
  switch (filter) {
    case 'all':
      return conversation.status !== 'resolved'
    case 'ai':
      return conversation.status === 'ai'
    case 'open':
      return conversation.status === 'open' || conversation.status === 'pending'
    case 'unassigned':
      return conversation.status === 'open' && conversation.assignee === null
    case 'resolved':
      return conversation.status === 'resolved'
  }
}

interface InboxState {
  readonly me: Agent | null
  /** The first read of the list: while it runs, and whether it failed and why. */
  readonly loading: boolean
  readonly loadError: string | null
  readonly live: 'connecting' | 'open' | 'closed'
  readonly summaries: readonly ConversationSummary[]
  readonly selectedId: string | null
  /** The thread of the selected conversation, once read. */
  readonly detail: Conversation | null
  readonly filter: InboxFilter
  readonly query: string
  /** What an agent is writing, by conversation: switching away keeps it. */
  readonly drafts: Readonly<Record<string, string>>
  readonly sending: boolean
  /** The code of the last refused action, until dismissed. */
  readonly error: string | null
  /** The clock the list reads its times against, moved every half minute. */
  readonly now: Date

  /** Reads the list and opens the live stream. Returns what stops both. */
  start: () => () => void
  reload: () => Promise<void>
  select: (id: string) => void
  setFilter: (filter: InboxFilter) => void
  setQuery: (query: string) => void
  setDraft: (id: string, text: string) => void
  dismissError: () => void
  send: (id: string, body: string, kind: 'reply' | 'note', resolve?: boolean) => Promise<boolean>
  takeOver: (id: string) => Promise<void>
  resolve: (id: string) => Promise<void>
  giveFeedback: (id: string, messageId: string, feedback: Feedback | null) => Promise<void>
}

const newestFirst = (a: ConversationSummary, b: ConversationSummary) =>
  b.lastMessageAt.localeCompare(a.lastMessageAt)

const codeOf = (error: unknown): string =>
  error instanceof ApiFailure ? error.code : 'INTERNAL_ERROR'

export const useInbox = create<InboxState>((set, get) => {
  /** Reads the open thread again — unless another conversation got selected meanwhile. */
  async function refreshDetail(id: string): Promise<void> {
    try {
      const detail = await api.conversation(id)
      if (get().selectedId === id) set({ detail })
    } catch (error) {
      if (get().selectedId === id) set({ error: codeOf(error) })
    }
  }

  function applySummary(summary: ConversationSummary): void {
    const others = get().summaries.filter((s) => s.id !== summary.id)
    set({ summaries: [...others, summary].sort(newestFirst) })
    if (summary.id === get().selectedId) void refreshDetail(summary.id)
  }

  /** Runs an action whose answer is the conversation as it now stands. */
  async function act(id: string, action: () => Promise<Conversation>): Promise<boolean> {
    try {
      const detail = await action()
      if (get().selectedId === id) set({ detail })
      return true
    } catch (error) {
      set({ error: codeOf(error) })
      return false
    }
  }

  return {
    me: null,
    loading: true,
    loadError: null,
    live: 'connecting',
    summaries: [],
    selectedId: null,
    detail: null,
    filter: 'all',
    query: '',
    drafts: {},
    sending: false,
    error: null,
    now: new Date(),

    start: () => {
      let stopped = false
      let socket: WebSocket | null = null
      let retry: ReturnType<typeof setTimeout> | undefined
      let delay = 500
      let opened = false

      function connect(): void {
        if (stopped) return
        set({ live: 'connecting' })
        const next = new WebSocket(eventsUrl())
        socket = next
        next.onopen = () => {
          delay = 500
          set({ live: 'open' })
          // Back after a drop: what changed meanwhile came with no signal.
          if (opened) void get().reload()
          opened = true
        }
        next.onmessage = (message) => {
          const event = JSON.parse(String(message.data)) as InboxEvent
          if (event.type === 'conversation') applySummary(event.summary)
        }
        next.onclose = () => {
          if (stopped || socket !== next) return
          set({ live: 'closed' })
          retry = setTimeout(connect, delay)
          delay = Math.min(delay * 2, 10_000)
        }
      }

      void get().reload()
      connect()
      const clock = setInterval(() => set({ now: new Date() }), 30_000)
      return () => {
        stopped = true
        clearTimeout(retry)
        clearInterval(clock)
        socket?.close()
      }
    },

    reload: async () => {
      try {
        const [me, summaries] = await Promise.all([api.me(), api.conversations()])
        set({ me, summaries: [...summaries].sort(newestFirst), loading: false, loadError: null })
        const { selectedId } = get()
        const first = summaries.find((s) => matchesFilter(s, get().filter))
        if (selectedId === null && first) get().select(first.id)
        else if (selectedId !== null) void refreshDetail(selectedId)
      } catch (error) {
        set({ loading: false, loadError: codeOf(error) })
      }
    },

    select: (id) => {
      if (get().selectedId !== id) set({ selectedId: id, detail: null })
      void refreshDetail(id)
      // Opening is reading: the server records who opened it (the access journal).
      api.markRead(id).catch((error: unknown) => set({ error: codeOf(error) }))
    },

    setFilter: (filter) => set({ filter }),
    setQuery: (query) => set({ query }),
    setDraft: (id, text) => set((state) => ({ drafts: { ...state.drafts, [id]: text } })),
    dismissError: () => set({ error: null }),

    send: async (id, body, kind, resolve = false) => {
      set({ sending: true })
      const sent = await act(id, () => api.send(id, { body, kind, resolve }))
      set((state) => ({
        sending: false,
        drafts: sent ? { ...state.drafts, [id]: '' } : state.drafts,
      }))
      return sent
    },

    takeOver: async (id) => {
      await act(id, () => api.takeOver(id))
    },

    resolve: async (id) => {
      await act(id, () => api.resolve(id))
    },

    giveFeedback: async (id, messageId, feedback) => {
      await act(id, () => api.feedback(id, messageId, { action: feedback }))
    },
  }
})
