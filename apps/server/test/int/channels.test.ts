import { createECDH } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AlertChannels, AuthState, Invited } from '@chat/contracts'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { and, eq, sql } from 'drizzle-orm'
import type { Hono } from 'hono'
import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { McpConnections } from '../../src/ai/mcp.js'
import { createApp } from '../../src/app.js'
import { openSession } from '../../src/auth/credentials.js'
import { TicketBook } from '../../src/auth/tickets.js'
import { twilioSignature } from '../../src/channels/twilio.js'
import type { Config } from '../../src/config.js'
import { type Db, connect, migrateDatabase } from '../../src/db/client.js'
import {
  agents,
  contacts,
  conversations,
  messages,
  notifications,
  outbound,
  pageViews,
  pushSubscriptions,
} from '../../src/db/schema.js'
import { MemoryStore } from '../../src/files/store.js'
import { notify } from '../../src/inbox/notifications.js'
import { type AgentRow, loadConversation } from '../../src/inbox/read.js'
import { markRead, sendMessage } from '../../src/inbox/write.js'
import { deliverDue } from '../../src/outbound/dispatch.js'
import type { Mail, Mailer } from '../../src/outbound/mailer.js'
import { InboxHub } from '../../src/realtime/hub.js'
import { DatabaseSource } from '../../src/settings/database.js'
import { loadDemoSettings } from '../../src/settings/demo.js'
import { Settings } from '../../src/settings/settings.js'
import { WidgetHub } from '../../src/widget/hub.js'

/**
 * What leaves the chat and what comes in by phone (D23), against a real PostgreSQL: SMS
 * and RCS from Twilio — signed, once each —, the answers back in their order, how they
 * went; a reply by e-mail to a visitor who left; an agent's alerts on their phone and in
 * their mailbox; the links of the accounts by e-mail.
 */

const SECRET = 'a-secret-for-the-tests-of-the-chat-server'
const TOKEN = 'twilio-auth-token-of-the-tests'
// A made-up account: built, so that no scanner takes it for a real one.
const ACCOUNT = `AC${'0123456789abcdef'.repeat(2)}`
const PUBLIC = 'https://chat.exemple.fr'

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: Db
let source: DatabaseSource
let settings: Settings
let app: Hono
let supervisor: AgentRow
let numberId: string
let siteId: string

const mails: Mail[] = []
const mailer: Mailer = {
  async send(mail) {
    mails.push(mail)
    return `<${mails.length}@tests>`
  },
}

/** What Twilio and the push services were called with, and what they answer. */
interface Call {
  readonly url: string
  readonly headers: Record<string, string>
  readonly body: string
}
let calls: Call[] = []
let sid = 0
const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input)
  const headers = Object.fromEntries(
    Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
      k.toLowerCase(),
      v,
    ]),
  )
  const body =
    init?.body instanceof Uint8Array ? `<${init.body.length} bytes>` : String(init?.body ?? '')
  calls.push({ url, headers, body })
  if (url.startsWith('https://api.twilio.com/')) {
    sid += 1
    return Response.json(
      { sid: `SM${String(sid).padStart(32, '0')}`, status: 'queued' },
      { status: 201 },
    )
  }
  if (url.includes('/gone')) return new Response(null, { status: 410 })
  return new Response(null, { status: 201 })
}

const config: Config = {
  filesDir: join(tmpdir(), 'chat-test-files'),
  port: 0,
  databaseUrl: '',
  webOrigin: 'http://localhost:3210',
  production: true,
  devAgent: null,
  publicUrl: PUBLIC,
  oidc: null,
  secret: SECRET,
  trustProxy: false,
  giphyKey: null,
  mail: { url: 'smtp://localhost:2525', from: 'Acme <support@acme.fr>' },
  pushSubject: 'mailto:support@acme.fr',
}

const postman = () =>
  deliverDue({
    db,
    settings,
    config,
    mailer,
    fetch: fakeFetch,
    env: { TWILIO_TEST_TOKEN: TOKEN },
  })

/** Everything waiting is due now. */
const hurry = () => db.execute(sql`update chat.outbound set next_attempt_at = now()`)

/** A message from a phone, as Twilio posts it — signed, unless told otherwise. */
async function sms(
  params: Record<string, string>,
  signed = true,
  path = `/channels/twilio/${numberId}`,
) {
  const all = { AccountSid: ACCOUNT, To: '+33700000000', NumMedia: '0', ...params }
  return app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': signed ? twilioSignature(TOKEN, `${PUBLIC}${path}`, all) : 'nope',
    },
    body: new URLSearchParams(all).toString(),
  })
}

