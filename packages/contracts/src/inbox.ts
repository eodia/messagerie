import type { ErrorCode } from './api.js'
import type { SurveyScale } from './widget.js'
import type { PageCallStatus, WidgetAppearance } from './widget.js'

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

/** A value attached by the page or an agent: text, a number, yes or no. */
export type MetadataValue = string | number | boolean

/** Free metadata — `{ "Commande": "A-1042", "Panier (€)": 89.9 }` — never checked. */
export type Metadata = Readonly<Record<string, MetadataValue>>

export interface Contact {
  readonly id: string
  readonly name: string
  readonly email: string | null
  readonly phone: string | null
  /** True when the site signed who the visitor is (HMAC or JWT) — never on its word alone. */
  readonly identified: boolean
  readonly location: string | null
  /** Where they are, roughly (D18): a country, an IANA time zone, a point. */
  readonly country: string | null
  readonly timeZone: string | null
  readonly place: GeoPoint | null
  readonly segment: string | null
  /** The attributes the site sent with the signed identity, in its order. */
  readonly attributes: readonly ContactAttribute[]
  /** What the page or an agent said of the contact — declared, not checked. */
  readonly data: Metadata
}

/** A point on the map. `approximate`: the city of the visitor's time zone, not theirs. */
export interface GeoPoint {
  readonly latitude: number
  readonly longitude: number
  readonly approximate: boolean
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
  /** A promoted conversation that a supervisor reviewed. */
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
  /** Deleted for everyone — its words and files gone: by whom, and when. */
  readonly deleted?: { readonly by: string | null; readonly at: string }
}

/** What the AI made of a file, when an agent asked. */
export interface AttachmentAnalysis {
  readonly summary: string
  readonly model: string
  readonly at: string
  /** The agent who asked. */
  readonly by: string
}

/**
 * A file sent with a message. `url`, relative to the chat server's address, reads it for a
 * day without a token: an `<img>` can.
 */
export interface Attachment {
  readonly id: string
  readonly name: string
  readonly mime: string
  readonly size: number
  readonly url: string
  readonly analysis: AttachmentAnalysis | null
}

/**
 * « Traduction automatique »: a message in the agents' language when its words are in
 * another. The visitor's and the AI's words, translated for the agents; or an agent's reply
 * as they wrote it, before it went out translated in `body`.
 */
export interface Translation {
  /** The language of the message's `body` — ISO 639-1: `de`, `en`… */
  readonly from: string
  /** The language of `body` here. */
  readonly language: string
  readonly body: string
}

export interface VisitorMessage extends MessageBase {
  readonly kind: 'visitor'
  /** Empty when the visitor only sent files. */
  readonly body: string
  readonly attachments: readonly Attachment[]
  /** Their words in the agents' language. */
  readonly translation?: Translation
}

export interface AgentMessage extends MessageBase {
  readonly kind: 'agent'
  readonly author: string
  /** Who wrote it — they may delete it for everyone. */
  readonly authorId: string | null
  /** What the visitor read. */
  readonly body: string
  readonly attachments: readonly Attachment[]
  /** Sent translated: the agent's own words. */
  readonly translation?: Translation
}

export interface AiMessage extends MessageBase {
  readonly kind: 'ai'
  readonly body: string
  /** Its words in the agents' language. */
  readonly translation?: Translation
  /** 0 to 1: under the site's threshold, the AI hands over instead of answering. */
  readonly confidence: number
  readonly sources: readonly Source[]
  readonly feedback: Feedback | null
}

