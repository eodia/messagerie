'use client'

import type {
  Agent,
  AlertKind,
  Conversation,
  ConversationSummary,
  Feedback,
  InboxEvent,
  NotificationList,
} from '@chat/contracts'
import { create } from 'zustand'
import { chime, inView, notifyDesktop } from '../alerts'
import { ApiFailure, api, eventsUrl } from '../api'
import { $t } from '../i18n'

/**
 * The inbox's state, fed by the chat server.
 *
 * The list is read once, then kept current by the WebSocket's signals: each one carries a
 * conversation's new summary, and the open conversation's thread is read again when it is
 * the one that changed. A socket that drops comes back by itself, and the list is read
 * again then — whatever happened meanwhile is not lost.
 *
 * A signal may carry an alert: the inbox decides here whether it is the reader's, and
 * then rings, notifies the desktop, and counts it on the tab.
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

/**
 * Whether a conversation is the reader's to answer: theirs, or waiting in the queue for
 * anyone. What the AI is answering, or a colleague has, is not.
 */
export function concernsMe(summary: ConversationSummary, me: Agent | null): boolean {
  if (me === null) return false
  if (summary.assigneeId === me.id) return summary.status !== 'resolved'
  return summary.status === 'open' && summary.assigneeId === null
}

/** What waits for the reader: unread, and theirs to answer — the tab's and sidebar's count. */
export const waitingCount = (state: Pick<InboxState, 'summaries' | 'me'>): number =>
  state.summaries.filter((s) => s.unread && concernsMe(s, state.me)).length

interface InboxState {
  readonly me: Agent | null
  readonly agents: readonly Agent[]
  /** The first read of the list: while it runs, and whether it failed and why. */
  readonly loading: boolean
  readonly loadError: string | null
  readonly live: 'connecting' | 'open' | 'closed'
  readonly summaries: readonly ConversationSummary[]
  readonly selectedId: string | null
  /** The thread of the selected conversation, once read. */
  readonly detail: Conversation | null
  readonly notifications: NotificationList
  readonly filter: InboxFilter
  readonly query: string
  /** What an agent is writing, by conversation: switching away keeps it. */
  readonly drafts: Readonly<Record<string, string>>
  readonly sending: boolean
  /** The code of the last refused action, until dismissed. */
  readonly error: string | null
  /** A sentence saying an action went through — promoted, run — until dismissed. */
  readonly notice: string | null
  /** The clock the list reads its times against, moved every half minute. */
  readonly now: Date
  /** How the app goes to a screen — set by the shell, which holds the router. */
  readonly navigate: (path: string) => void

  /** Reads the list and opens the live stream. Returns what stops both. */
  start: () => () => void
  reload: () => Promise<void>
  setNavigator: (navigate: (path: string) => void) => void
  select: (id: string) => void
  /** Goes to the inbox and opens a conversation — from the bell or the desktop. */
  open: (id: string) => void
  setFilter: (filter: InboxFilter) => void
  setQuery: (query: string) => void
  setDraft: (id: string, text: string) => void
  dismissError: () => void
  /** A failure's code, shown like the refusal of an action. */
  fail: (error: unknown) => void
  say: (notice: string) => void
  send: (id: string, body: string, kind: 'reply' | 'note', resolve?: boolean) => Promise<boolean>
  takeOver: (id: string) => Promise<void>
  resolve: (id: string) => Promise<void>
  assign: (id: string, assigneeId: string | null) => Promise<void>
  giveFeedback: (id: string, messageId: string, feedback: Feedback | null) => Promise<void>
  readAllNotifications: () => Promise<void>
}

const newestFirst = (a: ConversationSummary, b: ConversationSummary) =>
  b.lastMessageAt.localeCompare(a.lastMessageAt)

const codeOf = (error: unknown): string =>
  error instanceof ApiFailure ? error.code : 'INTERNAL_ERROR'