async function smsConversation(phone: string) {
  const [contact] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.siteId, siteId), eq(contacts.phone, phone)))
  const [conversation] = contact
    ? await db.select().from(conversations).where(eq(conversations.contactId, contact.id))
    : []
  return { contact, conversation }
}

beforeAll(async () => {
  process.env.TWILIO_TEST_TOKEN = TOKEN
  container = await new PostgreSqlContainer('pgvector/pgvector:pg16').start()
  ;({ pool, db } = connect(container.getConnectionUri()))
  await migrateDatabase(db)
  await loadDemoSettings(db)
  source = new DatabaseSource(db, container.getConnectionUri())
  settings = new Settings(source)
  const [site] = await settings.sites()
  siteId = site?.id ?? ''
  numberId = await source.create('Numéros SMS', {
    Nom: 'Acme — SMS',
    Numéro: '+33 7 00 00 00 00',
    Fournisseur: 'Twilio',
    'Compte Twilio': ACCOUNT,
    "Jeton (variable d'environnement)": 'TWILIO_TEST_TOKEN',
    Site: siteId,
    Actif: true,
  })
  const [me] = await db.select().from(agents).where(eq(agents.role, 'supervisor'))
  if (!me) throw new Error('no supervisor in the demonstration')
  supervisor = me
  ;({ app } = createApp({
    db,
    hub: new InboxHub(),
    config: { ...config, databaseUrl: container.getConnectionUri() },
    settings,
    tickets: new TicketBook(),
    widgetHub: new WidgetHub(),
    mcp: new McpConnections(),
    ai: null,
    files: new MemoryStore(),
    mailer,
  }))
}, 180_000)

afterAll(async () => {
  await source?.close()
  await pool?.end()
  await container?.stop()
})

beforeEach(() => {
  calls = []
  mails.length = 0
})

