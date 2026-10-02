import type {
  ConversationEvent,
  PageAction,
  PageActionDeclaration,
  PageCallStatus,
  PageSnapshot,
} from '@chat/contracts'
import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { conversations, messages, pageActions, pageCalls } from '../db/schema.js'
import type { AgentRow } from '../inbox/read.js'
import { signalChange } from '../realtime/signals.js'
import { Refusal } from '../refusal.js'

/**
 * The page's actions (D21): the page declares what it can do — look a price up, fill a
 * form, open a step —, a supervisor allows it, the AI asks for it, and one tab of the
 * visitor's runs it and answers. A read waits for its answer, ten seconds at most; what the
 * visitor must accept first ends the AI's turn, and the answer starts another.
 *
 * What a page says — its context, its actions' words, their results — is data, never
 * instructions (D13): the AI is told so.
 */

const NAME = /^[A-Za-z][\w-]{0,47}$/
const MAX_ACTIONS = 20
const MAX_JSON = 16_000
/** How long the AI waits for a page to answer. */
export const WAIT_MS = 10_000
const POLL_MS = 250
/** A request to accept is answered within half an hour, or not at all. */
const CONFIRM_TTL = '30 minutes'

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

/** What fits: JSON, sixteen thousand characters at most — or nothing. */
function bounded(value: unknown): unknown {
  if (value === undefined) return null
  try {
    const json = JSON.stringify(value)
    return json === undefined || json.length > MAX_JSON ? null : JSON.parse(json)
  } catch {
    return null
  }
}

function readDeclaration(raw: unknown): PageActionDeclaration | null {
  const value = record(raw)
  const name = text(value.name, 48)
  if (!NAME.test(name)) return null
  const parameters = record(bounded(value.parameters))
  return {
    name,
    label: text(value.label, 80) || name,
    description: text(value.description, 600),
    parameters: parameters.type === 'object' ? parameters : { type: 'object', properties: {} },
    kind: value.kind === 'do' ? 'do' : 'read',
    confirm: value.confirm === true,
  }
}

/** The page as the widget sent it — bounded, its actions well named; `null` without one. */
export function readSnapshot(raw: unknown): PageSnapshot | null {
  if (raw === undefined || raw === null) return null
  const value = record(raw)
  const actions = Array.isArray(value.actions) ? value.actions : []
  const declared = actions
    .slice(0, MAX_ACTIONS)
    .map(readDeclaration)
    .filter((a): a is PageActionDeclaration => a !== null)
  return {
    url: text(value.url, 2000),
    title: text(value.title, 200),
    context: bounded(value.context),
    actions: declared.filter((a, i) => declared.findIndex((b) => b.name === a.name) === i),
  }
}

/**
 * Keeps the page the visitor wrote from, and what its actions are: a new one is known — off
 * until a supervisor allows it —, a known one is said again in the page's words.
 */
export async function keepSnapshot(
  db: Db,
  conversationId: string,
  siteId: string,
  snapshot: PageSnapshot,
): Promise<void> {
  await db.update(conversations).set({ page: snapshot }).where(eq(conversations.id, conversationId))
  for (const action of snapshot.actions) {
    await db
      .insert(pageActions)
      .values({
        siteId,
        name: action.name,
        label: action.label,
        description: action.description,
        kind: action.kind,
        parameters: { ...action.parameters },
        confirm: action.confirm || action.kind === 'do',
      })
      .onConflictDoUpdate({
        target: [pageActions.siteId, pageActions.name],
        set: {
          label: action.label,
          description: action.description,
          kind: action.kind,
          parameters: { ...action.parameters },
          lastSeenAt: new Date(),
        },
      })
  }
}

// ── What the AI may ask ─────────────────────────────────────────────────────

export interface PageTool {
  readonly name: string
  readonly label: string
  readonly description: string
  readonly parameters: Readonly<Record<string, unknown>>
  readonly kind: 'read' | 'do'
  /** The supervisor's, or the page's: either asks for it. */
  readonly confirm: boolean
}

/** The actions the visitor's page declared that a supervisor allows. */
export async function pageToolsFor(
  db: Db,
  siteId: string,
  snapshot: PageSnapshot | null,
): Promise<PageTool[]> {
  if (!snapshot || snapshot.actions.length === 0) return []
  const allowed = await db
    .select()
    .from(pageActions)
    .where(
      and(
        eq(pageActions.siteId, siteId),
        eq(pageActions.enabled, true),
        inArray(
          pageActions.name,
          snapshot.actions.map((a) => a.name),
        ),
      ),
    )
  return snapshot.actions.flatMap((declared) => {
    const row = allowed.find((a) => a.name === declared.name)
    if (!row) return []
    return [
      {
        name: declared.name,
        label: declared.label,
        description: declared.description,
        parameters: declared.parameters,
        kind: declared.kind,
        confirm: row.confirm || declared.confirm,
      },
    ]
  })
}