export interface NoteMessage extends MessageBase {
  readonly kind: 'note'
  readonly author: string
  readonly authorId: string | null
  readonly body: string
  readonly attachments: readonly Attachment[]
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
  /** The AI called one of the « Outils IA »; `detail` is what it looked at. */
  | { readonly type: 'tool'; readonly tool: string; readonly detail: string }
  /**
   * Moved to another inbox, or another team, by `by` — the names as they were then. A
   * field left out did not change.
   */
  | {
      readonly type: 'transferred'
      readonly inbox?: string
      readonly team?: string
      readonly by: string
    }
  /** Put on hold by `agent` until `until`. */
  | { readonly type: 'snoozed'; readonly agent: string; readonly until: string }
  /** Back from on hold: woken by `agent`, or by its time (`null`). */
  | { readonly type: 'woke'; readonly agent: string | null }
  /**
   * The visitor began a new conversation from the page (`MessagerieChat.reset()`); one
   * the AI alone held is resolved by it.
   */
  | { readonly type: 'restarted' }
  /**
   * The widget asked the visitor for their e-mail — nobody could answer soon. `by`: the
   * automation that asked; null when the AI handed over while the agents were away.
   */
  | { readonly type: 'email_requested'; readonly by: string | null; readonly text: string | null }
  /** The visitor left their e-mail in the widget's card. */
  | { readonly type: 'email_given'; readonly email: string }
  /** An automation asked the visitor how it went (D20): `by`, its name. */
  | {
      readonly type: 'survey_requested'
      readonly survey: string
      readonly scale: SurveyScale
      readonly by: string | null
    }
  /** The visitor answered: their score, and their word if they left one. */
  | {
      readonly type: 'survey_answered'
      readonly survey: string
      readonly scale: SurveyScale
      readonly score: number
      readonly comment: string | null
    }
  /** The AI asked the visitor's page to act (D21) — and how it went. */
  | {
      readonly type: 'page_action'
      readonly call: string
      readonly name: string
      readonly label: string
      readonly args: Readonly<Record<string, unknown>>
      readonly status: PageCallStatus
      readonly result?: unknown
      readonly error?: string
    }
  /** Taken out of the AI's hands and given to the agents' queue — by an automation (D20). */
  | { readonly type: 'queued'; readonly by: string }
  | {
      readonly type: 'priority'
      readonly priority: 'low' | 'normal' | 'high' | 'urgent'
      readonly by: string
    }

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
  /** The site's name when the conversation began; `siteId` finds the site. */
  readonly site: string
  readonly siteId: string
  /** « Boîtes de réception »: null for a conversation from before the inboxes. */
  readonly inboxId: string | null
  readonly teamId: string | null
  /** What the page or an agent attached to the conversation. */
  readonly data: Metadata
  readonly status: ConversationStatus
  /** On hold until then — `pending` —, or null. */
  readonly snoozedUntil: string | null
  readonly assignee: string | null
  readonly assigneeId: string | null
  readonly unread: boolean
  readonly intent: string | null
  /**
   * The visitor's language, read by the AI where their site translates — ISO 639-1. Not
   * the agents' language: their messages read translated, and replies may go out in it.
   */
  readonly language: string | null
  readonly tags: readonly Tag[]
  readonly sentiment: Sentiment | null
  readonly priority: Priority
  /** What the copilot proposes for the next reply, 1 to 3. */
  readonly suggestions: readonly string[]
  /** The AI's summary, written when an agent picks the conversation up. */
  readonly summary: string | null
  readonly history: readonly PastConversation[]
  /**
   * The pages the visitor went through while the conversation lived, newest first — as
   * their widget says it, never checked.
   */
  readonly pages: readonly PageVisit[]
  readonly messages: readonly Message[]
}

/** A page a visitor in conversation opened: since when, until when — open while `leftAt` is null. */
export interface PageVisit {
  readonly url: string
  readonly title: string
  readonly at: string
  readonly leftAt: string | null
}

/** An agent — a row of « Conseillers », and their account (D19). */
export interface Agent {
  readonly id: string
  readonly name: string
  readonly email: string | null
  readonly role: 'agent' | 'supervisor'
  /** Their teams — given in the list of agents, to suggest a conversation's own team. */
  readonly teamIds?: readonly string[]
}

/** A message found by the palette's search: where it is, who said it, and around what. */
/** A GIF GIPHY found, for the agents' picker. */
export interface GifHit {
  readonly id: string
  readonly title: string
  /** A small rendition, read from GIPHY by the agent's browser. */
  readonly preview: string
  readonly width: number
  readonly height: number
}

