import { randomUUID } from 'node:crypto'
import type { ConversationSummary, Message } from '@chat/contracts'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { changeEvents, webhookDeliveries, webhooks } from '../db/schema.js'
import { loadMessagesById, loadSummaries } from '../inbox/read.js'
import { signature, unseal } from './seal.js'
import { allowedTarget } from './target.js'

/**
 * The webhooks' postman (D17) — basedb's: every two seconds, what the triggers captured
 * becomes one delivery per webhook that listens; what is due goes out, fifty events at
 * most to a call, signed, in order per conversation — never globally.
 *
 * - 2xx: delivered. 5xx, 408, 429, a timeout or no answer: tried again later, eight
 *   times over a day and a half — `Retry-After` heard when longer. Anything else: failed.
 * - A webhook whose fifty last deliveries all failed is stopped (`failures`).
 * - A call taken and never finished — the process died — is free again two minutes on:
 *   an event may come twice, never be lost. Receivers deduplicate by its `id`.
 * - Events are kept seven days, deliveries ninety.
 */

const BATCH = 50
const LEASE = '2 minutes'
const TIMEOUT_MS = 10_000
const ATTEMPTS = 8
/** Seconds before the next try, after the 1st, 2nd… failed one. */
const BACKOFF = [10, 30, 120, 600, 3600, 21_600, 86_400, 86_400]
const DISABLE_AFTER = 50
const PASS_MS = 2000
const SWEEP_MS = 60 * 60_000

export const USER_AGENT = 'messagerie-webhook/1'

/** What a webhook receives: events, and what they are about as it is now. */
export interface WebhookEvent {
  readonly id: string
  readonly type: string
  readonly occurredAt: string
  readonly conversation?: ConversationSummary
  readonly message?: Message
  readonly webhook?: { readonly id: string; readonly label: string }
}

/** What happened in the conversations, made into deliveries for the webhooks that listen. */
async function fanOut(db: Db): Promise<void> {
  await db.execute(sql`
    with batch as (
      select id, type, conversation_id, inbox_id, webhook_id, occurred_at
      from chat.change_event
      where drained_at is null
      order by occurred_at
      limit 1000
      for update skip locked
    ), made as (
      insert into chat.webhook_delivery (webhook_id, event_id, partition_key, created_at)
      select w.id, b.id, w.id::text || ':' || coalesce(b.conversation_id, b.id)::text, b.occurred_at
      from batch b
      join chat.webhook w on w.is_active and w.deleted_at is null and (
        case when b.webhook_id is not null then w.id = b.webhook_id
        else b.type = any(w.events) and (w.inbox_ids is null or b.inbox_id = any(w.inbox_ids))
        end)
      returning 1
    )
    update chat.change_event set drained_at = now()
    where id in (select id from batch)`)
}

interface Claimed {
  readonly id: string
  readonly webhookId: string
  readonly eventId: string
  readonly attempts: number
}

/**
 * What may go now: due, its webhook active, and nothing before it in its conversation
 * still waiting or on its way. One claim at a time, all processes together — the order
 * of a conversation is that of its claims.
 */
