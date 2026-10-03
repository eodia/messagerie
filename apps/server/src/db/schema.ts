import type {
  AutomationStep,
  AutomationTrigger,
  Condition,
  ContactAttribute,
  ConversationEvent,
  DashboardCard,
  DashboardFilter,
  Metadata,
  PageCallStatus,
  PageSnapshot,
  RunStepRecord,
  Source,
} from '@chat/contracts'
import { sql } from 'drizzle-orm'
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core'

/**
 * The `chat` schema — the flow of conversations, owned by the chat server (D1).
 *
 * What is set up by people (sites, teams, canned replies, articles, guardrails, tools)
 * lives in the settings tables below (D19) and is referred to by its id, as text: a site
 * is `site_id`, a team `team_id` — kept when the row is gone, for the history; its tables are its
 * own business, and a row deleted there leaves a dangling id here, not a failed delete.
 *
 * Identifiers and columns in English (basedb's A2); what people read stays in French.
 */
export const chat = pgSchema('chat')

export const conversationStatus = chat.enum('conversation_status', [
  'ai',
  'open',
  'pending',
  'resolved',
])
export const priority = chat.enum('priority', ['low', 'normal', 'high', 'urgent'])
export const sentiment = chat.enum('sentiment', ['positive', 'neutral', 'negative'])
export const messageAuthor = chat.enum('message_author', ['contact', 'agent', 'ai', 'system'])
export const messageKind = chat.enum('message_kind', ['text', 'note', 'event', 'handoff', 'file'])
export const aiRunKind = chat.enum('ai_run_kind', [
  'answer',
  'suggestion',
  'tag',
  'summary',
  'rephrase',
  'attachment',
  'speech',
  /** An automation's « Demander à l'IA » step (D20). */
  'automation',
  /** The visitor's words in the agents' language, and the agent's in the visitor's. */
  'translation',
])
export const feedbackAction = chat.enum('feedback_action', ['accepted', 'edited', 'rejected'])
export const tagOrigin = chat.enum('tag_origin', ['agent', 'ai'])
export const chunkSource = chat.enum('chunk_source', ['article', 'conversation'])
export const alertKind = chat.enum('alert_kind', [
  'visitor_message',
  'handoff',
  'assigned',
  'transferred',
  /** A conversation put on hold came back: its time came. */
  'woke',
  /** An automation's « Prévenir » step (D20), with its text. */
  'automation',
])

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()

/**
 * The agents — the people who answer, and their accounts (D19) — and the rows the API's
 * tokens write under (`token:<prefix>`). `login` is what one signs in with: a person's
 * e-mail, lowercased. A row is never deleted while a message names it: it is deactivated.
 */
export const agents = chat.table('agent', {
  id: uuid('id').primaryKey().defaultRandom(),
  login: text('login').notNull().unique(),
  name: text('name').notNull(),
  email: text('email'),
  role: text('role', { enum: ['agent', 'supervisor'] })
    .notNull()
    .default('agent'),
  active: boolean('active').notNull().default(true),
  /** « Conversations simultanées »: how many they take at once; null, no limit. */
  maxConversations: integer('max_conversations'),
  /** scrypt, `scrypt$N$r$p$salt$hash`; null: they sign in by invitation or identity provider. */
  passwordHash: text('password_hash'),
  lastSignInAt: timestamp('last_sign_in_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/**
 * A signed-in agent's session (D19): the cookie holds its token, the database only its
 * SHA-256. It lasts thirty days from its last use; signing out deletes it.
 */
export const sessions = chat.table(
  'session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('session_agent_idx').on(t.agentId)],
)

/**
 * A link a supervisor hands over — to join (`invite`), or to choose a new password
 * (`reset`) —, used once, for seven days. Only its SHA-256 is kept.
 */
export const invitations = chat.table('invitation', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  purpose: text('purpose', { enum: ['invite', 'reset'] }).notNull(),
  createdBy: uuid('created_by').references(() => agents.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
})

/** An agent as an identity provider knows them: its issuer and its `sub` (OIDC). */
export const agentIdentities = chat.table(
  'agent_identity',
  {
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.issuer, t.subject] })],
)

