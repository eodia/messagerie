import { type Llm, Redactor, readJson } from '@chat/ai'
import type { AutomationStep, ConversationEvent, MetadataValue } from '@chat/contracts'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { recordRun } from '../ai/runs.js'
import type { Db } from '../db/client.js'
import { agents, automations, conversations, messages } from '../db/schema.js'
import type { Access } from '../inbox/access.js'
import { requestEmail } from '../inbox/email-request.js'
import { patchConversationData } from '../inbox/metadata.js'
import { activeAgentIds, notify } from '../inbox/notifications.js'
import type { AgentRow } from '../inbox/read.js'
import { addTag, removeTag } from '../inbox/tags.js'
import { assign, resolve, snooze, transfer, wake } from '../inbox/write.js'
import { person } from '../programs.js'
import { signalChange } from '../realtime/signals.js'
import { Refusal } from '../refusal.js'
import { resolveHeaders } from '../settings/settings.js'
import type { Settings } from '../settings/settings.js'
import { USER_AGENT } from '../webhooks/dispatch.js'
import { allowedTarget } from '../webhooks/target.js'
import { type Subject, jsonEscape, render } from './subject.js'

/**
 * What each step does (D20) — through the inbox's own writes where there is one, as the
 * automation's agent row, so that the thread says who did it. Every write runs in a
 * transaction that names the run (`chat.automation_run`): the events it causes carry it,
 * and an automation is never set off by its own doing.
 */

export interface StepDeps {
  readonly db: Db
  readonly settings: Settings
  readonly access: Access
  readonly llm: Llm | null
  readonly redact: boolean
  readonly webOrigin: string
}

export interface StepRun {
  readonly runId: string
  readonly automationId: string
  readonly conversationId: string | null
  readonly actor: AgentRow
  readonly subject: Subject
  readonly outputs: Readonly<Record<string, string>>
  readonly scope: Record<string, unknown>
}

/** What a step did: said for the run's log, and what `{{etape.<id>}}` gives. */
export interface StepOutcome {
  readonly status: 'succeeded' | 'skipped'
  readonly detail?: string
  readonly output?: string
}

const done = (detail?: string, output?: string): StepOutcome => ({
  status: 'succeeded',
  ...(detail === undefined ? {} : { detail }),
  ...(output === undefined ? {} : { output }),
})
const skipped = (detail: string): StepOutcome => ({ status: 'skipped', detail })

