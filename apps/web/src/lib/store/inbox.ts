'use client'

import type {
  Agent,
  AlertKind,
  Conversation,
  ConversationSummary,
  Feedback,
  InboxDirectory,
  InboxEvent,
  MetadataValue,
  NotificationList,
  TransferBody,
} from '@chat/contracts'
import { create } from 'zustand'
import {
  type ConversationsPlace,
  type ListFilter,
  conversationOfWord,
  conversationsAddress,
  inboxOfWord,
} from '../address'
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

export type InboxFilter = ListFilter

const INBOX_KEY = 'chat.inbox'

function storeInbox(inbox: string | null): void {
  try {
    if (inbox) window.localStorage.setItem(INBOX_KEY, inbox)
    else window.localStorage.removeItem(INBOX_KEY)
  } catch {
    // The choice is forgotten at the next visit, nothing more.
  }
}

/** Where the conversations' screen is, as its address says it. */
export function inboxAddress(
  state: Pick<InboxState, 'inbox' | 'filter' | 'selectedId' | 'summaries' | 'detail' | 'directory'>,
): string {
  const { selectedId, summaries, detail } = state
  const name =
    selectedId === null
      ? null
      : (summaries.find((s) => s.id === selectedId)?.contact.name ??
        (detail?.id === selectedId ? detail.contact.name : null))
  return conversationsAddress(
    state.inbox,
    state.filter,
    selectedId !== null && name !== null ? { id: selectedId, name } : null,
    state.directory.inboxes,
  )
}

/** The inbox last chosen — a convenience of this browser, nothing more. */
function storedInbox(): string | null {
  try {
    return window.localStorage.getItem(INBOX_KEY)
  } catch {
    return null
  }
}

/** The conversations of the chosen inbox — all of them when none is. */
export const inInbox = (summary: Pick<ConversationSummary, 'inboxId'>, inbox: string | null) =>
  inbox === null || summary.inboxId === inbox

type Status = Pick<ConversationSummary, 'status' | 'assignee'>

export function matchesFilter(conversation: Status, filter: InboxFilter): boolean {
  switch (filter) {
    case 'all':
      return conversation.status !== 'resolved' && conversation.status !== 'pending'
    case 'ai':
      return conversation.status === 'ai'
    case 'open':
      return conversation.status === 'open'
    case 'snoozed':
      return conversation.status === 'pending'
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
  // On hold: nobody's to answer until it comes back.
  if (summary.status === 'pending') return false
  if (summary.assigneeId === me.id) return summary.status !== 'resolved'
  return summary.status === 'open' && summary.assigneeId === null
}

/** What waits for the reader: unread, and theirs to answer — the tab's and sidebar's count. */
export const waitingCount = (state: Pick<InboxState, 'summaries' | 'me'>): number =>
  state.summaries.filter((s) => s.unread && concernsMe(s, state.me)).length

/** The same count, inbox by inbox — the sidebar's. */
export function waitingByInbox(
  state: Pick<InboxState, 'summaries' | 'me'>,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const s of state.summaries) {
    if (s.inboxId !== null && s.unread && concernsMe(s, state.me)) {
      counts.set(s.inboxId, (counts.get(s.inboxId) ?? 0) + 1)
    }
  }
  return counts
}

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
  /** The inboxes the reader sees, and every team. */
  readonly directory: InboxDirectory
  /** The inbox the list shows; null: all of them. */
  readonly inbox: string | null
  readonly filter: InboxFilter
  readonly query: string
  /** The conversations whose visitor is writing, now — a few seconds after their last key. */
  readonly typing: Readonly<Record<string, true>>
  /** What an agent is writing, by conversation: switching away keeps it. */
  readonly drafts: Readonly<Record<string, string>>
  readonly sending: boolean
  /** The code of the last refused action, until dismissed. */
  readonly error: string | null
  /** A sentence saying an action went through — promoted, run — until dismissed. */
  readonly notice: string | null
  /** An address being followed, until the list it names is read: nothing to write yet. */
  readonly arriving: boolean
  /** A dialog of the open conversation asked from elsewhere — the palette. */
  readonly asked: 'assign' | 'transfer' | null
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
  /** Goes where an address says: its inbox, its tab, its conversation. */
  arrive: (place: ConversationsPlace) => void
  /** Shows one inbox — or all with null — on the conversations screen. */
  showInbox: (inbox: string | null) => void
  setFilter: (filter: InboxFilter) => void
  setQuery: (query: string) => void
  setDraft: (id: string, text: string) => void
  dismissError: () => void
  /** A failure's code, shown like the refusal of an action. */
  fail: (error: unknown) => void
  say: (notice: string) => void
  /** Asks the open conversation for one of its dialogs; `null` once it opened. */
  ask: (dialog: 'assign' | 'transfer' | null) => void
  /** With files, words are optional. */
  send: (
    id: string,
    body: string,
    kind: 'reply' | 'note',
    resolve?: boolean,
    files?: readonly File[],
  ) => Promise<boolean>
  takeOver: (id: string) => Promise<void>
  resolve: (id: string) => Promise<void>
  /** « Mettre en attente » until `until` (ISO), and « Réveiller » before it. */
  snooze: (id: string, until: string) => Promise<void>
  wake: (id: string) => Promise<void>
  assign: (id: string, assigneeId: string | null) => Promise<void>
  transfer: (id: string, body: TransferBody) => Promise<boolean>
  addTag: (id: string, label: string) => Promise<void>
  removeTag: (id: string, label: string) => Promise<void>
  /** Sets (a value) or removes (null) metadata of a conversation, or of its contact. */
  setData: (
    target:
      | { readonly conversation: string }
      | { readonly contact: string; readonly conversation: string },
    data: Readonly<Record<string, MetadataValue | null>>,
  ) => Promise<boolean>
  giveFeedback: (id: string, messageId: string, feedback: Feedback | null) => Promise<void>
  /** « Supprimer pour moi »: gone from the reader's thread only. */
  hideMessage: (id: string, messageId: string) => Promise<void>
  /** « Supprimer pour tout le monde »: its words and files gone, for all. */
  deleteMessage: (id: string, messageId: string) => Promise<void>
  readAllNotifications: () => Promise<void>
}

