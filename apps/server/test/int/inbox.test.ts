import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { eq, sql } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type Db, connect, migrateDatabase } from '../../src/db/client.js'
import {
  agents,
  aiRuns,
  contacts,
  conversations,
  messages,
  notifications,
} from '../../src/db/schema.js'
import { handOff, receiveVisitorMessage } from '../../src/inbox/incoming.js'
import { listNotifications } from '../../src/inbox/notifications.js'
import { type AgentRow, loadConversation, loadSummaries } from '../../src/inbox/read.js'
import {
  assign,
  markRead,
  resolve,
  sendMessage,
  setFeedback,
  takeOver,
} from '../../src/inbox/write.js'
import {
  type Signal,
  listenForChanges,
  signalChange,
  signalTyping,
} from '../../src/realtime/signals.js'
import { Refusal } from '../../src/refusal.js'
import { visitorTyping } from '../../src/widget/visitor.js'

/**
 * The inbox against a real PostgreSQL 16 with pgvector — the image the product runs on.
 * Each test makes its own conversation; none depends on another's.
 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: Db
let agent: AgentRow

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg16').start()
  ;({ pool, db } = connect(container.getConnectionUri()))
  await migrateDatabase(db)
  const [row] = await db
    .insert(agents)
    .values({ basedbUserId: 'test-agent', name: 'Agent de test' })
    .returning()
  if (!row) throw new Error('agent not inserted')
  agent = row
}, 180_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

/** A conversation the AI is answering, with one question and one AI answer. */
async function aiConversation(): Promise<{ id: string; answerId: string; questionId: string }> {
  const [contact] = await db
    .insert(contacts)
    .values({ siteId: 'site', name: 'Visiteur' })
    .returning()
  const [conversation] = await db
    .insert(conversations)
    .values({ contactId: contact?.id ?? '', siteId: 'site', siteName: 'Site' })
    .returning()
  const id = conversation?.id ?? ''
  const [question] = await db
    .insert(messages)
    .values({ conversationId: id, author: 'contact', body: 'Une question ?' })
    .returning()
  const [run] = await db
    .insert(aiRuns)
    .values({ conversationId: id, kind: 'answer', model: 'test', confidence: 0.9 })
    .returning()
  const [answer] = await db
    .insert(messages)
    .values({ conversationId: id, author: 'ai', body: 'Une réponse.', aiRunId: run?.id })
    .returning()
  return { id, answerId: answer?.id ?? '', questionId: question?.id ?? '' }
}

describe('replying', () => {
  it('takes the conversation from the AI', async () => {
    const { id } = await aiConversation()
    const after = await sendMessage(db, agent, id, { body: '  Bonjour !  ', kind: 'reply' })
    expect(after.status).toBe('open')
    expect(after.assignee).toBe('Agent de test')
    expect(after.messages.at(-1)).toMatchObject({ kind: 'agent', body: 'Bonjour !' })
  })

  it('leaves the status alone for a note, and keeps it out of the preview', async () => {
    const { id } = await aiConversation()
    const after = await sendMessage(db, agent, id, { body: 'Pour l’équipe', kind: 'note' })
    expect(after.status).toBe('ai')
    expect(after.messages.at(-1)).toMatchObject({ kind: 'note', author: 'Agent de test' })
    const [summary] = await loadSummaries(db, [id])
    expect(summary?.preview).toBe('Une réponse.')
  })

  it('reopens a resolved conversation, and says so before the reply', async () => {
    const { id } = await aiConversation()
    await resolve(db, agent, id)
    const after = await sendMessage(db, agent, id, { body: 'Encore une chose', kind: 'reply' })
    expect(after.status).toBe('open')
    const kinds = after.messages.slice(-3).map((m) => (m.kind === 'event' ? m.event.type : m.kind))
    expect(kinds).toEqual(['resolved', 'reopened', 'agent'])
  })

  it('refuses an empty message', async () => {
    const { id } = await aiConversation()
    await expect(sendMessage(db, agent, id, { body: '   ', kind: 'reply' })).rejects.toMatchObject({
      code: 'EMPTY_MESSAGE',
    })
  })
})