export interface MessageHit {
  readonly conversationId: string
  readonly messageId: string
  readonly contactName: string
  readonly author: 'visitor' | 'agent' | 'ai' | 'note'
  readonly at: string
  /** The message's words, the match within them. */
  readonly body: string
}

/** A conversation as the list shows it: enough to draw its row, not its thread. */
export interface ConversationSummary {
  readonly id: string
  readonly contact: Pick<Contact, 'id' | 'name' | 'email' | 'identified'>
  readonly site: string
  readonly siteId: string
  readonly inboxId: string | null
  readonly teamId: string | null
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
  /** The files sent with the last message — its words may be none. */
  readonly previewFiles: number
  readonly lastMessageAt: string
  readonly priority: Priority
  readonly sentiment: Sentiment | null
  readonly tags: readonly Tag[]
  /** On hold until then — `pending` —, or null. */
  readonly snoozedUntil: string | null
}

/** Put a conversation on hold until a time. */
export interface SnoozeBody {
  readonly until: string
}

/**
 * Why a conversation calls for an agent's attention: a visitor wrote, the AI handed it
 * over, or someone gave it to them. What rings, what shows in the bell.
 */
export type AlertKind =
  | 'visitor_message'
  | 'handoff'
  | 'assigned'
  | 'transferred'
  | 'woke'
  /** An automation's « Prévenir » step: `text` says why, `by` is the automation. */
  | 'automation'

/** One entry of an agent's bell. Kept by the server, so that a reload loses none. */
export interface Notification {
  readonly id: string
  readonly kind: AlertKind
  readonly conversationId: string
  readonly contactName: string
  /** Who assigned the conversation, for `assigned`; the automation, for `automation`. */
  readonly by: string | null
  readonly text: string | null
  readonly at: string
  readonly read: boolean
}

export interface NotificationList {
  readonly unread: number
  /** The latest, newest first. */
  readonly items: readonly Notification[]
}

/** A canned reply of « Réponses types », offered after « / » in the composer. */
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
  readonly location: string | null
  readonly country: string | null
  readonly timeZone: string | null
  readonly place: GeoPoint | null
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

/** The simple counters of the statistics screen. */
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