/** Runs `write` in a transaction that names the run, for the events it causes. */
export function caused<T>(db: Db, runId: string, write: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('chat.automation_run', ${runId}, true)`)
    return write(tx as unknown as Db)
  })
}

function conversationOf(run: StepRun): string {
  if (run.conversationId === null) throw new Refusal('CONVERSATION_NOT_FOUND', 404)
  return run.conversationId
}

async function lock(tx: Db, id: string) {
  const [row] = await tx.select().from(conversations).where(eq(conversations.id, id)).for('update')
  if (!row) throw new Refusal('CONVERSATION_NOT_FOUND', 404)
  return row
}

const event = (conversationId: string, value: ConversationEvent) => ({
  conversationId,
  author: 'system' as const,
  kind: 'event' as const,
  meta: { event: value },
  createdAt: new Date(),
})

/** The active people of a team, with what they hold. */
async function teamMembers(deps: StepDeps, teamId: string) {
  const entries = await deps.settings.agents()
  const ids = entries.filter((e) => e.teamIds.includes(teamId)).map((e) => e.id)
  if (ids.length === 0) return []
  const rows = await deps.db
    .select({ id: agents.id, name: agents.name, max: agents.maxConversations })
    .from(agents)
    .where(and(inArray(agents.id, ids), eq(agents.active, true), person(agents.login)))
    .orderBy(asc(agents.name), asc(agents.id))
  const load = await deps.db
    .select({ id: conversations.assigneeId, n: sql<number>`count(*)::int` })
    .from(conversations)
    .where(
      and(
        inArray(conversations.assigneeId, ids),
        inArray(conversations.status, ['open', 'pending']),
      ),
    )
    .groupBy(conversations.assigneeId)
  const held = new Map(load.map((l) => [l.id, l.n]))
  return rows.map((r) => ({ ...r, held: held.get(r.id) ?? 0 }))
}

async function assignStep(
  deps: StepDeps,
  run: StepRun,
  step: Extract<AutomationStep, { kind: 'assign' }>,
): Promise<StepOutcome> {
  const id = conversationOf(run)
  if (step.to === 'nobody') {
    await caused(deps.db, run.runId, (tx) => assign(tx, run.actor, id, null))
    return done()
  }
  if (step.to === 'agent') {
    const agentId = step.agentId ?? ''
    await caused(deps.db, run.runId, (tx) => assign(tx, run.actor, id, agentId))
    const [agent] = await deps.db
      .select({ name: agents.name })
      .from(agents)
      .where(eq(agents.id, agentId))
    return done(agent?.name, agent?.name)
  }
  const teamId = step.teamId ?? ''
  // Those who may take one more: under their « Conversations simultanées ».
  const free = (await teamMembers(deps, teamId)).filter((m) => m.max === null || m.held < m.max)
  if (free.length === 0) return skipped('no_agent')
  let chosen = free[0] as (typeof free)[number]
  if (step.to === 'least_busy') {
    for (const m of free) if (m.held < chosen.held) chosen = m
  } else {
    const key = `turn:${teamId}`
    const [row] = await deps.db
      .select({ state: automations.state })
      .from(automations)
      .where(eq(automations.id, run.automationId))
    const last = row?.state[key]
    const after = free.findIndex((m) => m.id === last)
    chosen = free[(after + 1) % free.length] as (typeof free)[number]
    await deps.db
      .update(automations)
      .set({ state: sql`${automations.state} || ${JSON.stringify({ [key]: chosen.id })}::jsonb` })
      .where(eq(automations.id, run.automationId))
  }
  await caused(deps.db, run.runId, (tx) => assign(tx, run.actor, id, chosen.id))
  return done(chosen.name, chosen.name)
}

async function priorityStep(
  deps: StepDeps,
  run: StepRun,
  priority: 'low' | 'normal' | 'high' | 'urgent',
): Promise<StepOutcome> {
  const id = conversationOf(run)
  const changed = await caused(deps.db, run.runId, async (tx) => {
    const row = await lock(tx, id)
    if (row.priority === priority) return false
    await tx.insert(messages).values(event(id, { type: 'priority', priority, by: run.actor.name }))
    await tx
      .update(conversations)
      .set({ priority, updatedAt: new Date() })
      .where(eq(conversations.id, id))
    await signalChange(tx, id)
    return true
  })
  return changed ? done(priority) : skipped('unchanged')
}

/** To the agents: out of the AI's hands, back from a close or from on hold. */
async function openStep(deps: StepDeps, run: StepRun): Promise<StepOutcome> {
  const id = conversationOf(run)
  const before = await caused(deps.db, run.runId, async (tx) => {
    const row = await lock(tx, id)
    if (row.status === 'open') return row.status
    if (row.status === 'pending') {
      await wake(tx, run.actor, id)
      return row.status
    }
    await tx
      .insert(messages)
      .values(
        event(
          id,
          row.status === 'ai'
            ? { type: 'queued', by: run.actor.name }
            : { type: 'reopened', agent: run.actor.name },
        ),
      )
    await tx
      .update(conversations)
      .set({ status: 'open', agentUnread: true, updatedAt: new Date() })
      .where(eq(conversations.id, id))
    const audience = await deps.access.audience(tx, row.inboxId, row.teamId)
    const told = await notify(tx, audience, id, 'handoff', run.actor.id)
    await signalChange(tx, id, { alert: 'handoff', notify: told })
    return row.status
  })
  return before === 'open' ? skipped('unchanged') : done(before)
}

/** A message from the automation, to the visitor or to the team. */
async function writeStep(
  deps: StepDeps,
  run: StepRun,
  kind: 'text' | 'note',
  template: string,
): Promise<StepOutcome> {
  const id = conversationOf(run)
  const body = render(template, run.scope).trim()
  if (body === '') return skipped('empty')
  await caused(deps.db, run.runId, async (tx) => {
    await lock(tx, id)
    const at = new Date()
    await tx.insert(messages).values({
      conversationId: id,
      author: 'agent',
      kind,
      agentId: run.actor.id,
      body,
      createdAt: at,
    })
    await tx
      .update(conversations)
      .set(kind === 'text' ? { lastMessageAt: at, updatedAt: at } : { updatedAt: at })
      .where(eq(conversations.id, id))
    await signalChange(tx, id)
  })
  return done(undefined, body)
}

async function notifyStep(
  deps: StepDeps,
  run: StepRun,
  step: Extract<AutomationStep, { kind: 'notify' }>,
): Promise<StepOutcome> {
  const id = conversationOf(run)
  const text = render(step.text, run.scope).trim().slice(0, 500)
  let targets: string[]
  switch (step.to) {
    case 'assignee':
      targets = run.subject.conversation?.assigneeId ? [run.subject.conversation.assigneeId] : []
      break
    case 'team':
      targets = (await teamMembers(deps, step.teamId ?? '')).map((m) => m.id)
      break
    case 'supervisors': {
      const rows = await deps.db
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.active, true), eq(agents.role, 'supervisor'), person(agents.login)))
      targets = rows.map((r) => r.id)
      break
    }
    default: {
      const active = new Set(await activeAgentIds(deps.db))
      targets = (step.agentIds ?? []).filter((a) => active.has(a))
    }
  }
  if (targets.length === 0) return skipped('nobody')
  const told = await caused(deps.db, run.runId, async (tx) => {
    const told = await notify(tx, targets, id, 'automation', run.actor.id, text)
    await signalChange(tx, id, { alert: 'automation', notify: told })
    return told
  })
  return done(String(told.length))
}

const WEBHOOK_TIMEOUT_MS = 10_000
const OUTPUT_MAX = 4000

async function webhookStep(
  run: StepRun,
  step: Extract<AutomationStep, { kind: 'webhook' }>,
): Promise<StepOutcome> {
  const url = render(step.url, run.scope, encodeURIComponent)
  if (!(await allowedTarget(url))) throw new Refusal('WEBHOOK_TARGET_REJECTED', 400)
  let body: string
  if (step.body.trim() === '') {
    body = JSON.stringify({
      automation: run.scope.automatisation,
      conversation: run.scope.conversation,
      contact: run.scope.contact,
      etape: run.outputs,
    })
  } else {
    body = render(step.body, run.scope, jsonEscape)
    try {
      JSON.parse(body)
    } catch {
      throw new Error('BODY_NOT_JSON')
    }
  }
  const headers = resolveHeaders(
    Object.fromEntries(step.headers.map((h) => [h.name, render(h.value, run.scope)])),
  )
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: { ...headers, 'content-type': 'application/json', 'user-agent': USER_AGENT },
    body,
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  })
  const answer = (await response.text().catch(() => '')).slice(0, OUTPUT_MAX)
  if (!response.ok) throw new Error(`HTTP_${response.status}`)
  return done(String(response.status), answer)
}

const TRANSCRIPT = 30

async function transcriptOf(db: Db, conversationId: string): Promise<string> {
  const rows = await db
    .select({ author: messages.author, body: messages.body })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.kind, 'text'),
        isNull(messages.deletedAt),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(TRANSCRIPT)
  return rows
    .reverse()
    .map((m) => `${m.author === 'contact' ? 'Visiteur' : 'Nous'} : ${m.body}`)
    .join('\n')
}

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .trim()

async function aiStep(
  deps: StepDeps,
  run: StepRun,
  step: Extract<AutomationStep, { kind: 'ai' }>,
): Promise<StepOutcome> {
  if (deps.llm === null) throw new Refusal('AI_UNAVAILABLE', 503)
  const redactor = new Redactor(deps.redact && deps.llm.external)
  const prompt = render(step.prompt, run.scope)
  const transcript =
    run.conversationId === null ? '' : await transcriptOf(deps.db, run.conversationId)
  const classify = step.mode === 'classify'
  const system = [
    'Tu travailles pour une équipe de service client, dans une automatisation : ta réponse est lue par un programme, pas par le client.',
    `Consigne : ${prompt}`,
    classify
      ? `Choisis UNE réponse parmi : ${step.choices.map((c) => `« ${c} »`).join(', ')}. Réponds UNIQUEMENT en JSON : {"choix": "…"}`
      : 'Réponds par le texte demandé, sans préambule.',
  ].join('\n')
  const completion = await deps.llm.complete({
    json: classify,
    temperature: classify ? 0 : 0.3,
    maxTokens: 800,
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content:
          transcript === ''
            ? '(aucune conversation)'
            : `Conversation :\n${redactor.mask(transcript)}`,
      },
    ],
  })
  let output: string
  if (classify) {
    const said = String(readJson(completion.text)?.choix ?? '')
    output = step.choices.find((c) => fold(c) === fold(said)) ?? ''
  } else {
    output = redactor.unmask(completion.text.trim()).slice(0, OUTPUT_MAX)
  }
  if (run.conversationId !== null) {
    await recordRun(deps.db, {
      conversationId: run.conversationId,
      kind: 'automation',
      completion,
      input: { automation: run.automationId, step: step.id, prompt },
      output: { text: output },
    })
  }
  return done(output === '' ? 'none' : output.slice(0, 200), output)
}

/** Runs one step that is not a branch nor a wait. */
export async function runStep(
  deps: StepDeps,
  run: StepRun,
  step: AutomationStep,
): Promise<StepOutcome> {
  const { db } = deps
  switch (step.kind) {
    case 'assign':
      return assignStep(deps, run, step)
    case 'transfer': {
      const id = conversationOf(run)
      await caused(db, run.runId, (tx) =>
        transfer(tx, deps.settings, deps.access, run.actor, id, {
          ...(step.inboxId ? { inboxId: step.inboxId } : {}),
          ...(step.teamId ? { teamId: step.teamId } : {}),
        }),
      )
      return done()
    }
    case 'tag': {
      const id = conversationOf(run)
      for (const label of step.add) {
        await caused(db, run.runId, (tx) =>
          addTag(tx, deps.settings, run.actor, id, render(label, run.scope)),
        )
      }
      for (const label of step.remove) {
        await caused(db, run.runId, (tx) => removeTag(tx, run.actor, id, render(label, run.scope)))
      }
      return done()
    }
    case 'priority':
      return priorityStep(deps, run, step.priority)
    case 'status': {
      const id = conversationOf(run)
      if (step.status === 'open') return openStep(deps, run)
      if (step.status === 'resolved') {
        if (run.subject.conversation?.status === 'resolved') return skipped('unchanged')
        await caused(db, run.runId, (tx) => resolve(tx, run.actor, id))
        return done()
      }
      const until = new Date(Date.now() + (step.hours ?? 24) * 3600_000)
      await caused(db, run.runId, (tx) => snooze(tx, run.actor, id, until))
      return done(until.toISOString())
    }
    case 'reply':
      return writeStep(deps, run, 'text', step.body)
    case 'note':
      return writeStep(deps, run, 'note', step.body)
    case 'notify':
      return notifyStep(deps, run, step)
    case 'webhook':
      return webhookStep(run, step)
    case 'ai':
      return aiStep(deps, run, step)
    case 'data': {
      const id = conversationOf(run)
      const value: MetadataValue = render(step.value, run.scope).slice(0, 1000)
      await caused(db, run.runId, (tx) => patchConversationData(tx, id, { [step.key]: value }))
      return done(value, value)
    }
    case 'ask_email': {
      const id = conversationOf(run)
      const asked = await caused(db, run.runId, (tx) =>
        requestEmail(tx, id, run.actor.name, render(step.text, run.scope).trim() || null),
      )
      return asked ? done() : skipped('not_needed')
    }
    default:
      throw new Error(`step ${step.kind} is the engine's`)
  }
}
