import type {
  Agent,
  ContactDetail,
  ContactListItem,
  Conversation,
  ConversationStatus,
  ConversationSummary,
  MessageHit,
} from '@chat/contracts'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { conversations } from '../db/schema.js'
import { canSee } from '../inbox/access.js'
import { contactDetail, listContacts } from '../inbox/extras.js'
import { startConversation } from '../inbox/outreach.js'
import { loadConversation, loadSummaries, searchMessages } from '../inbox/read.js'
import { addTag, removeTag } from '../inbox/tags.js'
import { assign, listAgents, resolve, sendMessage } from '../inbox/write.js'
import { Refusal } from '../refusal.js'
import type { Settings } from '../settings/settings.js'
import { type TokenContext, writing } from './tokens.js'

/**
 * What a token may do — the same for the REST API and the MCP server, and through the
 * same functions as the inbox: one way to the data, whoever asks (D16). Reads see the
 * token's inboxes only; writes need a `write` token, and never delete.
 */

export interface ServiceDeps {
  readonly db: Db
  readonly settings: Settings | null
  /** The server writes e-mails (D23): a program may write first by e-mail. */
  readonly email?: boolean
}

/** Which conversations a list asks for — not resolved ones, by default. */
export type StatusFilter = ConversationStatus | 'unresolved' | 'all'

export interface ConversationQuery {
  readonly status?: StatusFilter
  readonly inbox?: string
  /** An agent's id, or `none` for the queue. */
  readonly assignee?: string
  readonly limit?: number
}

const LIMIT = 50
const MAX_LIMIT = 200

export function whoami(context: TokenContext) {
  const { token } = context
  return {
    label: token.label,
    prefix: `msg_${token.tokenPrefix}`,
    access: token.access,
    surfaces: token.surfaces,
    inboxIds: context.visible === null ? null : [...context.visible],
    expiresAt: token.expiresAt?.toISOString() ?? null,
  }
}

export async function inboxes(deps: ServiceDeps, context: TokenContext) {
  const all = deps.settings ? await deps.settings.inboxes() : []
  return all
    .filter((inbox) => inbox.active && canSee(context.visible, inbox.id))
    .map((inbox) => ({ id: inbox.id, name: inbox.name, description: inbox.description }))
}

export async function agentsList(deps: ServiceDeps): Promise<Agent[]> {
  return listAgents(deps.db, deps.settings)
}

export async function conversationList(
  deps: ServiceDeps,
  context: TokenContext,
  query: ConversationQuery,
): Promise<ConversationSummary[]> {
  const status = query.status ?? 'unresolved'
  const limit = Math.min(Math.max(1, Math.floor(query.limit ?? LIMIT)), MAX_LIMIT)
  const all = await loadSummaries(deps.db, undefined, context.visible)
  return all
    .filter((s) =>
      status === 'all'
        ? true
        : status === 'unresolved'
          ? s.status !== 'resolved'
          : s.status === status,
    )
    .filter((s) => query.inbox === undefined || s.inboxId === query.inbox)
    .filter(
      (s) =>
        query.assignee === undefined ||
        (query.assignee === 'none' ? s.assigneeId === null : s.assigneeId === query.assignee),
    )
    .slice(0, limit)
}

/** A conversation the token reaches — else, for it, one that does not exist. */
async function reached(deps: ServiceDeps, context: TokenContext, id: string): Promise<void> {
  const [row] = await deps.db
    .select({ inboxId: conversations.inboxId })
    .from(conversations)
    .where(eq(conversations.id, id))
  if (!row || !canSee(context.visible, row.inboxId)) {
    throw new Refusal('CONVERSATION_NOT_FOUND', 404)
  }
}

export async function conversation(
  deps: ServiceDeps,
  context: TokenContext,
  id: string,
): Promise<Conversation> {
  return loadConversation(deps.db, id, context.actor, context.visible)
}

export async function reply(
  deps: ServiceDeps,
  context: TokenContext,
  id: string,
  body: string,
  options: { readonly note?: boolean; readonly resolve?: boolean } = {},
): Promise<Conversation> {
  writing(context)
  await reached(deps, context, id)
  return sendMessage(deps.db, context.actor, id, {
    body,
    kind: options.note ? 'note' : 'reply',
    resolve: options.resolve === true && !options.note,
  })
}

/** Writes first to a customer, by SMS or by e-mail (D23): the conversation, with its message. */
export async function startOutreach(
  deps: ServiceDeps,
  context: TokenContext,
  body: Readonly<Record<string, unknown>>,
): Promise<Conversation> {
  writing(context)
  if (!deps.settings) throw new Refusal('NUMBER_UNAVAILABLE', 404)
  return startConversation(
    { db: deps.db, settings: deps.settings, email: deps.email === true },
    context.actor,
    context.visible,
    { ...body },
  )
}

export async function assignTo(
  deps: ServiceDeps,
  context: TokenContext,
  id: string,
  assigneeId: string | null,
): Promise<Conversation> {
  writing(context)
  await reached(deps, context, id)
  return assign(deps.db, context.actor, id, assigneeId)
}

export async function close(
  deps: ServiceDeps,
  context: TokenContext,
  id: string,
): Promise<Conversation> {
  writing(context)
  await reached(deps, context, id)
  return resolve(deps.db, context.actor, id)
}

export async function tag(
  deps: ServiceDeps,
  context: TokenContext,
  id: string,
  label: string,
  remove = false,
): Promise<Conversation> {
  writing(context)
  await reached(deps, context, id)
  return remove
    ? removeTag(deps.db, context.actor, id, label)
    : addTag(deps.db, deps.settings, context.actor, id, label)
}

export async function contactsList(
  deps: ServiceDeps,
  context: TokenContext,
  query: string,
): Promise<ContactListItem[]> {
  return listContacts(deps.db, query, context.visible)
}

export async function contact(
  deps: ServiceDeps,
  context: TokenContext,
  id: string,
): Promise<ContactDetail> {
  return contactDetail(deps.db, id, context.visible)
}

export async function search(
  deps: ServiceDeps,
  context: TokenContext,
  query: string,
): Promise<MessageHit[]> {
  return searchMessages(deps.db, query, context.visible)
}