/** A visitor: anonymous, then identified when the site signs who they are (D5). */
export const contacts = chat.table(
  'contact',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: text('site_id').notNull(),
    /** The site's own identifier of its customer, from the signed identity. */
    externalId: text('external_id'),
    name: text('name').notNull(),
    email: text('email'),
    identified: boolean('identified').notNull().default(false),
    location: text('location'),
    /**
     * Where they are, roughly (D18): their country (ISO 3166), the time zone their browser
     * gives, and a point — the zone's city, or a better one a site or the seed gave.
     */
    country: text('country'),
    timeZone: text('time_zone'),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    segment: text('segment'),
    attributes: jsonb('attributes').$type<ContactAttribute[]>().notNull().default([]),
    phone: text('phone'),
    /**
     * What the page or an agent said of the contact (`MessagerieChat.setContactData`, the
     * details panel) — never checked, unlike `attributes`, which the site signed.
     */
    data: jsonb('data').$type<Metadata>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('contact_site_external_key').on(t.siteId, t.externalId)],
)

export const conversations = chat.table(
  'conversation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    siteId: text('site_id').notNull(),
    /** The site's name when the conversation started — kept when the site is renamed or gone. */
    siteName: text('site_name').notNull(),
    status: conversationStatus('status').notNull().default('ai'),
    /**
     * The visitor began anew from the page (`MessagerieChat.reset()`): no longer their
     * current conversation — their next message opens another. Kept for the team.
     */
    visitorLeftAt: timestamp('visitor_left_at', { withTimezone: true }),
    /**
     * On hold until then (`pending`): back in the queue at that time, or sooner when the
     * visitor writes.
     */
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    assigneeId: uuid('assignee_id').references(() => agents.id, { onDelete: 'set null' }),
    /** « Boîtes de réception »: where it arrived, or was transferred. Null: before inboxes. */
    inboxId: text('inbox_id'),
    teamId: text('team_id'),
    /** What the page or an agent attached to it: an order, a page, a cart. */
    data: jsonb('data').$type<Metadata>().notNull().default({}),
    /** The visitor's page when they last wrote: its address, its context, its actions (D21). */
    page: jsonb('page').$type<PageSnapshot>(),
    priority: priority('priority').notNull().default('normal'),
    sentiment: sentiment('sentiment'),
    intent: text('intent'),
    /**
     * The visitor's language, as the AI reads it (ISO 639-1: `de`, `en`…): the agents read a
     * conversation in another language translated, and their replies go out in it.
     */
    language: text('language'),
    /** Written by the AI when an agent picks the conversation up, and at its close. */
    summary: text('summary'),
    /** Something new for the agents since one last opened it. */
    agentUnread: boolean('agent_unread').notNull().default(true),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('conversation_inbox_idx').on(t.status, t.lastMessageAt.desc()),
    index('conversation_site_idx').on(t.siteId, t.status, t.updatedAt),
    index('conversation_contact_idx').on(t.contactId),
    index('conversation_box_idx').on(t.inboxId, t.status),
  ],
)

/**
 * The runs of the AI — every call, traced (D9): what went in, what came out, how sure it
 * was, how long it took and what it cost.
 */
export const aiRuns = chat.table(
  'ai_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    kind: aiRunKind('kind').notNull(),
    model: text('model').notNull(),
    input: jsonb('input').notNull().default({}),
    output: jsonb('output').notNull().default({}),
    confidence: real('confidence'),
    latencyMs: integer('latency_ms'),
    costEur: numeric('cost_eur', { precision: 10, scale: 6 }),
    createdAt: createdAt(),
  },
  (t) => [index('ai_run_conversation_idx').on(t.conversationId, t.createdAt)],
)

/** What a message carries beyond its text: one field per kind that needs one. */
export interface MessageMeta {
  /** An AI answer: the passages it answered from. */
  readonly sources?: readonly Source[]
  /** An event: what happened. */
  readonly event?: ConversationEvent
  /**
   * The message in the agents' language, when its words are in another — the visitor's,
   * the AI's, translated for the agents; or the agent's own words, as written before they
   * went out translated in `body`. `from` is the language of `body`.
   */
  readonly translation?: { readonly from: string; readonly language: string; readonly body: string }
  /** The language of `body`, once the AI read it — `fr`, `de`… */
  readonly language?: string
  /** A handoff: why, and what the agent needs to pick the conversation up. */
  readonly handoff?: {
    readonly reason: string
    readonly summary: string
    readonly confidence: number
    readonly assignee: string
    readonly team: string
  }
}

