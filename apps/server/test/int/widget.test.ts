import type { VisitorConversation, WidgetSession } from '@chat/contracts'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import { TicketBook } from '../../src/auth/tickets.js'
import type { Config } from '../../src/config.js'
import { type Db, connect, migrateDatabase } from '../../src/db/client.js'
import { agents, conversations, messages, siteSecrets } from '../../src/db/schema.js'
import { sendMessage } from '../../src/inbox/write.js'
import { InboxHub } from '../../src/realtime/hub.js'
import { Settings } from '../../src/settings/settings.js'
import { TemplateSource } from '../../src/settings/source.js'
import { WidgetHub } from '../../src/widget/hub.js'
import { signIdentity } from '../../src/widget/tokens.js'

/**
 * The widget's API, on the demonstration settings (Acme Assurances, `localhost` allowed),
 * against a real PostgreSQL.
 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: Db
let app: Hono
const told: string[] = []
const SECRET = 'site-secret-of-acme-for-the-tests-only'

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg16').start()
  ;({ pool, db } = connect(container.getConnectionUri()))
  await migrateDatabase(db)
  await db.insert(siteSecrets).values({ siteId: 'acme', identitySecret: SECRET })
  const config: Config = {
    port: 0,
    databaseUrl: container.getConnectionUri(),
    webOrigin: 'http://localhost:3210',
    production: true,
    devAgent: null,
    basedb: null,
    secret: 'a-secret-for-the-tests-of-the-chat-server',
    trustProxy: false,
  }
  ;({ app } = createApp({
    db,
    hub: new InboxHub(),
    config,
    basedb: null,
    settings: new Settings(new TemplateSource(null, true)),
    tickets: new TicketBook(),
    widgetHub: new WidgetHub(),
    onVisitorMessage: (id) => told.push(id),
  }))
}, 180_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

const ORIGIN = 'http://localhost:8080'

function call(
  path: string,
  init: { body?: unknown; token?: string; origin?: string; method?: string } = {},
) {
  return app.request(`/api/widget${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: {
      origin: init.origin ?? ORIGIN,
      'content-type': 'application/json',
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
}

const session = async (body: Record<string, unknown> = {}) =>
  (await (await call('/session', { body: { site: 'acme', ...body } })).json()) as WidgetSession

describe('a session', () => {
  it('opens for an anonymous visitor, with the site and its hours', async () => {
    const opened = await session()
    expect(opened).toMatchObject({
      contact: { name: null, identified: false },
      site: { name: 'Acme Assurances', color: '#2563EB', language: 'fr', ai: true },
      conversation: null,
    })
    expect(opened.visitor).toMatch(/^v1\./)
    expect(typeof opened.availability.open).toBe('boolean')
  })

  it('is refused to a page of another site, and to a site that does not exist', async () => {
    const foreign = await call('/session', {
      body: { site: 'acme' },
      origin: 'https://ailleurs.example',
    })
    expect(foreign.status).toBe(403)
    expect(await foreign.json()).toEqual({ code: 'ORIGIN_NOT_ALLOWED' })
    expect((await call('/session', { body: { site: 'nope' } })).status).toBe(404)
  })

  it('makes a signed-in customer out of a signed identity, with what they wrote before', async () => {
    const anonymous = await session()
    await call('/messages', {
      body: { body: 'Question avant connexion' },
      token: anonymous.visitor,
    })
    const identity = signIdentity(SECRET, {
      sub: 'CLI-1',
      name: 'Camille Test',
      email: 'camille@exemple.fr',
      attributes: { Contrat: 'A1' },
      exp: Math.floor(Date.now() / 1000) + 600,
    })
    const signed = await session({ visitor: anonymous.visitor, identity })
    expect(signed.contact).toEqual({ name: 'Camille Test', identified: true })
    expect(signed.conversation?.messages.map((m) => ('body' in m ? m.body : m.event))).toEqual([
      'Question avant connexion',
    ])
  })

  it('refuses an identity signed with another secret, or expired', async () => {
    const forged = signIdentity('not-the-site-secret', { sub: 'CLI-1', exp: 9_999_999_999 })
    expect((await call('/session', { body: { site: 'acme', identity: forged } })).status).toBe(401)
    const expired = signIdentity(SECRET, { sub: 'CLI-1', exp: 1 })
    expect((await call('/session', { body: { site: 'acme', identity: expired } })).status).toBe(401)
  })
})

describe('a visitor who writes', () => {
  it('starts a conversation the AI answers, and the AI is told', async () => {
    const { visitor } = await session()
    const response = await call('/messages', { body: { body: 'Bonjour !' }, token: visitor })
    const conversation = (await response.json()) as VisitorConversation
    expect(conversation).toMatchObject({
      answeredBy: 'ai',
      messages: [{ from: 'visitor', body: 'Bonjour !' }],
    })
    expect(told).toContain(conversation.id)
  })

  it('never sees a note, nor an agent’s full name', async () => {
    const { visitor } = await session()
    const { id } = (await (
      await call('/messages', { body: { body: 'Allô ?' }, token: visitor })
    ).json()) as VisitorConversation
    const [agent] = await db
      .insert(agents)
      .values({ basedbUserId: 'w-agent', name: 'Nadia Benali' })
      .returning()
    if (!agent) throw new Error('agent not inserted')
    await sendMessage(db, agent, id, { body: 'Note pour l’équipe', kind: 'note' })
    await sendMessage(db, agent, id, { body: 'Bonjour, je suis là.', kind: 'reply' })
    const seen = (await (
      await call('/conversation', { token: visitor })
    ).json()) as VisitorConversation
    expect(seen.messages.map((m) => m.from)).toEqual(['visitor', 'agent'])
    expect(seen.messages[1]).toMatchObject({ author: 'Nadia', body: 'Bonjour, je suis là.' })
    expect(seen.answeredBy).toBe('team')
  })

  it('starts a new conversation after one resolved more than a day ago', async () => {
    const { visitor } = await session()
    const first = (await (
      await call('/messages', { body: { body: 'Un' }, token: visitor })
    ).json()) as VisitorConversation
    await db
      .update(conversations)
      .set({ status: 'resolved', updatedAt: new Date(Date.now() - 2 * 86_400_000) })
      .where(eq(conversations.id, first.id))
    const second = (await (
      await call('/messages', { body: { body: 'Deux' }, token: visitor })
    ).json()) as VisitorConversation
    expect(second.id).not.toBe(first.id)
    expect(
      await db.select().from(messages).where(eq(messages.conversationId, first.id)),
    ).toHaveLength(1)
  })

  it('is refused with a token forged or of another site', async () => {
    const response = await call('/messages', { body: { body: 'x' }, token: 'v1.e30.forged' })
    expect(response.status).toBe(401)
  })

  it('is slowed down past twenty messages a minute', async () => {
    const { visitor } = await session()
    const statuses: number[] = []
    for (let i = 0; i < 21; i++) {
      statuses.push((await call('/messages', { body: { body: `n°${i}` }, token: visitor })).status)
    }
    expect(statuses.at(-1)).toBe(429)
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true)
  })
})
