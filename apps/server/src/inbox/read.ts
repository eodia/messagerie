import type {
  Agent,
  Attachment,
  Contact,
  Conversation,
  ConversationSummary,
  Feedback,
  Message,
  MessageHit,
  PastConversation,
  Tag,
} from '@chat/contracts'
import { type SQL, and, asc, desc, eq, gt, inArray, isNull, like, ne, or, sql } from 'drizzle-orm'
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
  hiddenMessages,
  messages,
} from '../db/schema.js'
import { attachmentsOf, forInbox } from '../files/attachments.js'
import { pointOf } from '../places/place.js'
import { Refusal } from '../refusal.js'
import { type Visible, canSee } from './access.js'

/**
 * The inbox's reads: the list, and one conversation with its thread — in the shapes of
 * `@chat/contracts`, which is all the inbox ever sees of the schema.
 */

export type AgentRow = typeof agents.$inferSelect

export function toAgent(row: AgentRow): Agent {
  return { id: row.id, name: row.name, email: row.email, role: row.role }
}

const PREVIEW_AUTHOR = { contact: 'visitor', agent: 'agent', ai: 'ai', system: null } as const

/** Only the conversations of the inboxes one sees — and those of no inbox. */
function inVisible(visible: Visible): SQL | undefined {
  if (visible === null) return undefined
  return visible.size === 0
    ? isNull(conversations.inboxId)
    : or(isNull(conversations.inboxId), inArray(conversations.inboxId, [...visible]))
}

/**
 * The rows of the list — all of them, or those of `ids` — of the inboxes one sees, the
 * newest first.
 */
export async function loadSummaries(
  db: Db,
  ids?: readonly string[],
  visible: Visible = null,
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
    .where(and(ids ? inArray(conversations.id, [...ids]) : undefined, inVisible(visible)))
    .orderBy(desc(conversations.lastMessageAt))
  if (rows.length === 0) return []

  const listed = rows.map((row) => row.conversation.id)
  // The last thing said in each — what the row previews.
  const last = await db
    .selectDistinctOn([messages.conversationId], {
      id: messages.id,
      conversationId: messages.conversationId,
      author: messages.author,
      body: messages.body,
      agent: agents.name,
    })
    .from(messages)
    .leftJoin(agents, eq(agents.id, messages.agentId))
    .where(
      and(
        inArray(messages.conversationId, listed),
        eq(messages.kind, 'text'),
        isNull(messages.deletedAt),
      ),
    )
    .orderBy(messages.conversationId, desc(messages.createdAt))
  const handedOff = await db
    .selectDistinct({ conversationId: messages.conversationId })
    .from(messages)
    .where(and(inArray(messages.conversationId, listed), eq(messages.kind, 'handoff')))

  const lastOf = new Map(last.map((m) => [m.conversationId, m]))
  const handed = new Set(handedOff.map((m) => m.conversationId))
  const files = await attachmentsOf(
    db,
    last.map((m) => m.id),
  )
  const tagRows = await db
    .select()
    .from(conversationTags)
    .where(inArray(conversationTags.conversationId, listed))
    .orderBy(asc(conversationTags.createdAt))
  const tagsOf = new Map<string, Tag[]>()
  for (const t of tagRows) {
    const list = tagsOf.get(t.conversationId) ?? []
    list.push({ label: t.label, color: t.color, byAi: t.origin === 'ai' })
    tagsOf.set(t.conversationId, list)
  }

  return rows.map(({ conversation, contact, assignee }) => {
    const said = lastOf.get(conversation.id)
    return {
      id: conversation.id,
      contact,
      site: conversation.siteName,
      inboxId: conversation.inboxId,
      teamId: conversation.teamId,
      status: conversation.status,
      assignee,
      assigneeId: conversation.assigneeId,
      unread: conversation.agentUnread,
      handedOff: handed.has(conversation.id),
      preview: said?.body ?? '',
      snoozedUntil: snoozedUntil(conversation),
      previewAuthor: said ? PREVIEW_AUTHOR[said.author] : null,
      previewAgent: said?.author === 'agent' ? said.agent : null,
      previewFiles: said ? (files.get(said.id)?.length ?? 0) : 0,
      lastMessageAt: conversation.lastMessageAt.toISOString(),
/** When a conversation on hold comes back — only while it is on hold. */
const snoozedUntil = (row: typeof conversations.$inferSelect): string | null =>
  row.status === 'pending' ? (row.snoozedUntil?.toISOString() ?? null) : null

      priority: conversation.priority,
      sentiment: conversation.sentiment,
      tags: tagsOf.get(conversation.id) ?? [],
    }
  })
}

