import { createHmac } from 'node:crypto'
import { type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { eq, sql } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { type Db, connect, migrateDatabase } from '../../src/db/client.js'
import { agents, contacts, conversations, messages, webhooks } from '../../src/db/schema.js'
import type { AgentRow } from '../../src/inbox/read.js'
import { resolve, sendMessage } from '../../src/inbox/write.js'
import { type WebhookEvent, deliverWebhooks } from '../../src/webhooks/dispatch.js'
import {
  createWebhook,
  deleteWebhook,
  pingWebhook,
  setWebhookActive,
  webhookLog,
} from '../../src/webhooks/manage.js'
import { allowedTarget, shapedTarget } from '../../src/webhooks/target.js'

/**
 * The webhooks (D17), against a real PostgreSQL and a receiver on this machine: what the
 * triggers capture, what goes out — signed, in order —, what is tried again, and when a
 * webhook stops by itself.
 */

const KEY = 'a-secret-for-the-tests-of-the-chat-server'

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: Db
let supervisor: AgentRow
let agent: AgentRow

/** What the receiver got, and what it answers next. */
interface Call {
  readonly headers: Record<string, string | string[] | undefined>
  readonly body: string
  readonly events: WebhookEvent[]
}
let calls: Call[] = []
let answers: number[] = []
let receiver: Server
let target = ''

async function conversation(inboxId = 'box-a'): Promise<string> {
  const [contact] = await db
    .insert(contacts)
    .values({ siteId: 'acme', name: 'Léa Martin' })
    .returning()
  const [row] = await db
    .insert(conversations)
    .values({
      contactId: contact?.id ?? '',
      siteId: 'acme',
      siteName: 'Acme',
      inboxId,
      status: 'open',
    })
    .returning()
  return row?.id ?? ''
}

async function webhook(events: string[] = ['message.created', 'conversation.resolved']) {
  return createWebhook(db, KEY, supervisor, {
    label: 'Synchronisation ERP',
    url: target,
    events: events as never,
    inboxIds: null,
  })
}

/** Everything due is due now: a retry's wait skipped. */
const hurry = () => db.execute(sql`update chat.webhook_delivery set next_attempt_at = now()`)

beforeAll(async () => {
  process.env.CHAT_WEBHOOK_DEV = '1'
  container = await new PostgreSqlContainer('pgvector/pgvector:pg16').start()
  ;({ pool, db } = connect(container.getConnectionUri()))
  await migrateDatabase(db)
  const [boss, colleague] = await db
    .insert(agents)
    .values([
      { login: 'test-supervisor', name: 'Marc', role: 'supervisor' },
      { login: 'test-agent', name: 'Julie', role: 'agent' },
    ])
    .returning()
  if (!boss || !colleague) throw new Error('agents not inserted')
  supervisor = boss
  agent = colleague
  receiver = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      calls.push({ headers: request.headers, body, events: JSON.parse(body).events })
      response.statusCode = answers.shift() ?? 200
      response.end()
    })
  })
  await new Promise<void>((done) => receiver.listen(0, '127.0.0.1', done))
  target = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`
}, 180_000)

beforeEach(async () => {
  calls = []
  answers = []
  await db.execute(sql`delete from chat.webhook_delivery`)
  await db.execute(sql`delete from chat.change_event`)
  await db.execute(sql`delete from chat.webhook`)
})

afterAll(async () => {
  receiver?.close()
  await pool?.end()
  await container?.stop()
  Reflect.deleteProperty(process.env, 'CHAT_WEBHOOK_DEV')
})

describe('a webhook', () => {
  it('is told what happened, in order, signed with its secret', async () => {
    const { webhook: made, secret } = await webhook()
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/)
    const [stored] = await db.select().from(webhooks).where(eq(webhooks.id, made.id))
    expect(stored?.signingSecret).toMatch(/^v1\./)
    expect(stored?.signingSecret).not.toContain(secret.slice(6))

    const id = await conversation()
    await db.insert(messages).values({ conversationId: id, author: 'contact', body: 'Bonjour' })
    await sendMessage(db, agent, id, { body: 'Je regarde **votre dossier**', kind: 'reply' })
    await resolve(db, agent, id)
    await deliverWebhooks(db, KEY)

    expect(calls).toHaveLength(1)
    const [call] = calls
    if (!call) throw new Error('no call')
    expect(call.events.map((e) => e.type)).toEqual([
      'message.created',
      'message.created',
      'conversation.resolved',
    ])
    expect(call.events[1]?.message).toMatchObject({ kind: 'agent', author: 'Julie' })
    expect(call.events[2]?.conversation).toMatchObject({ id, status: 'resolved' })

    const header = String(call.headers['x-messagerie-signature'])
    const [, at, mac] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header) ?? []
    expect(mac).toBe(createHmac('sha256', secret).update(`${at}.${call.body}`).digest('hex'))
    expect(call.headers['x-messagerie-webhook-id']).toBe(made.id)
    expect(call.headers['user-agent']).toBe('messagerie-webhook/1')

    const log = await webhookLog(db, supervisor, made.id)
    expect(log.every((d) => d.status === 'delivered' && d.responseCode === 200)).toBe(true)
  })

  it('hears only its events and its inboxes', async () => {
    await createWebhook(db, KEY, supervisor, {
      label: 'Sinistres',
      url: target,
      events: ['conversation.resolved'],
      inboxIds: ['box-b'],
    })
    const a = await conversation('box-a')
    const b = await conversation('box-b')
    await sendMessage(db, agent, b, { body: 'Bonjour', kind: 'reply' })
    await resolve(db, agent, a)
    await resolve(db, agent, b)
    await deliverWebhooks(db, KEY)
    expect(calls.flatMap((c) => c.events.map((e) => [e.type, e.conversation?.id]))).toEqual([
      ['conversation.resolved', b],
    ])
  })

  it('tries again what failed, and keeps the order of a conversation meanwhile', async () => {
    const { webhook: made } = await webhook()
    const id = await conversation()
    answers = [503]
    await sendMessage(db, agent, id, { body: 'Premier', kind: 'reply' })
    await deliverWebhooks(db, KEY)
    expect(calls).toHaveLength(1)
    const [waiting] = await webhookLog(db, supervisor, made.id)
    expect(waiting).toMatchObject({ status: 'pending', attempts: 1, responseCode: 503 })
    expect(Date.parse(waiting?.nextAttemptAt ?? '')).toBeGreaterThan(Date.now())

    // The second waits for the first, even though it is due.
    await sendMessage(db, agent, id, { body: 'Second', kind: 'reply' })
    await deliverWebhooks(db, KEY)
    expect(calls).toHaveLength(1)

    await hurry()
    await deliverWebhooks(db, KEY)
    expect(calls).toHaveLength(2)
    const bodies = calls[1]?.events.map((e) =>
      e.message && 'body' in e.message ? e.message.body : null,
    )
    expect(bodies).toEqual(['Premier', 'Second'])
  })

  it('fails at once on a refusal, and stops after fifty failures in a row', async () => {
    const { webhook: made } = await webhook(['message.created'])
    const id = await conversation()
    for (let i = 0; i < 50; i++) {
      await db.insert(messages).values({ conversationId: id, author: 'contact', body: `n° ${i}` })
    }
    answers = [400]
    await deliverWebhooks(db, KEY)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.events).toHaveLength(50)
    const log = await webhookLog(db, supervisor, made.id, 60)
    expect(log.every((d) => d.status === 'failed' && d.errorCode === 'HTTP_400')).toBe(true)
    const [stopped] = await db.select().from(webhooks).where(eq(webhooks.id, made.id))
    expect(stopped).toMatchObject({ isActive: false, disabledReason: 'failures' })
  })

  it('answers a test, and is silent once stopped or deleted', async () => {
    const { webhook: made } = await webhook()
    await pingWebhook(db, supervisor, made.id)
    await deliverWebhooks(db, KEY)
    expect(calls[0]?.events[0]).toMatchObject({
      type: 'webhook.ping',
      webhook: { id: made.id, label: 'Synchronisation ERP' },
    })

    await setWebhookActive(db, supervisor, made.id, false)
    const id = await conversation()
    await sendMessage(db, agent, id, { body: 'Personne n’écoute', kind: 'reply' })
    const captured = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from chat.change_event where conversation_id = ${id}`,
    )
    expect(captured.rows[0]?.n).toBe(0)

    await setWebhookActive(db, supervisor, made.id, true)
    await deleteWebhook(db, supervisor, made.id)
    await expect(pingWebhook(db, supervisor, made.id)).rejects.toMatchObject({
      code: 'WEBHOOK_NOT_FOUND',
    })
  })

  it('is made by a supervisor only', async () => {
    await expect(
      createWebhook(db, KEY, agent, {
        label: 'X',
        url: target,
        events: ['message.created'],
        inboxIds: null,
      }),
    ).rejects.toMatchObject({ code: 'NOT_ALLOWED' })
  })
})

