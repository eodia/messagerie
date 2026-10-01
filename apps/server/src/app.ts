import type { Llm } from '@chat/ai'
import type {
  ApiError,
  AssignBody,
  Feedback,
  FeedbackBody,
  InboxEvent,
  SendMessageBody,
  Ticket,
} from '@chat/contracts'
import { createNodeWebSocket } from '@hono/node-ws'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { type Rewording, rephrase } from './ai/copilot.js'
import type { AiJobs } from './ai/jobs.js'
import type { McpConnections } from './ai/mcp.js'
import { type AgentEnv, agentAuth } from './auth/agent.js'
import type { TicketBook } from './auth/tickets.js'
import type { BasedbClient } from './basedb/client.js'
import type { Config } from './config.js'
import type { Db } from './db/client.js'
import { conversations } from './db/schema.js'
import { homePage } from './home-page.js'
import { Access, canSee, inboxDirectory } from './inbox/access.js'
import {
  cannedReplies,
  contactDetail,
  knowledge,
  listContacts,
  promote,
  stats,
} from './inbox/extras.js'
import { patchContact, patchConversationData, readPatch } from './inbox/metadata.js'
import { listNotifications, readNotifications } from './inbox/notifications.js'
import { loadConversation, loadSummaries, toAgent } from './inbox/read.js'
import {
  createRow,
  deleteRow,
  settingsOverview,
  settingsRows,
  updateRow,
} from './inbox/settings-screen.js'
import { runInConversation, testTool, toolsOverview } from './inbox/tools-screen.js'
import { saveWidget, widgetEditor } from './inbox/widget-editor.js'
import {
  assign,
  listAgents,
  markRead,
  resolve,
  sendMessage,
  setFeedback,
  takeOver,
  transfer,
} from './inbox/write.js'
import type { InboxHub } from './realtime/hub.js'
import { Refusal } from './refusal.js'
import type { Settings } from './settings/settings.js'
import { demoPage } from './widget/demo.js'
import type { WidgetHub } from './widget/hub.js'
import { previewPage } from './widget/preview-page.js'
import { widgetRoutes, widgetScript } from './widget/routes.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FEEDBACK: readonly Feedback[] = ['accepted', 'edited', 'rejected']

function uuidParam(value: string): string {
  if (!UUID.test(value)) throw new Refusal('CONVERSATION_NOT_FOUND', 404)
  return value
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => null)
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Refusal('INVALID_REQUEST', 400)
  }
  return body as Record<string, unknown>
}

function sendBody(raw: Record<string, unknown>): SendMessageBody {
  const { body, kind, resolve } = raw
  if (typeof body !== 'string' || (kind !== 'reply' && kind !== 'note')) {
    throw new Refusal('INVALID_REQUEST', 400, { expected: '{ body: string, kind: reply|note }' })
  }
  if (resolve !== undefined && typeof resolve !== 'boolean') {
    throw new Refusal('INVALID_REQUEST', 400, { field: 'resolve' })
  }
  return { body, kind, resolve: resolve === true }
}

function assignBody(raw: Record<string, unknown>): AssignBody {
  const { assigneeId } = raw
  if (assigneeId === null) return { assigneeId: null }
  if (typeof assigneeId === 'string' && UUID.test(assigneeId)) return { assigneeId }
  throw new Refusal('INVALID_REQUEST', 400, { field: 'assigneeId' })
}

function feedbackBody(raw: Record<string, unknown>): FeedbackBody {
  const { action } = raw
  if (action === null) return { action: null }
  if (typeof action === 'string' && (FEEDBACK as readonly string[]).includes(action)) {
    return { action: action as Feedback }
  }
  throw new Refusal('INVALID_REQUEST', 400, { field: 'action' })
}

/**
 * The chat server's HTTP and WebSocket surface. Only the inbox's routes exist so far; the
 * widget's arrive under `/api/widget`.
 */
