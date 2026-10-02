import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type {
  Automation,
  AutomationButton,
  AutomationChoices,
  AutomationDefinition,
  AutomationRun,
  AutomationRunList,
  AutomationRunStatus,
} from '@chat/contracts'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { agents, automationRuns, automations, contacts, conversations } from '../db/schema.js'
import type { AgentRow } from '../inbox/read.js'
import { person } from '../programs.js'
import { Refusal } from '../refusal.js'
import type { Settings } from '../settings/settings.js'
import { seal, unseal } from '../webhooks/seal.js'
import { queueRun } from './engine.js'
import { aboutConversation, nextOccurrence, problemOf, readDefinition } from './model.js'
import { holds, loadSubject } from './subject.js'

/**
 * The automations, as supervisors set them up (D20): written as drafts, switched on once
 * nothing keeps them from running; each with its agent row, which signs what it does.
 * Agents start the « button » ones from a conversation; another system calls a « webhook »
 * one at its address, with its key.
 */

export interface ManageDeps {
  readonly db: Db
  readonly settings: Settings
  /** `CHAT_SECRET`: seals the webhooks' keys. */
  readonly secret: string
  /** Where another system calls: `CHAT_PUBLIC_URL`. */
  readonly publicUrl: string
  /** Hurries the engine, when it runs in this process. */
  readonly poke: () => void
}

type Row = typeof automations.$inferSelect

function supervisor(agent: AgentRow): void {
  if (agent.role !== 'supervisor') throw new Refusal('NOT_ALLOWED', 403)
}

const newKey = () => `ahk_${randomBytes(24).toString('base64url')}`

async function rowOf(db: Db, id: string): Promise<Row> {
  const [row] = await db
    .select()
    .from(automations)
    .where(and(eq(automations.id, id), isNull(automations.deletedAt)))
  if (!row) throw new Refusal('AUTOMATION_NOT_FOUND', 404)
  return row
}

async function present(deps: ManageDeps, rows: readonly Row[]): Promise<Automation[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const stats = await deps.db
    .select({
      id: automationRuns.automationId,
      runs: sql<number>`count(*) filter (where ${automationRuns.createdAt} > now() - interval '7 days')::int`,
      failed: sql<number>`count(*) filter (where ${automationRuns.createdAt} > now() - interval '7 days' and ${automationRuns.status} = 'failed')::int`,
      last: sql<string | null>`max(${automationRuns.createdAt})`,
    })
    .from(automationRuns)
    .where(inArray(automationRuns.automationId, ids))
    .groupBy(automationRuns.automationId)
  const creators = await deps.db
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(inArray(agents.id, [...new Set(rows.map((r) => r.createdBy))]))
  const byId = new Map(stats.map((s) => [s.id, s]))
  return rows.map((row) => {
    const stat = byId.get(row.id)
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      trigger: row.trigger,
      condition: row.condition,
      steps: row.steps,
      active: row.isActive,
      webhookUrl:
        row.trigger.kind === 'webhook' && row.webhookKey
          ? `${deps.publicUrl}/api/automations/${row.id}/hook?key=${unseal(row.webhookKey, deps.secret)}`
          : null,
      createdBy: creators.find((c) => c.id === row.createdBy)?.name ?? '—',
      updatedAt: row.updatedAt.toISOString(),
      lastRunAt: stat?.last ? new Date(stat.last).toISOString() : null,
      runs7d: stat?.runs ?? 0,
      failed7d: stat?.failed ?? 0,
    }
  })
}

export async function listAutomations(deps: ManageDeps, agent: AgentRow): Promise<Automation[]> {
  supervisor(agent)
  const rows = await deps.db
    .select()
    .from(automations)
    .where(isNull(automations.deletedAt))
    .orderBy(automations.name)
  return present(deps, rows)
}

export async function getAutomation(
  deps: ManageDeps,
  agent: AgentRow,
  id: string,
): Promise<Automation> {
  supervisor(agent)
  return (await present(deps, [await rowOf(deps.db, id)]))[0] as Automation
}

/** What a definition changes in its row: a schedule's next time, a webhook's key. */
function derived(definition: AutomationDefinition, row: Row | null, secret: string) {
  return {
    nextRunAt:
      definition.trigger.kind === 'schedule' && definition.trigger.schedule
        ? nextOccurrence(definition.trigger.schedule, new Date())
        : null,
    webhookKey:
      definition.trigger.kind === 'webhook' ? (row?.webhookKey ?? seal(newKey(), secret)) : null,
  }
}

function refuseProblem(definition: AutomationDefinition): void {
  const problem = problemOf(definition)
  if (problem) throw new Refusal('AUTOMATION_INVALID', 400, { ...problem })
}

