import type { ContactAttribute, ConversationEvent, Metadata, Source } from '@chat/contracts'
import { sql } from 'drizzle-orm'
import {
  boolean,
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
 * lives in basedb and is referred to here by the `_id` of its basedb row, as text: a site
 * is `site_id`, a team `team_id`. No foreign key crosses into basedb — its tables are its
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
])

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()

/**
 * The agents, as the chat knows them: a copy of basedb's « Conseillers » rows, kept so
 * that a message can name its author after the row is gone (D4).
 */
export const agents = chat.table('agent', {
  id: uuid('id').primaryKey().defaultRandom(),
  basedbUserId: text('basedb_user_id').notNull().unique(),
  name: text('name').notNull(),
  email: text('email'),
  role: text('role', { enum: ['agent', 'supervisor'] })
    .notNull()
    .default('agent'),
  active: boolean('active').notNull().default(true),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
})

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
    /** The site's name when the conversation started — the list shows it without basedb. */
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
    priority: priority('priority').notNull().default('normal'),
    sentiment: sentiment('sentiment'),
    intent: text('intent'),
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
 * webhook listens. Drained into deliveries; kept seven days.
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
  },
  (t) => [index('change_event_undrained_idx').on(t.occurredAt).where(sql`drained_at is null`)],
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

/** Tags on a conversation. The label and colour come from basedb's « Étiquettes ». */
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
    /** The basedb row it was cut from. */
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
 * The secret each site signs its visitors' identity with. Here, never in basedb, where
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
