import type {
  Agent,
  Contact,
  Conversation,
  ConversationSummary,
  Feedback,
  Message,
  PastConversation,
} from '@chat/contracts'
import { and, asc, desc, eq, gt, inArray, ne } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Db } from '../db/client.js'
import {
  type MessageMeta,
  agents,
  aiFeedback,
  aiRuns,
  contacts,
  conversationTags,
  conversations,
  messages,
} from '../db/schema.js'
import { Refusal } from '../refusal.js'

/**
 * The inbox's reads: the list, and one conversation with its thread — in the shapes of
 * `@chat/contracts`, which is all the inbox ever sees of the schema.
 */

export type AgentRow = typeof agents.$inferSelect

export function toAgent(row: AgentRow): Agent {
  return { id: row.id, name: row.name, email: row.email, role: row.role }
}

const PREVIEW_AUTHOR = { contact: 'visitor', agent: 'agent', ai: 'ai', system: null } as const

/** The rows of the list — all of them, or those of `ids`, the newest first. */
export async function loadSummaries(
  db: Db,
  ids?: readonly string[],
): Promise<ConversationSummary[]> {
  if (ids !== undefined && ids.length === 0) return []
  const rows = await db
    .select({
      conversation: conversations,
      contact: {
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
        identified: contacts.identified,
      },
      assignee: agents.name,
    })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .leftJoin(agents, eq(agents.id, conversations.assigneeId))
    .where(ids ? inArray(conversations.id, [...ids]) : undefined)
    .orderBy(desc(conversations.lastMessageAt))
  if (rows.length === 0) return []

  const listed = rows.map((row) => row.conversation.id)
  // The last thing said in each — what the row previews.
  const last = await db
    .selectDistinctOn([messages.conversationId], {
      conversationId: messages.conversationId,
      author: messages.author,
      body: messages.body,
      agent: agents.name,
    })
    .from(messages)
    .leftJoin(agents, eq(agents.id, messages.agentId))
    .where(and(inArray(messages.conversationId, listed), eq(messages.kind, 'text')))
    .orderBy(messages.conversationId, desc(messages.createdAt))
  const handedOff = await db
    .selectDistinct({ conversationId: messages.conversationId })
    .from(messages)
    .where(and(inArray(messages.conversationId, listed), eq(messages.kind, 'handoff')))

  const lastOf = new Map(last.map((m) => [m.conversationId, m]))
  const handed = new Set(handedOff.map((m) => m.conversationId))

  return rows.map(({ conversation, contact, assignee }) => {
    const said = lastOf.get(conversation.id)
    return {
      id: conversation.id,
      contact,
      site: conversation.siteName,
      status: conversation.status,
      assignee,
      unread: conversation.agentUnread,
      handedOff: handed.has(conversation.id),
      preview: said?.body ?? '',
      previewAuthor: said ? PREVIEW_AUTHOR[said.author] : null,
      previewAgent: said?.author === 'agent' ? said.agent : null,
      lastMessageAt: conversation.lastMessageAt.toISOString(),
    }
  })
}

/**
 * One conversation and its thread, as `viewer` sees it: the verdicts on the AI's answers
 * are theirs, not their colleagues'.
 */
export async function loadConversation(
  db: Db,
  id: string,
  viewer: AgentRow,
): Promise<Conversation> {
  const [row] = await db
    .select({ conversation: conversations, contact: contacts, assignee: agents.name })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .leftJoin(agents, eq(agents.id, conversations.assigneeId))
    .where(eq(conversations.id, id))
  if (!row) throw new Refusal('CONVERSATION_NOT_FOUND', 404)
  const { conversation, contact } = row

  const author = alias(agents, 'author')
  const thread = await db
    .select({
      message: messages,
      author: author.name,
      confidence: aiRuns.confidence,
      feedback: aiFeedback.action,
    })
    .from(messages)
    .leftJoin(author, eq(author.id, messages.agentId))
    .leftJoin(aiRuns, eq(aiRuns.id, messages.aiRunId))
    .leftJoin(
      aiFeedback,
      and(eq(aiFeedback.aiRunId, messages.aiRunId), eq(aiFeedback.agentId, viewer.id)),
    )
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.createdAt))

  const tags = await db
    .select()
    .from(conversationTags)
    .where(eq(conversationTags.conversationId, id))
    .orderBy(asc(conversationTags.createdAt))

  return {
    id: conversation.id,
    contact: toContact(contact),
    site: conversation.siteName,
    status: conversation.status,
    assignee: row.assignee,
    unread: conversation.agentUnread,
    intent: conversation.intent,
    tags: tags.map((t) => ({ label: t.label, color: t.color, byAi: t.origin === 'ai' })),
    sentiment: conversation.sentiment,
    priority: conversation.priority,
    suggestions: await currentSuggestions(db, id),
    summary: conversation.summary,
    history: await pastConversations(db, contact.id, id),
    messages: thread.flatMap(({ message, author, confidence, feedback }) => {
      const shown = toMessage(message, author, confidence, feedback)
      return shown ? [shown] : []
    }),
  }
}

