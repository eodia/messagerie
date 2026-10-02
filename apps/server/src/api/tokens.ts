import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import type {
  ApiToken,
  CreateTokenBody,
  CreatedToken,
  TokenAccess,
  TokenSurface,
} from '@chat/contracts'
import { desc, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Db } from '../db/client.js'
import { agents, apiTokens } from '../db/schema.js'
import type { Access, Visible } from '../inbox/access.js'
import type { AgentRow } from '../inbox/read.js'
import { Refusal } from '../refusal.js'

/**
 * The tokens of the public API and the MCP server (D16) — basedb's integration tokens, for
 * the chat:
 *
 * - `msg_<prefix>_<secret>`: an 8-character prefix kept in clear, to tell tokens apart; a
 *   secret of 32 random bytes in base 62, of which only the SHA-256 is kept — a token is
 *   long and random, a slow hash would cost every call for nothing (basedb's reasoning);
 * - `read`, or `write` — read, reply, note, assign, resolve, tag; never delete —, on the
 *   REST API, the MCP server or both, over some inboxes or all those its creator sees;
 * - no expiry by default, or 1 to 365 days; revoked at once; never shown again once
 *   created; managed by supervisors from the inbox, never by a token.
 *
 * A token acts through an agent row of its own, never active (`token:<id>`): listed
 * nowhere, told nothing, it names what it writes — « Zapier » in the thread.
 */

export const TOKEN = /^msg_([a-z0-9]{8})_([0-9A-Za-z]{43})$/
const PREFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const LABEL_MAX = 200
/** A verdict kept this long: a program calling ten times a second asks the base once. */
const CACHE_MS = 5000
/** `last_used_at` written at most this often per token. */
const TOUCH_MS = 5 * 60_000

/** The marker of a token's agent row. */
const INTEGRATION = 'token:'
export const isIntegration = (agent: Pick<AgentRow, 'login'>): boolean =>
  agent.login.startsWith(INTEGRATION)

function base62(bytes: Uint8Array): string {
  let value = BigInt(`0x${Buffer.from(bytes).toString('hex')}`)
  let out = ''
  while (value > 0n) {
    out = (BASE62[Number(value % 62n)] as string) + out
    value /= 62n
  }
  return out.padStart(43, '0')
}

const sha256 = (secret: string) => createHash('sha256').update(secret).digest('hex')

function newToken(): { readonly token: string; readonly prefix: string; readonly hash: string } {
  const prefix = Array.from({ length: 8 }, () => PREFIX_ALPHABET[randomInt(36)]).join('')
  const secret = base62(randomBytes(32))
  return { token: `msg_${prefix}_${secret}`, prefix, hash: sha256(secret) }
}

type TokenRow = typeof apiTokens.$inferSelect

function toApiToken(row: TokenRow, creator: string | null): ApiToken {
  return {
    id: row.id,
    label: row.label,
    prefix: `msg_${row.tokenPrefix}`,
    access: row.access,
    surfaces: row.surfaces as TokenSurface[],
    inboxIds: row.inboxIds,
    createdBy: creator ?? '—',
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  }
}

// ── Managed from the inbox, by supervisors ───────────────────────────────────────────

function supervisor(agent: AgentRow): void {
  if (agent.role !== 'supervisor') throw new Refusal('NOT_ALLOWED', 403)
}

export async function listTokens(db: Db, agent: AgentRow): Promise<ApiToken[]> {
  supervisor(agent)
  const creator = alias(agents, 'creator')
  const rows = await db
    .select({ token: apiTokens, creator: creator.name })
    .from(apiTokens)
    .leftJoin(creator, eq(creator.id, apiTokens.createdBy))
    .orderBy(desc(apiTokens.createdAt))
  return rows.map((r) => toApiToken(r.token, r.creator))
}

/** What a creation asks, checked: a label, rights, where, for how long. */
export function readCreateBody(raw: Record<string, unknown>): CreateTokenBody {
  const { label, access, surfaces, inboxIds, expiresInDays } = raw
  const named = typeof label === 'string' ? label.trim() : ''
  if (named === '' || named.length > LABEL_MAX) {
    throw new Refusal('INVALID_REQUEST', 400, { field: 'label', max: LABEL_MAX })
  }
  if (access !== 'read' && access !== 'write') {
    throw new Refusal('INVALID_REQUEST', 400, { field: 'access', expected: 'read | write' })
  }
  const where = Array.isArray(surfaces)
    ? [...new Set(surfaces.filter((s): s is TokenSurface => s === 'rest' || s === 'mcp'))]
    : []
  if (where.length === 0) {
    throw new Refusal('INVALID_REQUEST', 400, { field: 'surfaces', expected: 'rest, mcp' })
  }
  if (
    inboxIds !== null &&
    (!Array.isArray(inboxIds) ||
      inboxIds.length === 0 ||
      inboxIds.length > 100 ||
      !inboxIds.every((id) => typeof id === 'string' && id !== ''))
  ) {
    throw new Refusal('INVALID_REQUEST', 400, { field: 'inboxIds' })
  }
  if (
    expiresInDays !== null &&
    (typeof expiresInDays !== 'number' ||
      !Number.isInteger(expiresInDays) ||
      expiresInDays < 1 ||
      expiresInDays > 365)
  ) {
    throw new Refusal('INVALID_REQUEST', 400, { field: 'expiresInDays', min: 1, max: 365 })
  }
  return {
    label: named,
    access: access as TokenAccess,
    surfaces: where,
    inboxIds: inboxIds as string[] | null,
    expiresInDays: expiresInDays as number | null,
  }
}

