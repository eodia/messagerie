import type {
  Agent,
  Conversation,
  ConversationEvent,
  Feedback,
  SendMessageBody,
  TransferBody,
} from '@chat/contracts'
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import {
  accessLog,
  agents,
  aiFeedback,
  conversations,
  messages,
  notifications,
} from '../db/schema.js'
import { signalChange } from '../realtime/signals.js'
import { Refusal } from '../refusal.js'
import type { Settings } from '../settings/settings.js'
import type { Access } from './access.js'
import { notify } from './notifications.js'
import { type AgentRow, loadConversation, toAgent } from './read.js'

/**
 * The agents' writes. Each one runs in a transaction that locks the conversation, so that
 * two agents acting at once apply one after the other rather than over each other, and
 * each one signals its change from inside that transaction (D6). Each returns the
 * conversation as the acting agent now sees it.
 */

type Row = typeof conversations.$inferSelect

async function lock(tx: Db, id: string): Promise<Row> {
  const [row] = await tx.select().from(conversations).where(eq(conversations.id, id)).for('update')
  if (!row) throw new Refusal('CONVERSATION_NOT_FOUND', 404)
  return row
}

/**
 * Timestamps for the rows of one write, a millisecond apart: a transaction's `now()` is
 * the same for all of them, and a thread is ordered by time.
 */
function clock(): () => Date {
  let at = Date.now()
  return () => new Date(at++)
}

function eventRow(conversationId: string, event: ConversationEvent, createdAt: Date) {
  return {
    conversationId,
    author: 'system' as const,
    kind: 'event' as const,
    meta: { event },
    createdAt,
  }
}

/** An agent opened the conversation: it is read, and the access journal says who. */
export async function markRead(db: Db, agent: AgentRow, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await lock(tx, id)
    await tx.insert(accessLog).values({ agentId: agent.id, conversationId: id })
    // Opening it answers the bell too: its lines for this agent are read.
    const bell = await tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.agentId, agent.id),
          eq(notifications.conversationId, id),
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id })
    if (row.agentUnread) {
      await tx.update(conversations).set({ agentUnread: false }).where(eq(conversations.id, id))
    }
    if (row.agentUnread || bell.length > 0) {
      await signalChange(tx, id, bell.length > 0 ? { notify: [agent.id] } : {})
    }
  })
}

export async function sendMessage(
  db: Db,
  agent: AgentRow,
  id: string,
  request: SendMessageBody,
): Promise<Conversation> {
  const body = request.body.trim()
  if (body === '') throw new Refusal('EMPTY_MESSAGE', 400)

  await db.transaction(async (tx) => {
    const row = await lock(tx, id)
    const tick = clock()

    if (request.kind === 'note') {
      const at = tick()
      await tx.insert(messages).values({
        conversationId: id,
        author: 'agent',
        kind: 'note',
        agentId: agent.id,
        body,
        createdAt: at,
      })
      await tx.update(conversations).set({ updatedAt: at }).where(eq(conversations.id, id))
    } else {
      // Answering a resolved conversation opens it again, and says so.
      if (row.status === 'resolved') {
        await tx
          .insert(messages)
          .values(eventRow(id, { type: 'reopened', agent: agent.name }, tick()))
      }
      const sentAt = tick()
      await tx.insert(messages).values({
        conversationId: id,
        author: 'agent',
        kind: 'text',
        agentId: agent.id,
        body,
        createdAt: sentAt,
      })
      if (request.resolve) {
        await tx
          .insert(messages)
          .values(eventRow(id, { type: 'resolved', agent: agent.name }, tick()))
      }
      // An agent who writes to the visitor while the AI has the conversation takes it.
      const taking = row.status === 'ai' || row.assigneeId === null
      await tx
        .update(conversations)
        .set({
          status: request.resolve
            ? 'resolved'
            : row.status === 'ai' || row.status === 'resolved'
              ? 'open'
              : row.status,
          assigneeId: taking ? agent.id : row.assigneeId,
          agentUnread: false,
          lastMessageAt: sentAt,
          updatedAt: sentAt,
        })
        .where(eq(conversations.id, id))
    }
    await signalChange(tx, id)
  })
  return loadConversation(db, id, agent)
}

/** The agent takes the conversation from the AI, which stops answering there. */
export async function takeOver(db: Db, agent: AgentRow, id: string): Promise<Conversation> {
  await db.transaction(async (tx) => {
    const row = await lock(tx, id)
    if (row.status !== 'ai') return
    const at = clock()()
    await tx.insert(messages).values(eventRow(id, { type: 'takeover', agent: agent.name }, at))
    await tx
      .update(conversations)
      .set({ status: 'open', assigneeId: agent.id, updatedAt: at })
      .where(eq(conversations.id, id))
    await signalChange(tx, id)
  })
  return loadConversation(db, id, agent)
}

export async function resolve(db: Db, agent: AgentRow, id: string): Promise<Conversation> {
  await db.transaction(async (tx) => {
    const row = await lock(tx, id)
    if (row.status === 'resolved') return
    const at = clock()()
    await tx.insert(messages).values(eventRow(id, { type: 'resolved', agent: agent.name }, at))
    await tx
      .update(conversations)
      .set({ status: 'resolved', agentUnread: false, updatedAt: at })
      .where(eq(conversations.id, id))
    await signalChange(tx, id)
  })
  return loadConversation(db, id, agent)
}

/**
 * The agent's verdict on an answer of the AI — or its withdrawal. These rows are the
 * evaluation set (D9). A verdict is the agent's own: no signal, nobody else's inbox changes.
 */
