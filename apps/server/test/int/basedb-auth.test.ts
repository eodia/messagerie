import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Hono } from 'hono'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { McpConnections } from '../../src/ai/mcp.js'
import { createApp } from '../../src/app.js'
import { TicketBook } from '../../src/auth/tickets.js'
import { BasedbClient } from '../../src/basedb/client.js'
import type { Config } from '../../src/config.js'
import { type Db, connect, migrateDatabase } from '../../src/db/client.js'
import { InboxHub } from '../../src/realtime/hub.js'
import { Settings } from '../../src/settings/settings.js'
import { BasedbSource } from '../../src/settings/source.js'
import { WidgetHub } from '../../src/widget/hub.js'

/**
 * Agents authenticated by basedb (D4, B2), against a stand-in for basedb 0.5.0 that
 * answers in its shapes: introspection (RFC 7662, chapter 13 §11), the description of the
 * « Messagerie » base, and the rows of « Conseillers ».
 */

const TENANT = 't1'
const BASE = 'b_t1_messagerie'
const CHAT_TOKEN = 'bdb_chat'

let introspections = 0
let rowsRead = 0

const people: Record<string, object> = {
  bda_marc: { sub: 'u-marc', name: 'Marc J.', email: 'marc@exemple.fr' },
  bda_stranger: { sub: 'u-stranger', name: 'Inconnu' },
  bda_retired: { sub: 'u-retired', name: 'Ancien' },
}

const fakeBasedb = new Hono()
fakeBasedb.post('/auth/introspect', async (c) => {
  introspections++
  if (c.req.header('authorization') !== `Bearer ${CHAT_TOKEN}`) {
    return c.json({ code: 'TOKEN_INVALID' }, 401)
  }
  const { token } = await c.req.parseBody()
  if (token === 'bdb_program') {
    return c.json({ active: true, token_type: 'integration_token', sub: 'u-marc', tenant: TENANT })
  }
  const person = typeof token === 'string' ? people[token] : undefined
  if (!person) return c.json({ active: false })
  return c.json({ active: true, token_type: 'access_token', tenant: TENANT, ...person })
})
fakeBasedb.get(`/api/v1/${TENANT}/meta/bases/${BASE}`, (c) =>
  c.json({
    data: {
      name: BASE,
      tables: [
        {
          name: 'conseillers',
          label: 'Conseillers',
          fields: [
            { name: 'nom', label: 'Nom', kind: 'short_text' },
            { name: 'compte_basedb', label: 'Compte basedb', kind: 'user' },
            {
              name: 'role',
              label: 'Rôle',
              kind: 'select',
              options: [
                { value: 'conseiller', label: 'Conseiller' },
                { value: 'superviseur', label: 'Superviseur' },
              ],
            },
            { name: 'actif', label: 'Actif', kind: 'boolean' },
          ],
        },
      ],
    },
  }),
)
fakeBasedb.get(`/api/v1/${TENANT}/data/${BASE}/conseillers`, (c) => {
  rowsRead++
  return c.json({
    data: [
      { _id: 'r1', nom: 'Marc JAMAIN', compte_basedb: 'u-marc', role: 'superviseur', actif: true },
      { _id: 'r2', nom: 'Ancien', compte_basedb: 'u-retired', role: 'conseiller', actif: false },
    ],
    meta: { has_next_page: false },
  })
})

let basedb: ReturnType<typeof serve>
let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: Db
let app: Hono

beforeAll(async () => {
  basedb = serve({ fetch: fakeBasedb.fetch, port: 0 })
  await new Promise((ready) => basedb.once('listening', ready))
  const url = `http://127.0.0.1:${(basedb.address() as AddressInfo).port}`

  container = await new PostgreSqlContainer('pgvector/pgvector:pg16').start()
  ;({ pool, db } = connect(container.getConnectionUri()))
  await migrateDatabase(db)

  const config: Config = {
    filesDir: join(tmpdir(), 'chat-test-files'),
    port: 0,
    databaseUrl: container.getConnectionUri(),
    webOrigin: 'http://localhost:3210',
    production: true,
    devAgent: null,
    basedb: { url, tenant: TENANT, base: BASE, token: CHAT_TOKEN, supervisorsGroup: null },
    secret: 'a-secret-for-the-tests-of-the-chat-server',
    trustProxy: false,
    giphyKey: null,
  }
  const basedbClient = new BasedbClient(config.basedb as NonNullable<Config['basedb']>)
  const settings = new Settings(new BasedbSource(basedbClient))
  ;({ app } = createApp({
    db,
    hub: new InboxHub(),
    config,
    basedb: basedbClient,
    settings,
    tickets: new TicketBook(),
    widgetHub: new WidgetHub(),
    mcp: new McpConnections(),
    ai: null,
  }))
}, 180_000)

afterAll(async () => {
  basedb?.close()
  await pool?.end()
  await container?.stop()
})

const me = (token?: string) =>
  app.request('/api/inbox/me', {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  })

describe('an agent signed in to basedb', () => {
  it('is let in, with the name and role of their « Conseillers » row', async () => {
    const response = await me('bda_marc')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      name: 'Marc JAMAIN',
      email: 'marc@exemple.fr',
      role: 'supervisor',
    })
  })

  it('is not asked about again for thirty seconds', async () => {
    const before = introspections
    await me('bda_marc')
    await me('bda_marc')
    expect(introspections).toBe(before)
  })

  it('gets a ticket for the live stream', async () => {
    const response = await app.request('/api/inbox/ticket', {
      method: 'POST',
      headers: { authorization: 'Bearer bda_marc' },
    })
    expect(response.status).toBe(200)
    expect((await response.json()) as { ticket: string }).toMatchObject({
      ticket: expect.stringMatching(/^[\w-]{32}$/),
    })
  })
})

describe('everyone else', () => {
  it('is refused without a token — production has no development identity', async () => {
    expect(await (await me()).json()).toEqual({ code: 'SESSION_INVALID' })
  })

  it('is refused with a token basedb does not vouch for', async () => {
    const response = await me('bda_forged')
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ code: 'SESSION_INVALID' })
  })

  it('is refused with an integration token: a program is not an agent', async () => {
    expect((await me('bdb_program')).status).toBe(401)
  })

  it('is refused when absent from « Conseillers », or no longer active there', async () => {
    expect(await (await me('bda_stranger')).json()).toEqual({ code: 'NOT_AN_AGENT' })
    expect(await (await me('bda_retired')).json()).toEqual({ code: 'NOT_AN_AGENT' })
  })

  it('cannot open the live stream without a ticket', async () => {
    const response = await app.request('/api/inbox/events', {
      headers: { origin: 'https://ailleurs.example' },
    })
    expect(response.status).toBe(403)
  })
})

describe('the « Conseillers » rows', () => {
  it('are read once, then again after basedb signals a change', async () => {
    const settings = new Settings(
      new BasedbSource(
        new BasedbClient({
          url: `http://127.0.0.1:${(basedb.address() as AddressInfo).port}`,
          tenant: TENANT,
          base: BASE,
          token: CHAT_TOKEN,
          supervisorsGroup: null,
        }),
      ),
    )
    const before = rowsRead
    await settings.agent('u-marc')
    await settings.agent('u-marc')
    expect(rowsRead).toBe(before + 1)
    settings.invalidate('Conseillers')
    expect(await settings.agent('u-retired')).toMatchObject({ active: false, role: 'agent' })
    expect(rowsRead).toBe(before + 2)
  })
})