const newestFirst = (a: ConversationSummary, b: ConversationSummary) =>
  b.lastMessageAt.localeCompare(a.lastMessageAt)

const codeOf = (error: unknown): string =>
  error instanceof ApiFailure ? error.code : 'INTERNAL_ERROR'

const NO_NOTIFICATIONS: NotificationList = { unread: 0, items: [] }

/** No such inbox, or not the reader's — its conversations are then all shown. */
const INBOX_UNKNOWN = 'INBOX_NOT_FOUND'

/** The widget says « still typing » every two seconds or so: silent longer, they stopped. */
const TYPING_MS = 6000

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

  const typingTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** The address followed before the list was read. */
  let pending: ConversationsPlace | null = null

  /** Follows the address waiting, once the inboxes and the conversations are known. */
  function settle(): void {
    const place = pending
    if (place === null) return
    pending = null
    const { directory, summaries, selectedId } = get()
    let error: string | null = null
    if (place.inbox !== undefined) {
      const inbox = place.inbox === null ? null : inboxOfWord(place.inbox, directory.inboxes)
      if (place.inbox !== null && inbox === null) error = INBOX_UNKNOWN
      set({ inbox: inbox?.id ?? null })
      storeInbox(inbox?.id ?? null)
    }
    set({ filter: place.filter })
    if (place.conversation !== null) {
      const id = conversationOfWord(
        place.conversation,
        summaries.map((s) => s.id),
      )
      if (id === null) error = 'CONVERSATION_NOT_FOUND'
      else if (id !== selectedId) get().select(id)
    }
    set({ arriving: false, ...(error ? { error, notice: null } : {}) })
  }

  /** The visitor is typing, or stopped (`false`) — by their message, or by their silence. */
  function setTyping(id: string, typing: boolean): void {
    clearTimeout(typingTimers.get(id))
    typingTimers.delete(id)
    if (typing)
      typingTimers.set(
        id,
        setTimeout(() => setTyping(id, false), TYPING_MS),
      )
    if (typing === (get().typing[id] === true)) return
    set((state) => {
      const { [id]: _, ...others } = state.typing
      return { typing: typing ? { ...others, [id]: true } : others }
    })
  }

  function applySummary(summary: ConversationSummary, alert: AlertKind | undefined): void {
    const before = get().summaries.find((s) => s.id === summary.id)
    // Their message arrived: they are no longer typing it.
    if (summary.previewAuthor === 'visitor' && summary.lastMessageAt !== before?.lastMessageAt) {
      setTyping(summary.id, false)
    }
    const others = get().summaries.filter((s) => s.id !== summary.id)
    set({ summaries: [...others, summary].sort(newestFirst) })
    if (summary.id === get().selectedId) void refreshDetail(summary.id)
    if (alert !== undefined) raise(summary, alert)
  }

  /** An alert, if it is the reader's: a chime, the desktop, and nothing if they are on it. */
  function raise(summary: ConversationSummary, alert: AlertKind): void {
    const { me, selectedId } = get()
    const concerns =
      // An automation's alert comes only to those it told.
      alert === 'automation'
        ? true
        : alert === 'assigned' || alert === 'woke'
          ? summary.assigneeId === me?.id
          : concernsMe(summary, me)
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
          : alert === 'automation'
            ? $t('À voir : {name}', { name })
            : alert === 'woke'
              ? $t('De retour de l’attente : {name}', { name })
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
    directory: { inboxes: [], teams: [] },
    inbox: storedInbox(),
    filter: 'all',
    query: '',
    typing: {},
    drafts: {},
    sending: false,
    error: null,
    notice: null,
    asked: null,
    arriving: false,
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
        } catch (error) {
          // Not an agent, or signed out: no stream to wait for — the screen says why.
          const code = codeOf(error)
          if (code === 'NOT_AN_AGENT' || code === 'SIGNED_OUT') set({ live: 'closed' })
          else again()
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
          else if (event.type === 'typing') setTyping(event.conversationId, true)
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
        const [me, summaries, notifications, agents, directory] = await Promise.all([
          api.me(),
          api.conversations(),
          api.notifications(),
          api.agents(),
          api.inboxes(),
        ])
        // An inbox kept from another session, no longer seen: all of them.
        const inbox = directory.inboxes.some((i) => i.id === get().inbox) ? get().inbox : null
        set({
          me,
          agents,
          directory,
          inbox,
          notifications,
          summaries: [...summaries].sort(newestFirst),
          loading: false,
          loadError: null,
        })
        // An address reached before the list was read: it is followed now.
        settle()
        const { selectedId } = get()
        const first = summaries.find(
          (s) => matchesFilter(s, get().filter) && inInbox(s, get().inbox),
        )
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
      get().select(id)
      get().navigate(inboxAddress(get()))
    },

    arrive: (place) => {
      pending = place
      if (get().loading) set({ arriving: true })
      else settle()
    },

    showInbox: (inbox) => {
      set({ inbox })
      storeInbox(inbox)
      get().navigate(inboxAddress(get()))
    },

    setFilter: (filter) => set({ filter }),
    setQuery: (query) => set({ query }),
    setDraft: (id, text) => set((state) => ({ drafts: { ...state.drafts, [id]: text } })),
    dismissError: () => set({ error: null, notice: null }),
    fail: (error) => set({ error: codeOf(error), notice: null }),
    ask: (asked) => set({ asked }),

    say: (notice) => {
      set({ notice, error: null })
      setTimeout(() => {
        if (get().notice === notice) set({ notice: null })
      }, 6000)
    },

    send: async (id, body, kind, resolve = false, files = []) => {
      set({ sending: true })
      const sent = await act(id, () =>
        files.length > 0
          ? api.sendFiles(id, files, { body, kind, resolve })
          : api.send(id, { body, kind, resolve }),
      )
      // Sent: the draft is emptied — unless the agent went on typing meanwhile.
      set((state) => ({
        sending: false,
        drafts:
          sent && (state.drafts[id] ?? '').trim() === body.trim()
            ? { ...state.drafts, [id]: '' }
            : state.drafts,
      }))
      return sent
    },

    takeOver: async (id) => {
      await act(id, () => api.takeOver(id))
    },

    resolve: async (id) => {
      await act(id, () => api.resolve(id))
    },

    snooze: async (id, until) => {
      await act(id, () => api.snooze(id, until))
    },

    wake: async (id) => {
      await act(id, () => api.wake(id))
    },

    assign: async (id, assigneeId) => {
      await act(id, () => api.assign(id, assigneeId))
    },

    addTag: async (id, label) => {
      await act(id, () => api.addTag(id, label))
    },

    removeTag: async (id, label) => {
      await act(id, () => api.removeTag(id, label))
    },

    hideMessage: async (id, messageId) => {
      await act(id, () => api.hideMessage(id, messageId))
    },

    deleteMessage: async (id, messageId) => {
      await act(id, () => api.deleteMessage(id, messageId))
    },

    transfer: async (id, body) => {
      const done = await act(id, () => api.transfer(id, body))
      // Moved to an inbox the reader may no longer see: the list is read again.
      if (done) void get().reload()
      return done
    },

    setData: async (target, data) => {
      try {
        if ('contact' in target) await api.contactData(target.contact, data)
        else await api.conversationData(target.conversation, data)
        await refreshDetail(target.conversation)
        return true
      } catch (error) {
        set({ error: codeOf(error) })
        return false
      }
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