describe('SMS and RCS, from Twilio', () => {
  it('make a message from a phone a visitor’s message, in the conversation of that phone', async () => {
    const response = await sms({
      From: '+33612345678',
      Body: 'Bonjour, mon sinistre ?',
      MessageSid: 'SMa1',
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<Response>')
    const { contact, conversation } = await smsConversation('+33612345678')
    expect(contact).toMatchObject({ name: '+33612345678', identified: false })
    expect(conversation).toMatchObject({
      channel: 'sms',
      smsNumberId: numberId,
      siteId,
      status: 'open',
    })
    // Twilio tries again when it did not hear the answer: the message is not written twice.
    await sms({ From: '+33612345678', Body: 'Bonjour, mon sinistre ?', MessageSid: 'SMa1' })
    await sms({ From: 'rcs:+33612345678', Body: 'Avec une photo bientôt', MessageSid: 'SMa2' })
    const said = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversation?.id ?? ''))
    expect(said.map((m) => m.body)).toEqual(['Bonjour, mon sinistre ?', 'Avec une photo bientôt'])
    const [now] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversation?.id ?? ''))
    expect(now?.channel).toBe('rcs')
  })

  it('refuse a call whose signature does not hold, and a number that is off', async () => {
    expect((await sms({ From: '+33699999999', Body: 'x', MessageSid: 'SMx' }, false)).status).toBe(
      403,
    )
    expect((await smsConversation('+33699999999')).contact).toBeUndefined()
    const unknown = '00000000-0000-4000-8000-000000000000'
    expect(
      (
        await sms(
          { From: '+33699999999', Body: 'x', MessageSid: 'SMy' },
          true,
          `/channels/twilio/${unknown}`,
        )
      ).status,
    ).toBe(404)
  })

  it('send the answers back in their order, and hear how they went', async () => {
    await sms({ From: '+33611111111', Body: 'Une question', MessageSid: 'SMb1' })
    const { conversation } = await smsConversation('+33611111111')
    const id = conversation?.id ?? ''
    await sendMessage(db, supervisor, id, {
      body: '**Bonjour** : voici [le lien](https://acme.fr).',
      kind: 'reply',
    })
    await sendMessage(db, supervisor, id, { body: 'Une note', kind: 'note' })
    await sendMessage(db, supervisor, id, { body: 'Et la suite.', kind: 'reply' })
    const queued = await db.select().from(outbound).where(eq(outbound.conversationId, id))
    expect(queued).toHaveLength(2)

    // One at a time in a conversation: the second waits for the first.
    await postman()
    await postman()
    const twilio = calls.filter((c) => c.url.startsWith('https://api.twilio.com/'))
    expect(twilio).toHaveLength(2)
    expect(twilio[0]?.url).toBe(
      `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}/Messages.json`,
    )
    const first = new URLSearchParams(twilio[0]?.body)
    expect(first.get('To')).toBe('+33611111111')
    expect(first.get('From')).toBe('+33700000000')
    expect(first.get('Body')).toBe('Bonjour : voici le lien (https://acme.fr).')
    expect(first.get('StatusCallback')).toBe(`${PUBLIC}/channels/twilio/${numberId}/status`)
    expect(new URLSearchParams(twilio[1]?.body).get('Body')).toBe('Et la suite.')

    const [sent] = await db
      .select()
      .from(outbound)
      .where(and(eq(outbound.conversationId, id), eq(outbound.status, 'sent')))
      .orderBy(outbound.createdAt)
      .limit(1)
    const status = async (params: Record<string, string>) => {
      const path = `/channels/twilio/${numberId}/status`
      const all = { AccountSid: ACCOUNT, ...params }
      return app.request(path, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-twilio-signature': twilioSignature(TOKEN, `${PUBLIC}${path}`, all),
        },
        body: new URLSearchParams(all).toString(),
      })
    }
    expect(
      (await status({ MessageSid: sent?.providerId ?? '', MessageStatus: 'read' })).status,
    ).toBe(204)
    // A lesser word, late, does not take it back.
    await status({ MessageSid: sent?.providerId ?? '', MessageStatus: 'delivered' })
    const thread = await loadConversation(db, id, supervisor)
    expect(thread.channel).toBe('sms')
    const answers = thread.messages.filter((m) => m.kind === 'agent')
    expect(answers.map((m) => (m.kind === 'agent' ? m.delivery : null))).toEqual([
      { by: 'sms', status: 'read', error: null },
      { by: 'sms', status: 'sent', error: null },
    ])
  })

  it('fail an answer Twilio refuses, with its code — and go on with the next', async () => {
    await sms({ From: '+33622222222', Body: 'Allô', MessageSid: 'SMc1' })
    const { conversation } = await smsConversation('+33622222222')
    const id = conversation?.id ?? ''
    await sendMessage(db, supervisor, id, { body: 'Refusée', kind: 'reply' })
    const refusing: typeof fetch = async () =>
      Response.json({ code: 21610, message: 'unsubscribed' }, { status: 400 })
    await deliverDue({
      db,
      settings,
      config,
      mailer,
      fetch: refusing,
      env: { TWILIO_TEST_TOKEN: TOKEN },
    })
    const [row] = await db.select().from(outbound).where(eq(outbound.conversationId, id))
    expect(row).toMatchObject({ status: 'failed', error: 'TWILIO_21610' })
  })
})

