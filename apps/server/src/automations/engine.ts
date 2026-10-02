import type { AutomationStep, RunStepRecord } from '@chat/contracts'
import { and, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { agents, automationRuns, automations, conversations, messages } from '../db/schema.js'
import { Refusal } from '../refusal.js'
import { EVENT_TRIGGERS, allSteps, continuationAfter, nextOccurrence } from './model.js'
import { type StepDeps, runStep } from './steps.js'
import { type Subject, holds, loadSubject, loadSubjects, scopeOf } from './subject.js'

/**
 * The automations at work (D20) — basedb's engine, made for conversations:
 *
 * - every two seconds, what the triggers captured (D17) becomes runs of the automations
 *   that listen and whose condition the conversation meets; then up to ten runs are
 *   claimed — `SKIP LOCKED`, any number of processes — and worked, step after step;
 * - a wait puts its run aside until its time, and the run goes on from there;
 * - every half-minute, the schedules due go off; every minute, the conversations whose
 *   visitor waits for an answer are looked for (`no_reply`), once per message left waiting;
 * - an automation is never set off by what its own run did; a chain of automations
 *   setting each other off stops at three; an automation runs a hundred times an hour at
 *   most — what goes beyond is dropped, and said in the server's log;
 * - a run the process died in is failed (`INTERRUPTED`), not run again: its steps may have
 *   written already. Runs are kept ninety days.
 */

const PASS_MS = 2000
const SCHEDULE_MS = 30_000
const NO_REPLY_MS = 60_000
const SWEEP_MS = 3600_000
const CLAIM = 10
const LEASE = '2 minutes'
/** The time a run may take at one go — under its lease. */
const BUDGET_MS = 100_000
const MAX_DEPTH = 3
const PER_HOUR = 100
const FOR_EACH_MAX = 200
const FOR_EACH_DAYS = 90

type AutomationRow = typeof automations.$inferSelect
type RunRow = typeof automationRuns.$inferSelect

export type EngineDeps = StepDeps

async function listening(db: Db): Promise<AutomationRow[]> {
  return db
    .select()
    .from(automations)
    .where(and(eq(automations.isActive, true), isNull(automations.deletedAt)))
}

interface Queued {
  readonly conversationId: string | null
  readonly cause: Record<string, unknown>
  readonly input?: unknown
  readonly depth?: number
  readonly dedupKey?: string
  /** A schedule's « for each »: bounded already, not counted against the hour. */
  readonly unlimited?: boolean
}

/** Queues a run — `null` when the hour's runs are spent, or its key was used already. */
export async function queueRun(db: Db, automationId: string, run: Queued): Promise<string | null> {
  if (!run.unlimited) {
    const [recent] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(automationRuns)
      .where(
        and(
          eq(automationRuns.automationId, automationId),
          gt(automationRuns.createdAt, sql`now() - interval '1 hour'`),
        ),
      )
    if ((recent?.n ?? 0) >= PER_HOUR) {
      console.warn(
        `chat : automatisation ${automationId} — plus de ${PER_HOUR} exécutions en une heure`,
      )
      return null
    }
  }
  const [row] = await db
    .insert(automationRuns)
    .values({
      automationId,
      conversationId: run.conversationId,
      cause: run.cause,
      input: run.input ?? null,
      depth: run.depth ?? 0,
      dedupKey: run.dedupKey ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: automationRuns.id })
  return row?.id ?? null
}

// ── Events → runs ───────────────────────────────────────────────────────────

const EVENT_KINDS = new Set(Object.values(EVENT_TRIGGERS))

/** What the triggers captured, made into runs; returns how many events were read. */
export async function drainEvents(deps: EngineDeps): Promise<number> {
  return deps.db.transaction(async (raw) => {
    const tx = raw as unknown as Db
    const { rows } = await tx.execute<{
      id: string
      type: string
      conversation_id: string | null
      message_id: string | null
      caused_by: string | null
    }>(sql`
      select id, type, conversation_id, message_id, caused_by from chat.change_event
      where automated_at is null
      order by occurred_at
      limit 200
      for update skip locked`)
    if (rows.length === 0) return 0
    const listeners = (await listening(tx)).filter((a) => EVENT_KINDS.has(a.trigger.kind))
    if (listeners.length > 0) {
      const causeIds = [...new Set(rows.map((r) => r.caused_by).filter((c): c is string => !!c))]
      const causes = new Map(
        causeIds.length === 0
          ? []
          : (
              await tx
                .select({
                  id: automationRuns.id,
                  automationId: automationRuns.automationId,
                  depth: automationRuns.depth,
                })
                .from(automationRuns)
                .where(inArray(automationRuns.id, causeIds))
            ).map((c) => [c.id, c]),
      )
      const messageIds = rows
        .filter((r) => r.type === 'message.created' && r.message_id)
        .map((r) => r.message_id as string)
      const authors = new Map(
        messageIds.length === 0
          ? []
          : (
              await tx
                .select({ id: messages.id, author: messages.author })
                .from(messages)
                .where(inArray(messages.id, messageIds))
            ).map((m) => [m.id, m.author]),
      )
      for (const row of rows) {
        const kind = EVENT_TRIGGERS[row.type]
        if (!kind || !row.conversation_id) continue
        if (kind === 'visitor_message' && authors.get(row.message_id ?? '') !== 'contact') continue
        const candidates = listeners.filter((a) => a.trigger.kind === kind)
        if (candidates.length === 0) continue
        const cause = row.caused_by ? causes.get(row.caused_by) : undefined
        const depth = cause ? cause.depth + 1 : 0
        if (depth > MAX_DEPTH) continue
        const subject = await loadSubject(
          tx,
          deps.settings,
          row.conversation_id,
          kind === 'visitor_message' ? row.message_id : null,
        )
        for (const automation of candidates) {
          if (cause?.automationId === automation.id) continue
          if (!holds(automation.condition, subject)) continue
          await queueRun(tx, automation.id, {
            conversationId: row.conversation_id,
            cause: { type: 'event', event: kind, messageId: row.message_id },
            depth,
          })
        }
      }
    }
    await tx.execute(sql`
      update chat.change_event set automated_at = now()
      where id in (${sql.join(
        rows.map((r) => sql`${r.id}::uuid`),
        sql`, `,
      )})`)
    return rows.length
  })
}

// ── Schedules ───────────────────────────────────────────────────────────────

/** The conversations of the last ninety days that `condition` keeps — `max` at most. */
async function conversationsKept(
  deps: EngineDeps,
  automation: AutomationRow,
  max: number,
): Promise<string[]> {
  const recent = await deps.db
    .select({ id: conversations.id })
    .from(conversations)
    .where(gt(conversations.lastMessageAt, sql`now() - ${`${FOR_EACH_DAYS} days`}::interval`))
    .orderBy(sql`${conversations.lastMessageAt} desc`)
    .limit(5000)
  const kept: string[] = []
  for (let at = 0; at < recent.length && kept.length < max; at += 500) {
    const ids = recent.slice(at, at + 500).map((r) => r.id)
    const subjects = await loadSubjects(deps.db, deps.settings, ids)
    for (const id of ids) {
      const subject = subjects.get(id)
      if (subject && holds(automation.condition, subject) && kept.length < max) kept.push(id)
    }
  }
  return kept
}

export async function fireSchedules(deps: EngineDeps, now = new Date()): Promise<number> {
  const due = await deps.db.transaction(async (raw) => {
    const tx = raw as unknown as Db
    const rows = await tx
      .select()
      .from(automations)
      .where(
        and(
          eq(automations.isActive, true),
          isNull(automations.deletedAt),
          lt(automations.nextRunAt, now),
        ),
      )
      .for('update', { skipLocked: true })
    for (const row of rows) {
      const schedule = row.trigger.schedule
      await tx
        .update(automations)
        .set({ nextRunAt: schedule ? nextOccurrence(schedule, now) : null })
        .where(eq(automations.id, row.id))
    }
    return rows.filter((r) => r.trigger.kind === 'schedule')
  })
  for (const automation of due) {
    const at = now.toISOString()
    if (!automation.trigger.forEach) {
      await queueRun(deps.db, automation.id, {
        conversationId: null,
        cause: { type: 'schedule', at },
        dedupKey: `schedule:${at}`,
      })
      continue
    }
    for (const id of await conversationsKept(deps, automation, FOR_EACH_MAX)) {
      await queueRun(deps.db, automation.id, {
        conversationId: id,
        cause: { type: 'schedule', at },
        dedupKey: `schedule:${at}:${id}`,
        unlimited: true,
      })
    }
  }
  return due.length
}

// ── A visitor left waiting ──────────────────────────────────────────────────

export async function scanNoReply(deps: EngineDeps): Promise<number> {
  const watching = (await listening(deps.db)).filter((a) => a.trigger.kind === 'no_reply')
  let queued = 0
  for (const automation of watching) {
    const minutes = automation.trigger.minutes ?? 15
    const since = automation.activatedAt ?? new Date(0)
    // Their last words are the visitor's, and older than the delay — by a day at most.
    const { rows } = await deps.db.execute<{ id: string; message_id: string }>(sql`
      select c.id, m.id as message_id
      from chat.conversation c
      join lateral (
        select id, author, created_at from chat.message
        where conversation_id = c.id and kind in ('text', 'file') and deleted_at is null
        order by created_at desc limit 1
      ) m on true
      where c.status in ('ai', 'open')
        and c.last_message_at <= now() - ${minutes} * interval '1 minute'
        and c.last_message_at > now() - ${minutes + 1440} * interval '1 minute'
        and m.author = 'contact'
        and m.created_at >= ${since}
        and not exists (
          select 1 from chat.automation_run r
          where r.automation_id = ${automation.id} and r.dedup_key = 'reply:' || m.id::text)
      limit 500`)
    if (rows.length === 0) continue
    const subjects = await loadSubjects(
      deps.db,
      deps.settings,
      rows.map((r) => r.id),
    )
    for (const row of rows) {
      const subject = subjects.get(row.id)
      if (!subject || !holds(automation.condition, subject)) continue
      const id = await queueRun(deps.db, automation.id, {
        conversationId: row.id,
        cause: { type: 'event', event: 'no_reply', messageId: row.message_id },
        dedupKey: `reply:${row.message_id}`,
      })
      if (id) queued++
    }
  }
  return queued
}

// ── Runs ────────────────────────────────────────────────────────────────────

async function claim(db: Db): Promise<RunRow[]> {
  // A run whose process died: its steps may have written — failed, not run again.
  await db
    .update(automationRuns)
    .set({ status: 'failed', error: 'INTERRUPTED', finishedAt: new Date(), leaseUntil: null })
    .where(and(eq(automationRuns.status, 'running'), lt(automationRuns.leaseUntil, new Date())))
  const { rows } = await db.execute<{ id: string }>(sql`
    update chat.automation_run set status = 'running', lease_until = now() + ${LEASE}::interval
    where id in (
      select id from chat.automation_run
      where status = 'queued' or (status = 'waiting' and resume_at <= now())
      order by created_at
      limit ${CLAIM}
      for update skip locked)
    returning id`)
  if (rows.length === 0) return []
  return db
    .select()
    .from(automationRuns)
    .where(
      inArray(
        automationRuns.id,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(automationRuns.createdAt)
}

/** A failure, said as a code for the run's log. */
function codeOf(error: unknown): string {
  if (error instanceof Refusal) return error.code
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'TIMEOUT'
    if (/^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message
    console.error('chat : automatisation', error)
  }
  return 'ERROR'
}

const UNIT_MS = { minutes: 60_000, hours: 3600_000, days: 86_400_000 } as const

/** Works one claimed run: from its start, or from the wait it was put aside at. */
export async function workRun(deps: EngineDeps, run: RunRow): Promise<void> {
  const { db } = deps
  const records: RunStepRecord[] = [...run.steps]
  const outputs: Record<string, string> = { ...run.outputs }
  const save = (values: Partial<typeof automationRuns.$inferInsert>) =>
    db
      .update(automationRuns)
      .set({ steps: records, outputs, leaseUntil: null, ...values })
      .where(eq(automationRuns.id, run.id))
  const finish = (status: 'succeeded' | 'failed' | 'stopped', error: string | null = null) =>
    save({ status, error, finishedAt: new Date(), resumeAt: null })

  const [automation] = await db
    .select()
    .from(automations)
    .where(eq(automations.id, run.automationId))
  if (!automation || automation.deletedAt) return void (await finish('stopped', 'AUTOMATION_GONE'))
  const trying = run.cause.type === 'test'
  if (!automation.isActive && !trying) return void (await finish('stopped', 'AUTOMATION_OFF'))
  const [actor] = await db.select().from(agents).where(eq(agents.id, automation.agentId))
  if (!actor) return void (await finish('failed', 'AUTOMATION_GONE'))

  let sequences: (readonly AutomationStep[])[] = [automation.steps]
  if (run.resumeAfter !== null) {
    const wait = allSteps(automation.steps).find((s) => s.id === run.resumeAfter)
    if (wait?.kind === 'wait' && wait.unlessReply && run.conversationId && run.waitingSince) {
      const [replied] = await db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, run.conversationId),
            eq(messages.author, 'contact'),
            gt(messages.createdAt, run.waitingSince),
          ),
        )
        .limit(1)
      if (replied) return void (await finish('stopped', 'VISITOR_REPLIED'))
    }
    const rest = continuationAfter(automation.steps, run.resumeAfter)
    if (rest === null) return void (await finish('failed', 'STEP_GONE'))
    sequences = rest
  }

  const messageId = typeof run.cause.messageId === 'string' ? run.cause.messageId : null
  let subject: Subject = await loadSubject(db, deps.settings, run.conversationId, messageId)
  let stale = false
  let scope: Record<string, unknown> = {}
  const refresh = async () => {
    if (stale) {
      const fresh = await loadSubject(db, deps.settings, run.conversationId, null)
      subject = { ...fresh, message: subject.message }
      stale = false
    }
    const [inboxes, teams] = await Promise.all([deps.settings.inboxes(), deps.settings.teams()])
    const c = subject.conversation
    scope = scopeOf(subject, outputs, {
      automation: automation.name,
      webOrigin: deps.webOrigin,
      inboxName: inboxes.find((i) => i.id === c?.inboxId)?.name ?? null,
      teamName: teams.find((t) => t.id === c?.teamId)?.name ?? null,
      input: run.input,
    })
  }

  const started = Date.now()
  let failure: string | null = null
  const sequence = async (steps: readonly AutomationStep[]): Promise<'go' | 'wait' | 'fail'> => {
    for (const step of steps) {
      if (Date.now() - started > BUDGET_MS) {
        failure = 'BUDGET'
        return 'fail'
      }
      const at = Date.now()
      if (step.kind === 'wait') {
        const resumeAt = new Date(at + step.amount * UNIT_MS[step.unit])
        records.push({
          id: step.id,
          kind: step.kind,
          status: 'succeeded',
          detail: resumeAt.toISOString(),
        })
        await save({
          status: 'waiting',
          resumeAt,
          resumeAfter: step.id,
          waitingSince: new Date(at),
        })
        return 'wait'
      }
      await refresh()
      if (step.kind === 'branch') {
        const path = step.paths.find((p) => p.otherwise || holds(p.condition, subject, outputs))
        records.push({
          id: step.id,
          kind: step.kind,
          status: path ? 'succeeded' : 'skipped',
          ...(path ? { path: path.id, detail: path.label } : {}),
          ms: Date.now() - at,
        })
        if (path) {
          const went = await sequence(path.steps)
          if (went !== 'go') return went
        }
        continue
      }
      try {
        const outcome = await runStep(
          deps,
          {
            runId: run.id,
            automationId: automation.id,
            conversationId: run.conversationId,
            actor,
            subject,
            outputs,
            scope,
          },
          step,
        )
        if (outcome.output !== undefined) outputs[step.id] = outcome.output
        records.push({
          id: step.id,
          kind: step.kind,
          status: outcome.status,
          ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
          ms: Date.now() - at,
        })
        stale = true
      } catch (error) {
        failure = codeOf(error)
        records.push({
          id: step.id,
          kind: step.kind,
          status: 'failed',
          error: failure,
          ms: Date.now() - at,
        })
        return 'fail'
      }
    }
    return 'go'
  }

  try {
    for (const steps of sequences) {
      const went = await sequence(steps)
      if (went === 'wait') return
      if (went === 'fail') return void (await finish('failed', failure))
    }
    await finish('succeeded')
  } catch (error) {
    await finish('failed', codeOf(error))
  }
}

