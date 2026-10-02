import type {
  AutomationDefinition,
  AutomationSchedule,
  AutomationStep,
  AutomationTrigger,
  AutomationTriggerKind,
  BranchPath,
  Condition,
  ConditionField,
  ConditionOperator,
  ConditionRule,
} from '@chat/contracts'
import { Refusal } from '../refusal.js'
import { addDays, instantOf, localTime } from '../settings/hours.js'

/**
 * An automation as written (D20): read from what the editor sends — bounded, shaped,
 * defaulted —, then checked for what would keep it from running. A draft may be saved
 * with a problem; it is switched on only without one.
 */

export const TRIGGER_KINDS: readonly AutomationTriggerKind[] = [
  'conversation_created',
  'visitor_message',
  'handed_off',
  'assigned',
  'transferred',
  'resolved',
  'reopened',
  'no_reply',
  'schedule',
  'button',
  'webhook',
]

/** The captured events (D17) that set each trigger off. */
export const EVENT_TRIGGERS: Readonly<Record<string, AutomationTriggerKind>> = {
  'conversation.created': 'conversation_created',
  // The visitor's only: the drain reads the message's author.
  'message.created': 'visitor_message',
  'conversation.handed_off': 'handed_off',
  'conversation.assigned': 'assigned',
  'conversation.transferred': 'transferred',
  'conversation.resolved': 'resolved',
  'conversation.reopened': 'reopened',
}

const FIELDS: Readonly<Record<ConditionField, readonly ConditionOperator[]>> = {
  inbox: ['is', 'is_not', 'empty', 'not_empty'],
  team: ['is', 'is_not', 'empty', 'not_empty'],
  site: ['is', 'is_not'],
  status: ['is', 'is_not'],
  priority: ['is', 'is_not'],
  sentiment: ['is', 'is_not', 'empty', 'not_empty'],
  assignee: ['is', 'is_not', 'empty', 'not_empty'],
  tags: ['has', 'has_not'],
  identified: ['yes', 'no'],
  hours: ['open', 'closed'],
  message: ['contains', 'not_contains', 'equals', 'not_equals', 'empty', 'not_empty'],
  idle: ['more_than', 'less_than'],
  data: ['contains', 'not_contains', 'equals', 'not_equals', 'empty', 'not_empty'],
  step: ['contains', 'not_contains', 'equals', 'not_equals', 'empty', 'not_empty'],
}

const MAX_STEPS = 60
const MAX_DEPTH = 4
const MAX_PATHS = 6
const MAX_RULES = 20
const MAX_VALUES = 50
const TEXT = 4000
const SHORT = 200

export const STEP_ID = /^s\d{1,4}$/
const PATH_ID = /^p\d{1,4}$/
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

type Raw = Record<string, unknown>

function invalid(problem: string, step?: string): never {
  throw new Refusal('AUTOMATION_INVALID', 400, step ? { problem, step } : { problem })
}

const record = (value: unknown): Raw =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {}

function text(value: unknown, max: number, problem: string, step?: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') invalid(problem, step)
  const trimmed = value.trim()
  if (trimmed.length > max) invalid(problem, step)
  return trimmed
}

function strings(value: unknown, max: number, problem: string, step?: string): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > max) invalid(problem, step)
  return [
    ...new Set(
      value.map((v) => {
        if (typeof v !== 'string' || v.length > SHORT) invalid(problem, step)
        return v.trim()
      }),
    ),
  ].filter((v) => v !== '')
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  problem: string,
  step?: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) invalid(problem, step)
  return value as T
}

function integer(value: unknown, min: number, max: number, problem: string, step?: string): number {
  const n = typeof value === 'string' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) invalid(problem, step)
  return n
}

const optionalId = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' && value.length <= SHORT
    ? value.trim()
    : undefined