/** The AI's tools, as the tools screen shows them. */
export interface ToolsOverview {
  readonly tools: readonly {
    readonly id: string
    readonly name: string
    readonly description: string
    /** `contact`: the visitor's record, as their site signed it. */
    readonly type: 'contact' | 'http' | 'callback'
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
  /** Where the widget may show, from « Sites ». */
  readonly domains: readonly string[]
  /** The AI answers first on this site. */
  readonly ai: boolean
  /** The first names the widget shows behind the AI. */
  readonly team: readonly string[]
  readonly settings: WidgetSettings
}

export interface WidgetEditor {
  readonly sites: readonly WidgetEditorSite[]
  /** A supervisor may save. */
  readonly canEdit: boolean
}

/** A team, as « Équipes » names it. */
export interface TeamItem {
  readonly id: string
  readonly name: string
}

/** An inbox the agent sees, with the teams that answer there. */
export interface InboxItem {
  readonly id: string
  readonly name: string
  readonly description: string | null
  /** `#RRGGBB`, or null. */
  readonly color: string | null
  /** A pictogram of the interface's library (basedb's set), by its name, or null. */
  readonly icon: string | null
  /** A small picture in place of the pictogram — https or data URL — or null. */
  readonly image: string | null
  readonly teams: readonly TeamItem[]
  readonly defaultTeamId: string | null
}

/** A site the agent may narrow the inbox to, from the menu at the top of the sidebar. */
export interface SiteItem {
  readonly id: string
  readonly name: string
  /** The widget's colour, `#RRGGBB`. */
  readonly color: string
}

export interface InboxDirectory {
  /** The inboxes this agent sees — all of them for a supervisor. */
  readonly inboxes: readonly InboxItem[]
  /** Every team: a conversation may go to any team of its inbox. */
  readonly teams: readonly TeamItem[]
  /**
   * The sites whose conversations this agent sees: those that arrive in one of their
   * inboxes, and those of a conversation moved into one — every site for a supervisor.
   */
  readonly sites: readonly SiteItem[]
}

/** Moves a conversation: to another inbox, another team, or both. */
export interface TransferBody {
  readonly inboxId?: string
  /** A team of the target inbox; left out with `inboxId`, that inbox's default team. */
  readonly teamId?: string | null
  /** A note to whoever picks it up, kept in the thread among the notes. */
  readonly note?: string
}

/** What is done at once to the conversations ticked in the list. */
export type BulkAction =
  | { readonly type: 'resolve' }
  | { readonly type: 'read' }
  | { readonly type: 'assign'; readonly assigneeId: string | null }
  | { readonly type: 'tag'; readonly label: string }
  | { readonly type: 'snooze'; readonly until: string }
  | ({ readonly type: 'transfer' } & TransferBody)

export interface BulkBody {
  readonly ids: readonly string[]
  readonly action: BulkAction
}

/** Each conversation on its own: those done, and those refused with why. */
export interface BulkResult {
  readonly done: readonly string[]
  readonly refused: readonly { readonly id: string; readonly code: ErrorCode }[]
}

/** Changes metadata: a key with a value is set, a key with `null` removed. */
export interface MetadataBody {
  readonly data: Readonly<Record<string, MetadataValue | null>>
}

/** A field of a settings table, as the « Messagerie » template declares it. */
export interface SettingsField {
  readonly label: string
  readonly kind:
    | 'short_text'
    | 'long_text'
    | 'url'
    | 'number'
    | 'boolean'
    | 'date'
    | 'select'
    | 'multi_select'
    | 'link'
    | 'multi_link'
    | 'user'
  readonly description: string | null
  readonly required: boolean
  /** A choice's options, in order. */
  readonly options: readonly string[]
  /** The key of the table a relation points at. */
  readonly target: string | null
}

export interface SettingsTable {
  /** The template's key: `boites`, `equipes`… */
  readonly key: string
  readonly label: string
  readonly description: string | null
  readonly fields: readonly SettingsField[]
}

/** A row by field label: a relation as the id(s) of its row(s), a person as an account id. */
export interface SettingsRow {
  readonly id: string
  readonly values: Readonly<Record<string, unknown>>
}

export interface SettingsOverview {
  readonly tables: readonly SettingsTable[]
  /** The agents a « Personne » field may name. */
  readonly users: readonly {
    readonly id: string
    readonly name: string
    readonly email: string | null
  }[]
  /** A supervisor may change the settings. */
  readonly canEdit: boolean
}

/** Someone a supervisor invites as an agent. */
export interface InviteBody {
  readonly name: string
  readonly email: string
  readonly role: 'agent' | 'supervisor'
  readonly teamIds: readonly string[]
}

export interface Invited {
  /** Their row in « Conseillers ». */
  readonly row: SettingsRow
  /** The link to hand over — they choose their password there. Shown once, seven days good. */
  readonly link: string
}

/** A link to choose a new password, for an agent: shown once, seven days good. */
export interface PasswordReset {
  readonly link: string
}

// ── Signing in (D19) ────────────────────────────────────────────────────────────────────

export interface AuthState {
  /** The agent signed in; null: the sign-in screen. */
  readonly agent: Agent | null
  /** Nobody can sign in yet: the first supervisor is created from the sign-in screen. */
  readonly setup: boolean
  /** The identity provider's name, when one is configured: « Se connecter avec {sso} ». */
  readonly sso: string | null
}

export interface SignInBody {
  readonly email: string
  readonly password: string
}

/** The first supervisor, at the first start. */
export interface SetupBody {
  readonly name: string
  readonly email: string
  readonly password: string
}

/** What a link a supervisor handed over is for. */
export interface LinkInfo {
  readonly name: string
  readonly email: string | null
  readonly purpose: 'invite' | 'reset'
}

export interface ChangePasswordBody {
  readonly current: string
  readonly next: string
}

/** A tag « Étiquettes » offers, to put on a conversation. */
export interface TagOption {
  readonly name: string
  /** `#RRGGBB` */
  readonly color: string
  /** When to apply it — what the AI reads, and the agent too. */
  readonly when: string | null
}

// ── The public API and the MCP server's tokens (D16) ───────────────────────────────────

export type TokenAccess = 'read' | 'write'
export type TokenSurface = 'rest' | 'mcp'

/** A token as the « API et MCP » screen lists it — never its secret. */
export interface ApiToken {
  readonly id: string
  readonly label: string
  /** Its first characters, in clear: `msg_ab12cd34`. */
  readonly prefix: string
  readonly access: TokenAccess
  readonly surfaces: readonly TokenSurface[]
  /** The inboxes it reaches; null: every one its creator sees. */
  readonly inboxIds: readonly string[] | null
  readonly createdBy: string
  readonly createdAt: string
  readonly expiresAt: string | null
  readonly lastUsedAt: string | null
  readonly revokedAt: string | null
}

export interface CreateTokenBody {
  readonly label: string
  readonly access: TokenAccess
  readonly surfaces: readonly TokenSurface[]
  readonly inboxIds: readonly string[] | null
  /** 1 to 365; null: no expiry. */
  readonly expiresInDays: number | null
}

/** A token just created: its secret is in this answer, and nowhere else, ever. */
export interface CreatedToken {
  readonly token: ApiToken
  readonly secret: string
}

/** A page of the API's documentation: Markdown in basedb's subset, under a group. */
export interface DocSection {
  readonly id: string
  readonly title: string
  readonly group: string
  readonly markdown: string
}

export interface ApiDocumentation {
  readonly sections: readonly DocSection[]
}

// ── Webhooks (D17) ─────────────────────────────────────────────────────────────────────

/** What a webhook can be told of. */
export type WebhookEventType =
  | 'conversation.created'
  | 'message.created'
  | 'message.deleted'
  | 'conversation.handed_off'
  | 'conversation.assigned'
  | 'conversation.transferred'
  | 'conversation.resolved'
  | 'conversation.reopened'
  /** The visitor answered a satisfaction survey: the message carries the score. */
  | 'survey.answered'

export interface Webhook {
  readonly id: string
  readonly label: string
  readonly url: string
  readonly events: readonly WebhookEventType[]
  /** The inboxes it hears; null: all of them. */
  readonly inboxIds: readonly string[] | null
  readonly active: boolean
  /** Why it stopped: `failures` by itself, `manual` by someone. */
  readonly disabledReason: 'failures' | 'manual' | null
  readonly createdBy: string
  readonly createdAt: string
  readonly lastDeliveryAt: string | null
}

export interface CreateWebhookBody {
  readonly label: string
  readonly url: string
  readonly events: readonly WebhookEventType[]
  readonly inboxIds: readonly string[] | null
}

/** A webhook just created: its signing secret is here, and nowhere else, ever. */
export interface CreatedWebhook {
  readonly webhook: Webhook
  readonly secret: string
}

export type DeliveryStatus = 'pending' | 'in_flight' | 'delivered' | 'failed' | 'abandoned'

export interface WebhookDelivery {
  readonly id: string
  readonly type: WebhookEventType | 'webhook.ping'
  readonly conversationId: string
  readonly status: DeliveryStatus
  readonly attempts: number
  readonly responseCode: number | null
  readonly errorCode: string | null
  readonly createdAt: string
  readonly deliveredAt: string | null
  readonly nextAttemptAt: string | null
}

/** An action pages of a site declared (D21), and what the supervisors allow of it. */
export interface PageAction {
  readonly id: string
  readonly siteId: string
  readonly name: string
  readonly label: string
  readonly description: string
  readonly kind: 'read' | 'do'
  readonly parameters: Readonly<Record<string, unknown>>
  /** The AI may call it. Off until a supervisor allows it. */
  readonly enabled: boolean
  /** The visitor accepts it first. */
  readonly confirm: boolean
  readonly lastSeenAt: string
}