describe('a reply by e-mail, to a visitor who left', () => {
  async function webConversation(email: string | null) {
    const [contact] = await db
      .insert(contacts)
      .values({ siteId, name: 'Léa Martin', email })
      .returning()
    const [row] = await db
      .insert(conversations)
      .values({ contactId: contact?.id ?? '', siteId, siteName: 'Acme Assurances', status: 'open' })
      .returning()
    return row?.id ?? ''
  }

  it('waits, then sends what they did not see — the answers together', async () => {
    const id = await webConversation('lea@exemple.fr')
    await db.insert(pageViews).values({
      conversationId: id,
      url: 'https://www.acme.fr/sinistre',
      createdAt: new Date(Date.now() - 600_000),
      leftAt: new Date(Date.now() - 300_000),
    })
    await sendMessage(db, supervisor, id, { body: 'Votre dossier est complet.', kind: 'reply' })
    await sendMessage(db, supervisor, id, { body: 'Le virement part demain.', kind: 'reply' })
    // Two minutes first: they may still come back.
    await postman()
    expect(mails).toHaveLength(0)
    await db.execute(
      sql`update chat.outbound set next_attempt_at = now() where conversation_id = ${id} and created_at = (select min(created_at) from chat.outbound where conversation_id = ${id})`,
    )
    await postman()
    expect(mails).toHaveLength(1)
    expect(mails[0]).toMatchObject({
      to: 'lea@exemple.fr',
      subject: 'Acme Assurances vous a répondu',
    })
    expect(mails[0]?.text).toContain('Votre dossier est complet.')
    expect(mails[0]?.text).toContain('Le virement part demain.')
    expect(mails[0]?.text).toContain('https://www.acme.fr/sinistre')
    const rows = await db.select().from(outbound).where(eq(outbound.conversationId, id))
    expect(rows.map((r) => r.status)).toEqual(['sent', 'sent'])
    const thread = await loadConversation(db, id, supervisor)
    expect(
      thread.messages
        .filter((m) => m.kind === 'agent')
        .map((m) => m.kind === 'agent' && m.delivery?.by),
    ).toEqual(['email', 'email'])
  })

  it('sends nothing to a visitor still on the page, nor to one without an address', async () => {
    const watching = await webConversation('paul@exemple.fr')
    await db.insert(pageViews).values({ conversationId: watching, url: 'https://www.acme.fr/' })
    await sendMessage(db, supervisor, watching, { body: 'Je regarde.', kind: 'reply' })
    const silent = await webConversation(null)
    await sendMessage(db, supervisor, silent, { body: 'Personne à prévenir.', kind: 'reply' })
    expect(
      await db.select().from(outbound).where(eq(outbound.conversationId, silent)),
    ).toHaveLength(0)
    await hurry()
    await postman()
    expect(mails).toHaveLength(0)
    const [row] = await db.select().from(outbound).where(eq(outbound.conversationId, watching))
    expect(row).toMatchObject({ status: 'skipped', error: 'SEEN' })
  })

  it('sends nothing for a site that does not want it', async () => {
    await settings.updateSite(siteId, { 'Répondre par e-mail': false })
    const id = await webConversation('ines@exemple.fr')
    await sendMessage(db, supervisor, id, { body: 'Pas d’e-mail ici.', kind: 'reply' })
    await hurry()
    await postman()
    expect(mails).toHaveLength(0)
    const [row] = await db.select().from(outbound).where(eq(outbound.conversationId, id))
    expect(row).toMatchObject({ status: 'skipped', error: 'SITE_OFF' })
    await settings.updateSite(siteId, { 'Répondre par e-mail': true })
  })
})

describe('an agent’s alerts beyond the inbox', () => {
  it('reach their phone, unless they read the line meanwhile — and their mailbox, if asked', async () => {
    const [contact] = await db.insert(contacts).values({ siteId, name: 'Noé Petit' }).returning()
    const [row] = await db
      .insert(conversations)
      .values({ contactId: contact?.id ?? '', siteId, siteName: 'Acme Assurances', status: 'open' })
      .returning()
    const id = row?.id ?? ''
    await db
      .insert(messages)
      .values({ conversationId: id, author: 'contact', body: 'Vous êtes là ?' })
    // A real point, from a device's key pair.
    const device = createECDH('prime256v1')
    device.generateKeys()
    await db.insert(pushSubscriptions).values([
      {
        agentId: supervisor.id,
        endpoint: 'https://fcm.googleapis.com/fcm/send/phone',
        p256dh: device.getPublicKey().toString('base64url'),
        auth: Buffer.alloc(16, 7).toString('base64url'),
      },
      {
        agentId: supervisor.id,
        endpoint: 'https://fcm.googleapis.com/fcm/send/gone',
        p256dh: device.getPublicKey().toString('base64url'),
        auth: Buffer.alloc(16, 7).toString('base64url'),
      },
    ])
    await db.update(agents).set({ emailAlerts: true }).where(eq(agents.id, supervisor.id))
    await db.transaction((tx) => notify(tx, [supervisor.id], id, 'visitor_message'))
    // Another message: the same line, one push waiting.
    await db.transaction((tx) => notify(tx, [supervisor.id], id, 'visitor_message'))
    const waiting = await db.select().from(outbound).where(eq(outbound.conversationId, id))
    expect(waiting.map((w) => w.channel).sort()).toEqual(['email', 'push'])

    await postman()
    expect(calls).toHaveLength(0)
    await hurry()
    await postman()
    const pushed = calls.filter((c) => c.url.startsWith('https://fcm.googleapis.com/'))
    expect(pushed).toHaveLength(2)
    expect(pushed[0]?.headers['content-encoding']).toBe('aes128gcm')
    expect(pushed[0]?.headers.authorization).toMatch(/^vapid t=.+, k=.+$/)
    expect(pushed[0]?.headers.ttl).toBe('3600')
    // The device its push service says is gone is forgotten.
    const left = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.agentId, supervisor.id))
    expect(left.map((d) => d.endpoint)).toEqual(['https://fcm.googleapis.com/fcm/send/phone'])
    expect(mails).toHaveLength(1)
    expect(mails[0]?.subject).toBe('Noé Petit vous a écrit')
    expect(mails[0]?.text).toContain('« Vous êtes là ? »')
    expect(mails[0]?.text).toMatch(
      /http:\/\/localhost:3210\/conversations\/toutes\/noe-petit-[0-9a-f]{12}/,
    )

    // A line read before its time goes nowhere.
    await db.transaction((tx) => notify(tx, [supervisor.id], id, 'assigned', supervisor.id))
    await markRead(db, supervisor, id)
    calls = []
    await hurry()
    await postman()
    expect(calls).toHaveLength(0)
    const read = await db
      .select()
      .from(outbound)
      .innerJoin(notifications, eq(notifications.id, outbound.notificationId))
      .where(eq(notifications.kind, 'assigned'))
    expect(read.every((r) => r.outbound.status === 'skipped')).toBe(true)
    await db.update(agents).set({ emailAlerts: false }).where(eq(agents.id, supervisor.id))
  })
})