/** A new token, and its agent row. Its secret is in the answer, and nowhere else, ever. */
export async function createToken(
  db: Db,
  agent: AgentRow,
  body: CreateTokenBody,
): Promise<CreatedToken> {
  supervisor(agent)
  const made = newToken()
  const row = await db.transaction(async (tx) => {
    const [actor] = await tx
      .insert(agents)
      .values({
        login: `${INTEGRATION}${made.prefix}`,
        name: body.label,
        role: 'agent',
        // Never active: listed nowhere, rung for nothing.
        active: false,
      })
      .returning({ id: agents.id })
    if (!actor) throw new Error('token agent not created')
    const [token] = await tx
      .insert(apiTokens)
      .values({
        label: body.label,
        tokenPrefix: made.prefix,
        tokenHash: made.hash,
        access: body.access,
        surfaces: [...body.surfaces],
        inboxIds: body.inboxIds ? [...body.inboxIds] : null,
        agentId: actor.id,
        createdBy: agent.id,
        expiresAt:
          body.expiresInDays === null
            ? null
            : new Date(Date.now() + body.expiresInDays * 86_400_000),
      })
      .returning()
    if (!token) throw new Error('token not created')
    return token
  })
  return { token: toApiToken(row, agent.name), secret: made.token }
}

export async function revokeToken(db: Db, agent: AgentRow, id: string): Promise<void> {
  supervisor(agent)
  const [row] = await db
    .update(apiTokens)
    .set({ revokedAt: new Date(), revokedBy: agent.id })
    .where(eq(apiTokens.id, id))
    .returning({ id: apiTokens.id })
  if (!row) throw new Refusal('TOKEN_NOT_FOUND', 404)
  verified.clear()
}

// ── Taken by a program ───────────────────────────────────────────────────────────────

/** Who a token is, once checked: the agent it acts as, what it may, and where. */
export interface TokenContext {
  readonly token: TokenRow
  readonly actor: AgentRow
  readonly write: boolean
  /** The inboxes it reaches, its own limit within its creator's: null, every one. */
  readonly visible: Visible
}

const verified = new Map<string, { readonly at: number; readonly context: TokenContext }>()
const touched = new Map<string, number>()

/** The bearer of a request, when it is a token of the chat. */
export function bearerToken(header: string | undefined): string | null {
  const value = header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  return value.startsWith('msg_') ? value : null
}

/**
 * The token a request carries, for a surface: refused when it is malformed, unknown,
 * for another surface, revoked, expired, or when its creator no longer answers.
 */
export async function openToken(
  db: Db,
  access: Access,
  raw: string | null,
  surface: TokenSurface,
): Promise<TokenContext> {
  const parts = raw ? TOKEN.exec(raw) : null
  const secret = parts?.[2]
  if (!secret) throw new Refusal('TOKEN_INVALID', 401)
  const hash = sha256(secret)
  const now = Date.now()
  const kept = verified.get(hash)
  const context = kept && now - kept.at < CACHE_MS ? kept.context : await lookUp(db, access, hash)
  verified.set(hash, { at: now, context })
  if (verified.size > 1000) verified.delete(verified.keys().next().value as string)

  if (!context.token.surfaces.includes(surface)) throw new Refusal('TOKEN_INVALID', 401)
  if (context.token.revokedAt) throw new Refusal('TOKEN_REVOKED', 401)
  if (context.token.expiresAt && context.token.expiresAt.getTime() <= now) {
    throw new Refusal('TOKEN_EXPIRED', 401)
  }
  // Used: said at most every five minutes, outside the request's way.
  if (now - (touched.get(context.token.id) ?? 0) > TOUCH_MS) {
    touched.set(context.token.id, now)
    void db
      .update(apiTokens)
      .set({ lastUsedAt: new Date(now) })
      .where(eq(apiTokens.id, context.token.id))
      .catch(() => undefined)
  }
  return context
}

async function lookUp(db: Db, access: Access, hash: string): Promise<TokenContext> {
  const actor = alias(agents, 'actor')
  const creator = alias(agents, 'creator')
  const [row] = await db
    .select({ token: apiTokens, actor, creator })
    .from(apiTokens)
    .innerJoin(actor, eq(actor.id, apiTokens.agentId))
    .innerJoin(creator, eq(creator.id, apiTokens.createdBy))
    .where(eq(apiTokens.tokenHash, hash))
  // The lookup was by hash; the comparison, in constant time all the same.
  if (!row || !timingSafeEqual(Buffer.from(row.token.tokenHash, 'hex'), Buffer.from(hash, 'hex'))) {
    throw new Refusal('TOKEN_INVALID', 401)
  }
  // Its creator gone from « Conseillers »: the token goes with them.
  if (!row.creator.active) throw new Refusal('TOKEN_INVALID', 401)
  const theirs = await access.visibleTo(row.creator)
  const own = row.token.inboxIds ? new Set(row.token.inboxIds) : null
  const visible =
    own === null ? theirs : theirs === null ? own : new Set([...own].filter((id) => theirs.has(id)))
  return { token: row.token, actor: row.actor, write: row.token.access === 'write', visible }
}

/** A write, by a token: refused to a read-only one. */
export function writing(context: TokenContext): void {
  if (!context.write) throw new Refusal('TOKEN_READ_ONLY', 403)
}
