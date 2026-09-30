import { and, eq } from 'drizzle-orm'
import type { MiddlewareHandler } from 'hono'
import { type BasedbClient, BasedbFailure, type Introspection } from '../basedb/client.js'
import type { Config } from '../config.js'
import type { Db } from '../db/client.js'
import { agents } from '../db/schema.js'
import type { AgentRow } from '../inbox/read.js'
import { Refusal } from '../refusal.js'
import type { Settings } from '../settings/settings.js'

export type AgentEnv = {
  Variables: {
    agent: AgentRow
    /** The person's basedb token — for what the chat writes in basedb on their behalf. */
    basedbToken: string | null
  }
}

/**
 * Who is asking — an agent is a basedb account listed, active, in « Conseillers » (D4).
 *
 * The inbox sends the access token of the person signed in to basedb; basedb says what it
 * is worth (introspection, B2), and « Conseillers » says whether that person answers
 * visitors. The chat keeps a copy of the agent (`chat.agent`) so that a message still
 * names its author once the row is gone.
 *
 * Without a token, and in development only, `CHAT_DEV_AGENT` stands in: the inbox then
 * works without basedb. In production a request without a token is refused.
 */
export function agentAuth(
  db: Db,
  config: Config,
  basedb: BasedbClient | null,
  settings: Settings | null,
): MiddlewareHandler<AgentEnv> {
  const cache = new IdentityCache()
  return async (c, next) => {
    const header = c.req.header('authorization')
    const token = header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
    if (token !== '') {
      if (basedb === null || settings === null) throw new Refusal('AUTH_NOT_CONFIGURED', 503)
      c.set(
        'agent',
        await cache.agent(token, () => agentFromToken(db, config, basedb, settings, token)),
      )
      c.set('basedbToken', token)
    } else if (config.devAgent !== null) {
      c.set('agent', await devAgent(db, config.devAgent))
      c.set('basedbToken', null)
    } else if (basedb !== null) {
      throw new Refusal('SESSION_INVALID', 401)
    } else {
      throw new Refusal('AUTH_NOT_CONFIGURED', 503)
    }
    await next()
  }
}

async function devAgent(db: Db, basedbUserId: string): Promise<AgentRow> {
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.basedbUserId, basedbUserId), eq(agents.active, true)))
  if (!agent) throw new Refusal('NOT_AN_AGENT', 403)
  return agent
}

async function agentFromToken(
  db: Db,
  config: Config,
  basedb: BasedbClient,
  settings: Settings,
  token: string,
): Promise<AgentRow> {
  const answer: Introspection = await basedb.introspect(token).catch((error: unknown) => {
    throw unreachable(error)
  })
  // A person's token, of basedb's tenant. An integration token is a program, not an agent.
  if (!answer.active || answer.token_type !== 'access_token') {
    throw new Refusal('SESSION_INVALID', 401)
  }
  if (config.basedb !== null && answer.tenant !== config.basedb.tenant) {
    throw new Refusal('SESSION_INVALID', 401)
  }
  const entry = await settings.agent(answer.sub).catch((error: unknown) => {
    throw unreachable(error)
  })
  if (entry === null || !entry.active) throw new Refusal('NOT_AN_AGENT', 403)

  const copy = {
    name: entry.name || answer.name || answer.email || answer.sub,
    email: answer.email ?? null,
    role: entry.role,
    active: true,
    syncedAt: new Date(),
  }
  const [agent] = await db
    .insert(agents)
    .values({ basedbUserId: answer.sub, ...copy })
    .onConflictDoUpdate({ target: agents.basedbUserId, set: copy })
    .returning()
  if (!agent) throw new Refusal('INTERNAL_ERROR', 500)
  return agent
}

/** basedb did not answer, or its « Messagerie » base is not the one the chat expects. */
function unreachable(error: unknown): Refusal {
  if (error instanceof BasedbFailure && error.code.startsWith('TEMPLATE_MISMATCH')) {
    return new Refusal('SETTINGS_MISMATCH', 503, { missing: error.code.slice(19) })
  }
  return new Refusal('BASEDB_UNREACHABLE', 503)
}

/**
 * Who a token is, kept thirty seconds — basedb's own revocation window — and never past
 * the token's expiry: a signed-out agent is out within that time, and a busy inbox does
 * not ask basedb at every request. Refusals are not kept.
 */
const KEEP_MS = 30_000

class IdentityCache {
  private readonly known = new Map<string, { agent: Promise<AgentRow>; until: number }>()

  agent(token: string, resolve: () => Promise<AgentRow>): Promise<AgentRow> {
    const now = Date.now()
    const hit = this.known.get(token)
    if (hit && hit.until > now) return hit.agent
    if (this.known.size > 1000) {
      for (const [key, entry] of this.known) if (entry.until <= now) this.known.delete(key)
    }
    const agent = resolve()
    this.known.set(token, { agent, until: now + KEEP_MS })
    agent.catch(() => this.known.delete(token))
    return agent
  }
}
