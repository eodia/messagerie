import type { WidgetSession } from '@chat/contracts'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { and, eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { McpConnections } from '../../src/ai/mcp.js'
import { createApp } from '../../src/app.js'
import { TicketBook } from '../../src/auth/tickets.js'
import type { Config } from '../../src/config.js'
import { type Db, connect, migrateDatabase } from '../../src/db/client.js'
import { agents, contacts, conversations, notifications } from '../../src/db/schema.js'
import { Access } from '../../src/inbox/access.js'
import { createConversation, handOff } from '../../src/inbox/incoming.js'
import { patchContact, patchConversationData, readPatch } from '../../src/inbox/metadata.js'
import { type AgentRow, loadConversation, loadSummaries } from '../../src/inbox/read.js'
import { transfer } from '../../src/inbox/write.js'
import { InboxHub } from '../../src/realtime/hub.js'
import { Settings } from '../../src/settings/settings.js'
import type { LabeledRow, SettingsSource } from '../../src/settings/source.js'
import { WidgetHub } from '../../src/widget/hub.js'

/**
 * Inboxes and metadata, against a real PostgreSQL: where a conversation arrives, who sees
 * it, how it moves, and what a page or an agent attaches to it.
 *
 * Two inboxes — « Service client » (Support) and « Sinistres » (Auto, Habitation) — a
 * supervisor of Support, and an agent of Auto.
 */

const ROWS: Readonly<Record<string, LabeledRow[]>> = {
  Sites: [
    {
      id: 'acme',
      values: {
        Nom: 'Acme',
        'Domaines autorisés': 'localhost',
        'Agent IA actif': false,
        Actif: true,
        Langue: 'Français',
        'Boîte de réception': 'service',
        'Équipe par défaut': 'support',
      },
    },
  ],
  'Boîtes de réception': [
    {
      id: 'service',
      values: {
        Nom: 'Service client',
        Équipes: ['support'],
        'Équipe par défaut': 'support',
        Actif: true,
      },
    },
    {
      id: 'sinistres',
      values: {
        Nom: 'Sinistres',
        Équipes: ['auto', 'habitation'],
        'Équipe par défaut': 'auto',
        Actif: true,
      },
    },
  ],
  Équipes: [
    { id: 'support', values: { Nom: 'Support' } },
    { id: 'auto', values: { Nom: 'Équipe Auto' } },
    { id: 'habitation', values: { Nom: 'Équipe Habitation' } },
  ],
  Conseillers: [
    {
      id: 'c1',
      values: {
        Nom: 'Sarah Superviseure',
        'Compte basedb': 'sup',
        Rôle: 'Superviseur',
        Actif: true,
        Équipes: ['support'],
      },
    },
    {
      id: 'c2',
      values: {
        Nom: 'Alain Auto',
        'Compte basedb': 'auto-agent',
        Rôle: 'Conseiller',
        Actif: true,
        Équipes: ['auto'],
      },
    },
  ],
}

const source: SettingsSource = {
  kind: 'template',
  rows: async (table) => ROWS[table] ?? [],
  follow: () => null,
  update: async () => {},
  create: async () => 'new',
  remove: async () => {},
}
const settings = new Settings(source)
const access = new Access(settings)

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: Db
let supervisor: AgentRow
let autoAgent: AgentRow
let app: Hono

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg16').start()
  ;({ pool, db } = connect(container.getConnectionUri()))
  await migrateDatabase(db)
  const rows = await db
    .insert(agents)
    .values([
      { basedbUserId: 'sup', name: 'Sarah Superviseure', role: 'supervisor' },
      { basedbUserId: 'auto-agent', name: 'Alain Auto', role: 'agent' },
    ])
    .returning()
  supervisor = rows[0] as AgentRow
  autoAgent = rows[1] as AgentRow
  const config: Config = {
    port: 0,
    databaseUrl: container.getConnectionUri(),
    webOrigin: 'http://localhost:3210',
    production: false,
    devAgent: 'auto-agent',
    basedb: null,
    secret: 'a-secret-for-the-tests-of-the-chat-server',
    trustProxy: false,
  }
  ;({ app } = createApp({
    db,
    hub: new InboxHub(),
    config,
    basedb: null,
    settings,
    tickets: new TicketBook(),
    widgetHub: new WidgetHub(),
    mcp: new McpConnections(),
    ai: null,
  }))
}, 180_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