/**
 * The events of a conversation, in one table (the framing's data model): the visitor's
 * words, the agents' and the AI's, the notes, the handoffs and what happened. One table is
 * one order, one audit trail and one stream.
 */
export const messages = chat.table(
  'message',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    author: messageAuthor('author').notNull(),
    kind: messageKind('kind').notNull().default('text'),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    body: text('body').notNull().default(''),
    meta: jsonb('meta').$type<MessageMeta>().notNull().default({}),
    /** The run that wrote it, for an AI answer or a handoff. */
    aiRunId: uuid('ai_run_id').references(() => aiRuns.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    /**
     * Deleted for everyone: its words and files gone, « Ce message a été supprimé » in
     * their place — for the visitor, the team and the AI.
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => agents.id, { onDelete: 'set null' }),
  },
  (t) => [index('message_conversation_idx').on(t.conversationId, t.createdAt)],
)

/**
 * A token of the public API and the MCP server (D16) — basedb's integration tokens, for
 * the chat: `msg_<prefix>_<secret>`, of which only the SHA-256 of the secret is kept, and
 * the prefix in clear, to tell tokens apart. It acts as its own agent row (`agentId`),
 * never active: listed nowhere, told nothing, naming what it writes.
 */
export const apiTokens = chat.table('api_token', {
  id: uuid('id').primaryKey().defaultRandom(),
  label: text('label').notNull(),
  tokenPrefix: text('token_prefix').notNull(),
  /** SHA-256 of the secret, in hexadecimal. */
  tokenHash: text('token_hash').notNull().unique(),
  /** `read`, or `write`: read, reply, note, assign, resolve, tag — never delete. */
  access: text('access', { enum: ['read', 'write'] }).notNull(),
  /** `rest`, `mcp`: where the token is taken. */
  surfaces: text('surfaces').array().notNull(),
  /** The inboxes it reaches — every one the creator sees when null. */
  inboxIds: text('inbox_ids').array(),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => agents.id),
  createdAt: createdAt(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedBy: uuid('revoked_by').references(() => agents.id, { onDelete: 'set null' }),
})

/**
 * A webhook (D17) — basedb's, for the chat: an HTTPS address told of what happens in the
 * conversations, signed with its own secret. The secret is SEALED, not hashed — it signs
 * every call —, with a key drawn from `CHAT_SECRET`, and shown once. Deleted, it is kept,
 * stopped, for its log.
 */
export const webhooks = chat.table('webhook', {
  id: uuid('id').primaryKey().defaultRandom(),
  label: text('label').notNull(),
  targetUrl: text('target_url').notNull(),
  /** AES-256-GCM, `v1.<iv>.<tag>.<ciphertext>`. */
  signingSecret: text('signing_secret').notNull(),
  /** The events it is told of: `message.created`, `conversation.resolved`… */
  events: text('events').array().notNull(),
  /** The inboxes it hears; null: all of them. */
  inboxIds: text('inbox_ids').array(),
  isActive: boolean('is_active').notNull().default(true),
  /** Why it stopped: `failures` (by itself), `manual`. */
  disabledReason: text('disabled_reason'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => agents.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

/**
 * What happened, captured by triggers in the transaction that did it — and only while a
 * webhook or an automation listens. Drained into deliveries, and into automations' runs
 * (D20), each on its own; kept seven days.
 */
export const changeEvents = chat.table(
  'change_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    /** None for a test sent from the settings. */
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'cascade',
    }),
    messageId: uuid('message_id'),
    inboxId: text('inbox_id'),
    /** A test sent to one webhook only. */
    webhookId: uuid('webhook_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    drainedAt: timestamp('drained_at', { withTimezone: true }),
    /** Read by the automations. */
    automatedAt: timestamp('automated_at', { withTimezone: true }),
    /** The automation's run that did it — `chat.automation_run` of the transaction. */
    causedBy: uuid('caused_by'),
  },
  (t) => [
    index('change_event_undrained_idx').on(t.occurredAt).where(sql`drained_at is null`),
    index('change_event_unautomated_idx').on(t.occurredAt).where(sql`automated_at is null`),
  ],
)

/**
 * An event to send to a webhook, and how it went. In order per conversation, never
 * globally; the body is never kept — it is written when sent. Kept ninety days.
 */
export const webhookDeliveries = chat.table(
  'webhook_delivery',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    webhookId: uuid('webhook_id')
      .notNull()
      .references(() => webhooks.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => changeEvents.id, { onDelete: 'cascade' }),
    /** `<webhook>:<conversation>`: what keeps the order. */
    partitionKey: text('partition_key').notNull(),
    /** `pending`, `in_flight`, `delivered`, `failed`, `abandoned`. */
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    responseCode: integer('response_code'),
    errorCode: text('error_code'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('webhook_delivery_due_idx').on(t.status, t.nextAttemptAt),
    index('webhook_delivery_partition_idx').on(t.partitionKey, t.createdAt),
    index('webhook_delivery_log_idx').on(t.webhookId, t.createdAt),
  ],
)

/**
 * The automations (D20): a trigger, the conversations it keeps, and steps — as
 * `@chat/contracts` writes them. Each acts as an agent row of its own
 * (`automation:<id>`), never active: the thread says « Relance » did it.
 */
export const automations = chat.table('automation', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  isActive: boolean('is_active').notNull().default(false),
  trigger: jsonb('trigger').$type<AutomationTrigger>().notNull(),
  condition: jsonb('condition').$type<Condition>().notNull(),
  steps: jsonb('steps').$type<readonly AutomationStep[]>().notNull().default([]),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id),
  /** `webhook`: the key of its address, sealed (AES-256-GCM) — shown again to supervisors. */
  webhookKey: text('webhook_key'),
  /** Switched on then: a visitor left waiting since before is not its business. */
  activatedAt: timestamp('activated_at', { withTimezone: true }),
  /** `schedule`: when it goes off next. */
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
  /** What it remembers between runs: whose turn it is, for « à tour de rôle ». */
  state: jsonb('state').$type<Record<string, string>>().notNull().default({}),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => agents.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

/**
 * A run of an automation: queued, worked, perhaps waiting, then done — with what each
 * step did. Kept ninety days.
 */
export const automationRuns = chat.table(
  'automation_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    automationId: uuid('automation_id')
      .notNull()
      .references(() => automations.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    /** `queued`, `running`, `waiting`, `succeeded`, `failed`, `stopped`. */
    status: text('status').notNull().default('queued'),
    /** What set it off: `{ type: 'event', event, messageId }`, `{ type: 'button', agent }`… */
    cause: jsonb('cause').$type<Record<string, unknown>>().notNull(),
    /** What a webhook sent. */
    input: jsonb('input').$type<unknown>(),
    /** What the steps gave, by step id. */
    outputs: jsonb('outputs').$type<Record<string, string>>().notNull().default({}),
    steps: jsonb('steps').$type<readonly RunStepRecord[]>().notNull().default([]),
    /** A wait: the step it waits at, until when, and since when. */
    resumeAfter: text('resume_after'),
    resumeAt: timestamp('resume_at', { withTimezone: true }),
    waitingSince: timestamp('waiting_since', { withTimezone: true }),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    /** How deep in a chain of automations setting each other off. */
    depth: integer('depth').notNull().default(0),
    /** Once per key: `no_reply` runs once for a message left waiting. */
    dedupKey: text('dedup_key'),
    error: text('error'),
    createdAt: createdAt(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('automation_run_due_idx').on(t.status, t.resumeAt),
    index('automation_run_log_idx').on(t.automationId, t.createdAt.desc()),
    uniqueIndex('automation_run_dedup_key')
      .on(t.automationId, t.dedupKey)
      .where(sql`dedup_key is not null`),
  ],
)

/**
 * The actions a site's pages declared (D21): what the AI may ask of them, once a supervisor
 * allows it. Kept as last declared; never removed by a page that stops declaring one.
 */
export const pageActions = chat.table(
  'page_action',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: text('site_id').notNull(),
    name: text('name').notNull(),
    label: text('label').notNull(),
    description: text('description').notNull(),
    kind: text('kind', { enum: ['read', 'do'] }).notNull(),
    parameters: jsonb('parameters').$type<Record<string, unknown>>().notNull().default({}),
    enabled: boolean('enabled').notNull().default(false),
    confirm: boolean('confirm').notNull().default(false),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('page_action_site_name_key').on(t.siteId, t.name)],
)

/**
 * An action the AI asked of the visitor's page, and how it went: claimed by one tab of the
 * visitor, run there, answered. Its event in the thread says the same.
 */
export const pageCalls = chat.table(
  'page_call',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    /** Its event in the thread. */
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    label: text('label').notNull(),
    args: jsonb('args').$type<Record<string, unknown>>().notNull().default({}),
    confirm: boolean('confirm').notNull().default(false),
    /** `pending`, `confirming`, `running`, `done`, `failed`, `refused`, `expired`. */
    status: text('status').$type<PageCallStatus>().notNull(),
    result: jsonb('result').$type<unknown>(),
    error: text('error'),
    /** The visitor's tab that runs it. */
    claimedBy: text('claimed_by'),
    createdAt: createdAt(),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
  },
  (t) => [index('page_call_conversation_idx').on(t.conversationId, t.createdAt)],
)

/**
 * The pages a visitor in conversation goes through, as their widget says it: the page, from
 * when, until when — `leftAt` empty while it is still open in their browser. Data the page
 * gives, never checked; the hundred newest kept per conversation.
 */
export const pageViews = chat.table(
  'page_view',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    title: text('title').notNull().default(''),
    createdAt: createdAt(),
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (t) => [index('page_view_conversation_idx').on(t.conversationId, t.createdAt)],
)

/**
 * « Enquête de satisfaction »: what a visitor was asked at the end of a conversation — a
 * CSAT (1 to 5) or an NPS (0 to 10) — and what they answered. Asked by an automation (D20),
 * once a conversation; it judges the agent who had the conversation then, or the AI alone.
 */
export const surveys = chat.table(
  'survey',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    scale: text('scale', { enum: ['csat', 'nps'] }).notNull(),
    /** The site's own words; null: the widget's. */
    question: text('question'),
    /** The automation that asked. */
    askedBy: text('asked_by'),
    /** Who had the conversation when it was asked; null: the AI alone. */
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    /** 1 to 5 (CSAT), 0 to 10 (NPS); null until the visitor answers. */
    score: integer('score'),
    comment: text('comment'),
    createdAt: createdAt(),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('survey_conversation_idx').on(t.conversationId),
    index('survey_created_idx').on(t.createdAt),
  ],
)

/**
 * The dashboards every messaging is given (`overview`, `satisfaction`…), once each: one a
 * supervisor deleted is not given again.
 */
export const dashboardPresets = chat.table('dashboard_preset', {
  key: text('key').primaryKey(),
  installedAt: createdAt(),
})

/**
 * The dashboards (D22): their cards, on a twelve-column grid, each a question and how it
 * is drawn. Shared, agents see it; supervisors alone change it.
 */
export const dashboards = chat.table('dashboard', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  cards: jsonb('cards').$type<readonly DashboardCard[]>().notNull().default([]),
  /** Its filters, above the cards (basedb's parameters). */
  filters: jsonb('filters').$type<readonly DashboardFilter[]>().notNull().default([]),
  shared: boolean('shared').notNull().default(true),
  /** The one a new messaging starts with: shown first. */
  isDefault: boolean('is_default').notNull().default(false),
  createdBy: uuid('created_by').references(() => agents.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/** A message an agent took out of their own view of the thread — « Supprimer pour moi ». */
export const hiddenMessages = chat.table(
  'hidden_message',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.agentId] })],
)