type CallRow = typeof pageCalls.$inferSelect

export function eventOf(call: CallRow): ConversationEvent {
  return {
    type: 'page_action',
    call: call.id,
    name: call.name,
    label: call.label,
    args: call.args,
    status: call.status,
    ...(call.result !== null && call.result !== undefined ? { result: call.result } : {}),
    ...(call.error ? { error: call.error } : {}),
  }
}

/** The call's new state, and its event in the thread — the widget and the inbox hear it. */
async function settle(
  db: Db,
  id: string,
  values: Partial<typeof pageCalls.$inferInsert>,
  only: readonly PageCallStatus[],
): Promise<CallRow | null> {
  return db.transaction(async (tx) => {
    const [call] = await tx
      .update(pageCalls)
      .set(values)
      .where(and(eq(pageCalls.id, id), inArray(pageCalls.status, [...only])))
      .returning()
    if (!call) return null
    if (call.messageId) {
      await tx
        .update(messages)
        .set({ meta: { event: eventOf(call) } })
        .where(eq(messages.id, call.messageId))
    }
    await signalChange(tx, call.conversationId)
    return call
  })
}

export interface PageAnswer {
  /** What the model reads back. */
  readonly content: string
  /** What the agents see of it. */
  readonly detail: string
}

const said = (value: unknown) => {
  const json = JSON.stringify(value ?? null)
  return json.length > 4000 ? `${json.slice(0, 4000)}…` : json
}

/**
 * The AI asks the page. A read, or an action the visitor need not accept: its answer, once
 * a tab of the visitor's gave it — or « page indisponible ». An action to accept: asked,
 * the turn ends there.
 */
export async function callPage(
  db: Db,
  conversationId: string,
  tool: PageTool,
  args: Record<string, unknown>,
): Promise<PageAnswer> {
  const status: PageCallStatus = tool.confirm ? 'confirming' : 'pending'
  const call = await db.transaction(async (tx) => {
    const [made] = await tx
      .insert(pageCalls)
      .values({
        conversationId,
        name: tool.name,
        label: tool.label,
        args: record(bounded(args)),
        confirm: tool.confirm,
        status,
      })
      .returning()
    if (!made) throw new Error('page call not inserted')
    const [event] = await tx
      .insert(messages)
      .values({
        conversationId,
        author: 'system',
        kind: 'event',
        meta: { event: eventOf(made) },
        createdAt: new Date(),
      })
      .returning({ id: messages.id })
    await tx
      .update(pageCalls)
      .set({ messageId: event?.id ?? null })
      .where(eq(pageCalls.id, made.id))
    await signalChange(tx, conversationId)
    return made
  })
  if (tool.confirm) {
    return {
      content: JSON.stringify({
        ok: null,
        status: 'en attente',
        note: 'La proposition s’affiche dans la conversation : le visiteur l’accepte ou la refuse. Réponds-lui (action « answer », ne transfère pas) qu’il vérifie et accepte la proposition. Tu auras le résultat ensuite. Ne dis pas qu’elle est faite.',
      }),
      detail: 'demandée au visiteur',
    }
  }
  const deadline = Date.now() + WAIT_MS
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    const [now] = await db.select().from(pageCalls).where(eq(pageCalls.id, call.id))
    if (now?.status === 'done') {
      return {
        content: JSON.stringify({ ok: true, result: now.result ?? null }),
        detail: `faite — ${said(now.result)}`,
      }
    }
    if (now?.status === 'failed') {
      return {
        content: JSON.stringify({ ok: false, error: now.error ?? 'échec' }),
        detail: `échec — ${now.error ?? ''}`,
      }
    }
  }
  await settle(db, call.id, { status: 'expired', answeredAt: new Date() }, ['pending', 'running'])
  return {
    content: JSON.stringify({
      ok: false,
      error:
        'La page du visiteur n’a pas répondu : elle est peut-être fermée. Ne dis pas que l’action est faite ; explique comment la faire soi-même.',
    }),
    detail: 'sans réponse de la page',
  }
}

