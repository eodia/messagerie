import type { ApiError, AuthState, LinkInfo } from '@chat/contracts'
import { and, eq, isNotNull, or, sql } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { deleteCookie, getCookie, getSignedCookie, setCookie, setSignedCookie } from 'hono/cookie'
import { cors } from 'hono/cors'
import * as oidc from 'openid-client'
import type { Config } from '../config.js'
import type { Db } from '../db/client.js'
import { agentIdentities, agents } from '../db/schema.js'
import { type AgentRow, toAgent } from '../inbox/read.js'
import { person } from '../programs.js'
import { Refusal } from '../refusal.js'
import type { Settings } from '../settings/settings.js'
import { RateLimiter } from '../widget/hub.js'
import { REQUEST_HEADER } from './agent.js'
import {
  SESSION_COOKIE,
  SESSION_DAYS,
  closeSession,
  closeSessionsOf,
  hashPassword,
  openSession,
  readLink,
  sessionAgent,
  useLink,
  verifyPassword,
  weakPassword,
} from './credentials.js'

/**
 * Signing in, under `/api/auth` (D19): the state the sign-in screen starts from, the first
 * supervisor, the password, the links a supervisor hands over, and an identity provider
 * (OpenID Connect, code flow with PKCE). Each success sets the session cookie.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const OIDC_COOKIE = 'chat_oidc'

/** The agents who may sign in: an active supervisor with a password or a provider's identity. */
async function anyoneCanSignIn(db: Db): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(agents)
    .where(
      and(
        eq(agents.active, true),
        eq(agents.role, 'supervisor'),
        person(agents.login),
        or(
          isNotNull(agents.passwordHash),
          sql`exists (select 1 from ${agentIdentities} where ${agentIdentities.agentId} = ${agents.id})`,
        ),
      ),
    )
  return (row?.n ?? 0) > 0
}

async function jsonOf(c: Context): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null)
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Refusal('INVALID_REQUEST', 400)
  }
  return body as Record<string, unknown>
}

const str = (value: unknown) => (typeof value === 'string' ? value : '')