/** An agent's verdict on an AI output: one per agent and run, the latest standing. */
export const aiFeedback = chat.table(
  'ai_feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    aiRunId: uuid('ai_run_id')
      .notNull()
      .references(() => aiRuns.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    action: feedbackAction('action').notNull(),
    /** What the agent sent instead, when they corrected the answer. */
    finalText: text('final_text'),
    createdAt: createdAt(),
  },
  (t) => [unique('ai_feedback_run_agent_key').on(t.aiRunId, t.agentId)],
)

/** Tags on a conversation. The label and colour come from « Étiquettes »: copied, kept. */
export const conversationTags = chat.table(
  'conversation_tag',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    color: text('color').notNull(),
    origin: tagOrigin('origin').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.label] })],
)

/**
 * The passages the AI answers from: an article, or a promoted conversation, cut and
 * embedded. A chunk that came from a conversation goes with it when it is purged.
 * 1024 dimensions: the size of mistral-embed and bge-m3.
 */
export const kbChunks = chat.table(
  'kb_chunk',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: chunkSource('source').notNull(),
    /** The article or promoted conversation it was cut from. */
    sourceId: text('source_id').notNull(),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'cascade',
    }),
    title: text('title').notNull(),
    text: text('text').notNull(),
    embedding: vector('embedding', { dimensions: 1024 }),
    /** The source's text, hashed: an article that did not change is not embedded again. */
    digest: text('digest').notNull().default(''),
    /** The sites it answers for; empty, every site. */
    siteIds: text('site_ids').array().notNull().default(sql`'{}'::text[]`),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('kb_chunk_source_idx').on(t.source, t.sourceId),
    index('kb_chunk_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
)