/** The accented letters of French and its neighbours, and what they read as once folded. */
const ACCENTED = 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ'
const PLAIN = 'aaaaaaceeeeiiiinooooouuuuyy'

/** A text as the search compares it: lower case, without accents. */
const foldText = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')

/**
 * The messages that say every word of `query` — in any order, accents and case aside —,
 * in the conversations the reader sees, newest first: what the palette and the list offer
 * under « Dans les messages ».
 */
export async function searchMessages(
  db: Db,
  query: string,
  visible: Visible = null,
): Promise<MessageHit[]> {
  const text = query.trim()
  if (text.length < 3) return []
  // `%`, `_` and `\` typed are looked for as such, not as LIKE's wildcards.
  const words = foldText(text)
    .split(/\s+/u)
    .filter((word) => word !== '')
    .slice(0, 8)
    .map((word) => `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
  const folded = sql`translate(lower(${messages.body}), ${ACCENTED}, ${PLAIN})`
  const rows = await db
    .select({
      conversationId: messages.conversationId,
      messageId: messages.id,
      author: messages.author,
      kind: messages.kind,
      body: messages.body,
      at: messages.createdAt,
      contactName: contacts.name,
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(
      and(
        or(eq(messages.kind, 'text'), eq(messages.kind, 'note')),
        ...words.map((pattern) => like(folded, pattern)),
        inVisible(visible),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(20)
  return rows.map((row) => ({
    conversationId: row.conversationId,
    messageId: row.messageId,
    contactName: row.contactName,
    author:
      row.kind === 'note'
        ? 'note'
        : row.author === 'contact'
          ? 'visitor'
          : row.author === 'ai'
            ? 'ai'
            : 'agent',
    at: row.at.toISOString(),
    body: row.body,
  }))
}

/**
 * One conversation and its thread, as `viewer` sees it: the verdicts on the AI's answers
 * are theirs, not their colleagues'.
 */
export async function loadConversation(
  db: Db,
  id: string,
  viewer: AgentRow,
  visible: Visible = null,
): Promise<Conversation> {
  const [row] = await db
    .select({ conversation: conversations, contact: contacts, assignee: agents.name })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .leftJoin(agents, eq(agents.id, conversations.assigneeId))
    .where(eq(conversations.id, id))
  // Another inbox's conversation is, for this agent, one that does not exist.
  if (!row || !canSee(visible, row.conversation.inboxId)) {
    throw new Refusal('CONVERSATION_NOT_FOUND', 404)
  }
  const { conversation, contact } = row

  const author = alias(agents, 'author')
  const deleter = alias(agents, 'deleter')
  const thread = await db
    .select({
      message: messages,
      author: author.name,
      deleter: deleter.name,
      confidence: aiRuns.confidence,
      feedback: aiFeedback.action,
    })
    .from(messages)
    .leftJoin(author, eq(author.id, messages.agentId))
    .leftJoin(deleter, eq(deleter.id, messages.deletedBy))
    .leftJoin(aiRuns, eq(aiRuns.id, messages.aiRunId))
    .leftJoin(
      aiFeedback,
      and(eq(aiFeedback.aiRunId, messages.aiRunId), eq(aiFeedback.agentId, viewer.id)),
    )
    // What this agent deleted for themselves is not in their thread.
    .leftJoin(
      hiddenMessages,
      and(eq(hiddenMessages.messageId, messages.id), eq(hiddenMessages.agentId, viewer.id)),
    )
    .where(and(eq(messages.conversationId, id), isNull(hiddenMessages.messageId)))
    .orderBy(asc(messages.createdAt))

  const tags = await db
    .select()
    .from(conversationTags)
    .where(eq(conversationTags.conversationId, id))
    .orderBy(asc(conversationTags.createdAt))
  const files = await attachmentsOf(
    db,
    thread.map(({ message }) => message.id),
  )

  return {
    id: conversation.id,
    snoozedUntil: snoozedUntil(conversation),
    contact: toContact(contact),
    site: conversation.siteName,
    inboxId: conversation.inboxId,
    teamId: conversation.teamId,
    data: conversation.data,
    status: conversation.status,
    assignee: row.assignee,
    assigneeId: conversation.assigneeId,
    unread: conversation.agentUnread,
    intent: conversation.intent,
    tags: tags.map((t) => ({ label: t.label, color: t.color, byAi: t.origin === 'ai' })),
    sentiment: conversation.sentiment,
    priority: conversation.priority,
    suggestions: await currentSuggestions(db, id),
    summary: conversation.summary,
    history: await pastConversations(db, contact.id, id),
    messages: thread.flatMap(({ message, author, deleter, confidence, feedback }) => {
      const attached = (files.get(message.id) ?? []).map(forInbox)
      const shown = toMessage(message, author, confidence, feedback, attached, deleter)
      return shown ? [shown] : []
    }),
  }
}

/** A message deleted for everyone, as a program sees it: that it was, not what it said. */
function withoutWords(message: Message): Message {
  if (!('body' in message)) return message
  return 'attachments' in message
    ? { ...message, body: '', attachments: [] }
    : { ...message, body: '' }
}

/**
 * Messages by id, as a program sees them — no one's verdicts, no one's hiding; what was
 * deleted for everyone without its words. What a webhook's events carry.
 */
export async function loadMessagesById(
  db: Db,
  ids: readonly string[],
): Promise<Map<string, Message>> {
  if (ids.length === 0) return new Map()
  const author = alias(agents, 'author')
  const deleter = alias(agents, 'deleter')
  const rows = await db
    .select({
      message: messages,
      author: author.name,
      deleter: deleter.name,
      confidence: aiRuns.confidence,
    })
    .from(messages)
    .leftJoin(author, eq(author.id, messages.agentId))
    .leftJoin(deleter, eq(deleter.id, messages.deletedBy))
    .leftJoin(aiRuns, eq(aiRuns.id, messages.aiRunId))
    .where(inArray(messages.id, [...ids]))
  const files = await attachmentsOf(
    db,
    rows.map(({ message }) => message.id),
  )
  const found = new Map<string, Message>()
  for (const { message, author, deleter, confidence } of rows) {
    const attached = (files.get(message.id) ?? []).map(forInbox)
    const shown = toMessage(message, author, confidence, null, attached, deleter)
    if (!shown) continue
    found.set(message.id, shown.deleted && 'body' in shown ? withoutWords(shown) : shown)
  }
  return found
}

function toContact(row: typeof contacts.$inferSelect): Contact {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    identified: row.identified,
    location: row.location,
    country: row.country,
    timeZone: row.timeZone,
    place: pointOf(row),
    segment: row.segment,
    attributes: row.attributes,
    data: row.data,
  }
}

function toMessage(
  row: typeof messages.$inferSelect,
  author: string | null,
  confidence: number | null,
  feedback: Feedback | null,
  attachments: readonly Attachment[] = [],
  deleter: string | null = null,
): Message | null {
  const base = {
    id: row.id,
    at: row.createdAt.toISOString(),
    ...(row.deletedAt ? { deleted: { by: deleter, at: row.deletedAt.toISOString() } } : {}),
  }
  const meta: MessageMeta = row.meta
  const agent = author ?? '—'
  switch (row.kind) {
    case 'text':
      if (row.author === 'contact') {
        return { ...base, kind: 'visitor', body: row.body, attachments }
      }
      if (row.author === 'agent') {
        return {
          ...base,
          kind: 'agent',
          author: agent,
          authorId: row.agentId,
          body: row.body,
          attachments,
        }
      }
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
      return {
        ...base,
        kind: 'note',
        author: agent,
        authorId: row.agentId,
        body: row.body,
        attachments,
      }
    case 'event':
      return meta.event ? { ...base, kind: 'event', event: meta.event } : null
    case 'handoff':
      return meta.handoff ? { ...base, kind: 'handoff', ...meta.handoff } : null
    case 'file':
      // Files go with a text or a note — whose body may be empty; this kind is unused.
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
