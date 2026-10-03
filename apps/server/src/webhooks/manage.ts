import type {
  CreateWebhookBody,
  CreatedWebhook,
  Webhook,
  WebhookDelivery,
  WebhookEventType,
} from '@chat/contracts'
import { and, desc, eq, inArray, isNull, max } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { agents, changeEvents, webhookDeliveries, webhooks } from '../db/schema.js'
import type { AgentRow } from '../inbox/read.js'
import { Refusal } from '../refusal.js'
import { newSigningSecret, seal } from './seal.js'
import { allowedTarget } from './target.js'

/**
 * The webhooks, managed from the inbox by supervisors (D17) — basedb's: a name, an HTTPS
 * address, the events it is told of, its inboxes. Its signing secret is shown once. It can
 * be stopped, resumed, deleted — kept stopped, for its log —, and sent a test.
 */

export const EVENT_TYPES: readonly WebhookEventType[] = [
  'conversation.created',
  'message.created',
  'message.deleted',
  'conversation.handed_off',
  'conversation.assigned',
  'conversation.transferred',
  'conversation.resolved',
  'conversation.reopened',
  'survey.answered',
]

const LABEL_MAX = 200

function supervisor(agent: AgentRow): void {
  if (agent.role !== 'supervisor') throw new Refusal('NOT_ALLOWED', 403)
}

type Row = typeof webhooks.$inferSelect

function toWebhook(row: Row, creator: string | null, last: Date | string | null): Webhook {
  return {
    id: row.id,
    label: row.label,
    url: row.targetUrl,
    events: row.events as WebhookEventType[],
    inboxIds: row.inboxIds,
    active: row.isActive,
    disabledReason: row.isActive ? null : row.disabledReason === 'failures' ? 'failures' : 'manual',
    createdBy: creator ?? '—',
    createdAt: row.createdAt.toISOString(),
    lastDeliveryAt: last ? new Date(last).toISOString() : null,
  }
}

async function owned(db: Db, id: string): Promise<Row> {
  const [row] = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.id, id), isNull(webhooks.deletedAt)))
  if (!row) throw new Refusal('WEBHOOK_NOT_FOUND', 404)
  return row
}

export async function listWebhooks(db: Db, agent: AgentRow): Promise<Webhook[]> {
  supervisor(agent)
  const rows = await db
    .select({ webhook: webhooks, creator: agents.name })
    .from(webhooks)
    .leftJoin(agents, eq(agents.id, webhooks.createdBy))
    .where(isNull(webhooks.deletedAt))
    .orderBy(desc(webhooks.createdAt))
  const last = rows.length
    ? await db
        .select({ id: webhookDeliveries.webhookId, at: max(webhookDeliveries.deliveredAt) })
        .from(webhookDeliveries)
        .where(
          inArray(
            webhookDeliveries.webhookId,
            rows.map((r) => r.webhook.id),
          ),
        )
        .groupBy(webhookDeliveries.webhookId)
    : []
  const lastOf = new Map(last.map((l) => [l.id, l.at]))
  return rows.map((r) => toWebhook(r.webhook, r.creator, lastOf.get(r.webhook.id) ?? null))
}

export function readWebhookBody(raw: Record<string, unknown>): CreateWebhookBody {
  const { label, url, events, inboxIds } = raw
  const named = typeof label === 'string' ? label.trim() : ''
  if (named === '' || named.length > LABEL_MAX) {
    throw new Refusal('INVALID_REQUEST', 400, { field: 'label', max: LABEL_MAX })
  }
  if (typeof url !== 'string' || url.length > 2000) {
    throw new Refusal('INVALID_REQUEST', 400, { field: 'url' })
  }
  const chosen = Array.isArray(events)
    ? [...new Set(events.filter((e): e is WebhookEventType => EVENT_TYPES.includes(e)))]
    : []
  if (chosen.length === 0) {
    throw new Refusal('INVALID_REQUEST', 400, { field: 'events', expected: EVENT_TYPES })
  }
  if (
    inboxIds !== null &&
    (!Array.isArray(inboxIds) ||
      inboxIds.length === 0 ||
      !inboxIds.every((id) => typeof id === 'string' && id !== ''))
  ) {
    throw new Refusal('INVALID_REQUEST', 400, { field: 'inboxIds' })
  }
  return { label: named, url: url.trim(), events: chosen, inboxIds: inboxIds as string[] | null }
}

