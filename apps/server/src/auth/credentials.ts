import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { and, eq, gt, isNull, lt } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { agents, invitations, sessions } from '../db/schema.js'
import type { AgentRow } from '../inbox/read.js'

/**
 * The agents' credentials (D19): their password, their sessions, the links a supervisor
 * hands over. Nothing is kept that would let one sign in: a password as scrypt, a session
 * or a link as SHA-256 of its token.
 */

// ── Passwords ─────────────────────────────────────────────────────────────────────────

const N = 16_384
const R = 8
const P = 1
const KEY_LENGTH = 64
export const PASSWORD_MIN = 8

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((done, fail) =>
    scrypt(
      password.normalize('NFKC'),
      salt,
      KEY_LENGTH,
      { N: n, r, p, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? fail(error) : done(key)),
    ),
  )
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await derive(password, salt, N, R, P)
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$')
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const [kind, n, r, p, salt, key] = stored?.split('$') ?? []
  if (kind !== 'scrypt' || !salt || !key) {
    // The same work for an account without a password: the time says nothing.
    await derive(password, randomBytes(16), N, R, P)
    return false
  }
  const expected = Buffer.from(key, 'base64url')
  const actual = await derive(
    password,
    Buffer.from(salt, 'base64url'),
    Number(n),
    Number(r),
    Number(p),
  )
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** A password one may choose: eight characters at least, not the e-mail. */
export function weakPassword(password: string, email: string | null): boolean {
  return (
    password.length < PASSWORD_MIN ||
    password.length > 200 ||
    (email !== null && password.toLowerCase() === email.toLowerCase())
  )
}

// ── Tokens ────────────────────────────────────────────────────────────────────────────

const sha256 = (token: string) => createHash('sha256').update(token).digest('hex')
const newToken = (prefix: string) => `${prefix}_${randomBytes(32).toString('base64url')}`

// ── Sessions ──────────────────────────────────────────────────────────────────────────

export const SESSION_COOKIE = 'chat_session'
export const SESSION_DAYS = 30
const SESSION_MS = SESSION_DAYS * 24 * 3600_000
/** Its last use written at most this often — not at every request. */
const TOUCH_MS = 10 * 60_000
/** A session's verdict kept this long in the process: a busy inbox asks the base rarely. */
const CACHE_MS = 10_000

const known = new Map<string, { agent: AgentRow | null; until: number }>()

export async function openSession(
  db: Db,
  agentId: string,
  userAgent: string | null,
): Promise<string> {
  const token = newToken('ses')
  const now = new Date()
  await db.insert(sessions).values({
    agentId,
    tokenHash: sha256(token),
    userAgent: userAgent?.slice(0, 300) ?? null,
    expiresAt: new Date(now.getTime() + SESSION_MS),
  })
  await db.update(agents).set({ lastSignInAt: now }).where(eq(agents.id, agentId))
  return token
}

/** The active agent a session token is worth — null for one unknown, expired, or gone. */
export async function sessionAgent(db: Db, token: string): Promise<AgentRow | null> {
  const hash = sha256(token)
  const now = Date.now()
  const hit = known.get(hash)
  if (hit && hit.until > now) return hit.agent
  const [row] = await db
    .select({ agent: agents, session: sessions })
    .from(sessions)
    .innerJoin(agents, eq(agents.id, sessions.agentId))
    .where(and(eq(sessions.tokenHash, hash), gt(sessions.expiresAt, new Date(now))))
  const agent = row?.agent.active ? row.agent : null
  if (row && agent && now - row.session.lastSeenAt.getTime() > TOUCH_MS) {
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(now), expiresAt: new Date(now + SESSION_MS) })
      .where(eq(sessions.id, row.session.id))
  }
  if (known.size > 5000) known.clear()
  known.set(hash, { agent, until: now + CACHE_MS })
  return agent
}

export async function closeSession(db: Db, token: string): Promise<void> {
  const hash = sha256(token)
  known.delete(hash)
  await db.delete(sessions).where(eq(sessions.tokenHash, hash))
}

/** Every session of an agent ended — a new password, a deactivation. */
export async function closeSessionsOf(db: Db, agentId: string): Promise<void> {
  known.clear()
  await db.delete(sessions).where(eq(sessions.agentId, agentId))
}

/** The expired sessions and links, forgotten. */
export async function sweepCredentials(db: Db): Promise<void> {
  const now = new Date()
  await db.delete(sessions).where(lt(sessions.expiresAt, now))
  await db.delete(invitations).where(lt(invitations.expiresAt, now))
}

// ── Links: an invitation, a new password ──────────────────────────────────────────────

const LINK_MS = 7 * 24 * 3600_000

/** A link for `agentId`, the previous ones of the same purpose voided. Its token, once. */
export async function issueLink(
  db: Db,
  agentId: string,
  purpose: 'invite' | 'reset',
  createdBy: string | null,
): Promise<string> {
  const token = newToken('inv')
  await db.transaction(async (tx) => {
    await tx
      .delete(invitations)
      .where(and(eq(invitations.agentId, agentId), isNull(invitations.usedAt)))
    await tx.insert(invitations).values({
      agentId,
      tokenHash: sha256(token),
      purpose,
      createdBy,
      expiresAt: new Date(Date.now() + LINK_MS),
    })
  })
  return token
}

/** What a link is for, while it is good: the agent and the purpose. */
export async function readLink(
  db: Db,
  token: string,
): Promise<{ agent: AgentRow; purpose: 'invite' | 'reset'; id: string } | null> {
  const [row] = await db
    .select({ agent: agents, link: invitations })
    .from(invitations)
    .innerJoin(agents, eq(agents.id, invitations.agentId))
    .where(
      and(
        eq(invitations.tokenHash, sha256(token)),
        isNull(invitations.usedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    )
  if (!row || !row.agent.active) return null
  return { agent: row.agent, purpose: row.link.purpose, id: row.link.id }
}

/** A link used: its agent's password set, every other session of theirs ended. */
export async function useLink(db: Db, linkId: string, agentId: string, password: string) {
  const hash = await hashPassword(password)
  await db.transaction(async (tx) => {
    const [used] = await tx
      .update(invitations)
      .set({ usedAt: new Date() })
      .where(and(eq(invitations.id, linkId), isNull(invitations.usedAt)))
      .returning({ id: invitations.id })
    if (!used) throw new Error('link already used')
    await tx
      .update(agents)
      .set({ passwordHash: hash, updatedAt: new Date() })
      .where(eq(agents.id, agentId))
  })
  await closeSessionsOf(db, agentId)
}