// ── The visitor's side ──────────────────────────────────────────────────────

/** A call of the visitor's current conversation, or `ROW_NOT_FOUND`. */
async function callOf(db: Db, conversationId: string, id: string): Promise<CallRow> {
  const [call] = await db
    .select()
    .from(pageCalls)
    .where(and(eq(pageCalls.id, id), eq(pageCalls.conversationId, conversationId)))
  if (!call) throw new Refusal('ROW_NOT_FOUND', 404)
  return call
}

/**
 * A tab takes the call to run it — the first one: the others leave it. For a call to
 * accept, taking it is accepting it.
 */
export async function claimCall(
  db: Db,
  conversationId: string,
  id: string,
  tab: string,
): Promise<boolean> {
  const call = await callOf(db, conversationId, id)
  if (call.status !== 'pending' && call.status !== 'confirming') return false
  const fresh =
    call.status === 'pending'
      ? Date.now() - call.createdAt.getTime() < WAIT_MS
      : Date.now() - call.createdAt.getTime() < 30 * 60_000
  if (!fresh) return false
  const taken = await settle(db, id, { status: 'running', claimedBy: tab.slice(0, 64) }, [
    call.status,
  ])
  return taken !== null
}

/** The visitor declines an action to accept. Whether the AI goes on — it does. */
export async function refuseCall(db: Db, conversationId: string, id: string): Promise<boolean> {
  await callOf(db, conversationId, id)
  const refused = await settle(db, id, { status: 'refused', answeredAt: new Date() }, [
    'confirming',
  ])
  return refused !== null
}

/**
 * The tab that ran it answers. Returns whether the AI must go on — the call was one the
 * visitor accepted: the AI's turn ended when it asked.
 */
export async function answerCall(
  db: Db,
  conversationId: string,
  id: string,
  tab: string,
  raw: unknown,
): Promise<boolean> {
  const call = await callOf(db, conversationId, id)
  if (call.status !== 'running' || call.claimedBy !== tab.slice(0, 64)) return false
  const body = record(raw)
  const ok = body.ok === true
  const done = await settle(
    db,
    id,
    ok
      ? { status: 'done', result: bounded(body.result), answeredAt: new Date() }
      : { status: 'failed', error: text(body.error, 300) || 'échec', answeredAt: new Date() },
    ['running'],
  )
  return done !== null && call.confirm
}

/** Calls to accept left unanswered: expired, so that a widget opened later does not ask. */
export async function expireCalls(db: Db): Promise<void> {
  const stale = await db
    .select({ id: pageCalls.id })
    .from(pageCalls)
    .where(
      and(
        eq(pageCalls.status, 'confirming'),
        lt(pageCalls.createdAt, sql`now() - ${CONFIRM_TTL}::interval`),
      ),
    )
  for (const { id } of stale) {
    await settle(db, id, { status: 'expired', answeredAt: new Date() }, ['confirming'])
  }
}

// ── What supervisors allow ──────────────────────────────────────────────────

function supervisor(agent: AgentRow): void {
  if (agent.role !== 'supervisor') throw new Refusal('NOT_ALLOWED', 403)
}

const toPageAction = (row: typeof pageActions.$inferSelect): PageAction => ({
  id: row.id,
  siteId: row.siteId,
  name: row.name,
  label: row.label,
  description: row.description,
  kind: row.kind,
  parameters: row.parameters,
  enabled: row.enabled,
  confirm: row.confirm,
  lastSeenAt: row.lastSeenAt.toISOString(),
})

export async function listPageActions(
  db: Db,
  agent: AgentRow,
  siteId: string,
): Promise<PageAction[]> {
  supervisor(agent)
  const rows = await db
    .select()
    .from(pageActions)
    .where(eq(pageActions.siteId, siteId))
    .orderBy(pageActions.name)
  return rows.map(toPageAction)
}

export async function setPageAction(
  db: Db,
  agent: AgentRow,
  id: string,
  raw: unknown,
): Promise<PageAction> {
  supervisor(agent)
  const body = record(raw)
  const patch: Partial<typeof pageActions.$inferInsert> = {}
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
  if (typeof body.confirm === 'boolean') patch.confirm = body.confirm
  if (Object.keys(patch).length === 0) throw new Refusal('INVALID_REQUEST', 400)
  const [row] = await db.update(pageActions).set(patch).where(eq(pageActions.id, id)).returning()
  if (!row) throw new Refusal('ROW_NOT_FOUND', 404)
  return toPageAction(row)
}