describe('taking over', () => {
  it('happens once: a second take-over adds no event', async () => {
    const { id } = await aiConversation()
    await takeOver(db, agent, id)
    const after = await takeOver(db, agent, id)
    expect(after.messages.filter((m) => m.kind === 'event')).toHaveLength(1)
  })
})

describe('feedback', () => {
  it('is recorded, replaced, then withdrawn', async () => {
    const { id, answerId } = await aiConversation()
    const answer = (c: Awaited<ReturnType<typeof loadConversation>>) =>
      c.messages.find((m) => m.id === answerId)
    expect(answer(await setFeedback(db, agent, id, answerId, 'accepted'))).toMatchObject({
      feedback: 'accepted',
    })
    expect(answer(await setFeedback(db, agent, id, answerId, 'rejected'))).toMatchObject({
      feedback: 'rejected',
    })
    expect(answer(await setFeedback(db, agent, id, answerId, null))).toMatchObject({
      feedback: null,
    })
  })

  it('is refused on anything but an AI answer', async () => {
    const { id, questionId } = await aiConversation()
    const refused = await setFeedback(db, agent, id, questionId, 'accepted').catch((e) => e)
    expect(refused).toBeInstanceOf(Refusal)
    expect(refused.code).toBe('NOT_AN_AI_ANSWER')
  })
})

describe('change signals', () => {
  it('leave with the write that commits, and never with one that rolls back', async () => {
    const heard: string[] = []
    const stop = listenForChanges(container.getConnectionUri(), ({ conversationId }) => {
      if (conversationId) heard.push(conversationId)
    })
    // The listener connects on its own; a signal sent before it listens would be lost.
    await expect.poll(() => listenerReady(), { timeout: 10_000 }).toBe(true)

    const committed = await aiConversation()
    const rolledBack = await aiConversation()
    await sendMessage(db, agent, committed.id, { body: 'Validé', kind: 'reply' })
    await db
      .transaction(async (tx) => {
        await signalChange(tx, rolledBack.id)
        throw new Error('rollback')
      })
      .catch(() => {})

    await expect.poll(() => heard.includes(committed.id), { timeout: 5_000 }).toBe(true)
    // Time for a stray signal to arrive, had one been sent.
    await new Promise((done) => setTimeout(done, 300))
    expect(heard).not.toContain(rolledBack.id)
    await stop()
  })

  it('say who is typing, and nothing for a visitor with no conversation', async () => {
    const heard: Signal[] = []
    const stop = listenForChanges(container.getConnectionUri(), (signal) => {
      if (signal.typing) heard.push(signal)
    })
    await expect.poll(() => listenerReady(), { timeout: 10_000 }).toBe(true)

    const { id } = await aiConversation()
    const [row] = await db
      .select({ contactId: conversations.contactId })
      .from(conversations)
      .where(eq(conversations.id, id))
    const [stranger] = await db
      .insert(contacts)
      .values({ siteId: 'site', name: 'Sans conversation' })
      .returning()
    await visitorTyping(db, stranger?.id ?? '')
    await visitorTyping(db, row?.contactId ?? '')
    await signalTyping(db, id, 'agent', 'Agent')

    await expect.poll(() => heard.length, { timeout: 5_000 }).toBe(2)
    await new Promise((done) => setTimeout(done, 300))
    expect(heard).toEqual([
      { conversationId: id, typing: 'visitor' },
      { conversationId: id, typing: 'agent', by: 'Agent' },
    ])
    await stop()
  })
})

