import { type Llm, Redactor, readJson } from '@chat/ai'
import type {
  CannedReply,
  ContactDetail,
  ContactListItem,
  InboxStats,
  KnowledgeItem,
} from '@chat/contracts'
import { and, asc, desc, eq, ilike, inArray, max, or, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { contacts, conversations, kbChunks, messages } from '../db/schema.js'
import { pointOf } from '../places/place.js'
import { Refusal } from '../refusal.js'
import { type Settings, TABLES } from '../settings/settings.js'
import { type Visible, inVisible } from './access.js'
import type { AgentRow } from './read.js'

/**
 * What the inbox shows beyond the conversations: canned replies, contacts, counters, what
 * the AI answers from — and the promotion of a conversation into it.
 */

export async function cannedReplies(settings: Settings | null): Promise<CannedReply[]> {
  if (!settings) return []
  return (await settings.cannedReplies()).map(({ id, title, shortcut, body }) => ({
    id,
    title,
    shortcut,
    body,
  }))
}

// ── Contacts ──────────────────────────────────────────────────────────────────────────

/**
 * The contact whose id ends with `tail` — twelve hex digits, what the inbox's address names
 * a contact by (`/contacts/lea-martin-9f0c3b2a71de`). `null` if none, or if two share it.
 */
export async function contactByTail(db: Db, tail: string): Promise<string | null> {
  const rows = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(sql`right(replace(${contacts.id}::text, '-', ''), 12) = ${tail.toLowerCase()}`)
    .limit(2)
  return rows.length === 1 ? (rows[0]?.id ?? null) : null
}

/**
 * The contacts — with `visible`, those who wrote in one of these inboxes only, counted by
 * the conversations found there: an agent, or a token limited to some inboxes, reaches no
 * one else (D12, D16). With `siteId`, the contacts of that site.
 */
export async function listContacts(
  db: Db,
  query: string,
  visible: Visible = null,
  siteId: string | null = null,
): Promise<ContactListItem[]> {
  const needle = query.trim()
  const rows = await db
    .select({
      contact: contacts,
      conversations: sql<number>`count(${conversations.id})::int`,
      lastMessageAt: max(conversations.lastMessageAt),
      site: max(conversations.siteName),
    })
    .from(contacts)
    .leftJoin(conversations, and(eq(conversations.contactId, contacts.id), inVisible(visible)))
    .where(
      and(
        siteId === null ? undefined : eq(contacts.siteId, siteId),
        needle
          ? or(
              ilike(contacts.name, `%${needle}%`),
              ilike(contacts.email, `%${needle}%`),
              ilike(contacts.externalId, `%${needle}%`),
              ilike(contacts.phone, `%${needle.replace(/[\s.()-]/g, '')}%`),
            )
          : undefined,
        visible === null ? undefined : wroteIn(visible),
      ),
    )
    .groupBy(contacts.id)
    .orderBy(desc(max(conversations.lastMessageAt)))
    .limit(200)
  return rows.map(({ contact, conversations: count, lastMessageAt, site }) => ({
    id: contact.id,
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    identified: contact.identified,
    site,
    location: contact.location,
    country: contact.country,
    timeZone: contact.timeZone,
    place: pointOf(contact),
    conversations: count,
    lastMessageAt: lastMessageAt ? new Date(lastMessageAt).toISOString() : null,
  }))
}

/** The contacts who have a conversation one sees. */
const wroteIn = (visible: ReadonlySet<string>) =>
  sql`exists (select 1 from ${conversations} where ${conversations.contactId} = ${contacts.id} and ${inVisible(visible)})`

export async function contactDetail(
  db: Db,
  id: string,
  visible: Visible = null,
): Promise<ContactDetail> {
  const [contact] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), visible === null ? undefined : wroteIn(visible)))
  if (!contact) throw new Refusal('CONTACT_NOT_FOUND', 404)
  const rows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.contactId, id), inVisible(visible)))
    .orderBy(desc(conversations.lastMessageAt))
  const firsts = await db
    .selectDistinctOn([messages.conversationId], {
      conversationId: messages.conversationId,
      body: messages.body,
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(eq(conversations.contactId, id), eq(messages.author, 'contact')))
    .orderBy(messages.conversationId, asc(messages.createdAt))
  const question = new Map(firsts.map((f) => [f.conversationId, f.body]))
  return {
    contact: {
      id: contact.id,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      identified: contact.identified,
      location: contact.location,
      country: contact.country,
      timeZone: contact.timeZone,
      place: pointOf(contact),
      segment: contact.segment,
      attributes: contact.attributes,
      data: contact.data,
    },
    site: rows[0]?.siteName ?? null,
    conversations: rows.map((c) => ({
      id: c.id,
      subject: c.intent ?? question.get(c.id) ?? '',
      status: c.status,
      at: c.lastMessageAt.toISOString(),
    })),
  }
}

// ── Counters ──────────────────────────────────────────────────────────────────────────