export async function setFeedback(
  db: Db,
  agent: AgentRow,
  conversationId: string,
  messageId: string,
  action: Feedback | null,
): Promise<Conversation> {
  const [message] = await db
    .select({ author: messages.author, kind: messages.kind, aiRunId: messages.aiRunId })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.conversationId, conversationId)))
  if (!message) throw new Refusal('MESSAGE_NOT_FOUND', 404)
  const runId = message.aiRunId
  if (message.author !== 'ai' || message.kind !== 'text' || runId === null) {
    throw new Refusal('NOT_AN_AI_ANSWER', 400)
  }

  if (action === null) {
    await db
      .delete(aiFeedback)
      .where(and(eq(aiFeedback.aiRunId, runId), eq(aiFeedback.agentId, agent.id)))
  } else {
    await db
      .insert(aiFeedback)
      .values({ aiRunId: runId, agentId: agent.id, action })
      .onConflictDoUpdate({
        target: [aiFeedback.aiRunId, aiFeedback.agentId],
        set: { action, createdAt: new Date() },
      })
  }
  return loadConversation(db, conversationId, agent)
}

/** The agents a conversation can be given to. */
export async function listAgents(db: Db): Promise<Agent[]> {
  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.active, true))
    .orderBy(asc(agents.name))
  return rows.map(toAgent)
}

/**
 * Gives the conversation to an agent — or back to the queue with `null`. Given to a
 * person, it leaves the AI. The one who receives it is told, unless they gave it to
 * themselves.
 */
export async function assign(
  db: Db,
  agent: AgentRow,
  id: string,
  assigneeId: string | null,
): Promise<Conversation> {
  await db.transaction(async (tx) => {
    const row = await lock(tx, id)
    if (row.assigneeId === assigneeId) return
    let assignee: AgentRow | undefined
    if (assigneeId !== null) {
      ;[assignee] = await tx
        .select()
        .from(agents)
        .where(and(eq(agents.id, assigneeId), eq(agents.active, true)))
      if (!assignee) throw new Refusal('AGENT_NOT_FOUND', 404)
    }
    const at = clock()()
    await tx
      .insert(messages)
      .values(eventRow(id, { type: 'assigned', agent: assignee?.name ?? null, by: agent.name }, at))
    await tx
      .update(conversations)
      .set({
        assigneeId,
        status: row.status === 'ai' && assigneeId !== null ? 'open' : row.status,
        updatedAt: at,
      })
      .where(eq(conversations.id, id))
    const told =
      assignee && assignee.id !== agent.id
        ? await notify(tx, [assignee.id], id, 'assigned', agent.id)
        : []
    await signalChange(tx, id, told.length > 0 ? { alert: 'assigned', notify: told } : {})
  })
  return loadConversation(db, id, agent)
}

/**
 * Moves the conversation to another inbox, another team, or both — back to the queue of
 * whoever answers there: it leaves its assignee, and the AI. The inbox rings for them, and
 * a note, when given, waits for them in the thread.
 */
export async function transfer(
  db: Db,
  settings: Settings,
  access: Access,
  agent: AgentRow,
  id: string,
  body: TransferBody,
): Promise<Conversation> {
  const [inboxes, teams] = await Promise.all([settings.inboxes(), settings.teams()])
  await db.transaction(async (tx) => {
    const row = await lock(tx, id)
    const target =
      body.inboxId === undefined
        ? (inboxes.find((i) => i.id === row.inboxId) ?? null)
        : (inboxes.find((i) => i.id === body.inboxId && i.active) ?? null)
    if (body.inboxId !== undefined && !target) throw new Refusal('INBOX_NOT_FOUND', 404)

    let teamId: string | null
    if (body.teamId !== undefined) {
      teamId = body.teamId
      const serves = !target || target.teamIds.length === 0 || target.teamIds.includes(teamId ?? '')
      if (teamId !== null && (!teams.some((t) => t.id === teamId) || !serves)) {
        throw new Refusal('TEAM_NOT_FOUND', 404)
      }
    } else {
      teamId = body.inboxId === undefined ? row.teamId : (target?.defaultTeamId ?? null)
    }
    const inboxId = target?.id ?? row.inboxId
    if (inboxId === row.inboxId && teamId === row.teamId) return

    const at = clock()
    const team = teams.find((t) => t.id === teamId)
    const event: ConversationEvent = {
      type: 'transferred',
      by: agent.name,
      ...(inboxId !== row.inboxId && target ? { inbox: target.name } : {}),
      ...(teamId !== row.teamId && team ? { team: team.name } : {}),
    }
    await tx.insert(messages).values(eventRow(id, event, at()))
    const note = body.note?.trim()
    if (note) {
      await tx.insert(messages).values({
        conversationId: id,
        author: 'agent',
        kind: 'note',
        agentId: agent.id,
        body: note,
        createdAt: at(),
      })
    }
    await tx
      .update(conversations)
      .set({
        inboxId,
        teamId,
        assigneeId: null,
        status: row.status === 'resolved' ? 'resolved' : 'open',
        agentUnread: true,
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, id))
    const audience = (await access.audience(tx, inboxId, teamId)).filter((a) => a !== agent.id)
    const told = await notify(tx, audience, id, 'transferred', agent.id)
    await signalChange(tx, id, told.length > 0 ? { alert: 'transferred', notify: told } : {})
  })
  return loadConversation(db, id, agent)
}
