import type { Conversation, TagOption } from '@chat/contracts'
import { and, eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { conversationTags, conversations } from '../db/schema.js'
import { signalChange } from '../realtime/signals.js'
import { Refusal } from '../refusal.js'
import type { Settings } from '../settings/settings.js'
import { type AgentRow, loadConversation } from './read.js'

/**
 * The tags an agent puts on a conversation, or takes off: those « Étiquettes » defines,
 * in its colour — or a new one, grey, for what the list does not have yet.
 */

const UNLISTED = '#64748b'
const MAX_LABEL = 40

export async function tagOptions(settings: Settings | null): Promise<TagOption[]> {
  if (!settings) return []
  return (await settings.tags()).map(({ name, color, when }) => ({ name, color, when }))
}

export async function addTag(
  db: Db,
  settings: Settings | null,
  agent: AgentRow,
  id: string,
  raw: unknown,
): Promise<Conversation> {
  const label = typeof raw === 'string' ? raw.trim() : ''
  if (label === '' || label.length > MAX_LABEL) {
    throw new Refusal('INVALID_REQUEST', 400, { field: 'label' })
  }
  const listed = (await tagOptions(settings)).find(
    (t) => t.name.toLocaleLowerCase() === label.toLocaleLowerCase(),
  )
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, id))
      .for('update')
    if (!row) throw new Refusal('CONVERSATION_NOT_FOUND', 404)
    await tx
      .insert(conversationTags)
      .values({
        conversationId: id,
        label: listed?.name ?? label,
        color: listed?.color ?? UNLISTED,
        origin: 'agent',
      })
      .onConflictDoNothing()
    await signalChange(tx, id)
  })
  return loadConversation(db, id, agent)
}

export async function removeTag(
  db: Db,
  agent: AgentRow,
  id: string,
  label: string,
): Promise<Conversation> {
  await db.transaction(async (tx) => {
    await tx
      .delete(conversationTags)
      .where(and(eq(conversationTags.conversationId, id), eq(conversationTags.label, label)))
    await signalChange(tx, id)
  })
  return loadConversation(db, id, agent)
}
