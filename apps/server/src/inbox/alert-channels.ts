import type { AlertChannels, PushSubscriptionBody } from '@chat/contracts'
import { and, count, eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { agents, pushSubscriptions } from '../db/schema.js'
import { type VapidKeys, knownPushService } from '../outbound/push.js'
import { Refusal } from '../refusal.js'
import type { AgentRow } from './read.js'

/**
 * An agent's alerts beyond the open inbox (D23), as the menu of their account sets them:
 * the devices that get them by Web Push — a phone, mostly —, and their mailbox.
 */

const addressOf = (agent: AgentRow) =>
  agent.email ?? (agent.login.includes('@') ? agent.login : null)

export async function alertChannels(
  db: Db,
  agent: AgentRow,
  keys: VapidKeys,
  emailAvailable: boolean,
): Promise<AlertChannels> {
  const [devices] = await db
    .select({ n: count() })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.agentId, agent.id))
  const [row] = await db
    .select({ email: agents.emailAlerts })
    .from(agents)
    .where(eq(agents.id, agent.id))
  return {
    pushKey: keys.publicKey,
    devices: devices?.n ?? 0,
    emailAvailable,
    email: row?.email ?? false,
    address: addressOf(agent),
  }
}

export async function setEmailAlerts(db: Db, agent: AgentRow, raw: unknown): Promise<void> {
  if (typeof raw !== 'boolean') throw new Refusal('INVALID_REQUEST', 400, { field: 'email' })
  await db
    .update(agents)
    .set({ emailAlerts: raw, updatedAt: new Date() })
    .where(eq(agents.id, agent.id))
}

function readSubscription(raw: Record<string, unknown>): PushSubscriptionBody {
  const keys = (typeof raw.keys === 'object' && raw.keys !== null ? raw.keys : {}) as Record<
    string,
    unknown
  >
  const endpoint = typeof raw.endpoint === 'string' ? raw.endpoint : ''
  const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh : ''
  const auth = typeof keys.auth === 'string' ? keys.auth : ''
  if (!knownPushService(endpoint)) throw new Refusal('PUSH_REJECTED', 400)
  // A P-256 point (65 bytes) and a 16-byte secret, in base64url.
  if (
    Buffer.from(p256dh, 'base64url').length !== 65 ||
    Buffer.from(auth, 'base64url').length !== 16
  ) {
    throw new Refusal('INVALID_REQUEST', 400, { field: 'keys' })
  }
  return { endpoint, keys: { p256dh, auth } }
}

/** This device gets the agent's alerts — taken from whoever had it before on it. */
export async function subscribeDevice(
  db: Db,
  agent: AgentRow,
  raw: Record<string, unknown>,
  userAgent: string | null,
): Promise<void> {
  const body = readSubscription(raw)
  const values = {
    agentId: agent.id,
    p256dh: body.keys.p256dh,
    auth: body.keys.auth,
    userAgent: userAgent?.slice(0, 300) ?? null,
  }
  await db
    .insert(pushSubscriptions)
    .values({ endpoint: body.endpoint, ...values })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values })
}

/** This device gets them no more. */
export async function unsubscribeDevice(db: Db, agent: AgentRow, endpoint: unknown): Promise<void> {
  if (typeof endpoint !== 'string') throw new Refusal('INVALID_REQUEST', 400, { field: 'endpoint' })
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.agentId, agent.id), eq(pushSubscriptions.endpoint, endpoint)))
}
