import { and, eq } from 'drizzle-orm'
import type { MiddlewareHandler } from 'hono'
import type { Config } from '../config.js'
import type { Db } from '../db/client.js'
import { agents } from '../db/schema.js'
import type { AgentRow } from '../inbox/read.js'
import { Refusal } from '../refusal.js'

export type AgentEnv = { Variables: { agent: AgentRow } }

/**
 * Who is asking — an agent is a basedb account listed in « Conseillers » (D4).
 *
 * basedb will vouch for the account behind a request (dependency B2). Until then the only
 * identity is the development one, `CHAT_DEV_AGENT`, ignored in production: there, with no
 * way to know who asks, every request is refused rather than trusted.
 */
export function agentAuth(db: Db, config: Config): MiddlewareHandler<AgentEnv> {
  return async (c, next) => {
    const basedbUserId = config.devAgent
    if (basedbUserId === null) throw new Refusal('AUTH_NOT_CONFIGURED', 503)
    const [agent] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.basedbUserId, basedbUserId), eq(agents.active, true)))
    if (!agent) throw new Refusal('NOT_AN_AGENT', 403)
    c.set('agent', agent)
    await next()
  }
}
