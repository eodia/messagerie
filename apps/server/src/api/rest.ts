import { Hono } from 'hono'
import type { Db } from '../db/client.js'
import type { Access } from '../inbox/access.js'
import { Refusal } from '../refusal.js'
import type { Settings } from '../settings/settings.js'
import { RateLimiter } from '../widget/hub.js'
import {
  type StatusFilter,
  agentsList,
  assignTo,
  close,
  contact,
  contactsList,
  conversation,
  conversationList,
  inboxes,
  reply,
  search,
  tag,
  whoami,
} from './service.js'
import { type TokenContext, bearerToken, openToken } from './tokens.js'

/**
 * The public REST API, under `/api/v1`: a program — a script, a synchronisation, Zapier —
 * with a token of the chat, `Authorization: Bearer msg_…` (D16). JSON in, `{ "data": … }`
 * out; a refusal is `{ "code", "details"? }` with its HTTP status, as everywhere in the chat.
 *
 *   GET    /me                              the token: its name, rights, inboxes
 *   GET    /inboxes                         the inboxes it reaches
 *   GET    /agents                          the agents, to assign to
 *   GET    /conversations                   ?status=unresolved|ai|open|pending|resolved|all
 *                                           &inbox=<id>&assignee=<id>|none&limit=50
 *   GET    /conversations/:id               a conversation, its messages
 *   POST   /conversations/:id/messages      { body, kind?: reply|note, resolve? }  (write)
 *   POST   /conversations/:id/assign        { assigneeId: id | null }              (write)
 *   POST   /conversations/:id/resolve                                              (write)
 *   POST   /conversations/:id/tags          { label }                              (write)
 *   DELETE /conversations/:id/tags/:label                                          (write)
 *   GET    /contacts                        ?q=
 *   GET    /contacts/:id
 *   GET    /search                          ?q=  the messages that say it
 */

type TokenEnv = { Variables: { token: TokenContext } }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATUSES: readonly StatusFilter[] = ['unresolved', 'ai', 'open', 'pending', 'resolved', 'all']

function id(value: string, code: 'CONVERSATION_NOT_FOUND' | 'CONTACT_NOT_FOUND'): string {
  if (!UUID.test(value)) throw new Refusal(code, 404)
  return value
}

async function json(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => null)
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Refusal('INVALID_REQUEST', 400)
  }
  return body as Record<string, unknown>
}

export function restRoutes(deps: {
  readonly db: Db
  readonly settings: Settings | null
  readonly access: Access
}): Hono<TokenEnv> {
  const api = new Hono<TokenEnv>()
  // A program is not a page: no CORS, so that no browser carries a token across sites.
  const calls = new RateLimiter(240, 60_000)
  api.use('*', async (c, next) => {
    const context = await openToken(
      deps.db,
      deps.access,
      bearerToken(c.req.header('authorization')),
      'rest',
    )
    if (!calls.allow(context.token.id)) throw new Refusal('RATE_LIMITED', 429)
    c.set('token', context)
    await next()
  })

  api.get('/me', (c) => c.json({ data: whoami(c.get('token')) }))
  api.get('/inboxes', async (c) => c.json({ data: await inboxes(deps, c.get('token')) }))
  api.get('/agents', async (c) => c.json({ data: await agentsList(deps) }))

  api.get('/conversations', async (c) => {
    const status = c.req.query('status')
    if (status !== undefined && !STATUSES.includes(status as StatusFilter)) {
      throw new Refusal('INVALID_REQUEST', 400, { field: 'status', expected: STATUSES })
    }
    const limit = c.req.query('limit')
    return c.json({
      data: await conversationList(deps, c.get('token'), {
        ...(status ? { status: status as StatusFilter } : {}),
        ...(c.req.query('inbox') ? { inbox: c.req.query('inbox') } : {}),
        ...(c.req.query('assignee') ? { assignee: c.req.query('assignee') } : {}),
        ...(limit ? { limit: Number(limit) || undefined } : {}),
      }),
    })
  })

  api.get('/conversations/:id', async (c) =>
    c.json({
      data: await conversation(
        deps,
        c.get('token'),
        id(c.req.param('id'), 'CONVERSATION_NOT_FOUND'),
      ),
    }),
  )

  api.post('/conversations/:id/messages', async (c) => {
    const { body, kind, resolve } = await json(c.req.raw)
    if (typeof body !== 'string' || (kind !== undefined && kind !== 'reply' && kind !== 'note')) {
      throw new Refusal('INVALID_REQUEST', 400, {
        expected: '{ body: string, kind?: reply|note, resolve?: boolean }',
      })
    }
    return c.json(
      {
        data: await reply(
          deps,
          c.get('token'),
          id(c.req.param('id'), 'CONVERSATION_NOT_FOUND'),
          body,
          { note: kind === 'note', resolve: resolve === true },
        ),
      },
      201,
    )
  })

  api.post('/conversations/:id/assign', async (c) => {
    const { assigneeId } = await json(c.req.raw)
    if (assigneeId !== null && (typeof assigneeId !== 'string' || !UUID.test(assigneeId))) {
      throw new Refusal('INVALID_REQUEST', 400, { expected: '{ assigneeId: id | null }' })
    }
    return c.json({
      data: await assignTo(
        deps,
        c.get('token'),
        id(c.req.param('id'), 'CONVERSATION_NOT_FOUND'),
        assigneeId,
      ),
    })
  })

  api.post('/conversations/:id/resolve', async (c) =>
    c.json({
      data: await close(deps, c.get('token'), id(c.req.param('id'), 'CONVERSATION_NOT_FOUND')),
    }),
  )

  api.post('/conversations/:id/tags', async (c) => {
    const { label } = await json(c.req.raw)
    if (typeof label !== 'string') {
      throw new Refusal('INVALID_REQUEST', 400, { expected: '{ label: string }' })
    }
    return c.json({
      data: await tag(deps, c.get('token'), id(c.req.param('id'), 'CONVERSATION_NOT_FOUND'), label),
    })
  })

  api.delete('/conversations/:id/tags/:label', async (c) =>
    c.json({
      data: await tag(
        deps,
        c.get('token'),
        id(c.req.param('id'), 'CONVERSATION_NOT_FOUND'),
        decodeURIComponent(c.req.param('label')),
        true,
      ),
    }),
  )

  api.get('/contacts', async (c) =>
    c.json({ data: await contactsList(deps, c.get('token'), c.req.query('q') ?? '') }),
  )
  api.get('/contacts/:id', async (c) =>
    c.json({
      data: await contact(deps, c.get('token'), id(c.req.param('id'), 'CONTACT_NOT_FOUND')),
    }),
  )

  api.get('/search', async (c) =>
    c.json({ data: await search(deps, c.get('token'), c.req.query('q') ?? '') }),
  )

  return api
}
