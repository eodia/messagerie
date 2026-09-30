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
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { type AgentEnv, agentAuth } from './auth/agent.js'
import type { TicketBook } from './auth/tickets.js'
import type { MessagerieSettings } from './basedb/settings.js'
import type { Config } from './config.js'
import type { Db } from './db/client.js'
import { listNotifications, readNotifications } from './inbox/notifications.js'
import { loadConversation, loadSummaries, toAgent } from './inbox/read.js'
import {
  assign,
  listAgents,
  markRead,
  resolve,
  sendMessage,
  setFeedback,
  takeOver,
} from './inbox/write.js'
import type { InboxHub } from './realtime/hub.js'
import { Refusal } from './refusal.js'

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
}: {
  db: Db
  hub: InboxHub
  config: Config
  settings: MessagerieSettings | null
  tickets: TicketBook
}) {
  const app = new Hono()
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

  // CORS for the inbox's origin — not on a WebSocket upgrade, whose response headers are
  // not the middleware's to touch.
  const withCors = cors({
    origin: config.webOrigin,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowHeaders: ['content-type', 'authorization'],
    maxAge: 600,
  })
  app.use('/api/*', (c, next) =>
    c.req.header('upgrade')?.toLowerCase() === 'websocket' ? next() : withCors(c, next),
  )

  app.get('/health', (c) => c.json({ ok: true }))

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
  inbox.use(agentAuth(db, config, settings))

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

  inbox.get('/conversations', async (c) => c.json(await loadSummaries(db)))

  inbox.get('/conversations/:id', async (c) => {
    const id = uuidParam(c.req.param('id'))
    return c.json(await loadConversation(db, id, c.get('agent')))
  })

  inbox.post('/conversations/:id/read', async (c) => {
    await markRead(db, c.get('agent'), uuidParam(c.req.param('id')))
    return c.body(null, 204)
  })

  inbox.post('/conversations/:id/messages', async (c) => {
    const request = sendBody(await jsonBody(c.req.raw))
    return c.json(await sendMessage(db, c.get('agent'), uuidParam(c.req.param('id')), request))
  })

  inbox.post('/conversations/:id/takeover', async (c) =>
    c.json(await takeOver(db, c.get('agent'), uuidParam(c.req.param('id')))),
  )

  inbox.post('/conversations/:id/assign', async (c) => {
    const { assigneeId } = assignBody(await jsonBody(c.req.raw))
    return c.json(await assign(db, c.get('agent'), uuidParam(c.req.param('id')), assigneeId))
  })

  inbox.post('/conversations/:id/resolve', async (c) =>
    c.json(await resolve(db, c.get('agent'), uuidParam(c.req.param('id')))),
  )

  inbox.put('/conversations/:id/messages/:messageId/feedback', async (c) => {
    const { action } = feedbackBody(await jsonBody(c.req.raw))
    const messageId = c.req.param('messageId')
    if (!UUID.test(messageId)) throw new Refusal('MESSAGE_NOT_FOUND', 404)
    const id = uuidParam(c.req.param('id'))
    return c.json(await setFeedback(db, c.get('agent'), id, messageId, action))
  })

  app.route('/api/inbox', inbox)

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