/** What the AI made of a file, at an agent's request. */
export interface AttachmentAnalysis {
  readonly summary: string
  readonly model: string
  readonly at: string
  /** Who asked for it. */
  readonly by: string
}

/**
 * A file sent with a message, by the visitor or an agent. The bytes are in the file store
 * (`storageKey`), never in the database; the name is the sender's, shown, never trusted.
 */
export const attachments = chat.table(
  'attachment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    name: text('name').notNull().default(''),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    analysis: jsonb('analysis').$type<AttachmentAnalysis>(),
    createdAt: createdAt(),
  },
  (t) => [index('attachment_message_idx').on(t.messageId)],
)

/**
 * The secret each site signs its visitors' identity with. Here, never in the settings, where
 * whoever reads the « Messagerie » base would read it too (D5).
 */
export const siteSecrets = chat.table('site_secret', {
  siteId: text('site_id').primaryKey(),
  identitySecret: text('identity_secret').notNull(),
  createdAt: createdAt(),
})

/** Who opened which conversation, and when — the access journal of the framing. */
export const accessLog = chat.table(
  'access_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('access_log_conversation_idx').on(t.conversationId, t.at)],
)

/**
 * An agent's bell: what called for their attention, until they open the conversation.
 * One unread entry per agent, conversation and kind — a visitor who writes five times
 * rings five times but leaves one line, brought back to the top.
 */