describe('where a webhook may call', () => {
  it('outside development: HTTPS on 443, to public addresses only', async () => {
    Reflect.deleteProperty(process.env, 'CHAT_WEBHOOK_DEV')
    try {
      expect(shapedTarget('http://example.com/hook')).toBeNull()
      expect(shapedTarget('https://example.com:8443/hook')).toBeNull()
      expect(shapedTarget('https://user:pw@example.com/hook')).toBeNull()
      expect(shapedTarget('https://example.com/hook')).not.toBeNull()
      expect(await allowedTarget('https://127.0.0.1/hook')).toBe(false)
      expect(await allowedTarget('https://10.1.2.3/hook')).toBe(false)
      expect(await allowedTarget('https://[::ffff:192.168.1.1]/hook')).toBe(false)
      expect(await allowedTarget('https://[::ffff:7f00:1]/hook')).toBe(false)
      expect(await allowedTarget('https://[::1]/hook')).toBe(false)
      expect(await allowedTarget('https://169.254.169.254/latest')).toBe(false)
      expect(await allowedTarget('https://8.8.8.8/hook')).toBe(true)
      process.env.CHAT_WEBHOOK_ALLOW = '10.0.0.0/8'
      expect(await allowedTarget('https://10.1.2.3/hook')).toBe(true)
    } finally {
      process.env.CHAT_WEBHOOK_DEV = '1'
      Reflect.deleteProperty(process.env, 'CHAT_WEBHOOK_ALLOW')
    }
  })
})