export function createApp({
  db,
  hub,
  config,
  basedb,
  settings,
  tickets,
  widgetHub,
  ai,
  mcp,
}: {
  db: Db
  hub: InboxHub
  config: Config
  basedb: BasedbClient | null
  settings: Settings | null
  tickets: TicketBook
  widgetHub: WidgetHub
  /** The model and its queues; null without AI — conversations then go to the agents. */
  ai: { readonly llm: Llm; readonly redact: boolean; readonly jobs: AiJobs } | null
  mcp: McpConnections
}) {
  const app = new Hono()
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

  // CORS for the inbox's origin — not on a WebSocket upgrade, whose response headers are
  // not the middleware's to touch.
  const withCors = cors({
    origin: config.webOrigin,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowHeaders: ['content-type', 'authorization'],
    maxAge: 600,
  })
  app.use('/api/*', (c, next) =>
    c.req.header('upgrade')?.toLowerCase() === 'websocket' ? next() : withCors(c, next),
  )

  app.get('/health', (c) => c.json({ ok: true }))

  // Opened in a browser, the server's address says where the inbox is.
  app.get('/', (c) => c.html(homePage(config.webOrigin, config.production)))

  /**
   * The live signals. A WebSocket escapes CORS, so the origin is checked here: any page
   * the agent has open could otherwise open this socket and read along. It opens with a
   * ticket (`POST /api/inbox/ticket`), not a token: a browser cannot send a header here.
   * Registered before the inbox's routes, whose authentication it replaces.
   */
  app.get(
    '/api/inbox/events',
    async (c, next) => {
      const origin = c.req.header('origin')
      if (origin !== undefined && origin !== config.webOrigin) {
        return c.json({ code: 'INVALID_REQUEST', details: { origin } } satisfies ApiError, 403)
      }
      await next()
    },
    upgradeWebSocket((c) => {
      const agentId = tickets.redeem(c.req.query('ticket'))
      return {
        onOpen: (_event, socket) => {
          if (agentId === null) socket.close(4401, 'TICKET_INVALID')
          else hub.add(socket, agentId)
        },
        onClose: (_event, socket) => hub.remove(socket),
        onError: (_event, socket) => hub.remove(socket),
      }
    }),
  )

  const inbox = new Hono<AgentEnv>()
  inbox.use(agentAuth(db, config, basedb, settings))
  const access = new Access(settings)

  // An agent reaches the conversations of the inboxes they see; another inbox's
  // conversation is, for them, one that does not exist.
  inbox.use('/conversations/:id/*', async (c, next) => {
    const id = uuidParam(c.req.param('id'))
    const [row] = await db
      .select({ inboxId: conversations.inboxId })
      .from(conversations)
      .where(eq(conversations.id, id))
    if (!row || !canSee(await access.visibleTo(c.get('agent')), row.inboxId)) {
      throw new Refusal('CONVERSATION_NOT_FOUND', 404)
    }
    await next()
  })

  // The settings screens: the « Messagerie » base's tables, read by all, written by a
  // supervisor — with their own basedb token.
  const configured = () => {
    if (!settings) throw new Refusal('BASEDB_UNREACHABLE', 503)
    return settings
  }
  inbox.get('/settings', async (c) =>
    c.json(await settingsOverview(configured(), basedb, c.get('agent'))),
  )
  inbox.get('/settings/:table', async (c) =>
    c.json(await settingsRows(configured(), c.req.param('table'))),
  )
  inbox.post('/settings/:table', async (c) => {
    const { values } = await jsonBody(c.req.raw)
    const agent = c.get('agent')
    return c.json(
      await createRow(configured(), agent, c.get('basedbToken'), c.req.param('table'), values),
      201,
    )
  })
  inbox.patch('/settings/:table/:id', async (c) => {
    const { values } = await jsonBody(c.req.raw)
    const { table, id } = c.req.param()
    await updateRow(configured(), c.get('agent'), c.get('basedbToken'), table, id, values)
    return c.body(null, 204)
  })
  inbox.delete('/settings/:table/:id', async (c) => {
    const { table, id } = c.req.param()
    await deleteRow(configured(), c.get('agent'), c.get('basedbToken'), table, id)
    return c.body(null, 204)
  })

  inbox.get('/inboxes', async (c) => c.json(await inboxDirectory(settings, access, c.get('agent'))))

  inbox.get('/me', (c) => c.json(toAgent(c.get('agent'))))

  inbox.post('/ticket', (c) =>
    c.json({ ticket: tickets.issue(c.get('agent').id) } satisfies Ticket),
  )

  inbox.get('/agents', async (c) => c.json(await listAgents(db)))

  inbox.get('/notifications', async (c) => c.json(await listNotifications(db, c.get('agent'))))

  inbox.post('/notifications/read', async (c) => {
    const { conversationId } = await jsonBody(c.req.raw)
    if (
      conversationId !== undefined &&
      (typeof conversationId !== 'string' || !UUID.test(conversationId))
    ) {
      throw new Refusal('INVALID_REQUEST', 400, { field: 'conversationId' })
    }
    await readNotifications(db, c.get('agent'), conversationId)
    return c.body(null, 204)
  })

  inbox.get('/canned', async (c) => c.json(await cannedReplies(settings)))

  inbox.get('/contacts', async (c) => c.json(await listContacts(db, c.req.query('q') ?? '')))

  inbox.get('/contacts/:id', async (c) => {
    const id = c.req.param('id')
    if (!UUID.test(id)) throw new Refusal('CONTACT_NOT_FOUND', 404)
    return c.json(await contactDetail(db, id))
  })

  inbox.get('/stats', async (c) => c.json(await stats(db, c.get('agent'))))

  inbox.get('/knowledge', async (c) => c.json(await knowledge(db)))

  inbox.get('/tools', async (c) => c.json(await toolsOverview(settings, mcp)))

  inbox.get('/widget', async (c) =>
    c.json(
      settings
        ? await widgetEditor(settings, c.get('agent'), ai !== null)
        : { sites: [], persistent: false, canEdit: false },
    ),
  )

  /** A supervisor saves a site's widget — into its row of basedb, as themselves. */
  inbox.put('/widget/:site', async (c) => {
    if (!settings) throw new Refusal('SITE_NOT_FOUND', 404)
    const saved = await saveWidget(
      settings,
      c.get('agent'),
      c.get('basedbToken'),
      c.req.param('site'),
      await jsonBody(c.req.raw),
      ai !== null,
    )
    return c.json(saved)
  })

  /** An agent runs a copilot tool in a conversation; its trace joins the thread. */
  inbox.post('/conversations/:id/tools', async (c) => {
    const { tool, server, arguments: args } = await jsonBody(c.req.raw)
    if (typeof tool !== 'string' || (server !== undefined && typeof server !== 'string')) {
      throw new Refusal('INVALID_REQUEST', 400, { expected: '{ tool, server?, arguments }' })
    }
    const values =
      typeof args === 'object' && args !== null && !Array.isArray(args)
        ? (args as Record<string, unknown>)
        : {}
    const id = uuidParam(c.req.param('id'))
    return c.json(
      await runInConversation({ db, settings, basedb, mcp }, id, {
        tool,
        ...(server ? { server } : {}),
        arguments: values,
      }),
    )
  })

  /** A supervisor tries a tool, outside any conversation. */
  inbox.post('/tools/test', async (c) => {
    const { tool, server, arguments: args } = await jsonBody(c.req.raw)
    if (typeof tool !== 'string' || (server !== undefined && typeof server !== 'string')) {
      throw new Refusal('INVALID_REQUEST', 400, { expected: '{ tool, server?, arguments }' })
    }
    const values =
      typeof args === 'object' && args !== null && !Array.isArray(args)
        ? (args as Record<string, unknown>)
        : {}
    return c.json(
      await testTool({ db, settings, basedb, mcp }, c.get('agent'), {
        tool,
        ...(server ? { server } : {}),
        arguments: values,
      }),
    )
  })

  inbox.get('/conversations', async (c) =>
    c.json(await loadSummaries(db, undefined, await access.visibleTo(c.get('agent')))),
  )

  /** To another inbox, another team, or both. */
  inbox.post('/conversations/:id/transfer', async (c) => {
    if (!settings) throw new Refusal('INBOX_NOT_FOUND', 404)
    const { inboxId, teamId, note } = await jsonBody(c.req.raw)
    if (
      (inboxId !== undefined && typeof inboxId !== 'string') ||
      (teamId !== undefined && teamId !== null && typeof teamId !== 'string') ||
      (note !== undefined && (typeof note !== 'string' || note.length > 4000)) ||
      (inboxId === undefined && teamId === undefined)
    ) {
      throw new Refusal('INVALID_REQUEST', 400, { expected: '{ inboxId?, teamId?, note? }' })
    }
    const id = uuidParam(c.req.param('id'))
    return c.json(
      await transfer(db, settings, access, c.get('agent'), id, {
        ...(inboxId !== undefined ? { inboxId } : {}),
        ...(teamId !== undefined ? { teamId } : {}),
        ...(note !== undefined ? { note } : {}),
      }),
    )
  })

  /** The conversation's metadata: a key with a value is set, with `null` removed. */
  inbox.patch('/conversations/:id/data', async (c) => {
    const { data } = await jsonBody(c.req.raw)
    const id = uuidParam(c.req.param('id'))
    return c.json({ data: await patchConversationData(db, id, readPatch(data)) })
  })

  inbox.patch('/contacts/:id/data', async (c) => {
    const id = c.req.param('id')
    if (!UUID.test(id)) throw new Refusal('CONTACT_NOT_FOUND', 404)
    const { data } = await jsonBody(c.req.raw)
    await patchContact(db, id, { data: readPatch(data) })
    return c.body(null, 204)
  })

  /** Into basedb's « Conversations promues », « À relire ». */
  inbox.post('/conversations/:id/promote', async (c) => {
    const id = uuidParam(c.req.param('id'))
    await promote(
      { db, basedb, llm: ai?.llm ?? null, webOrigin: config.webOrigin },
      c.get('agent'),
      id,
    )
    return c.body(null, 204)
  })

  inbox.get('/conversations/:id', async (c) => {
    const id = uuidParam(c.req.param('id'))
    const agent = c.get('agent')
    return c.json(await loadConversation(db, id, agent, await access.visibleTo(agent)))
  })

  inbox.post('/conversations/:id/read', async (c) => {
    await markRead(db, c.get('agent'), uuidParam(c.req.param('id')))
    return c.body(null, 204)
  })

  inbox.post('/conversations/:id/messages', async (c) => {
    const request = sendBody(await jsonBody(c.req.raw))
    const id = uuidParam(c.req.param('id'))
    const sent = await sendMessage(db, c.get('agent'), id, request)
    if (request.resolve) ai?.jobs.resolved(id)
    return c.json(sent)
  })

  inbox.post('/conversations/:id/takeover', async (c) => {
    const id = uuidParam(c.req.param('id'))
    const taken = await takeOver(db, c.get('agent'), id)
    ai?.jobs.takenOver(id)
    return c.json(taken)
  })

  /** New suggestions from the copilot: they arrive by the live stream. */
  inbox.post('/conversations/:id/suggestions', (c) => {
    if (!ai) throw new Refusal('AI_UNAVAILABLE', 503)
    ai.jobs.suggest(uuidParam(c.req.param('id')))
    return c.body(null, 202)
  })

  inbox.post('/conversations/:id/rephrase', async (c) => {
    if (!ai) throw new Refusal('AI_UNAVAILABLE', 503)
    const { text, how } = await jsonBody(c.req.raw)
    const ways: readonly Rewording[] = ['clearer', 'shorter', 'warmer', 'correct']
    if (typeof text !== 'string' || !ways.includes(how as Rewording)) {
      throw new Refusal('INVALID_REQUEST', 400, {
        expected: '{ text, how: clearer|shorter|warmer|correct }',
      })
    }
    const id = uuidParam(c.req.param('id'))
    const reworded = await rephrase(
      { db, llm: ai.llm, redact: ai.redact },
      c.get('agent'),
      id,
      text,
      how as Rewording,
    )
    return c.json({ text: reworded })
  })

  inbox.post('/conversations/:id/assign', async (c) => {
    const { assigneeId } = assignBody(await jsonBody(c.req.raw))
    return c.json(await assign(db, c.get('agent'), uuidParam(c.req.param('id')), assigneeId))
  })

  inbox.post('/conversations/:id/resolve', async (c) => {
    const id = uuidParam(c.req.param('id'))
    const resolved = await resolve(db, c.get('agent'), id)
    ai?.jobs.resolved(id)
    return c.json(resolved)
  })

  inbox.put('/conversations/:id/messages/:messageId/feedback', async (c) => {
    const { action } = feedbackBody(await jsonBody(c.req.raw))
    const messageId = c.req.param('messageId')
    if (!UUID.test(messageId)) throw new Refusal('MESSAGE_NOT_FOUND', 404)
    const id = uuidParam(c.req.param('id'))
    return c.json(await setFeedback(db, c.get('agent'), id, messageId, action))
  })

  app.route('/api/inbox', inbox)

  // The widget: its API, when there are settings to know the sites by, and its script.
  if (settings !== null) {
    app.route(
      '/api/widget',
      widgetRoutes(
        {
          db,
          config,
          settings,
          aiAvailable: ai !== null,
          onVisitorMessage: (id) => ai?.jobs.visitorMessage(id),
        },
        widgetHub,
        tickets,
        upgradeWebSocket,
      ),
    )
  }
  const script = widgetScript(config.production)
  app.get('/widget.js', (c) => {
    const source = script()
    if (source === null)
      return c.text('// Widget non construit : pnpm --filter @chat/widget build', 404)
    c.header('content-type', 'text/javascript; charset=utf-8')
    c.header('cache-control', config.production ? 'public, max-age=300' : 'no-store')
    return c.body(source)
  })
  // The editor's preview: a page the inbox frames, where the widget waits for the editor.
  app.get('/widget/preview', (c) => {
    c.header('content-security-policy', `frame-ancestors ${config.webOrigin}`)
    c.header('cache-control', 'no-store')
    return c.html(previewPage(config.webOrigin))
  })
  if (!config.production && settings) {
    app.get('/demo', async (c) =>
      c.html(await demoPage(db, settings, c.req.query('client') === 'sophie')),
    )
  }

  app.onError((error, c) => {
    if (error instanceof Refusal) {
      const body: ApiError = error.details
        ? { code: error.code, details: error.details }
        : { code: error.code }
      return c.json(body, error.status)
    }
    console.error(error)
    return c.json({ code: 'INTERNAL_ERROR' }, 500)
  })

  return { app, injectWebSocket }
}

/** Keeps idle sockets from being closed by a proxy, and tells a client it is still heard. */
export function startPings(hub: InboxHub, everyMs = 25_000): () => void {
  const ping: InboxEvent = { type: 'ping' }
  const timer = setInterval(() => hub.broadcast(ping), everyMs)
  return () => clearInterval(timer)
}