/** A conversation of Acme, routed as a visitor's would be. */
async function arrived(): Promise<string> {
  const [contact] = await db
    .insert(contacts)
    .values({ siteId: 'acme', name: 'Visiteur' })
    .returning()
  const site = await settings.site('acme')
  if (!contact || !site) throw new Error('fixture')
  return createConversation(db, contact.id, site, await settings.routeOf(site))
}

const row = async (id: string) =>
  (await db.select().from(conversations).where(eq(conversations.id, id)))[0]

describe('a new conversation', () => {
  it('arrives in its site’s inbox, given to that inbox’s default team', async () => {
    const id = await arrived()
    expect(await row(id)).toMatchObject({ inboxId: 'service', teamId: 'support', status: 'open' })
  })
})

describe('who sees what', () => {
  it('shows a supervisor every inbox, an agent those of their teams', async () => {
    expect(await access.visibleTo(supervisor)).toBeNull()
    expect([...((await access.visibleTo(autoAgent)) ?? [])]).toEqual(['sinistres'])
  })

  it('hides another inbox’s conversation from an agent', async () => {
    const id = await arrived()
    const visible = await access.visibleTo(autoAgent)
    expect(await loadSummaries(db, [id], visible)).toEqual([])
    await expect(loadConversation(db, id, autoAgent, visible)).rejects.toMatchObject({
      code: 'CONVERSATION_NOT_FOUND',
    })
    const response = await app.request(`/api/inbox/conversations/${id}`)
    expect(response.status).toBe(404)
    const listed = (await (await app.request('/api/inbox/conversations')).json()) as {
      id: string
    }[]
    expect(listed.some((c) => c.id === id)).toBe(false)
  })

  it('lists the inboxes an agent sees, with their teams', async () => {
    const directory = (await (await app.request('/api/inbox/inboxes')).json()) as {
      inboxes: { id: string; teams: { name: string }[] }[]
    }
    expect(directory.inboxes.map((i) => i.id)).toEqual(['sinistres'])
    expect(directory.inboxes[0]?.teams.map((t) => t.name)).toEqual([
      'Équipe Auto',
      'Équipe Habitation',
    ])
  })
})

describe('a transfer', () => {
  it('moves the conversation to the inbox’s default team, back to its queue', async () => {
    const id = await arrived()
    await db
      .update(conversations)
      .set({ assigneeId: supervisor.id })
      .where(eq(conversations.id, id))
    const moved = await transfer(db, settings, access, supervisor, id, {
      inboxId: 'sinistres',
      note: 'Un sinistre auto, à reprendre.',
    })
    expect(moved).toMatchObject({ inboxId: 'sinistres', teamId: 'auto', assigneeId: null })
    expect(moved.messages.slice(-2)).toMatchObject([
      {
        kind: 'event',
        event: {
          type: 'transferred',
          inbox: 'Sinistres',
          team: 'Équipe Auto',
          by: 'Sarah Superviseure',
        },
      },
      { kind: 'note', body: 'Un sinistre auto, à reprendre.' },
    ])
    // The agent of Auto is rung; the one who moved it is not.
    const rung = await db
      .select({ agentId: notifications.agentId })
      .from(notifications)
      .where(and(eq(notifications.conversationId, id), eq(notifications.kind, 'transferred')))
    expect(rung.map((r) => r.agentId)).toEqual([autoAgent.id])
    // And now sees it.
    const visible = await access.visibleTo(autoAgent)
    expect(await loadSummaries(db, [id], visible)).toHaveLength(1)
  })

  it('moves it to another team of the same inbox', async () => {
    const id = await arrived()
    await transfer(db, settings, access, supervisor, id, { inboxId: 'sinistres' })
    const moved = await transfer(db, settings, access, supervisor, id, { teamId: 'habitation' })
    expect(moved).toMatchObject({ inboxId: 'sinistres', teamId: 'habitation' })
    expect(moved.messages.at(-1)).toMatchObject({
      event: { type: 'transferred', team: 'Équipe Habitation' },
    })
    expect((moved.messages.at(-1) as { event: object }).event).not.toHaveProperty('inbox')
  })

  it('refuses an unknown inbox, and a team that does not serve the inbox', async () => {
    const id = await arrived()
    await expect(
      transfer(db, settings, access, supervisor, id, { inboxId: 'nope' }),
    ).rejects.toMatchObject({ code: 'INBOX_NOT_FOUND' })
    await expect(
      transfer(db, settings, access, supervisor, id, { teamId: 'auto' }),
    ).rejects.toMatchObject({ code: 'TEAM_NOT_FOUND' })
  })
})

