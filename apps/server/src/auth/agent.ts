import { and, eq } from 'drizzle-orm'
import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import type { Config } from '../config.js'
import type { Db } from '../db/client.js'
import { agents } from '../db/schema.js'
import type { AgentRow } from '../inbox/read.js'
import { Refusal } from '../refusal.js'
import { SESSION_COOKIE, sessionAgent } from './credentials.js'

export type AgentEnv = {
  Variables: {
    agent: AgentRow
  }
}

/** The header every write of the inbox carries: a page of another origin cannot send it. */
export const REQUEST_HEADER = 'x-chat-request'

/**
 * Who is asking (D19): the agent of the session cookie — active, or refused.
 *
 * The cookie is `SameSite=Lax`, and every request that changes something must carry
 * `X-Chat-Request` as well: a page elsewhere cannot add that header without CORS letting
 * it, and CORS lets only the inbox's origin. Without a session, and in development only,
 * `CHAT_DEV_AGENT` (a login) stands in: no sign-in on a developer's machine.
 */
export function agentAuth(db: Db, config: Config): MiddlewareHandler<AgentEnv> {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE)
    if (token) {
      const agent = await sessionAgent(db, token)
      if (!agent) throw new Refusal('SESSION_INVALID', 401)
      if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && !c.req.header(REQUEST_HEADER)) {
        throw new Refusal('SESSION_INVALID', 401)
      }
      c.set('agent', agent)
    } else if (config.devAgent !== null) {
      c.set('agent', await devAgent(db, config.devAgent))
    } else {
      throw new Refusal('SESSION_INVALID', 401)
    }
    await next()
  }
}

async function devAgent(db: Db, login: string): Promise<AgentRow> {
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.login, login), eq(agents.active, true)))
  if (!agent) throw new Refusal('NOT_AN_AGENT', 403)
  return agent
}
