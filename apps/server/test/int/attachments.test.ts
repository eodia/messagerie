import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CompletionRequest, Llm } from '@chat/ai'
import type { Attachment, Conversation, VisitorConversation, WidgetSession } from '@chat/contracts'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { McpConnections } from '../../src/ai/mcp.js'
import { purgeExpired } from '../../src/ai/retention.js'
import { createApp } from '../../src/app.js'
import { TicketBook } from '../../src/auth/tickets.js'
import type { Config } from '../../src/config.js'
import { type Db, connect, migrateDatabase } from '../../src/db/client.js'
import { agents, aiRuns, conversations } from '../../src/db/schema.js'
import { MemoryStore } from '../../src/files/store.js'
import { InboxHub } from '../../src/realtime/hub.js'
import { MemorySource } from '../../src/settings/demo.js'
import { Settings } from '../../src/settings/settings.js'
import { WidgetHub } from '../../src/widget/hub.js'

/**
 * Files in conversations: sent from the widget and from the inbox, read through signed
 * links, refused when they are not what they claim, read by the AI on request, and
 * purged with their conversation — against a real PostgreSQL.
 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: Db
let app: Hono
const store = new MemoryStore()
const settings = new Settings(new MemorySource('dev-marc'))
const requests: CompletionRequest[] = []

/** A model that looks at anything, and says so in two lines. */
const llm: Llm = {
  model: 'scripted',
  embeddingModel: 'scripted-embed',
  visionModel: 'scripted-vision',
  external: false,
  complete: async (request) => {
    requests.push(request)
    return {
      text: '- **Une photo** de dégât des eaux\n- Rien d’illisible',
      toolCalls: [],
      model: request.model ?? 'scripted',
      usage: null,
      latencyMs: 3,
    }
  },
  embed: async () => [],
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)
const ORIGIN = 'http://localhost:8080'

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg16').start()
  ;({ pool, db } = connect(container.getConnectionUri()))
  await migrateDatabase(db)
  await db.insert(agents).values({ login: 'dev-marc', name: 'Marc JAMAIN', role: 'supervisor' })
  const config: Config = {
    filesDir: join(tmpdir(), 'chat-test-files'),
    port: 0,
    databaseUrl: container.getConnectionUri(),
    webOrigin: 'http://localhost:3210',
    production: false,
    devAgent: 'dev-marc',
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
    settings,
    tickets: new TicketBook(),
    widgetHub: new WidgetHub(),
    mcp: new McpConnections(),
    files: store,
    ai: {
      llm,
      redact: false,
      jobs: {
        visitorMessage: () => {},
        takenOver: () => {},
        resolved: () => {},
        suggest: () => {},
        knowledgeChanged: () => {},
        pageAnswered: () => {},
      },
    },
  }))
}, 180_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

function form(files: readonly { name: string; bytes: Uint8Array; type?: string }[], body = '') {
  const data = new FormData()
  for (const file of files) {
    data.append('file', new File([file.bytes], file.name, { type: file.type ?? '' }))
  }
  data.append('body', body)
  return data
}

async function visitor(): Promise<string> {
  const response = await app.request('/api/widget/session', {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ site: 'acme' }),
  })
  return ((await response.json()) as WidgetSession).visitor
}

const visitorSends = (token: string, data: FormData) =>
  app.request('/api/widget/attachments', {
    method: 'POST',
    headers: { origin: ORIGIN, authorization: `Bearer ${token}` },
    body: data,
  })

describe('a visitor’s files', () => {
  it('go with their words, and read through a link the server signed', async () => {
    const token = await visitor()
    const response = await visitorSends(
      token,
      form([{ name: 'dégât.png', bytes: PNG }], 'Voici la photo'),
    )
    expect(response.status).toBe(200)
    const conversation = (await response.json()) as VisitorConversation
    const sent = conversation.messages.at(-1)
    expect(sent).toMatchObject({ from: 'visitor', body: 'Voici la photo' })
    const file = sent && 'attachments' in sent ? sent.attachments?.[0] : undefined
    expect(file).toMatchObject({ name: 'dégât.png', mime: 'image/png', size: PNG.length })
    expect(file?.url).toMatch(/^\/files\/[0-9a-f-]{36}\?e=\d+&s=/)

    const read = await app.request(file?.url ?? '')
    expect(read.status).toBe(200)
    expect(read.headers.get('content-type')).toBe('image/png')
    expect(read.headers.get('x-content-type-options')).toBe('nosniff')
    expect(Buffer.from(await read.arrayBuffer()).equals(PNG)).toBe(true)

    // Another signature, or none: nothing.
    const forged = (file?.url ?? '').replace(/s=[^&]+$/, 's=forged')
    expect((await app.request(forged)).status).toBe(404)
    expect((await app.request((file?.url ?? '').split('?')[0] ?? '')).status).toBe(404)
  })

  it('are refused when they are not what they claim, or too many', async () => {
    const token = await visitor()
    const program = await visitorSends(
      token,
      form([
        { name: 'photo.png', bytes: Buffer.from('MZ\x90\x00 not an image'), type: 'image/png' },
      ]),
    )
    expect(program.status).toBe(415)
    expect(await program.json()).toMatchObject({
      code: 'ATTACHMENT_REFUSED',
      details: { reason: 'type' },
    })
    const six = Array.from({ length: 6 }, (_, i) => ({ name: `p${i}.png`, bytes: PNG }))
    expect((await visitorSends(token, form(six))).status).toBe(400)
    expect((await visitorSends(token, form([]))).status).toBe(400)
  })
})

