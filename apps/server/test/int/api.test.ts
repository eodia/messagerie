import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Conversation, ConversationSummary } from '@chat/contracts'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { McpConnections } from '../../src/ai/mcp.js'
import { documentation } from '../../src/api/documentation.js'
import { TOOLS } from '../../src/api/mcp.js'
import { ENDPOINTS } from '../../src/api/reference.js'
import { createToken, revokeToken } from '../../src/api/tokens.js'
import { createApp } from '../../src/app.js'
import { TicketBook } from '../../src/auth/tickets.js'
import type { Config } from '../../src/config.js'
import { type Db, connect, migrateDatabase } from '../../src/db/client.js'
import { agents, contacts, conversations, messages } from '../../src/db/schema.js'
import type { AgentRow } from '../../src/inbox/read.js'
import { InboxHub } from '../../src/realtime/hub.js'
import { MemorySource } from '../../src/settings/demo.js'
import { Settings } from '../../src/settings/settings.js'
import { WidgetHub } from '../../src/widget/hub.js'

/**
 * The public API and the MCP server (D16), against a real PostgreSQL: a token's rights,
 * its inboxes, its life — and the MCP tools, through JSON-RPC as a client sends it.
 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: Db
let app: Hono
let supervisor: AgentRow
let inA: string
let inB: string

async function conversationIn(inboxId: string): Promise<string> {
  const [contact] = await db
    .insert(contacts)
    .values({ siteId: 'acme', name: 'Léa Martin' })
    .returning()
  const [conversation] = await db
    .insert(conversations)
    .values({
      contactId: contact?.id ?? '',
      siteId: 'acme',
      siteName: 'Acme',
      inboxId,
      status: 'ai',
    })
    .returning()
  const id = conversation?.id ?? ''
  await db
    .insert(messages)
    .values({ conversationId: id, author: 'contact', body: 'Où en est mon remboursement ?' })
  return id
}

/** A JSON-RPC answer, and a tool's result in it. */
type Rpc<T> = { readonly result: T }
type ToolResult = { readonly content: { readonly text: string }[]; readonly isError?: boolean }

const call = (path: string, token: string, init: RequestInit = {}) =>
  app.request(`/api/v1${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  })

async function token(options: {
  access: 'read' | 'write'
  surfaces?: ('rest' | 'mcp')[]
  inboxIds?: string[] | null
}): Promise<{ id: string; secret: string }> {
  const made = await createToken(db, supervisor, {
    label: `Essai ${options.access}`,
    access: options.access,
    surfaces: options.surfaces ?? ['rest', 'mcp'],
    inboxIds: options.inboxIds ?? null,
    expiresInDays: null,
  })
  return { id: made.token.id, secret: made.secret }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg16').start()
  ;({ pool, db } = connect(container.getConnectionUri()))
  await migrateDatabase(db)
  const [row] = await db
    .insert(agents)
    .values({ login: 'test-supervisor', name: 'Marc', role: 'supervisor' })
    .returning()
  if (!row) throw new Error('supervisor not inserted')
  supervisor = row
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
    mail: null,
    pushSubject: 'mailto:tests@localhost',
  }
  ;({ app } = createApp({
    db,
    hub: new InboxHub(),
    config,
    settings: new Settings(new MemorySource(null)),
    tickets: new TicketBook(),
    widgetHub: new WidgetHub(),
    mcp: new McpConnections(),
    ai: null,
  }))
  inA = await conversationIn('box-a')
  inB = await conversationIn('box-b')
}, 180_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

describe('the REST API', () => {
  it('lists and reads with a read token, and refuses it a write', async () => {
    const { secret } = await token({ access: 'read' })
    const me = await call('/me', secret)
    expect(me.status).toBe(200)
    expect(((await me.json()) as { data: unknown }).data).toMatchObject({
      access: 'read',
      label: 'Essai read',
    })

    const list = (await (await call('/conversations', secret)).json()) as {
      data: ConversationSummary[]
    }
    expect(list.data.map((s) => s.id)).toEqual(expect.arrayContaining([inA, inB]))

    const sent = await call(`/conversations/${inA}/messages`, secret, {
      method: 'POST',
      body: JSON.stringify({ body: 'Bonjour' }),
    })
    expect(sent.status).toBe(403)
    expect(await sent.json()).toMatchObject({ code: 'TOKEN_READ_ONLY' })
  })

  it('replies with a write token, signed by its name, and leaves the conversation in the queue', async () => {
    const { secret } = await token({ access: 'write' })
    const sent = await call(`/conversations/${inA}/messages`, secret, {
      method: 'POST',
      body: JSON.stringify({ body: 'Votre dossier est **complet**.' }),
    })
    expect(sent.status).toBe(201)
    const { data } = (await sent.json()) as { data: Conversation }
    expect(data.messages.at(-1)).toMatchObject({ kind: 'agent', author: 'Essai write' })
    expect(data.status).toBe('open')
    expect(data.assigneeId).toBeNull()
  })

  it('writes first to a customer with a write token — when the server can', async () => {
    const reader = await token({ access: 'read' })
    const body = JSON.stringify({ channel: 'sms', phone: '+33612345678', body: 'Bonjour' })
    const refused = await call('/conversations', reader.secret, { method: 'POST', body })
    expect(refused.status).toBe(403)
    const { secret } = await token({ access: 'write' })
    // No number ready, no SMTP server here: said, not attempted.
    const sms = await call('/conversations', secret, { method: 'POST', body })
    expect(((await sms.json()) as { code: string }).code).toBe('NUMBER_UNAVAILABLE')
    const mail = await call('/conversations', secret, {
      method: 'POST',
      body: JSON.stringify({ channel: 'email', email: 'lea@exemple.fr', body: 'Bonjour' }),
    })
    expect(((await mail.json()) as { code: string }).code).toBe('MAIL_UNAVAILABLE')
  })

  it('reaches its own inboxes only', async () => {
    const { secret } = await token({ access: 'read', inboxIds: ['box-a'] })
    const list = (await (await call('/conversations', secret)).json()) as {
      data: ConversationSummary[]
    }
    expect(list.data.map((s) => s.id)).toContain(inA)
    expect(list.data.map((s) => s.id)).not.toContain(inB)
    const other = await call(`/conversations/${inB}`, secret)
    expect(other.status).toBe(404)
  })

  it('refuses a token malformed, revoked, or for another surface', async () => {
    expect((await call('/me', 'msg_nothing')).status).toBe(401)
    const revoked = await token({ access: 'read' })
    await revokeToken(db, supervisor, revoked.id)
    const answer = await call('/me', revoked.secret)
    expect(answer.status).toBe(401)
    expect(await answer.json()).toMatchObject({ code: 'TOKEN_REVOKED' })
    const mcpOnly = await token({ access: 'read', surfaces: ['mcp'] })
    expect((await call('/me', mcpOnly.secret)).status).toBe(401)
  })

  it('keeps only the hash of the secret', async () => {
    const { id, secret } = await token({ access: 'read' })
    const rows = await db.execute<{ token_hash: string }>(
      `select token_hash from chat.api_token where id = '${id}'`,
    )
    const stored = rows.rows[0]?.token_hash ?? ''
    expect(stored).toMatch(/^[0-9a-f]{64}$/)
    expect(secret).not.toContain(stored)
  })
})

describe('the documentation', () => {
  it('documents every route and every tool, and serves the specification', async () => {
    const pages = documentation('https://messagerie.example')
    const all = pages.map((p) => p.markdown).join('\n')
    for (const endpoint of ENDPOINTS) expect(all).toContain(`/api/v1${endpoint.path}`)
    for (const tool of TOOLS) expect(all).toContain(`\`${tool.name}\``)

    const { secret } = await token({ access: 'read' })
    const spec = (await (await call('/openapi.json', secret)).json()) as {
      openapi: string
      paths: Record<string, unknown>
    }
    expect(spec.openapi).toBe('3.1.0')
    expect(Object.keys(spec.paths)).toHaveLength(new Set(ENDPOINTS.map((e) => e.path)).size)
  })

  it('names the field a request got wrong', async () => {
    const { secret } = await token({ access: 'read' })
    const answer = await call('/conversations?status=nowhere', secret)
    expect(answer.status).toBe(400)
    expect(await answer.json()).toMatchObject({
      code: 'INVALID_REQUEST',
      details: { issues: [{ field: 'status' }] },
    })
  })
})