export async function createAutomation(
  deps: ManageDeps,
  agent: AgentRow,
  raw: unknown,
): Promise<Automation> {
  supervisor(agent)
  const definition = readDefinition(raw)
  const id = randomUUID()
  const row = await deps.db.transaction(async (tx) => {
    // Its own agent row: never active, never signed in with — its name signs its doing.
    const [actor] = await tx
      .insert(agents)
      .values({ login: `automation:${id}`, name: definition.name, role: 'agent', active: false })
      .returning({ id: agents.id })
    if (!actor) throw new Refusal('INTERNAL_ERROR', 500)
    const [made] = await tx
      .insert(automations)
      .values({
        id,
        ...definition,
        ...derived(definition, null, deps.secret),
        agentId: actor.id,
        createdBy: agent.id,
      })
      .returning()
    return made as Row
  })
  return (await present(deps, [row]))[0] as Automation
}

export async function updateAutomation(
  deps: ManageDeps,
  agent: AgentRow,
  id: string,
  raw: unknown,
): Promise<Automation> {
  supervisor(agent)
  const definition = readDefinition(raw)
  const before = await rowOf(deps.db, id)
  // On, it must stay able to run.
  if (before.isActive) refuseProblem(definition)
  const row = await deps.db.transaction(async (tx) => {
    const [saved] = await tx
      .update(automations)
      .set({ ...definition, ...derived(definition, before, deps.secret), updatedAt: new Date() })
      .where(eq(automations.id, id))
      .returning()
    await tx.update(agents).set({ name: definition.name }).where(eq(agents.id, before.agentId))
    return saved as Row
  })
  return (await present(deps, [row]))[0] as Automation
}

export async function setAutomationActive(
  deps: ManageDeps,
  agent: AgentRow,
  id: string,
  active: boolean,
): Promise<Automation> {
  supervisor(agent)
  const row = await rowOf(deps.db, id)
  if (active) refuseProblem(row)
  const [saved] = await deps.db
    .update(automations)
    .set({
      isActive: active,
      ...(active && !row.isActive ? { activatedAt: new Date() } : {}),
      // From now: a schedule switched on does not catch up on what it missed.
      ...derived(row, row, deps.secret),
      updatedAt: new Date(),
    })
    .where(eq(automations.id, id))
    .returning()
  return (await present(deps, [saved as Row]))[0] as Automation
}

export async function renewAutomationKey(
  deps: ManageDeps,
  agent: AgentRow,
  id: string,
): Promise<Automation> {
  supervisor(agent)
  const row = await rowOf(deps.db, id)
  if (row.trigger.kind !== 'webhook') throw new Refusal('INVALID_REQUEST', 400)
  const [saved] = await deps.db
    .update(automations)
    .set({ webhookKey: seal(newKey(), deps.secret), updatedAt: new Date() })
    .where(eq(automations.id, id))
    .returning()
  return (await present(deps, [saved as Row]))[0] as Automation
}

/** Gone from the list — its runs stop; its agent row stays, for the threads it signed. */
export async function deleteAutomation(
  deps: ManageDeps,
  agent: AgentRow,
  id: string,
): Promise<void> {
  supervisor(agent)
  await rowOf(deps.db, id)
  await deps.db.transaction(async (tx) => {
    await tx
      .update(automations)
      .set({ deletedAt: new Date(), isActive: false })
      .where(eq(automations.id, id))
    await tx
      .update(automationRuns)
      .set({ status: 'stopped', error: 'AUTOMATION_GONE', finishedAt: new Date(), resumeAt: null })
      .where(
        and(
          eq(automationRuns.automationId, id),
          inArray(automationRuns.status, ['queued', 'waiting']),
        ),
      )
  })
}

// ── Runs ────────────────────────────────────────────────────────────────────

function causeOf(cause: Record<string, unknown>): string {
  switch (cause.type) {
    case 'event':
      return `event:${String(cause.event)}`
    case 'button':
    case 'test':
      return `${cause.type}:${String(cause.agent ?? '')}`
    default:
      return String(cause.type)
  }
}

export async function automationRunList(
  deps: ManageDeps,
  agent: AgentRow,
  id: string,
): Promise<AutomationRunList> {
  supervisor(agent)
  await rowOf(deps.db, id)
  const rows = await deps.db
    .select({ run: automationRuns, contactName: contacts.name })
    .from(automationRuns)
    .leftJoin(conversations, eq(conversations.id, automationRuns.conversationId))
    .leftJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(eq(automationRuns.automationId, id))
    .orderBy(desc(automationRuns.createdAt))
    .limit(100)
  return {
    items: rows.map(
      ({ run, contactName }): AutomationRun => ({
        id: run.id,
        automationId: run.automationId,
        status: run.status as AutomationRunStatus,
        conversationId: run.conversationId,
        contactName,
        cause: causeOf(run.cause),
        steps: run.steps,
        error: run.error,
        createdAt: run.createdAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
        resumeAt: run.resumeAt?.toISOString() ?? null,
      }),
    ),
  }
}

/** Stops a run that waits or is queued. */
export async function stopRun(deps: ManageDeps, agent: AgentRow, runId: string): Promise<void> {
  supervisor(agent)
  await deps.db
    .update(automationRuns)
    .set({ status: 'stopped', error: 'STOPPED', finishedAt: new Date(), resumeAt: null })
    .where(and(eq(automationRuns.id, runId), inArray(automationRuns.status, ['queued', 'waiting'])))
}