function toContact(row: typeof contacts.$inferSelect): Contact {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    identified: row.identified,
    location: row.location,
    segment: row.segment,
    attributes: row.attributes,
  }
}

function toMessage(
  row: typeof messages.$inferSelect,
  author: string | null,
  confidence: number | null,
  feedback: Feedback | null,
): Message | null {
  const base = { id: row.id, at: row.createdAt.toISOString() }
  const meta: MessageMeta = row.meta
  const agent = author ?? '—'
  switch (row.kind) {
    case 'text':
      if (row.author === 'contact') return { ...base, kind: 'visitor', body: row.body }
      if (row.author === 'agent') return { ...base, kind: 'agent', author: agent, body: row.body }
      if (row.author === 'ai') {
        return {
          ...base,
          kind: 'ai',
          body: row.body,
          confidence: confidence ?? 0,
          sources: meta.sources ?? [],
          feedback,
        }
      }
      return null
    case 'note':
      return { ...base, kind: 'note', author: agent, body: row.body }
    case 'event':
      return meta.event ? { ...base, kind: 'event', event: meta.event } : null
    case 'handoff':
      return meta.handoff ? { ...base, kind: 'handoff', ...meta.handoff } : null
    case 'file':
      // Attachments arrive with the widget; until then a file message has nothing to show.
      return null
  }
}

/**
 * The copilot's latest proposals — as long as no agent has answered since: they were
 * written for the message before that answer.
 */
async function currentSuggestions(db: Db, conversationId: string): Promise<string[]> {
  const [run] = await db
    .select({ output: aiRuns.output, createdAt: aiRuns.createdAt })
    .from(aiRuns)
    .where(and(eq(aiRuns.conversationId, conversationId), eq(aiRuns.kind, 'suggestion')))
    .orderBy(desc(aiRuns.createdAt))
    .limit(1)
  if (!run) return []
  const [answered] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.author, 'agent'),
        eq(messages.kind, 'text'),
        gt(messages.createdAt, run.createdAt),
      ),
    )
    .limit(1)
  if (answered) return []
  const output = run.output as { suggestions?: unknown }
  return Array.isArray(output.suggestions)
    ? output.suggestions.filter((s): s is string => typeof s === 'string').slice(0, 3)
    : []
}

/** The contact's other conversations, the newest first — the « Historique » tab. */
async function pastConversations(
  db: Db,
  contactId: string,
  exceptId: string,
): Promise<PastConversation[]> {
  const past = await db
    .select({
      id: conversations.id,
      intent: conversations.intent,
      status: conversations.status,
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    .where(and(eq(conversations.contactId, contactId), ne(conversations.id, exceptId)))
    .orderBy(desc(conversations.createdAt))
    .limit(10)
  if (past.length === 0) return []
  // Without an intent, a conversation is named by its first question.
  const first = await db
    .selectDistinctOn([messages.conversationId], {
      conversationId: messages.conversationId,
      body: messages.body,
    })
    .from(messages)
    .where(
      and(
        inArray(
          messages.conversationId,
          past.map((p) => p.id),
        ),
        eq(messages.author, 'contact'),
      ),
    )
    .orderBy(messages.conversationId, asc(messages.createdAt))
  const question = new Map(first.map((f) => [f.conversationId, f.body]))
  return past.map((p) => ({
    subject: p.intent ?? question.get(p.id) ?? '',
    at: p.createdAt.toISOString(),
    status: p.status,
  }))
}