async function listenerReady(): Promise<boolean> {
  const result = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from pg_stat_activity where query = 'LISTEN chat_events'`,
  )
  return (result.rows[0]?.n ?? 0) > 0
}

describe('reading', () => {
  it('refuses a conversation that does not exist', async () => {
    await expect(
      loadConversation(db, '00000000-0000-4000-8000-000000000000', agent),
    ).rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND' })
  })

  it('lists the newest conversation first', async () => {
    const older = await aiConversation()
    const newer = await aiConversation()
    await db
      .update(conversations)
      .set({ lastMessageAt: new Date(Date.now() - 60_000) })
      .where(eq(conversations.id, older.id))
    const ids = (await loadSummaries(db)).map((s) => s.id)
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id))
  })
})

describe('alerts and notifications', () => {
  let colleague: AgentRow

  beforeAll(async () => {
    const [row] = await db
      .insert(agents)
      .values({ basedbUserId: 'test-colleague', name: 'Collègue' })
      .returning()
    if (!row) throw new Error('colleague not inserted')
    colleague = row
  })

  const bell = async (who: AgentRow, conversationId: string) =>
    (await listNotifications(db, who)).items.filter((n) => n.conversationId === conversationId)

  it('rings nobody while the AI answers', async () => {
    const { id } = await aiConversation()
    await receiveVisitorMessage(db, id, 'Encore une question')
    expect(await bell(agent, id)).toHaveLength(0)
    const [summary] = await loadSummaries(db, [id])
    expect(summary).toMatchObject({ status: 'ai', unread: true })
  })

  it('tells the agent who has the conversation, once however often the visitor writes', async () => {
    const { id } = await aiConversation()
    await takeOver(db, agent, id)
    await receiveVisitorMessage(db, id, 'Un')
    await receiveVisitorMessage(db, id, 'Deux')
    const lines = await bell(agent, id)
    expect(lines).toMatchObject([{ kind: 'visitor_message', read: false }])
    expect(await bell(colleague, id)).toHaveLength(0)
  })

  it('reads the bell when the conversation is opened', async () => {
    const { id } = await aiConversation()
    await takeOver(db, agent, id)
    await receiveVisitorMessage(db, id, 'Bonjour ?')
    await markRead(db, agent, id)
    expect(await bell(agent, id)).toMatchObject([{ read: true }])
    // A new message after that is a new line.
    await receiveVisitorMessage(db, id, 'Toujours là ?')
    expect((await bell(agent, id)).filter((n) => !n.read)).toHaveLength(1)
  })

  it('tells every active agent of a handoff to nobody in particular', async () => {
    const { id } = await aiConversation()
    await handOff(db, id, {
      reason: 'Hors sujet',
      summary: 'Résumé',
      confidence: 0.3,
      assigneeId: null,
      team: 'Support',
      model: 'test',
    })
    expect(await bell(agent, id)).toMatchObject([{ kind: 'handoff' }])
    expect(await bell(colleague, id)).toMatchObject([{ kind: 'handoff' }])
    const [summary] = await loadSummaries(db, [id])
    expect(summary).toMatchObject({ status: 'open', handedOff: true, assigneeId: null })
  })

  it('tells the one a conversation is given to, with who gave it — not the giver', async () => {
    const { id } = await aiConversation()
    const after = await assign(db, agent, id, colleague.id)
    expect(after).toMatchObject({ status: 'open', assignee: 'Collègue' })
    expect(await bell(colleague, id)).toMatchObject([{ kind: 'assigned', by: 'Agent de test' }])
    await assign(db, colleague, id, colleague.id)
    await assign(db, colleague, id, agent.id)
    expect(await bell(agent, id)).toMatchObject([{ kind: 'assigned', by: 'Collègue' }])
    const self = await aiConversation()
    await assign(db, agent, self.id, agent.id)
    expect(await bell(agent, self.id)).toHaveLength(0)
  })

  it('refuses to give a conversation to an agent who does not exist', async () => {
    const { id } = await aiConversation()
    await expect(
      assign(db, agent, id, '00000000-0000-4000-8000-000000000000'),
    ).rejects.toMatchObject({ code: 'AGENT_NOT_FOUND' })
    expect(
      await db.select().from(notifications).where(eq(notifications.conversationId, id)),
    ).toHaveLength(0)
  })
})