describe('the routes of an agent’s alerts, and the links by e-mail', () => {
  /** The inbox, as the demonstration's supervisor, with a session of theirs. */
  async function asSupervisor(path: string, init: { method?: string; body?: unknown } = {}) {
    const response = await app.request(path, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: {
        'content-type': 'application/json',
        'x-chat-request': '1',
        cookie: `chat_session=${await session()}`,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
    return response
  }
  let token: string | null = null
  async function session(): Promise<string> {
    if (token) return token
    token = await openSession(db, supervisor.id, null)
    return token
  }

  it('subscribe a device of a browser’s push service, and no other address', async () => {
    const device = createECDH('prime256v1')
    device.generateKeys()
    const body = {
      endpoint: 'https://web.push.apple.com/QGxyz',
      keys: {
        p256dh: device.getPublicKey().toString('base64url'),
        auth: Buffer.alloc(16, 1).toString('base64url'),
      },
    }
    expect((await asSupervisor('/api/inbox/alerts/devices', { method: 'PUT', body })).status).toBe(
      204,
    )
    const refused = await asSupervisor('/api/inbox/alerts/devices', {
      method: 'PUT',
      body: { ...body, endpoint: 'https://169.254.169.254/latest' },
    })
    expect(refused.status).toBe(400)
    const channels = (await (await asSupervisor('/api/inbox/alerts')).json()) as AlertChannels
    expect(channels).toMatchObject({ emailAvailable: true, email: false })
    expect(channels.devices).toBeGreaterThanOrEqual(1)
    expect(
      (await asSupervisor('/api/inbox/alerts', { method: 'PATCH', body: { email: true } })).status,
    ).toBe(204)
    expect(((await (await asSupervisor('/api/inbox/alerts')).json()) as AlertChannels).email).toBe(
      true,
    )
    await asSupervisor('/api/inbox/alerts', { method: 'PATCH', body: { email: false } })
    expect(
      (
        await asSupervisor('/api/inbox/alerts/devices', {
          method: 'DELETE',
          body: { endpoint: body.endpoint },
        })
      ).status,
    ).toBe(204)
  })

  it('send an invitation’s link by e-mail, and a new password’s to who forgot it', async () => {
    const invited = (await (
      await asSupervisor('/api/inbox/agents/invite', {
        body: { name: 'Inès Lambert', email: 'ines@exemple.fr', role: 'agent', teamIds: [] },
      })
    ).json()) as Invited
    expect(invited.emailed).toBe(true)
    expect(mails[0]).toMatchObject({ to: 'ines@exemple.fr', subject: 'Votre accès à Messagerie' })
    expect(mails[0]?.text).toContain(invited.link)

    const state = (await (await app.request('/api/auth/state')).json()) as AuthState
    expect(state.forgot).toBe(true)
    const forgot = (email: string) =>
      app.request('/api/auth/forgot', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-chat-request': '1' },
        body: JSON.stringify({ email }),
      })
    expect((await forgot('personne@exemple.fr')).status).toBe(202)
    expect((await forgot('ines@exemple.fr')).status).toBe(202)
    await new Promise((done) => setTimeout(done, 300))
    expect(mails.map((m) => m.to)).toEqual(['ines@exemple.fr', 'ines@exemple.fr'])
    expect(mails[1]?.text).toContain('Vous avez demandé à choisir un nouveau mot de passe')
  })
})