export function readCondition(raw: unknown, step?: string): Condition {
  const value = record(raw)
  const rules = value.rules ?? []
  if (!Array.isArray(rules) || rules.length > MAX_RULES) invalid('condition', step)
  return {
    match: value.match === 'any' ? 'any' : 'all',
    rules: rules.map((r): ConditionRule => {
      const rule = record(r)
      const field = oneOf(rule.field, Object.keys(FIELDS) as ConditionField[], 'condition', step)
      const op = oneOf(rule.op, FIELDS[field], 'condition', step)
      const key = optionalId(rule.key)
      return {
        field,
        op,
        values: strings(rule.values, MAX_VALUES, 'condition', step),
        ...(key === undefined ? {} : { key }),
      }
    }),
  }
}

function readSchedule(raw: unknown): AutomationSchedule {
  const value = record(raw)
  const every = oneOf(
    value.every ?? 'day',
    ['hour', 'day', 'weekdays', 'week'] as const,
    'schedule',
  )
  const at = typeof value.at === 'string' && TIME.test(value.at) ? value.at : invalid('schedule')
  const timezone = typeof value.timezone === 'string' ? value.timezone : 'Europe/Paris'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    invalid('schedule')
  }
  return { every, at, weekday: integer(value.weekday ?? 1, 1, 7, 'schedule'), timezone }
}

export function readTrigger(raw: unknown): AutomationTrigger {
  const value = record(raw)
  const kind = oneOf(value.kind, TRIGGER_KINDS, 'trigger')
  if (kind === 'no_reply')
    return { kind, minutes: integer(value.minutes ?? 15, 1, 10_080, 'minutes') }
  if (kind === 'schedule') {
    return { kind, schedule: readSchedule(value.schedule), forEach: value.forEach === true }
  }
  return { kind }
}

interface Ids {
  readonly steps: Set<string>
  readonly paths: Set<string>
  count: number
}

function readSteps(raw: unknown, depth: number, ids: Ids): AutomationStep[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) invalid('steps')
  return raw.map((r) => readStep(r, depth, ids))
}

function readPath(raw: unknown, step: string, depth: number, ids: Ids): BranchPath {
  const value = record(raw)
  const id =
    typeof value.id === 'string' && PATH_ID.test(value.id) ? value.id : invalid('path', step)
  if (ids.paths.has(id)) invalid('path', step)
  ids.paths.add(id)
  return {
    id,
    label: text(value.label, 80, 'path', step),
    condition: readCondition(value.condition, step),
    otherwise: value.otherwise === true,
    steps: readSteps(value.steps, depth + 1, ids),
  }
}