export const notifications = chat.table(
  'notification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    kind: alertKind('kind').notNull(),
    /** Who assigned the conversation, for `assigned`. */
    byAgentId: uuid('by_agent_id').references(() => agents.id, { onDelete: 'set null' }),
    /** What an automation says, for `automation`. */
    text: text('text'),
    createdAt: createdAt(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    index('notification_agent_idx').on(t.agentId, t.createdAt.desc()),
    uniqueIndex('notification_unread_key')
      .on(t.agentId, t.conversationId, t.kind)
      .where(sql`${t.readAt} is null`),
  ],
)

// <settings-tables>
// ── Settings (D19): the chat's own tables ──────────────────────────────────────────────
// The screens edit them by field label, through `settings/catalog.ts`.

/** A team of agents. */
export const teams = chat.table('team', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/** A site the widget runs on: its look, its language, its AI, how long it keeps. */
export const sites = chat.table('site', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  domains: text('domains'),
  welcome: text('welcome'),
  suggestions: text('suggestions'),
  color: text('color'),
  title: text('title'),
  tagline: text('tagline'),
  position: text('position'),
  offsetX: integer('offset_x'),
  offsetY: integer('offset_y'),
  launcher: text('launcher'),
  launcherLabel: text('launcher_label'),
  font: text('font'),
  customFont: text('custom_font'),
  theme: text('theme'),
  corners: text('corners'),
  logo: text('logo'),
  hideTeam: boolean('hide_team').notNull().default(false),
  nudgeAfter: integer('nudge_after'),
  hideOnMobile: boolean('hide_on_mobile').notNull().default(false),
  hideWhenClosed: boolean('hide_when_closed').notNull().default(false),
  hideBranding: boolean('hide_branding').notNull().default(false),
  language: text('language'),
  timeZone: text('time_zone'),
  aiEnabled: boolean('ai_enabled').notNull().default(true),
  aiThreshold: integer('ai_threshold'),
  aiInstructions: text('ai_instructions'),
  /** The agents read the visitors in their language, and answer in the visitors'. */
  translate: boolean('translate').notNull().default(true),
  retentionDays: integer('retention_days'),
  active: boolean('active').notNull().default(true),
  inboxId: uuid('inbox_id').references(() => inboxes.id, { onDelete: 'set null' }),
  defaultTeamId: uuid('default_team_id').references(() => teams.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/** When the team answers: a slot of some weekdays, for a site or for all. */
export const openingSlots = chat.table('opening_slot', {
  id: uuid('id').primaryKey().defaultRandom(),
  label: text('label').notNull(),
  days: text('days').array().notNull().default(sql`'{}'::text[]`),
  opens: text('opens'),
  closes: text('closes'),
  siteId: uuid('site_id').references(() => sites.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/** A day or days off: no one answers, the visitors are told. */
export const closures = chat.table('closure', {
  id: uuid('id').primaryKey().defaultRandom(),
  reason: text('reason').notNull(),
  startsOn: date('starts_on', { mode: 'string' }),
  endsOn: date('ends_on', { mode: 'string' }),
  message: text('message'),
  siteId: uuid('site_id').references(() => sites.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/** Where conversations arrive, and the teams that answer there (D12). */
export const inboxes = chat.table('inbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  color: text('color'),
  icon: text('icon'),
  image: text('image'),
  active: boolean('active').notNull().default(true),
  defaultTeamId: uuid('default_team_id').references(() => teams.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/** A reply an agent inserts with « / » — for some teams, or for all. */
export const cannedReplies = chat.table('canned_reply', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  shortcut: text('shortcut'),
  body: text('body'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/** A tag the agents — and the AI, when it may — set on conversations. */
export const tagDefinitions = chat.table('tag_definition', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  color: text('color'),
  whenToApply: text('when_to_apply'),
  byAi: boolean('by_ai').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/** The knowledge base's shelves. */
export const categories = chat.table('category', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/** What the AI answers from, once published — by site, or for all. */
export const articles = chat.table('article', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  body: text('body'),
  status: text('status'),
  authorId: uuid('author_id').references(() => agents.id, { onDelete: 'set null' }),
  reviewedOn: date('reviewed_on', { mode: 'string' }),
  categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/** A conversation turned into a question and its answer, for the AI. */
export const promotedConversations = chat.table('promoted_conversation', {
  id: uuid('id').primaryKey().defaultRandom(),
  question: text('question').notNull(),
  answer: text('answer'),
  status: text('status'),
  origin: text('origin'),
  conversationUrl: text('conversation_url'),
  promotedBy: uuid('promoted_by').references(() => agents.id, { onDelete: 'set null' }),
  reviewedBy: uuid('reviewed_by').references(() => agents.id, { onDelete: 'set null' }),
  categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/** A subject the AI never handles alone. */
export const guardrails = chat.table('guardrail', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  subject: text('subject'),
  action: text('action'),
  message: text('message'),
  active: boolean('active').notNull().default(true),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/** A tool the AI and the copilot may call: an HTTP call, a reminder, the visitor's record. */
export const aiTools = chat.table('ai_tool', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  kind: text('kind'),
  target: text('target'),
  method: text('method'),
  tokenEnv: text('token_env'),
  headers: text('headers'),
  parameters: text('parameters'),
  forAi: boolean('for_ai').notNull().default(false),
  forCopilot: boolean('for_copilot').notNull().default(false),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/** An MCP server whose tools the AI may call. */
export const mcpServers = chat.table('mcp_server', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  url: text('url'),
  description: text('description'),
  tokenEnv: text('token_env'),
  headers: text('headers'),
  allowedTools: text('allowed_tools'),
  forAi: boolean('for_ai').notNull().default(false),
  forCopilot: boolean('for_copilot').notNull().default(false),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const inboxTeams = chat.table(
  'inbox_team',
  {
    inboxId: uuid('inbox_id')
      .notNull()
      .references(() => inboxes.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.inboxId, t.teamId] })],
)

export const agentTeams = chat.table(
  'agent_team',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.teamId] })],
)

export const cannedReplyTeams = chat.table(
  'canned_reply_team',
  {
    cannedReplyId: uuid('canned_reply_id')
      .notNull()
      .references(() => cannedReplies.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.cannedReplyId, t.teamId] })],
)

export const articleSites = chat.table(
  'article_site',
  {
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.articleId, t.siteId] })],
)
// </settings-tables>