describe('a handoff', () => {
  it('rings for the team it goes to, and the supervisors', async () => {
    const id = await arrived()
    await transfer(db, settings, access, supervisor, id, { inboxId: 'sinistres' })
    await db.delete(notifications).where(eq(notifications.conversationId, id))
    await handOff(
      db,
      id,
      {
        reason: 'Test',
        summary: 'Résumé',
        confidence: 0.4,
        assigneeId: null,
        team: 'Équipe Auto',
        teamId: 'auto',
        model: 'test',
      },
      access,
    )
    const rung = await db
      .select({ agentId: notifications.agentId })
      .from(notifications)
      .where(eq(notifications.conversationId, id))
    expect(rung.map((r) => r.agentId).sort()).toEqual([supervisor.id, autoAgent.id].sort())
  })
})

describe('metadata', () => {
  it('sets, replaces and removes keys of a conversation', async () => {
    const id = await arrived()
    await patchConversationData(db, id, readPatch({ Commande: 'A-1042', Panier: 89.9 }))
    const data = await patchConversationData(db, id, readPatch({ Panier: null, Payé: true }))
    expect(data).toEqual({ Commande: 'A-1042', Payé: true })
  })

  it('refuses a value that is not text, a number or yes/no', () => {
    expect(() => readPatch({ Objet: { a: 1 } })).toThrow()
    expect(() => readPatch({ ['x'.repeat(61)]: 'trop long' })).toThrow()
  })

  it('lets a page name an anonymous visitor, never a customer the site signed', async () => {
    const [anonymous] = await db
      .insert(contacts)
      .values({ siteId: 'acme', name: 'Visiteur 1' })
      .returning()
    const [signed] = await db
      .insert(contacts)
      .values({ siteId: 'acme', name: 'Sophie Leroy', identified: true, externalId: 'CLI-1' })
      .returning()
    const change = {
      profile: { name: 'Jean Dupont', email: 'jean@exemple.fr', phone: '06 12 34 56 78' },
      data: readPatch({ Source: 'newsletter' }),
    }
    await patchContact(db, anonymous?.id ?? '', change)
    await patchContact(db, signed?.id ?? '', change)
    const [a] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, anonymous?.id ?? ''))
    const [s] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, signed?.id ?? ''))
    expect(a).toMatchObject({
      name: 'Jean Dupont',
      email: 'jean@exemple.fr',
      phone: '06 12 34 56 78',
    })
    expect(s).toMatchObject({
      name: 'Sophie Leroy',
      phone: '06 12 34 56 78',
      data: { Source: 'newsletter' },
    })
  })

  it('comes from the widget: the profile, and the conversation’s, before and after it begins', async () => {
    const call = (path: string, method: string, body: unknown, token?: string) =>
      app.request(`/api/widget${path}`, {
        method,
        headers: {
          origin: 'http://localhost:8080',
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      })
    const session = (await (
      await call('/session', 'POST', { site: 'acme' })
    ).json()) as WidgetSession
    const token = session.visitor

    expect(
      (await call('/conversation', 'PATCH', { data: { Page: '/tarifs' } }, token)).status,
    ).toBe(404)
    expect(
      (await call('/contact', 'PATCH', { name: 'Léa Martin', data: { Plan: 'Pro' } }, token))
        .status,
    ).toBe(204)
    const sent = await call(
      '/messages',
      'POST',
      { body: 'Bonjour', data: { Page: '/tarifs' } },
      token,
    )
    expect(sent.status).toBe(200)
    expect((await call('/conversation', 'PATCH', { data: { Panier: 3 } }, token)).status).toBe(204)
    expect((await call('/contact', 'PATCH', { email: 'pas-une-adresse' }, token)).status).toBe(400)

    const [conversation] = await db
      .select()
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(eq(contacts.name, 'Léa Martin'))
    expect(conversation?.conversation).toMatchObject({
      inboxId: 'service',
      data: { Page: '/tarifs', Panier: 3 },
    })
    expect(conversation?.contact.data).toEqual({ Plan: 'Pro' })
  })
})