/** One pass: the events read, then the runs due worked. */
export async function automationPass(deps: EngineDeps): Promise<void> {
  while ((await drainEvents(deps)) === 200) {}
  for (const run of await claim(deps.db)) {
    await workRun(deps, run).catch((error) => console.error('chat : automatisation', error))
  }
}

export async function sweepAutomations(db: Db): Promise<void> {
  await db.execute(sql`
    delete from chat.automation_run
    where finished_at < now() - interval '90 days'`)
}

/** The engine at work, until `stop`; `poke` hurries the next pass. */
export function startAutomations(deps: EngineDeps): { stop(): Promise<void>; poke(): void } {
  let stopped = false
  const pending = new Set<Promise<void>>()
  const timers: NodeJS.Timeout[] = []
  const every = (ms: number, work: () => Promise<unknown>, first = false) => {
    let running: Promise<void> | null = null
    const go = () => {
      if (running || stopped) return
      const current = work()
        .then(() => undefined)
        .catch((error) => console.error('chat : automatisations', error))
        .finally(() => {
          running = null
          pending.delete(current)
        })
      running = current
      pending.add(current)
    }
    timers.push(setInterval(go, ms))
    if (first) go()
    return go
  }
  const pass = every(PASS_MS, () => automationPass(deps))
  every(SCHEDULE_MS, () => fireSchedules(deps), true)
  every(NO_REPLY_MS, () => scanNoReply(deps))
  every(SWEEP_MS, () => sweepAutomations(deps.db), true)
  return {
    poke: () => setTimeout(pass, 50).unref(),
    stop: async () => {
      stopped = true
      for (const timer of timers) clearInterval(timer)
      await Promise.allSettled([...pending])
    },
  }
}
