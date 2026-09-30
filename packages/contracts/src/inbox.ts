/**
 * The inbox's model — the `chat` schema as the server hands it over to the agents
 * (docs/architecture/00-decisions-structurantes.md, D1). What the visitor's widget receives is
 * a narrower projection: no note, no event, no confidence ever reaches it.
 *
 * A conversation is a sequence of typed messages: what the visitor writes, what an agent or
 * the AI answers, the internal notes and the events (a tool called, a handoff) live in the
 * one list, in the order they happened. That is what makes a thread auditable as it reads.
 */

/** `ai`: the AI answers alone. `open`: an agent has it. `pending`: waiting for the visitor. */
export type ConversationStatus = 'ai' | 'open' | 'pending' | 'resolved'

export type Sentiment = 'positive' | 'neutral' | 'negative'
export type Priority = 'low' | 'normal' | 'high' | 'urgent'

/** What an agent said of an AI answer — the evaluation set is made of these. */
export type Feedback = 'accepted' | 'edited' | 'rejected'

export interface Contact {
  readonly id: string
  readonly name: string
  readonly email: string | null
  /** True when the site signed who the visitor is (HMAC or JWT) — never on its word alone. */
  readonly identified: boolean
  readonly location: string | null
  readonly segment: string | null
  /** The attributes the site sent with the signed identity, in its order. */
  readonly attributes: readonly ContactAttribute[]
}

export interface ContactAttribute {
  readonly label: string
  readonly value: string
  readonly kind?: 'text' | 'code' | 'status' | 'date'
}

/** A passage the AI answered from: an article, or a promoted conversation. */
export interface Source {
  readonly title: string
  readonly origin: 'article' | 'conversation'
  readonly detail: string
  /** A promoted conversation that an editor reviewed in basedb. */
  readonly validated?: boolean
}

export interface Tag {
  readonly label: string
  readonly color: string
  /** Set by the AI rather than by an agent. */
  readonly byAi: boolean
}

interface MessageBase {
  readonly id: string
  readonly at: string
}

export interface VisitorMessage extends MessageBase {
  readonly kind: 'visitor'
  readonly body: string
}

export interface AgentMessage extends MessageBase {
  readonly kind: 'agent'
  readonly author: string
  readonly body: string
}

export interface AiMessage extends MessageBase {
  readonly kind: 'ai'
  readonly body: string
  /** 0 to 1: under the site's threshold, the AI hands over instead of answering. */
  readonly confidence: number
  readonly sources: readonly Source[]
  readonly feedback: Feedback | null
}

export interface NoteMessage extends MessageBase {
  readonly kind: 'note'
  readonly author: string
  readonly body: string
}

/**
 * Something that happened in a conversation. Stored as data, not as a sentence: the inbox
 * says it in the reader's language (`$t`), which a French sentence written by the server
 * could never be.
 */
export type ConversationEvent =
  | { readonly type: 'takeover'; readonly agent: string }
  | { readonly type: 'resolved'; readonly agent: string }
  | { readonly type: 'reopened'; readonly agent: string }
  /** `agent` has it now, given by `by`; `agent` is null when it was taken back to the queue. */
  | { readonly type: 'assigned'; readonly agent: string | null; readonly by: string }
  /** The AI called one of basedb's « Outils IA »; `detail` is what it looked at. */
  | { readonly type: 'tool'; readonly tool: string; readonly detail: string }

/** Something that happened, told in one line: a tool called, an agent taking over. */
export interface EventMessage extends MessageBase {
  readonly kind: 'event'
  readonly event: ConversationEvent
}

/** The AI handing over to a human, with what the human needs to pick it up. */
export interface HandoffMessage extends MessageBase {
  readonly kind: 'handoff'
  readonly reason: string
  readonly summary: string
  readonly confidence: number
  readonly assignee: string
  readonly team: string
}

export type Message =
  | VisitorMessage
  | AgentMessage
  | AiMessage
  | NoteMessage
  | EventMessage
  | HandoffMessage

export interface PastConversation {
  readonly subject: string
  readonly at: string
  readonly status: ConversationStatus
}

export interface Conversation {
  readonly id: string
  readonly contact: Contact
  readonly site: string
  readonly status: ConversationStatus
  readonly assignee: string | null
  readonly assigneeId: string | null
  readonly unread: boolean
  readonly intent: string | null
  readonly tags: readonly Tag[]
  readonly sentiment: Sentiment | null
  readonly priority: Priority
  /** What the copilot proposes for the next reply, 1 to 3. */
  readonly suggestions: readonly string[]
  /** The AI's summary, written when an agent picks the conversation up. */
  readonly summary: string | null
  readonly history: readonly PastConversation[]
  readonly messages: readonly Message[]
}

/** An agent — a basedb account listed in the « Conseillers » table (D4). */
export interface Agent {
  readonly id: string
  readonly name: string
  readonly email: string | null
  readonly role: 'agent' | 'supervisor'
}

/** A conversation as the list shows it: enough to draw its row, not its thread. */
export interface ConversationSummary {
  readonly id: string
  readonly contact: Pick<Contact, 'id' | 'name' | 'email' | 'identified'>
  readonly site: string
  readonly status: ConversationStatus
  readonly assignee: string | null
  /** Who has it, to tell « mine » from « someone else's » without comparing names. */
  readonly assigneeId: string | null
  readonly unread: boolean
  /** An AI handed it over — the row says « Transférée » while an agent has it. */
  readonly handedOff: boolean
  readonly preview: string
  readonly previewAuthor: 'visitor' | 'agent' | 'ai' | null
  readonly previewAgent: string | null
  readonly lastMessageAt: string
}

/**
 * Why a conversation calls for an agent's attention: a visitor wrote, the AI handed it
 * over, or someone gave it to them. What rings, what shows in the bell.
 */
export type AlertKind = 'visitor_message' | 'handoff' | 'assigned'

/** One entry of an agent's bell. Kept by the server, so that a reload loses none. */
export interface Notification {
  readonly id: string
  readonly kind: AlertKind
  readonly conversationId: string
  readonly contactName: string
  /** Who assigned the conversation, for `assigned`. */
  readonly by: string | null
  readonly at: string
  readonly read: boolean
}

export interface NotificationList {
  readonly unread: number
  /** The latest, newest first. */
  readonly items: readonly Notification[]
}