const NO_NOTIFICATIONS: NotificationList = { unread: 0, items: [] }

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

  async function refreshNotifications(): Promise<void> {
    try {
      set({ notifications: await api.notifications() })
    } catch {
      // The bell keeps what it showed; the next signal reads it again.
    }
  }

  function applySummary(summary: ConversationSummary, alert: AlertKind | undefined): void {
    const others = get().summaries.filter((s) => s.id !== summary.id)
    set({ summaries: [...others, summary].sort(newestFirst) })
    if (summary.id === get().selectedId) void refreshDetail(summary.id)
    if (alert !== undefined) raise(summary, alert)
  }

  /** An alert, if it is the reader's: a chime, the desktop, and nothing if they are on it. */
  function raise(summary: ConversationSummary, alert: AlertKind): void {
    const { me, selectedId } = get()
    const concerns = alert === 'assigned' ? summary.assigneeId === me?.id : concernsMe(summary, me)
    if (!concerns) return
    // Looking at it already: it is read, no need to call.
    if (summary.id === selectedId && inView()) {
      api.markRead(summary.id).catch(() => {})
      return
    }
    chime(alert)
    const name = summary.contact.name
    const title =
      alert === 'visitor_message'
        ? name
        : alert === 'handoff'
          ? $t('L’IA transfère {name}', { name })
          : $t('Conversation confiée : {name}', { name })
    notifyDesktop(title, summary.preview, summary.id, () => get().open(summary.id))
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
    agents: [],
    loading: true,
    loadError: null,
    live: 'connecting',
    summaries: [],
    selectedId: null,
    detail: null,
    notifications: NO_NOTIFICATIONS,
    filter: 'all',
    query: '',
    drafts: {},
    sending: false,
    error: null,
    notice: null,
    now: new Date(),
    navigate: () => {},

    start: () => {
      let stopped = false
      let socket: WebSocket | null = null
      let retry: ReturnType<typeof setTimeout> | undefined
      let delay = 500
      let opened = false

      function again(): void {
        if (stopped) return
        set({ live: 'closed' })
        retry = setTimeout(connect, delay)
        delay = Math.min(delay * 2, 10_000)
      }

      async function connect(): Promise<void> {
        if (stopped) return
        set({ live: 'connecting' })
        let ticket: string
        try {
          ;({ ticket } = await api.ticket())
        } catch {
          again()
          return
        }
        if (stopped) return
        const next = new WebSocket(eventsUrl(ticket))
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
          if (event.type === 'conversation') applySummary(event.summary, event.alert)
          else if (event.type === 'notifications') void refreshNotifications()
        }
        next.onclose = () => {
          if (socket === next) again()
        }
      }

      void get().reload()
      void connect()
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
        const [me, summaries, notifications, agents] = await Promise.all([
          api.me(),
          api.conversations(),
          api.notifications(),
          api.agents(),
        ])
        set({
          me,
          agents,
          notifications,
          summaries: [...summaries].sort(newestFirst),
          loading: false,
          loadError: null,
        })
        const { selectedId } = get()
        const first = summaries.find((s) => matchesFilter(s, get().filter))
        if (selectedId === null && first) get().select(first.id)
        else if (selectedId !== null) void refreshDetail(selectedId)
      } catch (error) {
        set({ loading: false, loadError: codeOf(error) })
      }
    },

    setNavigator: (navigate) => set({ navigate }),

    select: (id) => {
      if (get().selectedId !== id) set({ selectedId: id, detail: null })
      void refreshDetail(id)
      // Opening is reading — the conversation, and its lines in the bell. The server
      // records who opened it (the access journal).
      api.markRead(id).catch((error: unknown) => set({ error: codeOf(error) }))
    },

    open: (id) => {
      get().navigate('/conversations')
      get().select(id)
    },

    setFilter: (filter) => set({ filter }),
    setQuery: (query) => set({ query }),
    setDraft: (id, text) => set((state) => ({ drafts: { ...state.drafts, [id]: text } })),
    dismissError: () => set({ error: null, notice: null }),
    fail: (error) => set({ error: codeOf(error), notice: null }),
    say: (notice) => {
      set({ notice, error: null })
      setTimeout(() => {
        if (get().notice === notice) set({ notice: null })
      }, 6000)
    },

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

    assign: async (id, assigneeId) => {
      await act(id, () => api.assign(id, assigneeId))
    },

    giveFeedback: async (id, messageId, feedback) => {
      await act(id, () => api.feedback(id, messageId, { action: feedback }))
    },

    readAllNotifications: async () => {
      try {
        await api.readNotifications()
        await refreshNotifications()
      } catch (error) {
        set({ error: codeOf(error) })
      }
    },
  }
})