async function claim(db: Db): Promise<Claimed[]> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('messagerie.webhooks.claim'))`)
    await tx.execute(sql`
      update chat.webhook_delivery set status = 'pending', lease_until = null
      where status = 'in_flight' and lease_until < now()`)
    const { rows } = await tx.execute<{
      id: string
      webhook_id: string
      event_id: string
      attempts: number
      ord: string
    }>(sql`
      with open as (
        select d.id, d.webhook_id, d.created_at,
          bool_and(d.status = 'pending' and d.next_attempt_at <= now() and w.is_active)
            over (partition by d.partition_key order by d.created_at, d.id) as ready
        from chat.webhook_delivery d
        join chat.webhook w on w.id = d.webhook_id and w.deleted_at is null
        where d.status in ('pending', 'in_flight')
      ), chosen as (
        select id,
          row_number() over (partition by webhook_id order by created_at, id) as rank,
          row_number() over (order by created_at, id) as ord
        from open where ready
      )
      update chat.webhook_delivery d
      set status = 'in_flight', lease_until = now() + ${LEASE}::interval,
        attempts = d.attempts + 1
      from chosen c
      where d.id = c.id and c.rank <= ${BATCH * 4}
      returning d.id, d.webhook_id, d.event_id, d.attempts, c.ord`)
    // In their order: a conversation's events go out as they happened.
    return rows
      .sort((a, b) => Number(a.ord) - Number(b.ord))
      .map((r) => ({
        id: r.id,
        webhookId: r.webhook_id,
        eventId: r.event_id,
        attempts: r.attempts,
      }))
  })
}

/** The events of a call, written now: what a conversation and a message are at sending. */
async function bodyOf(db: Db, eventIds: readonly string[]): Promise<WebhookEvent[]> {
  const rows = await db
    .select({
      id: changeEvents.id,
      type: changeEvents.type,
      occurredAt: changeEvents.occurredAt,
      conversationId: changeEvents.conversationId,
      messageId: changeEvents.messageId,
      webhookId: changeEvents.webhookId,
      label: webhooks.label,
    })
    .from(changeEvents)
    .leftJoin(webhooks, eq(webhooks.id, changeEvents.webhookId))
    .where(inArray(changeEvents.id, [...eventIds]))
  const conversationIds = [
    ...new Set(rows.flatMap((r) => (r.conversationId ? [r.conversationId] : []))),
  ]
  const summaries = new Map(
    (await loadSummaries(db, conversationIds)).map((s) => [s.id, s] as const),
  )
  const said = await loadMessagesById(
    db,
    rows.flatMap((r) => (r.messageId ? [r.messageId] : [])),
  )
  const order = new Map(eventIds.map((id, i) => [id, i]))
  return rows
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .map((r) => {
      const conversation = r.conversationId ? summaries.get(r.conversationId) : undefined
      const message = r.messageId ? said.get(r.messageId) : undefined
      return {
        id: r.id,
        type: r.type,
        occurredAt: r.occurredAt.toISOString(),
        ...(conversation ? { conversation } : {}),
        ...(message ? { message } : {}),
        ...(r.webhookId ? { webhook: { id: r.webhookId, label: r.label ?? '' } } : {}),
      }
    })
}

type Outcome =
  | { readonly kind: 'delivered'; readonly status: number }
  | {
      readonly kind: 'retry' | 'failed'
      readonly status: number | null
      readonly code: string
      readonly retryAfter?: number
    }

function retryAfter(header: string | null): number | undefined {
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds)
  const at = Date.parse(header)
  return Number.isNaN(at) ? undefined : Math.max(0, (at - Date.now()) / 1000)
}

/** One signed call: its verdict, never an exception. */
async function post(
  url: string,
  secret: string,
  webhookId: string,
  body: string,
): Promise<Outcome> {
  if (!(await allowedTarget(url))) return { kind: 'failed', status: null, code: 'TARGET_REJECTED' }
  try {
    const answer = await fetch(url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        'user-agent': USER_AGENT,
        'x-messagerie-signature': signature(secret, body),
        'x-messagerie-delivery-id': randomUUID(),
        'x-messagerie-webhook-id': webhookId,
      },
      body,
    })
    await answer.body?.cancel().catch(() => {})
    const status = answer.status
    if (status >= 200 && status < 300) return { kind: 'delivered', status }
    if (status >= 500 || status === 408 || status === 429) {
      return {
        kind: 'retry',
        status,
        code: `HTTP_${status}`,
        retryAfter: retryAfter(answer.headers.get('retry-after')),
      }
    }
    return {
      kind: 'failed',
      status,
      code: status >= 300 && status < 400 ? 'REDIRECT' : `HTTP_${status}`,
    }
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return { kind: 'retry', status: null, code: timedOut ? 'TIMEOUT' : 'NETWORK' }
  }
}

/** When to try again after the `attempts`-th failed try: the backoff, ±20 %. */
export function nextDelay(attempts: number, after?: number): number {
  const base = BACKOFF[Math.min(attempts, BACKOFF.length) - 1] ?? 86_400
  const jittered = base * (0.8 + Math.random() * 0.4)
  return Math.max(jittered, after ?? 0)
}

/** A webhook whose last fifty finished deliveries all failed stops, by itself. */
async function stopIfFailing(db: Db, webhookId: string): Promise<void> {
  const { rows } = await db.execute<{ finished: number; failed: number }>(sql`
    select count(*)::int as finished, count(*) filter (where status = 'failed')::int as failed
    from (
      select status from chat.webhook_delivery
      where webhook_id = ${webhookId} and status in ('delivered', 'failed')
      order by coalesce(delivered_at, created_at) desc, created_at desc
      limit ${DISABLE_AFTER}
    ) last`)
  const seen = rows[0]
  if (!seen || seen.finished < DISABLE_AFTER || seen.failed < DISABLE_AFTER) return
  await db
    .update(webhooks)
    .set({ isActive: false, disabledReason: 'failures', updatedAt: new Date() })
    .where(and(eq(webhooks.id, webhookId), eq(webhooks.isActive, true)))
  console.warn(`chat : webhook ${webhookId} arrêté après ${DISABLE_AFTER} échecs`)
}

async function settle(db: Db, batch: readonly Claimed[], outcome: Outcome): Promise<void> {
  const ids = batch.map((d) => d.id)
  if (outcome.kind === 'delivered') {
    await db
      .update(webhookDeliveries)
      .set({
        status: 'delivered',
        responseCode: outcome.status,
        errorCode: null,
        deliveredAt: new Date(),
        leaseUntil: null,
      })
      .where(inArray(webhookDeliveries.id, ids))
    return
  }
  // A batch's deliveries were claimed together; their tries may differ — each its own.
  for (const delivery of batch) {
    const again = outcome.kind === 'retry' && delivery.attempts < ATTEMPTS
    await db
      .update(webhookDeliveries)
      .set({
        status: again ? 'pending' : 'failed',
        responseCode: outcome.status,
        errorCode: outcome.code,
        leaseUntil: null,
        ...(again
          ? {
              nextAttemptAt: new Date(
                Date.now() + nextDelay(delivery.attempts, outcome.retryAfter) * 1000,
              ),
            }
          : {}),
      })
      .where(eq(webhookDeliveries.id, delivery.id))
  }
}

/** One pass: capture into deliveries, then send what is due. Exported for the tests. */
export async function deliverWebhooks(db: Db, key: string): Promise<void> {
  await fanOut(db)
  const claimed = await claim(db)
  if (claimed.length === 0) return
  const byWebhook = new Map<string, Claimed[]>()
  for (const delivery of claimed) {
    byWebhook.set(delivery.webhookId, [...(byWebhook.get(delivery.webhookId) ?? []), delivery])
  }
  const targets = await db
    .select()
    .from(webhooks)
    .where(inArray(webhooks.id, [...byWebhook.keys()]))
  await Promise.all(
    targets.map(async (target) => {
      const all = byWebhook.get(target.id) ?? []
      let secret: string
      try {
        secret = unseal(target.signingSecret, key)
      } catch {
        // `CHAT_SECRET` changed: the secret cannot sign any more — a new webhook is needed.
        await settle(db, all, { kind: 'failed', status: null, code: 'SECRET_UNREADABLE' })
        return
      }
      for (let i = 0; i < all.length; i += BATCH) {
        const batch = all.slice(i, i + BATCH)
        const events = await bodyOf(
          db,
          batch.map((d) => d.eventId),
        )
        const outcome = await post(target.targetUrl, secret, target.id, JSON.stringify({ events }))
        await settle(db, batch, outcome)
        if (outcome.kind !== 'delivered') {
          if (outcome.kind === 'failed') await stopIfFailing(db, target.id)
          // The rest would come after a failure in their conversation: they wait.
          const rest = all.slice(i + BATCH).map((d) => d.id)
          if (rest.length > 0) {
            await db
              .update(webhookDeliveries)
              .set({
                status: 'pending',
                attempts: sql`${webhookDeliveries.attempts} - 1`,
                leaseUntil: null,
              })
              .where(inArray(webhookDeliveries.id, rest))
          }
          return
        }
      }
    }),
  )
}

/** Events kept seven days — unless a delivery still names them —, deliveries ninety. */
export async function sweepWebhooks(db: Db): Promise<void> {
  await db.execute(sql`
    delete from chat.webhook_delivery
    where created_at < now() - interval '90 days'
      and status in ('delivered', 'failed', 'abandoned')`)
  await db.execute(sql`
    delete from chat.change_event e
    where e.occurred_at < now() - interval '7 days' and e.drained_at is not null
      and not exists (select 1 from chat.webhook_delivery d where d.event_id = e.id)`)
}

/** The postman at work, until `stop`. */
export function startWebhooks(db: Db, key: string): { stop(): Promise<void> } {
  let running: Promise<void> | null = null
  let stopped = false
  const pass = () => {
    if (running || stopped) return
    running = deliverWebhooks(db, key)
      .catch((error) => console.error('chat : webhooks', error))
      .finally(() => {
        running = null
      })
  }
  const passes = setInterval(pass, PASS_MS)
  const sweep = () => void sweepWebhooks(db).catch((e) => console.error('chat : webhooks', e))
  const sweeps = setInterval(sweep, SWEEP_MS)
  sweep()
  return {
    stop: async () => {
      stopped = true
      clearInterval(passes)
      clearInterval(sweeps)
      await running
    },
  }
}