export function authRoutes(deps: {
  readonly db: Db
  readonly config: Config
  readonly settings: Settings
}): Hono {
  const { db, config } = deps
  const auth = new Hono()
  // A quarter of an hour: thirty tries by address — an office shares one —, ten by e-mail.
  const byAddress = new RateLimiter(30, 15 * 60_000)
  const byEmail = new RateLimiter(10, 15 * 60_000)
  const secure = config.publicUrl.startsWith('https:')

  auth.use(
    '*',
    cors({
      origin: config.webOrigin,
      credentials: true,
      allowMethods: ['GET', 'POST'],
      allowHeaders: ['content-type', REQUEST_HEADER],
      maxAge: 600,
    }),
  )
  // Every write here comes from the inbox's own pages: the header says so.
  auth.use('*', async (c, next) => {
    if (c.req.method === 'POST' && !c.req.header(REQUEST_HEADER)) {
      throw new Refusal('INVALID_REQUEST', 400, { header: REQUEST_HEADER })
    }
    await next()
  })

  const address = (c: Context): string => {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    if (config.trustProxy && forwarded) return forwarded
    const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)
      ?.incoming
    return incoming?.socket?.remoteAddress ?? 'local'
  }
  const slow = (c: Context, email = '') => {
    if (!byAddress.allow(address(c)) || (email && !byEmail.allow(email))) {
      throw new Refusal('RATE_LIMITED', 429)
    }
  }

  async function signIn(c: Context, agent: AgentRow): Promise<void> {
    const token = await openSession(db, agent.id, c.req.header('user-agent') ?? null)
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure,
      path: '/',
      maxAge: SESSION_DAYS * 24 * 3600,
    })
  }

  auth.get('/state', async (c) => {
    const token = getCookie(c, SESSION_COOKIE)
    const agent = token ? await sessionAgent(db, token) : null
    return c.json({
      agent: agent ? toAgent(agent) : null,
      setup: !(await anyoneCanSignIn(db)),
      sso: config.oidc?.name ?? null,
    } satisfies AuthState)
  })

  /** The first supervisor — while nobody can sign in. An existing row of the same e-mail is theirs. */
  auth.post('/setup', async (c) => {
    slow(c)
    if (await anyoneCanSignIn(db)) throw new Refusal('SETUP_DONE', 409)
    const body = await jsonOf(c)
    const name = str(body.name).trim()
    const email = str(body.email).trim().toLowerCase()
    const password = str(body.password)
    if (name === '' || name.length > 120)
      throw new Refusal('INVALID_REQUEST', 400, { field: 'name' })
    if (!EMAIL.test(email)) throw new Refusal('INVALID_REQUEST', 400, { field: 'email' })
    if (weakPassword(password, email)) throw new Refusal('PASSWORD_WEAK', 400)
    const passwordHash = await hashPassword(password)
    const values = { name, email, role: 'supervisor' as const, active: true, passwordHash }
    const [agent] = await db
      .insert(agents)
      .values({ login: email, ...values })
      .onConflictDoUpdate({ target: agents.login, set: { ...values, updatedAt: new Date() } })
      .returning()
    if (!agent) throw new Refusal('INTERNAL_ERROR', 500)
    deps.settings.invalidate()
    await signIn(c, agent)
    return c.json(toAgent(agent), 201)
  })

  auth.post('/sign-in', async (c) => {
    const body = await jsonOf(c)
    const email = str(body.email).trim().toLowerCase()
    slow(c, email)
    const [agent] = await db.select().from(agents).where(eq(agents.login, email))
    // The same answer, the same time, for an unknown address and a wrong password.
    const good = await verifyPassword(str(body.password), agent?.passwordHash ?? null)
    if (!agent || !good || !agent.active) throw new Refusal('SIGN_IN_FAILED', 401)
    await signIn(c, agent)
    return c.json(toAgent(agent))
  })

  auth.post('/sign-out', async (c) => {
    const token = getCookie(c, SESSION_COOKIE)
    if (token) await closeSession(db, token)
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure })
    return c.body(null, 204)
  })

  /** One's own password, the current one given again. Every other session ends. */
  auth.post('/password', async (c) => {
    const token = getCookie(c, SESSION_COOKIE)
    const agent = token ? await sessionAgent(db, token) : null
    if (!agent) throw new Refusal('SESSION_INVALID', 401)
    slow(c, agent.login)
    const body = await jsonOf(c)
    const [row] = await db.select().from(agents).where(eq(agents.id, agent.id))
    if (!row?.passwordHash || !(await verifyPassword(str(body.current), row.passwordHash))) {
      throw new Refusal('SIGN_IN_FAILED', 401)
    }
    const next = str(body.next)
    if (weakPassword(next, row.email)) throw new Refusal('PASSWORD_WEAK', 400)
    await db
      .update(agents)
      .set({ passwordHash: await hashPassword(next), updatedAt: new Date() })
      .where(eq(agents.id, agent.id))
    await closeSessionsOf(db, agent.id)
    await signIn(c, row)
    return c.body(null, 204)
  })

  auth.get('/links/:token', async (c) => {
    slow(c)
    const link = await readLink(db, c.req.param('token'))
    if (!link) throw new Refusal('LINK_INVALID', 404)
    return c.json({
      name: link.agent.name,
      email: link.agent.email,
      purpose: link.purpose,
    } satisfies LinkInfo)
  })

  /** A link used: the password chosen, and signed in. */
  auth.post('/links/:token', async (c) => {
    slow(c)
    const link = await readLink(db, c.req.param('token'))
    if (!link) throw new Refusal('LINK_INVALID', 404)
    const password = str((await jsonOf(c)).password)
    if (weakPassword(password, link.agent.email)) throw new Refusal('PASSWORD_WEAK', 400)
    try {
      await useLink(db, link.id, link.agent.id, password)
    } catch {
      throw new Refusal('LINK_INVALID', 404)
    }
    await signIn(c, link.agent)
    return c.json(toAgent(link.agent))
  })

  // ── OpenID Connect ──────────────────────────────────────────────────────────────────

  let discovered: Promise<oidc.Configuration> | null = null
  const provider = () => {
    const settings = config.oidc
    if (!settings) throw new Refusal('SSO_FAILED', 404)
    discovered ??= oidc
      .discovery(
        new URL(settings.issuer),
        settings.clientId,
        settings.clientSecret || undefined,
        undefined,
        // A provider on the developer's machine speaks plain HTTP.
        settings.issuer.startsWith('http:') ? { execute: [oidc.allowInsecureRequests] } : undefined,
      )
      .catch((error: unknown) => {
        discovered = null
        throw error
      })
    return discovered
  }
  const callback = `${config.publicUrl}/api/auth/oidc/callback`
  /** Where to go once signed in: a path of the inbox, never another site. */
  const pathOf = (raw: string | undefined) =>
    raw?.startsWith('/') && !raw.startsWith('//') ? raw : '/'
  const backToInbox = (c: Context, path: string, error?: string) =>
    c.redirect(
      `${config.webOrigin}${error ? `/connexion?erreur=${encodeURIComponent(error)}` : path}`,
    )

  auth.get('/oidc/start', async (c) => {
    slow(c)
    const configuration = await provider().catch(() => {
      throw new Refusal('SSO_FAILED', 502)
    })
    const verifier = oidc.randomPKCECodeVerifier()
    const state = oidc.randomState()
    const nonce = oidc.randomNonce()
    await setSignedCookie(
      c,
      OIDC_COOKIE,
      JSON.stringify({ verifier, state, nonce, next: pathOf(c.req.query('next')) }),
      config.secret,
      { httpOnly: true, sameSite: 'Lax', secure, path: '/api/auth/oidc', maxAge: 600 },
    )
    const url = oidc.buildAuthorizationUrl(configuration, {
      redirect_uri: callback,
      scope: 'openid email profile',
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
      nonce,
    })
    return c.redirect(url.href)
  })

  /**
   * The provider sends the agent back: the code exchanged, the identity read. The agent is
   * the one this identity signed in before, or the one of the same e-mail, verified by
   * the provider — never someone new: agents are invited first.
   */
  auth.get('/oidc/callback', async (c) => {
    const raw = await getSignedCookie(c, config.secret, OIDC_COOKIE)
    deleteCookie(c, OIDC_COOKIE, { path: '/api/auth/oidc', secure })
    if (!raw) return backToInbox(c, '/', 'SSO_FAILED')
    const flow = JSON.parse(raw) as { verifier: string; state: string; nonce: string; next: string }
    try {
      const configuration = await provider()
      const current = new URL(c.req.url)
      const here = new URL(callback)
      current.protocol = here.protocol
      current.host = here.host
      const tokens = await oidc.authorizationCodeGrant(configuration, current, {
        pkceCodeVerifier: flow.verifier,
        expectedState: flow.state,
        expectedNonce: flow.nonce,
        idTokenExpected: true,
      })
      const claims = tokens.claims()
      if (!claims?.sub) return backToInbox(c, '/', 'SSO_FAILED')
      const issuer = configuration.serverMetadata().issuer
      const [linked] = await db
        .select({ agent: agents })
        .from(agentIdentities)
        .innerJoin(agents, eq(agents.id, agentIdentities.agentId))
        .where(and(eq(agentIdentities.issuer, issuer), eq(agentIdentities.subject, claims.sub)))
      let agent = linked?.agent
      const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : null
      if (!agent && email && claims.email_verified !== false) {
        ;[agent] = await db.select().from(agents).where(eq(agents.login, email))
        if (agent) {
          await db
            .insert(agentIdentities)
            .values({ issuer, subject: claims.sub, agentId: agent.id })
            .onConflictDoNothing()
        }
      }
      if (!agent?.active) return backToInbox(c, '/', 'NOT_AN_AGENT')
      await signIn(c, agent)
      return backToInbox(c, flow.next)
    } catch (error) {
      console.warn('chat : connexion OIDC refusée', error instanceof Error ? error.message : error)
      return backToInbox(c, '/', 'SSO_FAILED')
    }
  })

  auth.onError((error, c) => {
    if (error instanceof Refusal) {
      return c.json(
        {
          code: error.code,
          ...(error.details ? { details: error.details } : {}),
        } satisfies ApiError,
        error.status,
      )
    }
    console.error(error)
    return c.json({ code: 'INTERNAL_ERROR' } satisfies ApiError, 500)
  })

  return auth
}
