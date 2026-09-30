import type { ContactAttribute, ConversationEvent, Source } from '@chat/contracts'
import {
  boolean,
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
export const aiRunKind = chat.enum('ai_run_kind', ['answer', 'suggestion', 'tag', 'summary'])
export const feedbackAction = chat.enum('feedback_action', ['accepted', 'edited', 'rejected'])
export const tagOrigin = chat.enum('tag_origin', ['agent', 'ai'])
export const chunkSource = chat.enum('chunk_source', ['article', 'conversation'])

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
    segment: text('segment'),
    attributes: jsonb('attributes').$type<ContactAttribute[]>().notNull().default([]),
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
    assigneeId: uuid('assignee_id').references(() => agents.id, { onDelete: 'set null' }),
    teamId: text('team_id'),
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
  },
  (t) => [index('message_conversation_idx').on(t.conversationId, t.createdAt)],
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
    updatedAt: updatedAt(),
  },
  (t) => [
    index('kb_chunk_source_idx').on(t.source, t.sourceId),
    index('kb_chunk_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
)

export const attachments = chat.table('attachment', {
  id: uuid('id').primaryKey().defaultRandom(),
  messageId: uuid('message_id')
    .notNull()
    .references(() => messages.id, { onDelete: 'cascade' }),
  storageKey: text('storage_key').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  createdAt: createdAt(),
})

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
