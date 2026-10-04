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
import { MemoryStore } from '../../src/files/store.js'
import { contactByTail } from '../../src/inbox/extras.js'
import { handOff, receiveVisitorMessage } from '../../src/inbox/incoming.js'
import { listNotifications } from '../../src/inbox/notifications.js'
import {
  type AgentRow,
  loadConversation,
  loadSummaries,
  searchMessages,
} from '../../src/inbox/read.js'
import { wakeDue } from '../../src/inbox/snooze.js'
import {
  assign,
  deleteMessage,
  hideMessage,
  markRead,
  resolve,
  sendMessage,
  setFeedback,
  snooze,
  takeOver,
  wake,
} from '../../src/inbox/write.js'
import { leaveAllPages, leavePage, viewPage } from '../../src/page/views.js'
import {
  type Signal,
  listenForChanges,
  signalChange,
  signalTyping,
} from '../../src/realtime/signals.js'
import { Refusal } from '../../src/refusal.js'
import { visitorConversation, visitorTyping } from '../../src/widget/visitor.js'

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
    .values({ login: 'test-agent', name: 'Agent de test' })
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

describe('contact addresses', () => {
  it('find a contact by the end of its id, whatever the name before it', async () => {
    const [contact] = await db
      .insert(contacts)
      .values({ siteId: 'site', name: 'Léa Martin' })
      .returning()
    const id = contact?.id ?? ''
    const tail = id.replace(/-/g, '').slice(-12)
    expect(await contactByTail(db, tail)).toBe(id)
    expect(await contactByTail(db, tail.toUpperCase())).toBe(id)
    expect(await contactByTail(db, '000000000000')).toBeNull()
  })
})

describe('deleting a message', () => {
  async function anotherAgent(role: 'agent' | 'supervisor'): Promise<AgentRow> {
    const [row] = await db
      .insert(agents)
      .values({ login: `test-${role}-${Math.random()}`, name: `Autre ${role}`, role })
      .returning()
    if (!row) throw new Error('agent not inserted')
    return row
  }

  it('for oneself, takes it out of one’s own thread only', async () => {
    const { id, questionId } = await aiConversation()
    const colleague = await anotherAgent('agent')
    const mine = await hideMessage(db, agent, id, questionId)
    expect(mine.messages.some((m) => m.id === questionId)).toBe(false)
    const theirs = await loadConversation(db, id, colleague)
    expect(theirs.messages.some((m) => m.id === questionId)).toBe(true)
  })

  it('for everyone, empties it for the team and the visitor — by its author or a supervisor', async () => {
    const { id, questionId } = await aiConversation()
    const sent = await sendMessage(db, agent, id, { body: 'Une **réponse**', kind: 'reply' })
    const reply = sent.messages.filter((m) => m.kind === 'agent').pop()
    if (!reply) throw new Error('reply not sent')
    const store = new MemoryStore()

    // A colleague may not delete another's reply, nor what the visitor said.
    const colleague = await anotherAgent('agent')
    await expect(deleteMessage(db, colleague, id, reply.id, store)).rejects.toMatchObject({
      code: 'NOT_ALLOWED',
    })
    await expect(deleteMessage(db, agent, id, questionId, store)).rejects.toMatchObject({
      code: 'NOT_ALLOWED',
    })

    const after = await deleteMessage(db, agent, id, reply.id, store)
    const deleted = after.messages.find((m) => m.id === reply.id)
    expect(deleted).toMatchObject({ kind: 'agent', body: '', deleted: { by: agent.name } })

    // A supervisor may delete the visitor's words.
    const supervisor = await anotherAgent('supervisor')
    await deleteMessage(db, supervisor, id, questionId, store)

    const [conversation] = await db
      .select({ contactId: conversations.contactId })
      .from(conversations)
      .where(eq(conversations.id, id))
    const seen = await visitorConversation(db, conversation?.contactId ?? '')
    const shown = seen?.messages.filter((m) => m.id === reply.id || m.id === questionId)
    expect(shown).toHaveLength(2)
    for (const message of shown ?? []) {
      expect(message).toMatchObject({ deleted: true })
      expect('body' in message ? message.body : '').toBe('')
    }
  })

  it('leaves the conversation’s events alone', async () => {
    const { id } = await aiConversation()
    const taken = await takeOver(db, agent, id)
    const event = taken.messages.find((m) => m.kind === 'event')
    if (!event) throw new Error('no event')
    await expect(hideMessage(db, agent, id, event.id)).rejects.toMatchObject({
      code: 'MESSAGE_NOT_DELETABLE',
    })
  })
})