export async function createWebhook(
  db: Db,
  key: string,
  agent: AgentRow,
  body: CreateWebhookBody,
): Promise<CreatedWebhook> {
  supervisor(agent)
  if (!(await allowedTarget(body.url))) throw new Refusal('WEBHOOK_TARGET_REJECTED', 422)
  const secret = newSigningSecret()
  const [row] = await db
    .insert(webhooks)
    .values({
      label: body.label,
      targetUrl: body.url,
      signingSecret: seal(secret, key),
      events: [...body.events],
      inboxIds: body.inboxIds ? [...body.inboxIds] : null,
      createdBy: agent.id,
    })
    .returning()
  if (!row) throw new Error('webhook not created')
  return { webhook: toWebhook(row, agent.name, null), secret }
}

/** Stopped by someone, or resumed — its address checked again first. */
export async function setWebhookActive(
  db: Db,
  agent: AgentRow,
  id: string,
  active: boolean,
): Promise<void> {
  supervisor(agent)
  const row = await owned(db, id)
  if (active && !(await allowedTarget(row.targetUrl))) {
    throw new Refusal('WEBHOOK_TARGET_REJECTED', 422)
  }
  await db
    .update(webhooks)
    .set({ isActive: active, disabledReason: active ? null : 'manual', updatedAt: new Date() })
    .where(eq(webhooks.id, id))
}

/** Deleted: stopped for good, kept for its log; what waited to go is abandoned. */
export async function deleteWebhook(db: Db, agent: AgentRow, id: string): Promise<void> {
  supervisor(agent)
  await owned(db, id)
  await db.transaction(async (tx) => {
    await tx
      .update(webhooks)
      .set({ isActive: false, disabledReason: 'manual', deletedAt: new Date() })
      .where(eq(webhooks.id, id))
    await tx
      .update(webhookDeliveries)
      .set({ status: 'abandoned' })
      .where(
        and(
          eq(webhookDeliveries.webhookId, id),
          inArray(webhookDeliveries.status, ['pending', 'in_flight']),
        ),
      )
  })
}

/** The last calls of a webhook, the newest first. */
export async function webhookLog(
  db: Db,
  agent: AgentRow,
  id: string,
  limit = 30,
): Promise<WebhookDelivery[]> {
  supervisor(agent)
  await owned(db, id)
  const rows = await db
    .select({
      delivery: webhookDeliveries,
      type: changeEvents.type,
      conversationId: changeEvents.conversationId,
    })
    .from(webhookDeliveries)
    .innerJoin(changeEvents, eq(changeEvents.id, webhookDeliveries.eventId))
    .where(eq(webhookDeliveries.webhookId, id))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(limit)
  return rows.map(({ delivery, type, conversationId }) => ({
    id: delivery.id,
    type: type as WebhookDelivery['type'],
    conversationId: conversationId ?? '',
    status: delivery.status as WebhookDelivery['status'],
    attempts: delivery.attempts,
    responseCode: delivery.responseCode,
    errorCode: delivery.errorCode,
    createdAt: delivery.createdAt.toISOString(),
    deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
    nextAttemptAt: delivery.status === 'pending' ? delivery.nextAttemptAt.toISOString() : null,
  }))
}

/** A test: one `webhook.ping` event, for this webhook only — sent at the next pass. */
export async function pingWebhook(db: Db, agent: AgentRow, id: string): Promise<void> {
  supervisor(agent)
  const row = await owned(db, id)
  if (!row.isActive) throw new Refusal('INVALID_REQUEST', 400, { reason: 'stopped' })
  await db.insert(changeEvents).values({ type: 'webhook.ping', webhookId: id })
}