/** The counters of the conversations one sees — of one site, with `siteId`. */
export async function stats(
  db: Db,
  agent: AgentRow,
  visible: Visible = null,
  siteId: string | null = null,
  now = new Date(),
): Promise<InboxStats> {
  const scope =
    and(inVisible(visible), siteId === null ? undefined : eq(conversations.siteId, siteId)) ??
    sql`true`
  const since = new Date(now)
  since.setHours(0, 0, 0, 0)
  since.setDate(since.getDate() - 6)

  const perConversation = await db.execute<{
    id: string
    created: string
    ai: boolean
    agent: boolean
    handoff: boolean
    first_response: number | null
  }>(sql`
    select ${conversations.id} as id,
           ${conversations.createdAt} as created,
           bool_or(m.author = 'ai' and m.kind = 'text') as ai,
           bool_or(m.author = 'agent' and m.kind = 'text') as agent,
           bool_or(m.kind = 'handoff') as handoff,
           extract(epoch from (
             min(m.created_at) filter (where m.author in ('ai', 'agent') and m.kind = 'text')
             - min(m.created_at) filter (where m.author = 'contact')
           ))::float as first_response
      from ${conversations}
      join chat.message m on m.conversation_id = ${conversations.id}
     where ${conversations.createdAt} >= ${since} and ${scope}
     group by ${conversations.id}`)
  // The day in the server's time zone, not the database's.
  const localDay = (at: Date) =>
    `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
  const rows = perConversation.rows.map((r) => ({ ...r, day: localDay(new Date(r.created)) }))
  const aiAnswered = rows.filter((r) => r.ai)
  const aiResolved = aiAnswered.filter((r) => !r.handoff && !r.agent)
  const responses = rows
    .map((r) => r.first_response)
    .filter((s): s is number => s !== null && s >= 0)
    .sort((a, b) => a - b)
  const median =
    responses.length === 0
      ? null
      : responses.length % 2
        ? (responses[(responses.length - 1) / 2] ?? null)
        : ((responses[responses.length / 2 - 1] ?? 0) + (responses[responses.length / 2] ?? 0)) / 2

  const days = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(since)
    day.setDate(since.getDate() + i)
    return localDay(day)
  })
  const [open] = (
    await db.execute<{ ai: number; queue: number; mine: number }>(sql`
      select count(*) filter (where status = 'ai')::int as ai,
             count(*) filter (where status = 'open' and assignee_id is null)::int as queue,
             count(*) filter (where status in ('open', 'pending') and assignee_id = ${agent.id})::int as mine
        from ${conversations}
       where ${scope}`)
  ).rows

  return {
    conversations: rows.length,
    aiAnswered: aiAnswered.length,
    aiResolved: aiResolved.length,
    handedOff: rows.filter((r) => r.handoff).length,
    aiResolutionRate: aiAnswered.length > 0 ? aiResolved.length / aiAnswered.length : null,
    medianFirstResponseSeconds: median === null ? null : Math.round(median),
    open: open ?? { ai: 0, queue: 0, mine: 0 },
    perDay: days.map((day) => {
      const of = rows.filter((r) => r.day === day)
      return {
        day,
        total: of.length,
        ai: of.filter((r) => r.ai && !r.handoff && !r.agent).length,
        handedOff: of.filter((r) => r.handoff).length,
      }
    }),
  }
}

// ── Knowledge ─────────────────────────────────────────────────────────────────────────

export async function knowledge(db: Db): Promise<KnowledgeItem[]> {
  const rows = await db
    .select({
      source: kbChunks.source,
      sourceId: kbChunks.sourceId,
      title: sql<string>`min(split_part(${kbChunks.title}, ' — ', 1))`,
      passages: sql<number>`count(*)::int`,
      indexedAt: max(kbChunks.updatedAt),
    })
    .from(kbChunks)
    .groupBy(kbChunks.source, kbChunks.sourceId)
    .orderBy(kbChunks.source, sql`min(${kbChunks.title})`)
  return rows.map((r) => ({
    id: r.sourceId,
    source: r.source,
    title: r.title,
    passages: r.passages,
    indexedAt: r.indexedAt ? new Date(r.indexedAt).toISOString() : '',
  }))
}

// ── Promotion ─────────────────────────────────────────────────────────────────────────

/**
 * A conversation well resolved becomes a source for the AI — after an editor reads it in
 * the knowledge base (framing, « boucle d'amélioration »). It lands « À relire » in « Conversations
 * promues »: the question and the answer drafted without personal data, the link back to
 * the conversation, and who promoted it.
 */
export async function promote(
  deps: {
    readonly db: Db
    readonly settings: Settings
    readonly llm: Llm | null
    readonly webOrigin: string
  },
  agent: AgentRow,
  conversationId: string,
): Promise<void> {
  const { db } = deps
  const thread = await db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.kind, 'text')))
    .orderBy(asc(messages.createdAt))
  if (thread.length === 0) throw new Refusal('CONVERSATION_NOT_FOUND', 404)

  // Masked in any case: a promoted text is read by editors, then by the AI.
  const redactor = new Redactor(true)
  const transcript = thread
    .map((m) => `${m.author === 'contact' ? 'Client' : 'Nous'} : ${redactor.mask(m.body)}`)
    .join('\n')
  let question = redactor.mask(thread.find((m) => m.author === 'contact')?.body ?? '')
  let answer = redactor.mask(
    [...thread].reverse().find((m) => m.author === 'agent' || m.author === 'ai')?.body ?? '',
  )
  if (deps.llm) {
    const completion = await deps.llm.complete({
      json: true,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'Tire de cette conversation de service client une question type et sa réponse, pour une base de connaissance : générales, sans nom, sans numéro, sans aucune donnée personnelle, sans les placeholders entre crochets. Réponds UNIQUEMENT en JSON : {"question": "…", "answer": "…"}',
        },
        { role: 'user', content: transcript },
      ],
    })
    const json = readJson(completion.text)
    if (typeof json?.question === 'string' && json.question.trim()) question = json.question.trim()
    if (typeof json?.answer === 'string' && json.answer.trim()) answer = json.answer.trim()
  }

  await deps.settings.source.create(TABLES.promoted, {
    Question: question.slice(0, 500),
    Réponse: answer,
    Statut: 'À relire',
    Origine: 'Conseiller',
    Conversation: `${deps.webOrigin}/conversations?c=${conversationId}`,
    'Promue par': agent.id,
  })
  deps.settings.invalidate(TABLES.promoted)
}