describe('an agent’s files, and what the AI makes of them', () => {
  it('go in a note, and are read by the AI on request — text as text, images by the vision model', async () => {
    const token = await visitor()
    const first = (await (
      await visitorSends(token, form([{ name: 'photo.png', bytes: PNG }]))
    ).json()) as VisitorConversation

    const note = await app.request(`/api/inbox/conversations/${first.id}/attachments`, {
      method: 'POST',
      body: (() => {
        const data = form(
          [{ name: 'constat.txt', bytes: Buffer.from('Constat : fuite du ballon, 2 400 €') }],
          'Reçu par mail',
        )
        data.append('kind', 'note')
        return data
      })(),
    })
    expect(note.status).toBe(200)
    const conversation = (await note.json()) as Conversation
    const written = conversation.messages.at(-1)
    expect(written).toMatchObject({ kind: 'note', body: 'Reçu par mail' })
    const text = written && 'attachments' in written ? written.attachments[0] : undefined
    expect(text).toMatchObject({ name: 'constat.txt', mime: 'text/plain', analysis: null })

    const read = await app.request(`/api/inbox/attachments/${text?.id}/analysis`, {
      method: 'POST',
    })
    expect(read.status).toBe(200)
    const analyzed = (await read.json()) as Attachment
    // Plain text, whatever the model wrote.
    expect(analyzed.analysis?.summary).toBe('- Une photo de dégât des eaux\n- Rien d’illisible')
    expect(analyzed.analysis?.by).toBeTruthy()
    const asked = requests.at(-1)
    expect(asked?.model).toBeUndefined()
    expect(JSON.stringify(asked?.messages)).toContain('fuite du ballon')

    const photo = conversation.messages.find((m) => m.kind === 'visitor')
    const image = photo && 'attachments' in photo ? photo.attachments[0] : undefined
    await app.request(`/api/inbox/attachments/${image?.id}/analysis`, { method: 'POST' })
    const looked = requests.at(-1)
    expect(looked?.model).toBe('scripted-vision')
    const user = looked?.messages.find((m) => m.role === 'user')
    expect(user && 'images' in user ? user.images?.[0]?.mime : null).toBe('image/png')

    // Kept for the team, and traced (D9).
    const again = (await (
      await app.request(`/api/inbox/conversations/${first.id}`)
    ).json()) as Conversation
    const kept = again.messages.find((m) => m.kind === 'note')
    expect(kept && 'attachments' in kept ? kept.attachments[0]?.analysis?.summary : null).toContain(
      'dégât des eaux',
    )
    const runs = await db.select().from(aiRuns).where(eq(aiRuns.conversationId, first.id))
    expect(runs.filter((r) => r.kind === 'attachment')).toHaveLength(2)
  })

  it('says the AI cannot read a PDF without an OCR', async () => {
    const token = await visitor()
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n')
    const sent = (await (
      await visitorSends(token, form([{ name: 'facture.pdf', bytes: pdf }]))
    ).json()) as VisitorConversation
    const message = sent.messages.at(-1)
    const file = message && 'attachments' in message ? message.attachments?.[0] : undefined
    const read = await app.request(`/api/inbox/attachments/${file?.id}/analysis`, {
      method: 'POST',
    })
    expect(read.status).toBe(422)
    expect(await read.json()).toMatchObject({ code: 'ATTACHMENT_NOT_ANALYZABLE' })
  })
})

describe('the purge', () => {
  it('takes a conversation’s files with it', async () => {
    const token = await visitor()
    const sent = (await (
      await visitorSends(token, form([{ name: 'vieux.png', bytes: PNG }]))
    ).json()) as VisitorConversation
    const kept = () => [...store.files.keys()].filter((key) => key.startsWith(`${sent.id}/`))
    expect(kept()).toHaveLength(1)

    const longAgo = new Date(Date.now() - 3 * 365 * 86_400_000)
    await db
      .update(conversations)
      .set({ lastMessageAt: longAgo })
      .where(eq(conversations.id, sent.id))
    expect(await purgeExpired(db, settings, new Date(), store)).toBeGreaterThanOrEqual(1)
    expect(kept()).toHaveLength(0)
  })
})
