import type { WidgetAppearance } from './widget.js'

/**
 * The inbox's model — the `chat` schema as the server hands it over to the agents
 * (docs/architecture/00-decisions-structurantes.md, D1). What the visitor's widget receives is
 * a narrower projection (`widget.ts`): no note, no event, no confidence ever reaches it.
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

/** A canned reply of basedb's « Réponses types », offered after « / » in the composer. */
export interface CannedReply {
  readonly id: string
  readonly title: string
  /** Typed after « / »; null when it has none. */
  readonly shortcut: string | null
  /** May cite the contact: {prénom}, {nom}, {email}. */
  readonly body: string
}

export interface ContactListItem {
  readonly id: string
  readonly name: string
  readonly email: string | null
  readonly identified: boolean
  readonly site: string | null
  readonly conversations: number
  readonly lastMessageAt: string | null
}

export interface ContactDetail {
  readonly contact: Contact
  readonly site: string | null
  readonly conversations: readonly {
    readonly id: string
    readonly subject: string
    readonly status: ConversationStatus
    readonly at: string
  }[]
}

/** The simple counters of the framing's MVP — full dashboards are basedb's. */
export interface InboxStats {
  /** The last seven days, today included. */
  readonly conversations: number
  /** Conversations the AI answered at least once. */
  readonly aiAnswered: number
  /** Of those, answered by the AI alone: no handoff, no agent. */
  readonly aiResolved: number
  readonly handedOff: number
  /** `aiResolved / aiAnswered`, null without any. */
  readonly aiResolutionRate: number | null
  /** From the visitor's first message to the first answer, AI or agent. */
  readonly medianFirstResponseSeconds: number | null
  readonly open: { readonly ai: number; readonly queue: number; readonly mine: number }
  readonly perDay: readonly {
    readonly day: string
    readonly total: number
    readonly ai: number
    readonly handedOff: number
  }[]
}

/** What the AI answers from, as it is indexed now. */
export interface KnowledgeItem {
  readonly id: string
  readonly source: 'article' | 'conversation'
  readonly title: string
  readonly passages: number
  readonly indexedAt: string
}

/** The AI's tools, as the tools screen shows them — declared in basedb. */
export interface ToolsOverview {
  readonly tools: readonly {
    readonly id: string
    readonly name: string
    readonly description: string
    readonly type: 'basedb' | 'http' | 'callback'
    readonly target: string | null
    readonly method: 'GET' | 'POST'
    readonly agent: boolean
    readonly copilot: boolean
    readonly parameters: Readonly<Record<string, unknown>>
  }[]
  readonly mcp: readonly {
    readonly id: string
    readonly name: string
    readonly url: string
    readonly agent: boolean
    readonly copilot: boolean
    /** It answered, and listed its tools. */
    readonly reachable: boolean
    readonly tools: readonly {
      readonly name: string
      readonly description: string
      readonly parameters: Readonly<Record<string, unknown>>
    }[]
  }[]
}

export interface ToolTestResult {
  readonly content: string
  readonly detail: string
}

/** What the widget editor changes on a site: its words and its looks. */
export interface WidgetSettings {
  readonly name: string
  /** `#RRGGBB` */
  readonly color: string
  readonly language: 'fr' | 'en' | 'de' | 'es'
  readonly title: string | null
  readonly tagline: string | null
  readonly welcome: string | null
  readonly suggestions: readonly string[]
  readonly appearance: WidgetAppearance
}

export interface WidgetEditorSite {
  readonly id: string
  /** Where the widget may show, from basedb. */
  readonly domains: readonly string[]
  /** The AI answers first on this site. */
  readonly ai: boolean
  /** The first names the widget shows behind the AI. */
  readonly team: readonly string[]
  readonly settings: WidgetSettings
}

export interface WidgetEditor {
  readonly sites: readonly WidgetEditorSite[]
  /** False: settings from the template, changed in memory only — lost at restart. */
  readonly persistent: boolean
  /** A supervisor may save. */
  readonly canEdit: boolean
}
