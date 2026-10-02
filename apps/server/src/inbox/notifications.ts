import type { AlertKind, NotificationList } from '@chat/contracts'
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Db } from '../db/client.js'
import { agents, contacts, conversations, notifications } from '../db/schema.js'
import { signalNotifications } from '../realtime/signals.js'
import type { AgentRow } from './read.js'

/**
 * The agents' bells. A line is written in the transaction of what caused it, and read
 * when the agent opens the conversation — or marks everything read.
 */

/**
 * Puts a line in each agent's bell, or brings their unread one for the same conversation
 * and cause back to the top. Returns the agents notified, for the change signal.
 */
export async function notify(
  tx: Db,
  agentIds: readonly (string | null)[],
  conversationId: string,
  kind: AlertKind,
  byAgentId: string | null = null,
  /** What an automation says. */
  text: string | null = null,
): Promise<string[]> {
  const targets = [...new Set(agentIds.filter((id): id is string => id !== null))]
  if (targets.length === 0) return []
  const now = new Date()
  await tx
    .insert(notifications)
    .values(
      targets.map((agentId) => ({
        agentId,
        conversationId,
        kind,
        byAgentId,
        text,
        createdAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [notifications.agentId, notifications.conversationId, notifications.kind],
      targetWhere: sql`read_at is null`,
      set: { createdAt: now, byAgentId, text },
    })
  return targets
}

/** Every active agent — who is told when nobody in particular is. */
export async function activeAgentIds(tx: Db): Promise<string[]> {
  const rows = await tx.select({ id: agents.id }).from(agents).where(eq(agents.active, true))
  return rows.map((r) => r.id)
}

export async function listNotifications(db: Db, agent: AgentRow): Promise<NotificationList> {
  const by = alias(agents, 'by_agent')
  const rows = await db
    .select({ notification: notifications, contactName: contacts.name, by: by.name })
    .from(notifications)
    .innerJoin(conversations, eq(conversations.id, notifications.conversationId))
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .leftJoin(by, eq(by.id, notifications.byAgentId))
    .where(eq(notifications.agentId, agent.id))
    .orderBy(desc(notifications.createdAt))
    .limit(50)
  const [total] = await db
    .select({ unread: count() })
    .from(notifications)
    .where(and(eq(notifications.agentId, agent.id), isNull(notifications.readAt)))
  return {
    unread: total?.unread ?? 0,
    items: rows.map(({ notification, contactName, by }) => ({
      id: notification.id,
      kind: notification.kind,
      conversationId: notification.conversationId,
      contactName,
      by,
      text: notification.text,
      at: notification.createdAt.toISOString(),
      read: notification.readAt !== null,
    })),
  }
}

/**
 * Marks the agent's notifications read — of one conversation, or all of them — and tells
 * their other tabs. Returns whether anything was unread.
 */
export async function readNotifications(
  db: Db,
  agent: AgentRow,
  conversationId?: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const read = await tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.agentId, agent.id),
          isNull(notifications.readAt),
          conversationId ? eq(notifications.conversationId, conversationId) : undefined,
        ),
      )
      .returning({ id: notifications.id })
    if (read.length > 0) await signalNotifications(tx, [agent.id])
    return read.length > 0
  })
}
