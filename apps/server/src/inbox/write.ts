import type {
  Agent,
  Conversation,
  ConversationEvent,
  Feedback,
  SendMessageBody,
  TransferBody,
} from '@chat/contracts'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { isIntegration } from '../api/tokens.js'
import type { Db } from '../db/client.js'
import {
  accessLog,
  agents,
  aiFeedback,
  attachments,
  conversations,
  hiddenMessages,
  messages,
  notifications,
} from '../db/schema.js'
import type { AttachRows } from '../files/attachments.js'
import type { FileStore } from '../files/store.js'
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
  /** The rows of the files sent with it, given the message's id. */
  attach?: AttachRows,
): Promise<Conversation> {
  const body = request.body.trim()
  if (body === '' && !attach) throw new Refusal('EMPTY_MESSAGE', 400)

  await db.transaction(async (tx) => {
    const row = await lock(tx, id)
    const tick = clock()
    const withFiles = async (messageId: string | undefined) => {
      if (attach && messageId) await tx.insert(attachments).values(attach(messageId))
    }

    if (request.kind === 'note') {
      const at = tick()
      const [note] = await tx
        .insert(messages)
        .values({
          conversationId: id,
          author: 'agent',
          kind: 'note',
          agentId: agent.id,
          body,
          createdAt: at,
        })
        .returning({ id: messages.id })
      await withFiles(note?.id)
      await tx.update(conversations).set({ updatedAt: at }).where(eq(conversations.id, id))
    } else {
      // Answering a resolved conversation opens it again, and says so.
      if (row.status === 'resolved') {
        await tx
          .insert(messages)
          .values(eventRow(id, { type: 'reopened', agent: agent.name }, tick()))
      }
      const sentAt = tick()
      const [sent] = await tx
        .insert(messages)
        .values({
          conversationId: id,
          author: 'agent',
          kind: 'text',
          agentId: agent.id,
          body,
          createdAt: sentAt,
        })
        .returning({ id: messages.id })
      await withFiles(sent?.id)
      if (request.resolve) {
        await tx
          .insert(messages)
          .values(eventRow(id, { type: 'resolved', agent: agent.name }, tick()))
      }
      // An agent who writes to the visitor while the AI has the conversation takes it — a
      // program writing through a token does not: the conversation stays in the queue.
      const taking = (row.status === 'ai' || row.assigneeId === null) && !isIntegration(agent)
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
      .set({ status: 'resolved', snoozedUntil: null, agentUnread: false, updatedAt: at })
      .where(eq(conversations.id, id))
    await signalChange(tx, id)
  })
  return loadConversation(db, id, agent)
}

/** The furthest a conversation is put on hold: a year. */
const SNOOZE_MAX_MS = 366 * 24 * 3600_000

/**
 * « Mettre en attente » until `until`: off the queue and read, back at that time — or
 * sooner, when the visitor writes. Only a conversation agents answer: not one the AI has,
 * not a resolved one. Its assignee keeps it.
 */
export async function snooze(
  db: Db,
  agent: AgentRow,
  id: string,
  until: Date,
): Promise<Conversation> {
  const time = until.getTime()
  const now = Date.now()
  if (Number.isNaN(time) || time < now + 60_000 || time > now + SNOOZE_MAX_MS) {
    throw new Refusal('INVALID_REQUEST', 400, { field: 'until' })
  }
  await db.transaction(async (tx) => {
    const row = await lock(tx, id)
    if (row.status === 'ai' || row.status === 'resolved') throw new Refusal('NOT_SNOOZABLE', 409)
    const at = clock()()
    await tx
      .insert(messages)
      .values(eventRow(id, { type: 'snoozed', agent: agent.name, until: until.toISOString() }, at))
    await tx
      .update(conversations)
      .set({ status: 'pending', snoozedUntil: until, agentUnread: false, updatedAt: at })
      .where(eq(conversations.id, id))
    await signalChange(tx, id)
  })
  return loadConversation(db, id, agent)
}

/**
 * Back from on hold: woken by an agent, or by its time (`agent` null) — then it is unread
 * again, and its assignee is told.
 */
export async function wake(db: Db, agent: AgentRow | null, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await lock(tx, id)
    if (row.status !== 'pending') return
    const at = clock()()
    await tx.insert(messages).values(eventRow(id, { type: 'woke', agent: agent?.name ?? null }, at))
    await tx
      .update(conversations)
      .set({
        status: 'open',
        snoozedUntil: null,
        ...(agent === null ? { agentUnread: true } : {}),
        updatedAt: at,
      })
      .where(eq(conversations.id, id))
    if (agent !== null) {
      await signalChange(tx, id)
      return
    }
    const told = await notify(tx, [row.assigneeId], id, 'woke')
    await signalChange(tx, id, { alert: 'woke', notify: told })
  })
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