function readStep(raw: unknown, depth: number, ids: Ids): AutomationStep {
  const value = record(raw)
  const id = typeof value.id === 'string' && STEP_ID.test(value.id) ? value.id : invalid('steps')
  if (ids.steps.has(id)) invalid('steps', id)
  ids.steps.add(id)
  if (++ids.count > MAX_STEPS) invalid('too_many_steps')
  const kind = value.kind
  switch (kind) {
    case 'assign': {
      const to = oneOf(
        value.to ?? 'agent',
        ['agent', 'least_busy', 'round_robin', 'nobody'] as const,
        'assign',
        id,
      )
      const agentId = optionalId(value.agentId)
      const teamId = optionalId(value.teamId)
      return { id, kind, to, ...(agentId ? { agentId } : {}), ...(teamId ? { teamId } : {}) }
    }
    case 'transfer': {
      const inboxId = optionalId(value.inboxId)
      const teamId = optionalId(value.teamId)
      return { id, kind, ...(inboxId ? { inboxId } : {}), ...(teamId ? { teamId } : {}) }
    }
    case 'tag':
      return {
        id,
        kind,
        add: strings(value.add, 20, 'tag', id),
        remove: strings(value.remove, 20, 'tag', id),
      }
    case 'priority':
      return {
        id,
        kind,
        priority: oneOf(
          value.priority ?? 'high',
          ['low', 'normal', 'high', 'urgent'] as const,
          'priority',
          id,
        ),
      }
    case 'status': {
      const status = oneOf(
        value.status ?? 'open',
        ['open', 'resolved', 'snoozed'] as const,
        'status',
        id,
      )
      return status === 'snoozed'
        ? { id, kind, status, hours: integer(value.hours ?? 24, 1, 24 * 365, 'status', id) }
        : { id, kind, status }
    }
    case 'reply':
    case 'note':
      return { id, kind, body: text(value.body, TEXT, 'body', id) }
    case 'ask_email':
      return { id, kind, text: text(value.text, 500, 'body', id) }
    case 'notify': {
      const to = oneOf(
        value.to ?? 'assignee',
        ['assignee', 'team', 'supervisors', 'agents'] as const,
        'notify',
        id,
      )
      const teamId = optionalId(value.teamId)
      return {
        id,
        kind,
        to,
        agentIds: strings(value.agentIds, 50, 'notify', id),
        ...(teamId ? { teamId } : {}),
        text: text(value.text, 500, 'notify', id),
      }
    }
    case 'webhook': {
      const headers = value.headers ?? []
      if (!Array.isArray(headers) || headers.length > 20) invalid('headers', id)
      return {
        id,
        kind,
        url: text(value.url, 2000, 'url', id),
        headers: headers
          .map((h) => {
            const header = record(h)
            return {
              name: text(header.name, 100, 'headers', id),
              value: text(header.value, 2000, 'headers', id),
            }
          })
          .filter((h) => h.name !== ''),
        body: text(value.body, TEXT * 4, 'body', id),
      }
    }
    case 'ai':
      return {
        id,
        kind,
        mode: oneOf(value.mode ?? 'classify', ['classify', 'write'] as const, 'ai', id),
        prompt: text(value.prompt, TEXT, 'prompt', id),
        choices: strings(value.choices, 12, 'choices', id),
      }
    case 'data':
      return {
        id,
        kind,
        key: text(value.key, 60, 'data', id),
        value: text(value.value, TEXT, 'data', id),
      }
    case 'branch': {
      if (depth >= MAX_DEPTH) invalid('too_deep', id)
      const paths = value.paths ?? []
      if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_PATHS)
        invalid('paths', id)
      const read = paths.map((p) => readPath(p, id, depth, ids))
      // « Sinon » is the last path, or none is.
      if (read.some((p, i) => p.otherwise && i !== read.length - 1)) invalid('paths', id)
      return { id, kind, paths: read }
    }
    case 'wait':
      return {
        id,
        kind,
        amount: integer(value.amount ?? 1, 1, 10_000, 'wait', id),
        unit: oneOf(value.unit ?? 'hours', ['minutes', 'hours', 'days'] as const, 'wait', id),
        unlessReply: value.unlessReply === true,
      }
    default:
      return invalid('steps', id)
  }
}

/** What the editor sent, as an automation — or `AUTOMATION_INVALID`, with the problem. */
export function readDefinition(raw: unknown): AutomationDefinition {
  const value = record(raw)
  const name = text(value.name, 120, 'name')
  if (name === '') invalid('name')
  const ids: Ids = { steps: new Set(), paths: new Set(), count: 0 }
  return {
    name,
    description: text(value.description, 500, 'description'),
    trigger: readTrigger(value.trigger),
    condition: readCondition(value.condition),
    steps: readSteps(value.steps, 0, ids),
  }
}

// ── What keeps it from running ──────────────────────────────────────────────

export interface Problem {
  readonly problem: string
  readonly step?: string
}

/** Whether its runs are about a conversation. */
export const aboutConversation = (trigger: AutomationTrigger): boolean =>
  !(trigger.kind === 'schedule' && !trigger.forEach)

/** Every step, those of the paths included, in order. */
export function allSteps(steps: readonly AutomationStep[]): AutomationStep[] {
  return steps.flatMap((s) =>
    s.kind === 'branch' ? [s, ...s.paths.flatMap((p) => allSteps(p.steps))] : [s],
  )
}

