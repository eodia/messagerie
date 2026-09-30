import type { ApiError, Feedback, FeedbackBody, InboxEvent, SendMessageBody } from '@chat/contracts'
import { createNodeWebSocket } from '@hono/node-ws'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { type AgentEnv, agentAuth } from './auth/agent.js'
import type { Config } from './config.js'
import type { Db } from './db/client.js'
import { loadConversation, loadSummaries, toAgent } from './inbox/read.js'
import { markRead, resolve, sendMessage, setFeedback, takeOver } from './inbox/write.js'
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
export function createApp({ db, hub, config }: { db: Db; hub: InboxHub; config: Config }) {
  const app = new Hono()
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

  // CORS for the inbox's origin — not on a WebSocket upgrade, whose response headers are
  // not the middleware's to touch.
  const withCors = cors({
    origin: config.webOrigin,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowHeaders: ['content-type'],
    maxAge: 600,
  })
  app.use('/api/*', (c, next) =>
    c.req.header('upgrade')?.toLowerCase() === 'websocket' ? next() : withCors(c, next),
  )

  app.get('/health', (c) => c.json({ ok: true }))

  const inbox = new Hono<AgentEnv>()
  inbox.use(agentAuth(db, config))

  inbox.get('/me', (c) => c.json(toAgent(c.get('agent'))))

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

  /**
   * The live signals: one message per conversation that changed, anywhere. A WebSocket
   * escapes CORS, so the origin is checked here: any page the agent has open could
   * otherwise open this socket with the agent's credentials and read along.
   */
  inbox.get(
    '/events',
    async (c, next) => {
      const origin = c.req.header('origin')
      if (origin !== undefined && origin !== config.webOrigin) {
        return c.json({ code: 'INVALID_REQUEST', details: { origin } } satisfies ApiError, 403)
      }
      await next()
    },
    upgradeWebSocket(() => ({
      onOpen: (_event, socket) => hub.add(socket),
      onClose: (_event, socket) => hub.remove(socket),
      onError: (_event, socket) => hub.remove(socket),
    })),
  )

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
