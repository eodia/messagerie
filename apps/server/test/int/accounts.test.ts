import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AuthState, Invited, LinkInfo, PasswordReset } from '@chat/contracts'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { McpConnections } from '../../src/ai/mcp.js'
import { createApp } from '../../src/app.js'
import { TicketBook } from '../../src/auth/tickets.js'
import type { Config } from '../../src/config.js'
import { type Db, connect, migrateDatabase } from '../../src/db/client.js'
import { agents, sessions } from '../../src/db/schema.js'
import { InboxHub } from '../../src/realtime/hub.js'
import { DatabaseSource } from '../../src/settings/database.js'
import { loadDemoSettings } from '../../src/settings/demo.js'
import { Settings } from '../../src/settings/settings.js'
import { WidgetHub } from '../../src/widget/hub.js'

/**
 * The chat's own settings and accounts (D19), against a real PostgreSQL: the settings
 * read and written by field label, a change heard by every process; the first supervisor,
 * the password, the session cookie and its guard, the links a supervisor hands over.
 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: Db
let source: DatabaseSource
let settings: Settings
let app: Hono

const PASSWORD = 'un mot de passe assez long'

/** A browser of the inbox: it keeps the session cookie, and sends the guard header. */
function browser() {
  let cookie = ''
  return async (path: string, init: { method?: string; body?: unknown; guard?: boolean } = {}) => {
    const response = await app.request(path, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: {
        'content-type': 'application/json',
        ...(init.guard === false ? {} : { 'x-chat-request': '1' }),
        ...(cookie ? { cookie } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
    const set = response.headers.get('set-cookie')
    if (set) cookie = set.split(';')[0] ?? ''
    return response
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg16').start()
  ;({ pool, db } = connect(container.getConnectionUri()))
  await migrateDatabase(db)
  await loadDemoSettings(db)
  source = new DatabaseSource(db, container.getConnectionUri())
  settings = new Settings(source)
  const config: Config = {
    filesDir: join(tmpdir(), 'chat-test-files'),
    port: 0,
    databaseUrl: container.getConnectionUri(),
    webOrigin: 'http://localhost:3210',
    production: true,
    devAgent: null,
    publicUrl: 'http://localhost:8810',
    oidc: null,
    secret: 'a-secret-for-the-tests-of-the-chat-server',
    trustProxy: false,
    giphyKey: null,
  }
  ;({ app } = createApp({
    db,
    hub: new InboxHub(),
    config,
    settings,
    tickets: new TicketBook(),
    widgetHub: new WidgetHub(),
    mcp: new McpConnections(),
    ai: null,
  }))
}, 180_000)

afterAll(async () => {
  await source?.close()
  await pool?.end()
  await container?.stop()
})

describe('the settings in the chat’s own tables', () => {
  it('read the demonstration by label: relations as ids, counts counted', async () => {
    const [site] = await settings.sites()
    expect(site).toMatchObject({ name: 'Acme Assurances', aiEnabled: true, threshold: 0.7 })
    const teams = await source.rows('Équipes')
    const support = teams.find((t) => t.values.Nom === 'Support')
    expect(support?.values.Conseillers).toBe(1)
    const inbox = (await source.rows('Boîtes de réception')).find(
      (b) => b.values.Nom === 'Service client',
    )
    expect(inbox?.values.Équipes).toEqual([support?.id])
  })

  it('are written by label, a multiple relation replaced, and told to every process', async () => {
    let heard = 0
    const stop = source.follow(
      'Étiquettes',
      () => heard++,
      () => {},
    )
    await new Promise((ready) => setTimeout(ready, 300))
    const id = await source.create('Étiquettes', { Nom: 'Urgent', "Posée par l'IA": true })
    await source.update('Étiquettes', id, { Couleur: '#DC2626' })
    const tag = (await source.rows('Étiquettes')).find((t) => t.id === id)
    expect(tag?.values).toMatchObject({ Nom: 'Urgent', Couleur: '#DC2626', "Posée par l'IA": true })
    await source.remove('Étiquettes', id)
    await new Promise((ready) => setTimeout(ready, 300))
    expect(heard).toBeGreaterThanOrEqual(3)
    stop?.()
    await expect(source.update('Étiquettes', id, { Nom: 'X' })).rejects.toMatchObject({
      code: 'ROW_NOT_FOUND',
    })
    await expect(source.create('Étiquettes', { Inconnu: 1 })).rejects.toMatchObject({
      code: 'INVALID',
      field: 'Inconnu',
    })
  })

  it('keep an agent the threads name: removed, deactivated', async () => {
    const id = await source.create('Conseillers', {
      Nom: 'Paul Temporaire',
      'E-mail': 'Paul@Exemple.fr',
      Rôle: 'Conseiller',
    })
    const [row] = await db.select().from(agents).where(eq(agents.id, id))
    expect(row).toMatchObject({ login: 'paul@exemple.fr', role: 'agent', active: true })
    await source.remove('Conseillers', id)
    const [after] = await db.select().from(agents).where(eq(agents.id, id))
    expect(after?.active).toBe(false)
  })
})

describe('signing in', () => {
  it('starts with the first supervisor — the demonstration’s, claimed by their e-mail', async () => {
    const marc = browser()
    const state = (await (await marc('/api/auth/state')).json()) as AuthState
    expect(state).toEqual({ agent: null, setup: true, sso: null })
    expect((await marc('/api/inbox/settings')).status).toBe(401)

    const weak = await marc('/api/auth/setup', {
      body: { name: 'Marc', email: 'marc.jamain@exemple.fr', password: 'court' },
    })
    expect(await weak.json()).toMatchObject({ code: 'PASSWORD_WEAK' })
    const made = await marc('/api/auth/setup', {
      body: { name: 'Marc JAMAIN', email: 'marc.jamain@exemple.fr', password: PASSWORD },
    })
    expect(made.status).toBe(201)
    const demo = (await settings.agents()).find((a) => a.name === 'Marc JAMAIN')
    expect(await made.json()).toMatchObject({ id: demo?.id, role: 'supervisor' })
    expect((await marc('/api/inbox/settings')).status).toBe(200)

    // Once someone can sign in, the setup is closed.
    const again = await browser()('/api/auth/setup', {
      body: { name: 'Intrus', email: 'intrus@exemple.fr', password: PASSWORD },
    })
    expect(await again.json()).toMatchObject({ code: 'SETUP_DONE' })
  })

  it('refuses a wrong password as an unknown address, and a write without the guard', async () => {
    const someone = browser()
    for (const email of ['marc.jamain@exemple.fr', 'personne@exemple.fr']) {
      const refused = await someone('/api/auth/sign-in', {
        body: { email, password: 'mauvais mot' },
      })
      expect(refused.status).toBe(401)
      expect(await refused.json()).toMatchObject({ code: 'SIGN_IN_FAILED' })
    }
    const marc = browser()
    await marc('/api/auth/sign-in', {
      body: { email: 'MARC.JAMAIN@exemple.fr', password: PASSWORD },
    })
    const unguarded = await marc('/api/inbox/settings/etiquettes', {
      body: { values: { Nom: 'Sans en-tête' } },
      guard: false,
    })
    expect(unguarded.status).toBe(401)
    expect(
      (await marc('/api/inbox/settings/etiquettes', { body: { values: { Nom: 'Avec' } } })).status,
    ).toBe(201)

    await marc('/api/auth/sign-out', { body: {} })
    expect((await marc('/api/inbox/settings')).status).toBe(401)
  })

  it('invites an agent by a link they choose their password at — once', async () => {
    const marc = browser()
    await marc('/api/auth/sign-in', {
      body: { email: 'marc.jamain@exemple.fr', password: PASSWORD },
    })
    const invited = (await (
      await marc('/api/inbox/agents/invite', {
        body: { name: 'Julie Martin', email: 'julie@exemple.fr', role: 'agent', teamIds: [] },
      })
    ).json()) as Invited
    const token = invited.link.split('/invitation/')[1] ?? ''
    expect(invited.link).toMatch(/^http:\/\/localhost:3210\/invitation\/inv_/)

    const julie = browser()
    expect((await (await julie(`/api/auth/links/${token}`)).json()) as LinkInfo).toEqual({
      name: 'Julie Martin',
      email: 'julie@exemple.fr',
      purpose: 'invite',
    })
    const joined = await julie(`/api/auth/links/${token}`, { body: { password: PASSWORD } })
    expect(joined.status).toBe(200)
    const state = (await (await julie('/api/auth/state')).json()) as AuthState
    expect(state.agent).toMatchObject({ name: 'Julie Martin', role: 'agent' })
    // Once.
    expect((await browser()(`/api/auth/links/${token}`)).status).toBe(404)

    // A new password: a new link; every session of hers ends.
    const reset = (await (
      await marc(`/api/inbox/agents/${invited.row.id}/password`, { body: {} })
    ).json()) as PasswordReset
    const resetToken = reset.link.split('/invitation/')[1] ?? ''
    await browser()(`/api/auth/links/${resetToken}`, { body: { password: `${PASSWORD} bis` } })
    const ended = await db.select().from(sessions).where(eq(sessions.agentId, invited.row.id))
    expect(ended).toHaveLength(1)
    expect((await julie('/api/inbox/settings')).status).toBe(401)
  })

  it('leaves the administration to supervisors', async () => {
    const julie = browser()
    await julie('/api/auth/sign-in', {
      body: { email: 'julie@exemple.fr', password: `${PASSWORD} bis` },
    })
    expect((await julie('/api/inbox/settings/boites')).status).toBe(403)
    expect((await julie('/api/inbox/settings/articles')).status).toBe(200)
    const invite = await julie('/api/inbox/agents/invite', {
      body: { name: 'X', email: 'x@exemple.fr', role: 'agent', teamIds: [] },
    })
    expect(invite.status).toBe(403)
  })
})
