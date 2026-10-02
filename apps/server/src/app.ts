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
import type pg from 'pg'
import { analyzeAttachment } from './ai/attachments.js'
import { type Rewording, rephrase } from './ai/copilot.js'
import type { AiJobs } from './ai/jobs.js'
import type { McpConnections } from './ai/mcp.js'
import { speakMessage } from './ai/speech.js'
import { SOURCES } from './analytics/catalog.js'
import {
  type AnalyticsDeps,
  assistQuestion,
  createDashboard,
  deleteDashboard,
  filterValues,
  getDashboard,
  listDashboards,
  runCard,
  runDraft,
  saveDashboard,
} from './analytics/dashboards.js'
import { documentation, openApi } from './api/documentation.js'
import { mcpRoutes } from './api/mcp.js'
import { publicAddress, restRoutes } from './api/rest.js'
import { createToken, listTokens, readCreateBody, revokeToken } from './api/tokens.js'
import { type AgentEnv, REQUEST_HEADER, agentAuth } from './auth/agent.js'
import { authRoutes } from './auth/routes.js'
import type { TicketBook } from './auth/tickets.js'
import {
  type ManageDeps,
  automationChoices,
  automationRunList,
  buttonsFor,
  createAutomation,
  deleteAutomation,
  getAutomation,
  hookCalled,
  listAutomations,
  pressButton,
  renewAutomationKey,
  setAutomationActive,
  stopRun,
  tryAutomation,
  updateAutomation,
} from './automations/manage.js'
import type { Config } from './config.js'
import type { Db } from './db/client.js'
import { conversations } from './db/schema.js'
import { filesOf, keeping, readUploads, signLinksWith } from './files/attachments.js'
import { serveFile, uploadLimit } from './files/routes.js'
import { DiskStore, type FileStore } from './files/store.js'
import { gifFile, searchGifs } from './gifs.js'
import { homePage } from './home-page.js'
import { Access, canSee, inboxDirectory } from './inbox/access.js'
import { inviteAgent, resetAgentPassword } from './inbox/accounts.js'
import {
  cannedReplies,
  contactByTail,
  contactDetail,
  knowledge,
  listContacts,
  promote,
  stats,
} from './inbox/extras.js'
import { patchContact, patchConversationData, readPatch } from './inbox/metadata.js'
import { listNotifications, readNotifications } from './inbox/notifications.js'
import { loadConversation, loadSummaries, searchMessages, toAgent } from './inbox/read.js'
import {
  createRow,
  deleteRow,
  settingsOverview,
  settingsRows,
  updateRow,
} from './inbox/settings-screen.js'
import { addTag, removeTag, tagOptions } from './inbox/tags.js'
import { runInConversation, testTool, toolsOverview } from './inbox/tools-screen.js'
import { saveWidget, widgetEditor } from './inbox/widget-editor.js'
import {
  assign,
  deleteMessage,
  hideMessage,
  listAgents,
  markRead,
  resolve,
  sendMessage,
  setFeedback,
  snooze,
  takeOver,
  transfer,
  wake,
} from './inbox/write.js'
import { listPageActions, setPageAction } from './page/actions.js'
import type { InboxHub } from './realtime/hub.js'
import { signalTyping } from './realtime/signals.js'
import { Refusal } from './refusal.js'
import type { Settings } from './settings/settings.js'
import {
  createWebhook,
  deleteWebhook,
  listWebhooks,
  pingWebhook,
  readWebhookBody,
  setWebhookActive,
  webhookLog,
} from './webhooks/manage.js'
import { demoPage } from './widget/demo.js'
import { RateLimiter, type WidgetHub } from './widget/hub.js'
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
  settings,
  tickets,
  widgetHub,
  ai,
  mcp,
  files,
  automations,
  pool,
}: {
  db: Db
  hub: InboxHub
  config: Config
  settings: Settings
  tickets: TicketBook
  widgetHub: WidgetHub
  /** The model and its queues; null without AI — conversations then go to the agents. */
  ai: { readonly llm: Llm; readonly redact: boolean; readonly jobs: AiJobs } | null
  mcp: McpConnections
  /** Where the files sent in conversations are kept: `config.filesDir` unless given. */
  files?: FileStore
  /** The automations' engine, when it runs in this process: hurried by a button. */
  automations?: { poke(): void } | null
  /** The database's pool: the dashboards' questions run on a client of their own (D22). */
  pool?: pg.Pool
}) {
  const app = new Hono()
  const store = files ?? new DiskStore(config.filesDir)
  signLinksWith(config.secret)
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

  // CORS for the inbox's origin — not on a WebSocket upgrade, whose response headers are
  // not the middleware's to touch.
  // With credentials: the session is a cookie (D19).
  const withCors = cors({
    origin: config.webOrigin,
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowHeaders: ['content-type', REQUEST_HEADER],
    maxAge: 600,
  })
  app.use('/api/inbox/*', (c, next) =>
    c.req.header('upgrade')?.toLowerCase() === 'websocket' ? next() : withCors(c, next),
  )

  // Signing in: the session, the first supervisor, links, an identity provider.
  app.route('/api/auth', authRoutes({ db, config, settings }))

  app.get('/health', (c) => c.json({ ok: true }))

  // The files sent in conversations, to whoever holds a link the server signed.
  app.get('/files/:id', serveFile(db, store))

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
  inbox.use(agentAuth(db, config))
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

  // The settings screens (D19): the knowledge base read by all, the administration's
  // tables read and written by supervisors.
  inbox.get('/settings', async (c) => c.json(await settingsOverview(db, c.get('agent'))))
  inbox.get('/settings/:table', async (c) =>
    c.json(await settingsRows(settings, c.get('agent'), c.req.param('table'))),
  )
  inbox.post('/settings/:table', async (c) => {
    const { values } = await jsonBody(c.req.raw)
    return c.json(await createRow(settings, c.get('agent'), c.req.param('table'), values), 201)
  })
  inbox.patch('/settings/:table/:id', async (c) => {
    const { values } = await jsonBody(c.req.raw)
    const { table, id } = c.req.param()
    await updateRow(settings, c.get('agent'), table, id, values)
    return c.body(null, 204)
  })
  inbox.delete('/settings/:table/:id', async (c) => {
    const { table, id } = c.req.param()
    await deleteRow(settings, c.get('agent'), table, id)
    return c.body(null, 204)
  })
  // Agents' accounts, from the inbox: an invitation, a new password — each a link.
  inbox.post('/agents/invite', async (c) =>
    c.json(
      await inviteAgent(db, settings, config.webOrigin, c.get('agent'), await jsonBody(c.req.raw)),
      201,
    ),
  )
  inbox.post('/agents/:id/password', async (c) => {
    const id = c.req.param('id')
    if (!UUID.test(id)) throw new Refusal('ROW_NOT_FOUND', 404)
    return c.json(await resetAgentPassword(db, config.webOrigin, c.get('agent'), id))
  })

  inbox.get('/tags', async (c) => c.json(await tagOptions(settings)))

  inbox.post('/conversations/:id/tags', async (c) => {
    const { label } = await jsonBody(c.req.raw)
    const id = uuidParam(c.req.param('id'))
    return c.json(await addTag(db, settings, c.get('agent'), id, label))
  })

  inbox.delete('/conversations/:id/tags/:label', async (c) => {
    const id = uuidParam(c.req.param('id'))
    return c.json(await removeTag(db, c.get('agent'), id, c.req.param('label')))
  })

  inbox.get('/inboxes', async (c) =>
    c.json(await inboxDirectory(db, settings, access, c.get('agent'))),
  )

  inbox.get('/me', (c) => c.json(toAgent(c.get('agent'))))

  inbox.post('/ticket', (c) =>
    c.json({ ticket: tickets.issue(c.get('agent').id) } satisfies Ticket),
  )

  inbox.get('/agents', async (c) => c.json(await listAgents(db, settings)))
  // The palette's search inside the messages, in the inboxes the agent sees.
  inbox.get('/search', async (c) =>
    c.json(
      await searchMessages(db, c.req.query('q') ?? '', await access.visibleTo(c.get('agent'))),
    ),
  )

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

  // The contacts of the inboxes the agent sees — of one site, with `site`.
  inbox.get('/contacts', async (c) =>
    c.json(
      await listContacts(
        db,
        c.req.query('q') ?? '',
        await access.visibleTo(c.get('agent')),
        c.req.query('site') || null,
      ),
    ),
  )

  // GIPHY, for the picker — its key stays here (D5). A GIF chosen comes back as bytes, and
  // goes with the message as any file.
  inbox.get('/gifs', async (c) => {
    if (!config.giphyKey) throw new Refusal('GIFS_UNAVAILABLE', 503)
    const offset = Number(c.req.query('offset') ?? 0) || 0
    return c.json(await searchGifs(config.giphyKey, c.req.query('q') ?? '', offset, 'fr'))
  })
  inbox.get('/gifs/:id/file', async (c) => {
    if (!config.giphyKey) throw new Refusal('GIFS_UNAVAILABLE', 503)
    const { bytes } = await gifFile(config.giphyKey, c.req.param('id'))
    return c.body(bytes, 200, {
      'content-type': 'image/gif',
      'cache-control': 'private, max-age=600',
    })
  })

  // By its id, or by the word the inbox's address names it with: its name, then the end
  // of its id.
  inbox.get('/contacts/:id', async (c) => {
    const asked = c.req.param('id')
    const tail = /(?:^|-)([0-9a-f]{12})$/i.exec(asked)?.[1]
    const id = UUID.test(asked) ? asked : tail ? await contactByTail(db, tail) : null
    if (id === null) throw new Refusal('CONTACT_NOT_FOUND', 404)
    return c.json(await contactDetail(db, id, await access.visibleTo(c.get('agent'))))
  })

  inbox.get('/stats', async (c) => {
    const agent = c.get('agent')
    return c.json(
      await stats(db, agent, await access.visibleTo(agent), c.req.query('site') || null),
    )
  })

  inbox.get('/knowledge', async (c) => c.json(await knowledge(db)))

  inbox.get('/tools', async (c) => c.json(await toolsOverview(settings, mcp)))

  inbox.get('/widget', async (c) =>
    c.json(await widgetEditor(settings, c.get('agent'), ai !== null)),
  )

  /** A supervisor saves a site's widget — into its row of « Sites ». */
  inbox.put('/widget/:site', async (c) => {
    const saved = await saveWidget(
      settings,
      c.get('agent'),
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
      await runInConversation({ db, settings, mcp }, id, {
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
      await testTool({ db, settings, mcp }, c.get('agent'), {
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

  /** Into « Conversations promues », « À relire »: a source for the AI once reviewed. */
  inbox.post('/conversations/:id/promote', async (c) => {
    const id = uuidParam(c.req.param('id'))
    await promote(
      { db, settings, llm: ai?.llm ?? null, webOrigin: config.webOrigin },
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

  // The agent is writing a reply: the visitor sees three dots — once every two seconds.
  const typing = new RateLimiter(1, 2_000)
  inbox.post('/conversations/:id/typing', async (c) => {
    const id = uuidParam(c.req.param('id'))
    const agent = c.get('agent')
    if (typing.allow(`${agent.id}:${id}`)) {
      await signalTyping(db, id, 'agent', agent.name.split(/\s+/)[0] || undefined)
    }
    return c.body(null, 204)
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

  // A message read aloud by the AI's voice — audio mode. Its sound is not kept.
  const voices = new RateLimiter(40, 60_000)
  inbox.get('/messages/:id/speech', async (c) => {
    if (!ai) throw new Refusal('SPEECH_UNAVAILABLE', 503)
    const agent = c.get('agent')
    if (!voices.allow(agent.id)) throw new Refusal('RATE_LIMITED', 429)
    const audio = await speakMessage(
      { db, llm: ai.llm },
      agent,
      await access.visibleTo(agent),
      uuidParam(c.req.param('id')),
    )
    return c.body(audio.slice().buffer, 200, {
      'content-type': 'audio/mpeg',
      'cache-control': 'private, max-age=3600',
    })
  })

  // What the AI makes of a file — at the agent's request, kept for the team.
  inbox.post('/attachments/:id/analysis', async (c) => {
    if (!ai) throw new Refusal('AI_UNAVAILABLE', 503)
    const id = c.req.param('id')
    if (!UUID.test(id)) throw new Refusal('ATTACHMENT_NOT_FOUND', 404)
    const agent = c.get('agent')
    return c.json(
      await analyzeAttachment(
        { db, llm: ai.llm, redact: ai.redact, store },
        agent,
        await access.visibleTo(agent),
        id,
      ),
    )
  })

  inbox.post('/conversations/:id/assign', async (c) => {
    const { assigneeId } = assignBody(await jsonBody(c.req.raw))
    return c.json(await assign(db, c.get('agent'), uuidParam(c.req.param('id')), assigneeId))
  })

  // « Mettre en attente » until a time, and « Réveiller » before it.
  inbox.post('/conversations/:id/snooze', async (c) => {
    const { until } = await jsonBody(c.req.raw)
    if (typeof until !== 'string') throw new Refusal('INVALID_REQUEST', 400, { field: 'until' })
    return c.json(await snooze(db, c.get('agent'), uuidParam(c.req.param('id')), new Date(until)))
  })
  inbox.delete('/conversations/:id/snooze', async (c) => {
    const id = uuidParam(c.req.param('id'))
    await wake(db, c.get('agent'), id)
    return c.json(await loadConversation(db, id, c.get('agent')))
  })

  inbox.post('/conversations/:id/resolve', async (c) => {
    const id = uuidParam(c.req.param('id'))
    const resolved = await resolve(db, c.get('agent'), id)
    ai?.jobs.resolved(id)
    return c.json(resolved)
  })

  // « Supprimer pour moi », « Supprimer pour tout le monde ».
  inbox.post('/conversations/:id/messages/:messageId/hide', async (c) =>
    c.json(
      await hideMessage(
        db,
        c.get('agent'),
        uuidParam(c.req.param('id')),
        uuidParam(c.req.param('messageId')),
      ),
    ),
  )
  inbox.delete('/conversations/:id/messages/:messageId', async (c) =>
    c.json(
      await deleteMessage(
        db,
        c.get('agent'),
        uuidParam(c.req.param('id')),
        uuidParam(c.req.param('messageId')),
        store,
      ),
    ),
  )

  inbox.put('/conversations/:id/messages/:messageId/feedback', async (c) => {
    const { action } = feedbackBody(await jsonBody(c.req.raw))
    const messageId = c.req.param('messageId')
    if (!UUID.test(messageId)) throw new Refusal('MESSAGE_NOT_FOUND', 404)
    const id = uuidParam(c.req.param('id'))
    return c.json(await setFeedback(db, c.get('agent'), id, messageId, action))
  })

  // A reply or a note with files: multipart, `file` once per file, `body`, `kind`.
  inbox.post('/conversations/:id/attachments', uploadLimit, async (c) => {
    const id = uuidParam(c.req.param('id'))
    const form = await c.req.parseBody({ all: true })
    const uploads = await readUploads(filesOf(form))
    if (uploads.length === 0) throw new Refusal('INVALID_REQUEST', 400, { field: 'file' })
    const request: SendMessageBody = {
      body: typeof form.body === 'string' ? form.body : '',
      kind: form.kind === 'note' ? 'note' : 'reply',
      resolve: form.resolve === 'true',
    }
    if (request.body.length > 4000) throw new Refusal('INVALID_REQUEST', 400, { max: 4000 })
    return c.json(
      await keeping(store, id, uploads, (attach) =>
        sendMessage(db, c.get('agent'), id, request, attach),
      ),
    )
  })

  // The tokens of the API and the MCP server (D16): supervisors make and revoke them, from
  // the inbox; a token never can — it does not reach `/api/inbox`.
  // Their documentation, and the REST API's specification, for whoever is in the inbox.
  inbox.get('/api-docs', (c) =>
    c.json({ sections: documentation(publicAddress(c, config.trustProxy)) }),
  )
  inbox.get('/api-docs/openapi.json', (c) => c.json(openApi(publicAddress(c, config.trustProxy))))

  inbox.get('/tokens', async (c) => c.json(await listTokens(db, c.get('agent'))))
  inbox.post('/tokens', async (c) =>
    c.json(await createToken(db, c.get('agent'), readCreateBody(await jsonBody(c.req.raw))), 201),
  )
  inbox.delete('/tokens/:id', async (c) => {
    const id = c.req.param('id')
    if (!UUID.test(id)) throw new Refusal('TOKEN_NOT_FOUND', 404)
    await revokeToken(db, c.get('agent'), id)
    return c.body(null, 204)
  })

  // The webhooks (D17): supervisors make, stop, resume and delete them, read their log,
  // send them a test; `webhooks/dispatch.ts` calls them.
  const webhookParam = (value: string) => {
    if (!UUID.test(value)) throw new Refusal('WEBHOOK_NOT_FOUND', 404)
    return value
  }
  inbox.get('/webhooks', async (c) => c.json(await listWebhooks(db, c.get('agent'))))
  inbox.post('/webhooks', async (c) =>
    c.json(
      await createWebhook(
        db,
        config.secret,
        c.get('agent'),
        readWebhookBody(await jsonBody(c.req.raw)),
      ),
      201,
    ),
  )
  inbox.patch('/webhooks/:id', async (c) => {
    const { active } = await jsonBody(c.req.raw)
    if (typeof active !== 'boolean') throw new Refusal('INVALID_REQUEST', 400, { field: 'active' })
    await setWebhookActive(db, c.get('agent'), webhookParam(c.req.param('id')), active)
    return c.body(null, 204)
  })
  inbox.delete('/webhooks/:id', async (c) => {
    await deleteWebhook(db, c.get('agent'), webhookParam(c.req.param('id')))
    return c.body(null, 204)
  })
  inbox.get('/webhooks/:id/deliveries', async (c) =>
    c.json(await webhookLog(db, c.get('agent'), webhookParam(c.req.param('id')))),
  )
  inbox.post('/webhooks/:id/test', async (c) => {
    await pingWebhook(db, c.get('agent'), webhookParam(c.req.param('id')))
    return c.body(null, 202)
  })

  // The dashboards (D22): supervisors write them and their questions; agents run the
  // cards of the shared ones, as saved.
  const analytics: AnalyticsDeps = { db, pool: pool ?? null, llm: ai?.llm ?? null }
  inbox.get('/analytics/sources', (c) => c.json(SOURCES))
  inbox.post('/analytics/run', async (c) =>
    c.json(await runDraft(analytics, c.get('agent'), await jsonBody(c.req.raw))),
  )
  inbox.post('/analytics/assist', async (c) =>
    c.json(await assistQuestion(analytics, c.get('agent'), await jsonBody(c.req.raw))),
  )
  inbox.get('/dashboards', async (c) => c.json(await listDashboards(db, c.get('agent'))))
  inbox.post('/dashboards', async (c) =>
    c.json(await createDashboard(db, c.get('agent'), await jsonBody(c.req.raw)), 201),
  )
  inbox.get('/dashboards/:id', async (c) =>
    c.json(await getDashboard(db, c.get('agent'), c.req.param('id'))),
  )
  inbox.put('/dashboards/:id', async (c) =>
    c.json(await saveDashboard(db, c.get('agent'), c.req.param('id'), await jsonBody(c.req.raw))),
  )
  inbox.delete('/dashboards/:id', async (c) => {
    await deleteDashboard(db, c.get('agent'), c.req.param('id'))
    return c.body(null, 204)
  })
  inbox.post('/dashboards/:id/cards/:card/run', async (c) => {
    const { timeZone, values } = await jsonBody(c.req.raw)
    return c.json(
      await runCard(
        analytics,
        c.get('agent'),
        c.req.param('id'),
        c.req.param('card'),
        timeZone,
        values,
      ),
    )
  })
  inbox.post('/analytics/values', async (c) =>
    c.json(await filterValues(analytics, await jsonBody(c.req.raw))),
  )

  // The page's actions (D21): what a site's pages declared, and what supervisors allow.
  inbox.get('/sites/:site/page-actions', async (c) =>
    c.json(await listPageActions(db, c.get('agent'), c.req.param('site'))),
  )
  inbox.patch('/page-actions/:id', async (c) => {
    const id = c.req.param('id')
    if (!UUID.test(id)) throw new Refusal('ROW_NOT_FOUND', 404)
    return c.json(await setPageAction(db, c.get('agent'), id, await jsonBody(c.req.raw)))
  })

  // The automations (D20): supervisors write, switch on, try and read them;
  // `automations/engine.ts` runs them. Agents start the « button » ones from a conversation.
  const automating: ManageDeps = {
    db,
    settings,
    secret: config.secret,
    publicUrl: config.publicUrl,
    poke: automations?.poke ?? (() => {}),
  }
  const automationParam = (value: string) => {
    if (!UUID.test(value)) throw new Refusal('AUTOMATION_NOT_FOUND', 404)
    return value
  }
  inbox.get('/automations', async (c) => c.json(await listAutomations(automating, c.get('agent'))))
  inbox.get('/automations/choices', async (c) =>
    c.json(await automationChoices(automating, c.get('agent'), ai !== null)),
  )
  inbox.post('/automations', async (c) =>
    c.json(await createAutomation(automating, c.get('agent'), await jsonBody(c.req.raw)), 201),
  )
  inbox.get('/automations/:id', async (c) =>
    c.json(await getAutomation(automating, c.get('agent'), automationParam(c.req.param('id')))),
  )
  inbox.put('/automations/:id', async (c) =>
    c.json(
      await updateAutomation(
        automating,
        c.get('agent'),
        automationParam(c.req.param('id')),
        await jsonBody(c.req.raw),
      ),
    ),
  )
  inbox.patch('/automations/:id', async (c) => {
    const { active } = await jsonBody(c.req.raw)
    if (typeof active !== 'boolean') throw new Refusal('INVALID_REQUEST', 400, { field: 'active' })
    return c.json(
      await setAutomationActive(
        automating,
        c.get('agent'),
        automationParam(c.req.param('id')),
        active,
      ),
    )
  })
  inbox.post('/automations/:id/key', async (c) =>
    c.json(
      await renewAutomationKey(automating, c.get('agent'), automationParam(c.req.param('id'))),
    ),
  )
  inbox.delete('/automations/:id', async (c) => {
    await deleteAutomation(automating, c.get('agent'), automationParam(c.req.param('id')))
    return c.body(null, 204)
  })
  inbox.get('/automations/:id/runs', async (c) =>
    c.json(await automationRunList(automating, c.get('agent'), automationParam(c.req.param('id')))),
  )
  inbox.post('/automations/:id/try', async (c) => {
    const { conversationId } = await jsonBody(c.req.raw)
    const target =
      conversationId === null || conversationId === undefined
        ? null
        : uuidParam(String(conversationId))
    return c.json(
      await tryAutomation(automating, c.get('agent'), automationParam(c.req.param('id')), target),
      202,
    )
  })
  inbox.post('/automation-runs/:id/stop', async (c) => {
    await stopRun(automating, c.get('agent'), automationParam(c.req.param('id')))
    return c.body(null, 204)
  })
  inbox.get('/conversations/:id/automations', async (c) =>
    c.json(await buttonsFor(automating, uuidParam(c.req.param('id')))),
  )
  inbox.post('/conversations/:id/automations/:automation', async (c) =>
    c.json(
      await pressButton(
        automating,
        c.get('agent'),
        uuidParam(c.req.param('id')),
        automationParam(c.req.param('automation')),
      ),
      202,
    ),
  )

  app.route('/api/inbox', inbox)

  // A « webhook » automation's address: another system calls it, with its key (D20).
  app.post('/api/automations/:id/hook', async (c) => {
    const key = c.req.header('x-messagerie-key') ?? c.req.query('key') ?? ''
    const text = await c.req.text()
    if (text.length > 64_000) throw new Refusal('INVALID_REQUEST', 413)
    let body: unknown = {}
    if (text.trim() !== '') {
      try {
        body = JSON.parse(text)
      } catch {
        throw new Refusal('INVALID_REQUEST', 400, { expected: 'JSON' })
      }
    }
    return c.json(await hookCalled(automating, c.req.param('id'), key, body), 202)
  })

  // The public API and the MCP server: programs and agents, with a token of the chat (D16).
  app.route('/api/v1', restRoutes({ db, settings, access, trustProxy: config.trustProxy }))
  app.route('/mcp', mcpRoutes({ db, settings, access }))

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
          files: store,
          onVisitorMessage: (id) => ai?.jobs.visitorMessage(id),
          onPageAnswered: (id) => ai?.jobs.pageAnswered(id),
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