const NEEDS_CONVERSATION = new Set([
  'assign',
  'transfer',
  'tag',
  'priority',
  'status',
  'reply',
  'note',
  'notify',
  'data',
  'ask_email',
])

/** The first thing that would keep the automation from running, or `null`. */
export function problemOf(definition: AutomationDefinition): Problem | null {
  if (definition.steps.length === 0) return { problem: 'no_steps' }
  const conversation = aboutConversation(definition.trigger)
  const earlier = new Set<string>()
  for (const step of allSteps(definition.steps)) {
    const problem = stepProblem(step, conversation, earlier)
    if (problem !== null) return { problem, step: step.id }
    earlier.add(step.id)
  }
  return null
}

function stepProblem(
  step: AutomationStep,
  conversation: boolean,
  earlier: ReadonlySet<string>,
): string | null {
  if (!conversation && NEEDS_CONVERSATION.has(step.kind)) return 'needs_conversation'
  switch (step.kind) {
    case 'assign':
      if (step.to === 'agent' && !step.agentId) return 'agent_missing'
      if ((step.to === 'least_busy' || step.to === 'round_robin') && !step.teamId)
        return 'team_missing'
      return null
    case 'transfer':
      return step.inboxId || step.teamId ? null : 'target_missing'
    case 'tag':
      return step.add.length + step.remove.length > 0 ? null : 'tag_missing'
    case 'reply':
    case 'note':
      return step.body === '' ? 'body_missing' : null
    case 'notify':
      if (step.text === '') return 'text_missing'
      return step.to === 'team' && !step.teamId ? 'team_missing' : null
    case 'webhook':
      return /^https?:\/\//.test(step.url) ? null : 'url_missing'
    case 'ai':
      if (step.prompt === '') return 'prompt_missing'
      return step.mode === 'classify' && step.choices.length < 2 ? 'choices_missing' : null
    case 'data':
      return step.key === '' ? 'key_missing' : null
    case 'branch':
      for (const path of step.paths) {
        for (const rule of path.condition.rules) {
          if (rule.field === 'step' && !earlier.has(rule.key ?? '')) return 'step_unknown'
        }
      }
      return null
    default:
      return null
  }
}

/**
 * Where to go on after a wait: what is left of its own sequence, then of each sequence
 * around it, innermost first — or `null` when the step is no longer there.
 */
export function continuationAfter(
  steps: readonly AutomationStep[],
  id: string,
): (readonly AutomationStep[])[] | null {
  for (const [index, step] of steps.entries()) {
    if (step.id === id) return [steps.slice(index + 1)]
    if (step.kind !== 'branch') continue
    for (const path of step.paths) {
      const inner = continuationAfter(path.steps, id)
      if (inner) return [...inner, steps.slice(index + 1)]
    }
  }
  return null
}

// ── When a schedule goes off ────────────────────────────────────────────────

/** The first time after `after` that the schedule names, in its time zone. */
export function nextOccurrence(schedule: AutomationSchedule, after: Date): Date {
  const [hh, mm] = schedule.at.split(':').map(Number) as [number, number]
  const here = localTime(after, schedule.timezone)
  if (schedule.every === 'hour') {
    const next = new Date(after.getTime())
    next.setUTCSeconds(0, 0)
    // The minute of the hour, in any time zone of whole or half hours alike.
    const minute = (here.minutes % 60) as number
    const ahead = (mm - minute + 60) % 60 || 60
    return new Date(next.getTime() + ahead * 60_000)
  }
  for (let offset = 0; offset < 9; offset++) {
    const date = addDays(here.date, offset)
    const weekday = ((here.weekday - 1 + offset) % 7) + 1
    if (schedule.every === 'weekdays' && weekday > 5) continue
    if (schedule.every === 'week' && weekday !== schedule.weekday) continue
    const at = instantOf(date, hh * 60 + mm, schedule.timezone)
    if (at.getTime() > after.getTime()) return at
  }
  // Unreachable for a valid schedule: a week holds every weekday.
  return new Date(after.getTime() + 24 * 3600_000)
}