/** A message of the thread, the way its deletion reads it — `null` if not in this one. */
async function messageOf(tx: Db, conversationId: string, messageId: string) {
  const [row] = await tx
    .select({
      kind: messages.kind,
      author: messages.author,
      agentId: messages.agentId,
      deletedAt: messages.deletedAt,
    })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.conversationId, conversationId)))
  if (!row) throw new Refusal('MESSAGE_NOT_FOUND', 404)
  // An event or a handoff is the conversation's story, not something said.
  if (row.kind !== 'text' && row.kind !== 'note') throw new Refusal('MESSAGE_NOT_DELETABLE', 400)
  return row
}

/**
 * Whether an agent may delete a message for everyone: their own reply or note; a
 * supervisor, any message — a card number a visitor typed, an answer of the AI.
 */
export function mayDeleteForAll(
  agent: Pick<AgentRow, 'id' | 'role'>,
  message: { readonly author: string; readonly agentId: string | null },
): boolean {
  return agent.role === 'supervisor' || (message.author === 'agent' && message.agentId === agent.id)
}

/**
 * « Supprimer pour moi »: the message leaves this agent's view of the thread, and nobody
 * else's. Theirs alone: no signal.
 */
export async function hideMessage(
  db: Db,
  agent: AgentRow,
  conversationId: string,
  messageId: string,
): Promise<Conversation> {
  await messageOf(db, conversationId, messageId)
  await db.insert(hiddenMessages).values({ messageId, agentId: agent.id }).onConflictDoNothing()
  return loadConversation(db, conversationId, agent)
}

/**
 * « Supprimer pour tout le monde »: the message's words and files are gone — for the
 * visitor, the team and the AI —, « Ce message a été supprimé » in their place, with who
 * deleted it and when. The AI's trace of an answer stays: it is the evaluation's (D9).
 */
export async function deleteMessage(
  db: Db,
  agent: AgentRow,
  conversationId: string,
  messageId: string,
  store: FileStore,
): Promise<Conversation> {
  const keys = await db.transaction(async (tx) => {
    await lock(tx, conversationId)
    const message = await messageOf(tx, conversationId, messageId)
    if (message.deletedAt) return []
    if (!mayDeleteForAll(agent, message)) throw new Refusal('NOT_ALLOWED', 403)
    const files = await tx
      .delete(attachments)
      .where(eq(attachments.messageId, messageId))
      .returning({ key: attachments.storageKey })
    await tx
      .update(messages)
      .set({ body: '', meta: {}, deletedAt: new Date(), deletedBy: agent.id })
      .where(eq(messages.id, messageId))
    await signalChange(tx, conversationId)
    return files.map((f) => f.key)
  })
  // The bytes, once the rows are gone: a file left behind is a purge's, a row is not.
  await Promise.all(keys.map((key) => store.remove(key).catch(() => undefined)))
  return loadConversation(db, conversationId, agent)
}

/** The agents a conversation can be given to. */
export async function listAgents(db: Db, settings: Settings | null = null): Promise<Agent[]> {
  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.active, true))
    .orderBy(asc(agents.name))
  // Their teams, from « Conseillers »: whom to suggest for a conversation of a team.
  const entries = settings ? await settings.agents().catch(() => []) : []
  const teams = new Map(entries.map((e) => [e.id, e.teamIds]))
  return rows.map((row) => ({ ...toAgent(row), teamIds: teams.get(row.id) ?? [] }))
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