describe('the MCP server', () => {
  const rpc = (secret: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request('/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: JSON.stringify(body),
    })

  it('initializes, lists its tools — the writes for a write token only — and calls them', async () => {
    const read = await token({ access: 'read' })
    const init = await rpc(read.secret, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      },
    })
    expect(init.status).toBe(200)
    expect(
      ((await init.json()) as Rpc<{ serverInfo: { name: string } }>).result.serverInfo.name,
    ).toBe('messagerie')

    const tools = async (secret: string) =>
      (
        (await (await rpc(secret, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()) as Rpc<{
          tools: { name: string }[]
        }>
      ).result.tools.map((t) => t.name)
    expect(await tools(read.secret)).not.toContain('send_reply')
    const write = await token({ access: 'write' })
    expect(await tools(write.secret)).toEqual(
      expect.arrayContaining(['send_reply', 'get_conversation']),
    )

    const got = await rpc(read.secret, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'get_conversation', arguments: { conversation_id: inB } },
    })
    const result = ((await got.json()) as Rpc<ToolResult>).result
    expect(result.isError).toBeFalsy()
    const conversation = JSON.parse(result.content[0]?.text ?? '{}')
    expect(conversation.messages[0]).toMatchObject({
      from: 'visitor',
      text: 'Où en est mon remboursement ?',
    })
  })

  it('answers a refusal as a tool error, and refuses a page or a REST-only token', async () => {
    const limited = await token({ access: 'read', inboxIds: ['box-a'] })
    const got = await rpc(limited.secret, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'get_conversation', arguments: { conversation_id: inB } },
    })
    const result = ((await got.json()) as Rpc<ToolResult>).result
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toMatchObject({
      code: 'CONVERSATION_NOT_FOUND',
    })

    const fromPage = await rpc(
      limited.secret,
      { jsonrpc: '2.0', id: 5, method: 'tools/list' },
      { origin: 'https://evil.example' },
    )
    expect(fromPage.status).toBe(403)
    const restOnly = await token({ access: 'read', surfaces: ['rest'] })
    expect(
      (await rpc(restOnly.secret, { jsonrpc: '2.0', id: 6, method: 'tools/list' })).status,
    ).toBe(401)
  })

  it('names the token’s writes in the thread, never as an agent of the lists', async () => {
    const rows = await db
      .select({ active: agents.active })
      .from(agents)
      .where(eq(agents.name, 'Essai write'))
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.active === false)).toBe(true)
  })
})