/**
 * « Essayer » from the editor: a run now, on a conversation — the automation on or off,
 * its condition not asked. What it does, it does for real.
 */
export async function tryAutomation(
  deps: ManageDeps,
  agent: AgentRow,
  id: string,
  conversationId: string | null,
): Promise<{ readonly runId: string }> {
  supervisor(agent)
  const row = await rowOf(deps.db, id)
  if (aboutConversation(row.trigger) && conversationId === null) {
    throw new Refusal('INVALID_REQUEST', 400, { field: 'conversationId' })
  }
  if (conversationId !== null) await conversationExists(deps.db, conversationId)
  const runId = await queueRun(deps.db, id, {
    conversationId,
    cause: { type: 'test', agent: agent.name },
    unlimited: true,
  })
  if (!runId) throw new Refusal('RATE_LIMITED', 429)
  deps.poke()
  return { runId }
}

async function conversationExists(db: Db, id: string): Promise<void> {
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.id, id))
  if (!row) throw new Refusal('CONVERSATION_NOT_FOUND', 404)
}

// ── From a conversation ─────────────────────────────────────────────────────

/** The « button » automations whose condition the conversation meets. */
export async function buttonsFor(
  deps: ManageDeps,
  conversationId: string,
): Promise<AutomationButton[]> {
  const rows = await deps.db
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.isActive, true),
        isNull(automations.deletedAt),
        sql`${automations.trigger}->>'kind' = 'button'`,
      ),
    )
    .orderBy(automations.name)
  if (rows.length === 0) return []
  const subject = await loadSubject(deps.db, deps.settings, conversationId)
  return rows
    .filter((r) => holds(r.condition, subject))
    .map((r) => ({ id: r.id, name: r.name, description: r.description }))
}

export async function pressButton(
  deps: ManageDeps,
  agent: AgentRow,
  conversationId: string,
  id: string,
): Promise<{ readonly runId: string }> {
  const buttons = await buttonsFor(deps, conversationId)
  if (!buttons.some((b) => b.id === id)) throw new Refusal('AUTOMATION_NOT_FOUND', 404)
  const runId = await queueRun(deps.db, id, {
    conversationId,
    cause: { type: 'button', agent: agent.name },
  })
  if (!runId) throw new Refusal('RATE_LIMITED', 429)
  deps.poke()
  return { runId }
}

// ── From another system ─────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A call to a « webhook » automation's address: its key, then the JSON it sent — what
 * `{{webhook.…}}` cites. A `conversationId` in it makes the run about that conversation.
 */
export async function hookCalled(
  deps: ManageDeps,
  id: string,
  key: string,
  body: unknown,
): Promise<{ readonly runId: string }> {
  const [row] = UUID.test(id)
    ? await deps.db
        .select()
        .from(automations)
        .where(
          and(
            eq(automations.id, id),
            isNull(automations.deletedAt),
            eq(automations.isActive, true),
          ),
        )
    : []
  const expected =
    row?.trigger.kind === 'webhook' && row.webhookKey ? unseal(row.webhookKey, deps.secret) : ''
  const given = Buffer.from(key)
  const wanted = Buffer.from(expected)
  if (
    !row ||
    expected === '' ||
    given.length !== wanted.length ||
    !timingSafeEqual(given, wanted)
  ) {
    throw new Refusal('AUTOMATION_KEY_INVALID', 401)
  }
  const named =
    body !== null && typeof body === 'object' && 'conversationId' in body
      ? (body as { conversationId: unknown }).conversationId
      : null
  let conversationId: string | null = null
  if (typeof named === 'string' && UUID.test(named)) {
    await conversationExists(deps.db, named)
    conversationId = named
  }
  const runId = await queueRun(deps.db, id, {
    conversationId,
    cause: { type: 'webhook' },
    input: body,
  })
  if (!runId) throw new Refusal('RATE_LIMITED', 429)
  deps.poke()
  return { runId }
}

// ── What the editor offers ──────────────────────────────────────────────────

export async function automationChoices(
  deps: ManageDeps,
  agent: AgentRow,
  ai: boolean,
): Promise<AutomationChoices> {
  supervisor(agent)
  const [inboxes, teams, sites, tags, people] = await Promise.all([
    deps.settings.inboxes(),
    deps.settings.teams(),
    deps.settings.sites(),
    deps.settings.tags(),
    deps.db
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(and(eq(agents.active, true), person(agents.login)))
      .orderBy(agents.name),
  ])
  return {
    inboxes: inboxes.map((i) => ({ id: i.id, name: i.name })),
    teams: teams.map((t) => ({ id: t.id, name: t.name })),
    sites: sites.map((s) => ({ id: s.id, name: s.name, timezone: s.timezone })),
    agents: people,
    tags: tags.map((t) => ({ name: t.name, color: t.color })),
    ai,
  }
}
