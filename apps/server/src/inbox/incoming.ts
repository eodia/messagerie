import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { agents, aiRuns, conversations, messages } from '../db/schema.js'
import { signalChange } from '../realtime/signals.js'
import { Refusal } from '../refusal.js'
import { activeAgentIds, notify } from './notifications.js'

/**
 * What reaches a conversation from outside the inbox: a visitor's message — from the
 * widget — and the AI handing over. Both call for an agent's attention, and say so in
 * their signal (the inbox rings) and in the bells of whom they concern.
 */

async function lock(tx: Db, id: string) {
  const [row] = await tx.select().from(conversations).where(eq(conversations.id, id)).for('update')
  if (!row) throw new Refusal('CONVERSATION_NOT_FOUND', 404)
  return row
}

/**
 * A new conversation for a visitor: the AI answers first when the site says so, and the
 * site's default team takes what it hands over.
 */
export async function createConversation(
  db: Db,
  contactId: string,
  site: {
    readonly id: string
    readonly name: string
    readonly aiEnabled: boolean
    readonly defaultTeamId: string | null
  },
): Promise<string> {
  const [row] = await db
    .insert(conversations)
    .values({
      contactId,
      siteId: site.id,
      siteName: site.name,
      status: site.aiEnabled ? 'ai' : 'open',
      teamId: site.defaultTeamId,
    })
    .returning({ id: conversations.id })
  if (!row) throw new Refusal('INTERNAL_ERROR', 500)
  return row.id
}

/**
 * A visitor wrote. While the AI has the conversation, nobody is called: it answers. Once
 * an agent has it, that agent is; unassigned, the inbox rings for everyone and the row
 * waits in « Non assignées ». A resolved conversation opens again.
 */
export async function receiveVisitorMessage(db: Db, id: string, body: string): Promise<void> {
  const text = body.trim()
  if (text === '') throw new Refusal('EMPTY_MESSAGE', 400)
  await db.transaction(async (tx) => {
    const row = await lock(tx, id)
    const at = new Date()
    await tx
      .insert(messages)
      .values({ conversationId: id, author: 'contact', body: text, createdAt: at })
    const status =
      row.status === 'resolved'
        ? row.assigneeId
          ? 'open'
          : 'ai'
        : row.status === 'pending'
          ? 'open'
          : row.status
    await tx
      .update(conversations)
      .set({ status, agentUnread: true, lastMessageAt: at, updatedAt: at })
      .where(eq(conversations.id, id))
    if (status === 'ai') {
      await signalChange(tx, id)
      return
    }
    const told = await notify(tx, [row.assigneeId], id, 'visitor_message')
    await signalChange(tx, id, { alert: 'visitor_message', notify: told })
  })
}

export interface Handoff {
  readonly reason: string
  readonly summary: string
  readonly confidence: number
  /** The agent it goes to; `null` leaves it to the team, and every agent is told. */
  readonly assigneeId: string | null
  readonly team: string
  readonly model: string
}

/** The AI hands the conversation over, with what the agent needs to pick it up. */
export async function handOff(db: Db, id: string, handoff: Handoff): Promise<void> {
  await db.transaction(async (tx) => {
    await lock(tx, id)
    const [assignee] = handoff.assigneeId
      ? await tx.select().from(agents).where(eq(agents.id, handoff.assigneeId))
      : []
    const at = new Date()
    const [run] = await tx
      .insert(aiRuns)
      .values({
        conversationId: id,
        kind: 'answer',
        model: handoff.model,
        output: { handoff: handoff.reason },
        confidence: handoff.confidence,
        createdAt: at,
      })
      .returning()
    await tx.insert(messages).values({
      conversationId: id,
      author: 'ai',
      kind: 'handoff',
      meta: {
        handoff: {
          reason: handoff.reason,
          summary: handoff.summary,
          confidence: handoff.confidence,
          assignee: assignee?.name ?? '',
          team: handoff.team,
        },
      },
      aiRunId: run?.id ?? null,
      createdAt: at,
    })
    await tx
      .update(conversations)
      .set({
        status: 'open',
        assigneeId: assignee?.id ?? null,
        summary: handoff.summary,
        agentUnread: true,
        updatedAt: at,
      })
      .where(eq(conversations.id, id))
    const told = await notify(
      tx,
      assignee ? [assignee.id] : await activeAgentIds(tx),
      id,
      'handoff',
    )
    await signalChange(tx, id, { alert: 'handoff', notify: told })
  })
}