describe('on hold', () => {
  const inAnHour = () => new Date(Date.now() + 3600_000)

  it('leaves the queue until its time, then comes back unread, its assignee told', async () => {
    const { id } = await aiConversation()
    await takeOver(db, agent, id)
    const until = inAnHour()
    const held = await snooze(db, agent, id, until)
    expect(held).toMatchObject({
      status: 'pending',
      snoozedUntil: until.toISOString(),
      unread: false,
    })
    expect(held.messages.at(-1)).toMatchObject({
      kind: 'event',
      event: { type: 'snoozed', agent: 'Agent de test', until: until.toISOString() },
    })

    expect(await wakeDue(db)).toBe(0)
    expect(await wakeDue(db, new Date(until.getTime() + 1000))).toBe(1)
    const back = await loadConversation(db, id, agent)
    expect(back).toMatchObject({ status: 'open', snoozedUntil: null, unread: true })
    expect(back.messages.at(-1)).toMatchObject({ event: { type: 'woke', agent: null } })
    const told = (await listNotifications(db, agent)).items.filter((n) => n.conversationId === id)
    expect(told.map((n) => n.kind)).toContain('woke')
  })

  it('comes back sooner when the visitor writes, or when an agent wakes it', async () => {
    const { id } = await aiConversation()
    await takeOver(db, agent, id)
    await snooze(db, agent, id, inAnHour())
    await receiveVisitorMessage(db, id, 'Finalement, j’ai une autre question')
    expect(await loadConversation(db, id, agent)).toMatchObject({
      status: 'open',
      snoozedUntil: null,
    })

    await snooze(db, agent, id, inAnHour())
    await wake(db, agent, id)
    const woken = await loadConversation(db, id, agent)
    expect(woken).toMatchObject({ status: 'open', snoozedUntil: null })
    expect(woken.messages.at(-1)).toMatchObject({ event: { type: 'woke', agent: 'Agent de test' } })
  })

  it('is refused to the AI’s conversations, resolved ones, and to a time past', async () => {
    const { id } = await aiConversation()
    await expect(snooze(db, agent, id, inAnHour())).rejects.toMatchObject({ code: 'NOT_SNOOZABLE' })
    await takeOver(db, agent, id)
    await expect(snooze(db, agent, id, new Date(Date.now() - 1000))).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    })
    await resolve(db, agent, id)
    await expect(snooze(db, agent, id, inAnHour())).rejects.toMatchObject({ code: 'NOT_SNOOZABLE' })
  })
})

describe('the pages a visitor goes through', () => {
  it('follow the tab: a page said again is one, a new one leaves the last, closing leaves it', async () => {
    const { id } = await aiConversation()
    const devis = await viewPage(db, id, null, 'https://acme.fr/devis', 'Devis')
    expect(await viewPage(db, id, devis, 'https://acme.fr/devis', 'Devis')).toBe(devis)
    // Renamed, the same page: no new step.
    expect(await viewPage(db, id, devis, 'https://acme.fr/devis', 'Devis auto')).toBe(devis)
    const garanties = await viewPage(db, id, devis, 'https://acme.fr/garanties', 'Garanties')
    expect(garanties).not.toBe(devis)

    let pages = (await loadConversation(db, id, agent)).pages
    expect(pages.map((p) => [p.title, p.leftAt === null])).toEqual([
      ['Garanties', true],
      ['Devis auto', false],
    ])
    await leavePage(db, garanties)
    pages = (await loadConversation(db, id, agent)).pages
    expect(pages.every((p) => p.leftAt !== null)).toBe(true)
  })

  it('are all left when the server starts again', async () => {
    const { id } = await aiConversation()
    await viewPage(db, id, null, 'https://acme.fr/', 'Accueil')
    await leaveAllPages(db)
    expect((await loadConversation(db, id, agent)).pages[0]?.leftAt).not.toBeNull()
  })
})

describe('message search', () => {
  it('finds every word, in any order, accents and case aside', async () => {
    const { id } = await aiConversation()
    await db.insert(messages).values({
      conversationId: id,
      author: 'contact',
      body: 'Quel est le DÉLAI de remboursement après un dégât des eaux ?',
    })

    const found = async (query: string) =>
      (await searchMessages(db, query)).filter((hit) => hit.conversationId === id)

    expect(await found('remboursement delai')).toHaveLength(1)
    expect(await found('Dégat EAUX')).toHaveLength(1)
    expect(await found('remboursement sinistre')).toHaveLength(0)
    // LIKE's wildcards typed are looked for as such.
    expect(await found('d_lai')).toHaveLength(0)
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

  it('say a page changed lightly: the conversation and « page », nothing more', async () => {
    const heard: Signal[] = []
    const stop = listenForChanges(container.getConnectionUri(), (signal) => {
      heard.push(signal)
    })
    await expect.poll(() => listenerReady(), { timeout: 10_000 }).toBe(true)
    const { id } = await aiConversation()
    const view = await viewPage(db, id, null, 'https://acme.fr/devis', 'Devis')
    await leavePage(db, view)
    await expect
      .poll(() => heard.filter((s) => s.conversationId === id).length, { timeout: 5_000 })
      .toBe(2)
    expect(heard.filter((s) => s.conversationId === id)).toEqual([
      { conversationId: id, page: true },
      { conversationId: id, page: true },
    ])
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
      .values({ login: 'test-colleague', name: 'Collègue' })
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
