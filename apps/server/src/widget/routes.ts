import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Ticket, WidgetMessageBody, WidgetSessionBody } from '@chat/contracts'
import { type Context, Hono } from 'hono'
import { cors } from 'hono/cors'
import type { UpgradeWebSocket } from 'hono/ws'
import type { TicketBook } from '../auth/tickets.js'
import { readPatch, readProfile } from '../inbox/metadata.js'
import { Refusal } from '../refusal.js'
import { RateLimiter, type WidgetHub } from './hub.js'
import {
  type WidgetDeps,
  openSession,
  postVisitorMessage,
  updateVisitorContact,
  updateVisitorConversation,
  visitorConversation,
  visitorFrom,
} from './visitor.js'

/**
 * The widget's API, under `/api/widget` — called from the pages of the sites, never from
 * the inbox. Any origin may ask (CORS answers every one); each request is then checked
 * against the domains its site allows.
 */

const bearer = (c: Context) => {
  const header = c.req.header('authorization')
  return header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : undefined
}

async function jsonOf(c: Context): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null)
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Refusal('INVALID_REQUEST', 400)
  }
  return body as Record<string, unknown>
}

function sessionBody(raw: Record<string, unknown>): WidgetSessionBody {
  const { site, visitor, identity } = raw
  if (typeof site !== 'string' || site === '')
    throw new Refusal('INVALID_REQUEST', 400, { field: 'site' })
  return {
    site,
    ...(typeof visitor === 'string' ? { visitor } : {}),
    ...(typeof identity === 'string' && identity !== '' ? { identity } : {}),
  }
}

export function widgetRoutes(
  deps: WidgetDeps,
  hub: WidgetHub,
  tickets: TicketBook,
  upgradeWebSocket: UpgradeWebSocket,
): Hono {
  const widget = new Hono()
  // Sessions per address, messages per visitor: a page reloaded, a visitor typing fast,
  // pass; a script does not.
  const sessions = new RateLimiter(30, 60_000)
  const posts = new RateLimiter(20, 60_000)
  const edits = new RateLimiter(30, 60_000)

  widget.use('*', (c, next) =>
    c.req.header('upgrade')?.toLowerCase() === 'websocket'
      ? next()
      : cors({
          origin: (origin) => origin,
          allowMethods: ['GET', 'POST', 'PATCH'],
          allowHeaders: ['content-type', 'authorization'],
          maxAge: 600,
        })(c, next),
  )

  const address = (c: Context): string => {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    if (deps.config.trustProxy && forwarded) return forwarded
    const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)
      ?.incoming
    return incoming?.socket?.remoteAddress ?? 'local'
  }

  widget.post('/session', async (c) => {
    if (!sessions.allow(address(c))) throw new Refusal('RATE_LIMITED', 429)
    const body = sessionBody(await jsonOf(c))
    return c.json(await openSession(deps, body, c.req.header('origin')))
  })

  widget.get('/conversation', async (c) => {
    const visitor = await visitorFrom(deps, bearer(c), c.req.header('origin'))
    return c.json(await visitorConversation(deps.db, visitor.contactId))
  })

  widget.post('/messages', async (c) => {
    const visitor = await visitorFrom(deps, bearer(c), c.req.header('origin'))
    if (!posts.allow(visitor.contactId)) throw new Refusal('RATE_LIMITED', 429)
    const { body, data } = (await jsonOf(c)) as Partial<WidgetMessageBody>
    if (typeof body !== 'string') throw new Refusal('INVALID_REQUEST', 400, { field: 'body' })
    return c.json(
      await postVisitorMessage(deps, visitor, body, data === undefined ? null : readPatch(data)),
    )
  })

  /** `MessagerieChat.setUser` and `setContactData`. */
  widget.patch('/contact', async (c) => {
    const visitor = await visitorFrom(deps, bearer(c), c.req.header('origin'))
    if (!edits.allow(visitor.contactId)) throw new Refusal('RATE_LIMITED', 429)
    const raw = await jsonOf(c)
    await updateVisitorContact(deps, visitor, {
      profile: readProfile(raw),
      data: raw.data === undefined ? null : readPatch(raw.data),
    })
    return c.body(null, 204)
  })

  /** `MessagerieChat.setConversationData`, once the conversation has begun. */
  widget.patch('/conversation', async (c) => {
    const visitor = await visitorFrom(deps, bearer(c), c.req.header('origin'))
    if (!edits.allow(visitor.contactId)) throw new Refusal('RATE_LIMITED', 429)
    await updateVisitorConversation(deps, visitor, readPatch((await jsonOf(c)).data))
    return c.body(null, 204)
  })

  widget.post('/ticket', async (c) => {
    const visitor = await visitorFrom(deps, bearer(c), c.req.header('origin'))
    return c.json({ ticket: tickets.issue(`visitor:${visitor.contactId}`) } satisfies Ticket)
  })

  /** The visitor's live signals: their conversation changed, someone is typing. */
  widget.get(
    '/events',
    upgradeWebSocket((c) => {
      const holder = tickets.redeem(c.req.query('ticket'))
      const contactId = holder?.startsWith('visitor:') ? holder.slice(8) : null
      return {
        onOpen: (_event, socket) => {
          if (contactId === null) socket.close(4401, 'TICKET_INVALID')
          else hub.add(contactId, socket)
        },
        onClose: (_event, socket) => contactId && hub.remove(contactId, socket),
        onError: (_event, socket) => contactId && hub.remove(contactId, socket),
      }
    }),
  )

  return widget
}

const require = createRequire(import.meta.url)

/**
 * The widget's script, as `apps/widget` built it — read at each request in development,
 * so that a rebuild shows at once; once in production.
 */
export function widgetScript(production: boolean): () => string | null {
  let cached: string | null = null
  const read = () => {
    try {
      return readFileSync(require.resolve('@chat/widget/widget.js'), 'utf8')
    } catch {
      return null
    }
  }
  return () => {
    if (!production) return read()
    if (cached === null) cached = read()
    return cached
  }
}
