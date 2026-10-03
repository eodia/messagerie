import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { agents, aiRuns, attachments, conversations, messages } from '../db/schema.js'
import type { AttachRows } from '../files/attachments.js'
import { signalChange } from '../realtime/signals.js'
import { Refusal } from '../refusal.js'
import type { Access } from './access.js'
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
 * A new conversation for a visitor: the AI answers first when the site says so; it
 * arrives in the site's inbox, whose default team — or the site's — takes what the AI
 * hands over.
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
  route: { readonly inboxId: string | null; readonly teamId: string | null } | null = null,
  /** Where the visitor writes from, when not the widget: an SMS number (D23), an address (D24). */
  held:
    | { readonly channel: 'sms' | 'rcs'; readonly smsNumberId: string }
    | { readonly channel: 'email'; readonly emailAddressId: string }
    | null = null,
): Promise<string> {
  const [row] = await db
    .insert(conversations)
    .values({
      contactId,
      siteId: site.id,
      siteName: site.name,
      status: site.aiEnabled ? 'ai' : 'open',
      inboxId: route?.inboxId ?? null,
      teamId: route ? route.teamId : site.defaultTeamId,
      ...(held ?? {}),
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
export async function receiveVisitorMessage(
  db: Db,
  id: string,
  body: string,
  /** The rows of the files sent with it, given the message's id. */
  attach?: AttachRows,
  /** An SMS, an RCS, an e-mail: its id where it came from, and the channel it came by (D23, D24). */
  inbound?: {
    readonly providerId: string
    readonly channel: 'sms' | 'rcs' | 'email'
    readonly subject?: string | null
  },
): Promise<void> {
  const text = body.trim()
  if (text === '' && !attach) throw new Refusal('EMPTY_MESSAGE', 400)
  await db.transaction(async (tx) => {
    const row = await lock(tx, id)
    const at = new Date()
    const [message] = await tx
      .insert(messages)
      .values({
        conversationId: id,
        author: 'contact',
        body: text,
        meta: inbound
          ? {
              providerId: inbound.providerId,
              ...(inbound.channel === 'email'
                ? { email: { subject: inbound.subject ?? null } }
                : {}),
            }
          : {},
        createdAt: at,
      })
      .returning({ id: messages.id })
    if (attach && message) await tx.insert(attachments).values(attach(message.id))
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
      .set({
        status,
        snoozedUntil: null,
        agentUnread: true,
        lastMessageAt: at,
        updatedAt: at,
        // RCS, SMS, e-mail: the answers go back by what the visitor last wrote with.
        ...(inbound ? { channel: inbound.channel } : {}),
      })
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
  /** The team it goes to, when known: the conversation is now theirs. */
  readonly teamId?: string | null
  readonly model: string
  /** The trace of the decision to hand over, when the AI already recorded it. */
  readonly runId?: string
}

/**
 * The AI hands the conversation over, with what the agent needs to pick it up. Left to the
 * team, it rings for those who answer in its inbox (`access`) — or for every agent.
 */
export async function handOff(
  db: Db,
  id: string,
  handoff: Handoff,
  access: Access | null = null,
): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await lock(tx, id)
    const [assignee] = handoff.assigneeId
      ? await tx.select().from(agents).where(eq(agents.id, handoff.assigneeId))
      : []
    const at = new Date()
    const runId =
      handoff.runId ??
      (
        await tx
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
      )[0]?.id ??
      null
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
      aiRunId: runId,
      createdAt: at,
    })
    await tx
      .update(conversations)
      .set({
        status: 'open',
        assigneeId: assignee?.id ?? null,
        ...(handoff.teamId ? { teamId: handoff.teamId } : {}),
        summary: handoff.summary,
        agentUnread: true,
        updatedAt: at,
      })
      .where(eq(conversations.id, id))
    const told = await notify(
      tx,
      assignee
        ? [assignee.id]
        : access
          ? await access.audience(tx, row.inboxId, handoff.teamId ?? row.teamId)
          : await activeAgentIds(tx),
      id,
      'handoff',
    )
    await signalChange(tx, id, { alert: 'handoff', notify: told })
  })
}
