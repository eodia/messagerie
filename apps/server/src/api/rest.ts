import { type Context, Hono } from 'hono'
import type { z } from 'zod'
import type { Db } from '../db/client.js'
import type { Access } from '../inbox/access.js'
import { Refusal } from '../refusal.js'
import type { Settings } from '../settings/settings.js'
import { RateLimiter } from '../widget/hub.js'
import { openApi } from './documentation.js'
import { ENDPOINTS, type Endpoint } from './reference.js'
import {
  type ServiceDeps,
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
  startOutreach,
  tag,
  whoami,
} from './service.js'
import { type TokenContext, bearerToken, openToken } from './tokens.js'

/**
 * The public REST API, under `/api/v1`: a program — a script, a synchronisation, Zapier —
 * with a token of the chat, `Authorization: Bearer msg_…` (D16). Its routes are those of
 * `reference.ts`, checked with its schemas, and documented from it: JSON in, `{ "data": … }`
 * out; a refusal is `{ "code", "details"? }` with its HTTP status, as everywhere in the chat.
 * `GET /openapi.json` gives the specification.
 */

type TokenEnv = { Variables: { token: TokenContext } }

interface Input {
  readonly params: Readonly<Record<string, string>>
  readonly query: Readonly<Record<string, unknown>>
  readonly body: Readonly<Record<string, unknown>>
}

type Handler = (deps: ServiceDeps, token: TokenContext, input: Input) => unknown

const text = (value: unknown) => (typeof value === 'string' ? value : '')

/** What each route of the reference does — by its id. */
const HANDLERS: Readonly<Record<string, Handler>> = {
  me: (_deps, token) => whoami(token),
  listConversations: (deps, token, { query }) =>
    conversationList(deps, token, {
      ...(query.status ? { status: query.status as StatusFilter } : {}),
      ...(query.inbox ? { inbox: text(query.inbox) } : {}),
      ...(query.assignee ? { assignee: text(query.assignee) } : {}),
      ...(typeof query.limit === 'number' ? { limit: query.limit } : {}),
    }),
  getConversation: (deps, token, { params }) => conversation(deps, token, params.id ?? ''),
  startConversation: (deps, token, { body }) => startOutreach(deps, token, body),
  sendMessage: (deps, token, { params, body }) =>
    reply(deps, token, params.id ?? '', text(body.body), {
      note: body.kind === 'note',
      resolve: body.resolve === true,
    }),
  assign: (deps, token, { params, body }) =>
    assignTo(deps, token, params.id ?? '', (body.assigneeId as string | null) ?? null),
  resolve: (deps, token, { params }) => close(deps, token, params.id ?? ''),
  addTag: (deps, token, { params, body }) => tag(deps, token, params.id ?? '', text(body.label)),
  removeTag: (deps, token, { params }) =>
    tag(deps, token, params.id ?? '', params.label ?? '', true),
  listContacts: (deps, token, { query }) => contactsList(deps, token, text(query.q)),
  getContact: (deps, token, { params }) => contact(deps, token, params.id ?? ''),
  search: (deps, token, { query }) => search(deps, token, text(query.q)),
  inboxes: (deps, token) => inboxes(deps, token),
  agents: (deps) => agentsList(deps),
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A schema's verdict, or the refusal that names what is wrong. */
function checked(schema: z.ZodObject | undefined, value: unknown): Record<string, unknown> {
  if (!schema) return {}
  const result = schema.safeParse(value)
  if (result.success) return result.data as Record<string, unknown>
  throw new Refusal('INVALID_REQUEST', 400, {
    issues: result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    })),
  })
}

async function input(c: Context, endpoint: Endpoint): Promise<Input> {
  const params: Record<string, string> = {}
  for (const [name, spec] of Object.entries(endpoint.params ?? {})) {
    const raw = decodeURIComponent(c.req.param(name) ?? '')
    if (name === 'id' && !UUID.test(raw)) throw new Refusal(spec.notFound, 404)
    params[name] = raw
  }
  const query = checked(endpoint.query, c.req.query())
  let body: Record<string, unknown> = {}
  if (endpoint.body) {
    const raw: unknown = await c.req.json().catch(() => null)
    body = checked(endpoint.body, raw)
  }
  return { params, query, body }
}

/** Where the server answers, as the caller reached it — the specification's address. */
export function publicAddress(c: Context, trustProxy: boolean): string {
  const url = new URL(c.req.url)
  if (!trustProxy) return url.origin
  const proto =
    c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() || url.protocol.slice(0, -1)
  const host = c.req.header('x-forwarded-host')?.split(',')[0]?.trim() || url.host
  return `${proto}://${host}`
}

export function restRoutes(deps: {
  readonly db: Db
  readonly settings: Settings | null
  readonly access: Access
  readonly trustProxy: boolean
  readonly email?: boolean
}): Hono<TokenEnv> {
  const api = new Hono<TokenEnv>()
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

  api.get('/openapi.json', (c) => c.json(openApi(publicAddress(c, deps.trustProxy))))

  for (const endpoint of ENDPOINTS) {
    const handler = HANDLERS[endpoint.id]
    if (!handler) throw new Error(`no handler for ${endpoint.id}`)
    const path = endpoint.path.replace(/\{(\w+)\}/g, ':$1')
    api.on(endpoint.method, path, async (c) => {
      const data = await handler(deps, c.get('token'), await input(c, endpoint))
      return c.json({ data }, endpoint.status)
    })
  }
  return api
}
