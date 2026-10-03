import type { BulkAction, BulkResult, ErrorCode } from '@chat/contracts'
import { inArray } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { conversations } from '../db/schema.js'
import { Refusal } from '../refusal.js'
import type { Settings } from '../settings/settings.js'
import { type Access, canSee } from './access.js'
import type { AgentRow } from './read.js'
import { addTag } from './tags.js'
import { assign, markRead, resolve, snooze, transfer } from './write.js'

/**
 * The conversations ticked in the list, acted on at once — each one by the write it has
 * alone, in its own transaction, locked and signalled as ever (D6). One refused leaves the
 * others done: the answer says which, and why. Only conversations the agent sees.
 */

const MAX_IDS = 100
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const invalid = (field: string): never => {
  throw new Refusal('INVALID_REQUEST', 400, { field })
}

export function readBulk(raw: unknown): { ids: string[]; action: BulkAction } {
  const body = record(raw)
  if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > MAX_IDS) {
    invalid('ids')
  }
  const ids = [...new Set((body.ids as unknown[]).map(String))]
  if (!ids.every((id) => UUID.test(id))) invalid('ids')
  const action = record(body.action)
  const text = (key: string) => (typeof action[key] === 'string' ? (action[key] as string) : null)
  switch (action.type) {
    case 'resolve':
    case 'read':
      return { ids, action: { type: action.type } }
    case 'assign': {
      // `null` puts them back in the queue; anything else must name an agent.
      const assigneeId = action.assigneeId === null ? null : text('assigneeId')
      if (assigneeId === null && action.assigneeId !== null) invalid('assigneeId')
      if (assigneeId !== null && !UUID.test(assigneeId)) invalid('assigneeId')
      return { ids, action: { type: 'assign', assigneeId } }
    }
    case 'tag':
      return { ids, action: { type: 'tag', label: text('label') ?? invalid('label') } }
    case 'snooze':
      return { ids, action: { type: 'snooze', until: text('until') ?? invalid('until') } }
    case 'transfer': {
      const inboxId = text('inboxId')
      const teamId = action.teamId === null ? null : text('teamId')
      if (inboxId === null && action.teamId === undefined) invalid('inboxId')
      return {
        ids,
        action: {
          type: 'transfer',
          ...(inboxId !== null ? { inboxId } : {}),
          ...(action.teamId !== undefined ? { teamId } : {}),
          ...(text('note')?.trim() ? { note: (text('note') as string).slice(0, 4000) } : {}),
        },
      }
    }
    default:
      return invalid('action')
  }
}

export interface BulkDeps {
  readonly db: Db
  readonly settings: Settings | null
  readonly access: Access
  /** A conversation resolved: what follows for the AI (its summary, its memory). */
  readonly resolved?: (id: string) => void
}

export async function actOnMany(
  deps: BulkDeps,
  agent: AgentRow,
  raw: unknown,
): Promise<BulkResult> {
  const { db, settings, access } = deps
  const { ids, action } = readBulk(raw)
  if (action.type === 'transfer' && !settings) throw new Refusal('INVALID_REQUEST', 400)
  const visible = await access.visibleTo(agent)
  const rows = await db
    .select({ id: conversations.id, inboxId: conversations.inboxId })
    .from(conversations)
    .where(inArray(conversations.id, ids))
  const seen = new Set(rows.filter((r) => canSee(visible, r.inboxId)).map((r) => r.id))

  const done: string[] = []
  const refused: { id: string; code: ErrorCode }[] = []
  // One after the other: each write locks its conversation, and an agent's batch is small.
  for (const id of ids) {
    if (!seen.has(id)) {
      refused.push({ id, code: 'CONVERSATION_NOT_FOUND' })
      continue
    }
    try {
      switch (action.type) {
        case 'resolve':
          await resolve(db, agent, id)
          deps.resolved?.(id)
          break
        case 'read':
          await markRead(db, agent, id)
          break
        case 'assign':
          await assign(db, agent, id, action.assigneeId)
          break
        case 'tag':
          await addTag(db, settings, agent, id, action.label)
          break
        case 'snooze':
          await snooze(db, agent, id, new Date(action.until))
          break
        case 'transfer': {
          const { type: _, ...body } = action
          await transfer(db, settings as Settings, access, agent, id, body)
          break
        }
      }
      done.push(id)
    } catch (error) {
      if (!(error instanceof Refusal)) throw error
      refused.push({ id, code: error.code })
    }
  }
  return { done, refused }
}
