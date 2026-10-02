/**
 * The automations (D20): what sets one off, the conversations it acts on, and the steps it
 * takes — basedb's, made for conversations. Stored as written here, checked by the server.
 */

// ── What sets it off ────────────────────────────────────────────────────────

export type AutomationTriggerKind =
  /** A conversation begins. */
  | 'conversation_created'
  /** The visitor writes. */
  | 'visitor_message'
  /** The AI hands the conversation over to the agents. */
  | 'handed_off'
  | 'assigned'
  | 'transferred'
  | 'resolved'
  | 'reopened'
  /** The AI read the visitor's mood anew — after the message, not with it. */
  | 'sentiment_changed'
  /** The visitor's last message has waited `minutes` for an answer. */
  | 'no_reply'
  /** At set times — once, or for each conversation the condition keeps. */
  | 'schedule'
  /** An agent starts it, from a conversation. */
  | 'button'
  /** Another system calls the automation's address. */
  | 'webhook'

export interface AutomationSchedule {
  readonly every: 'hour' | 'day' | 'weekdays' | 'week'
  /** `HH:MM`, in `timezone`; the minutes alone for `hour`. */
  readonly at: string
  /** 1 (Monday) to 7, for `week`. */
  readonly weekday: number
  readonly timezone: string
}

export interface AutomationTrigger {
  readonly kind: AutomationTriggerKind
  /** `no_reply`: how long the visitor waits, in minutes. */
  readonly minutes?: number
  readonly schedule?: AutomationSchedule
  /**
   * `schedule`: one run for each conversation of the last ninety days that the condition
   * keeps — two hundred at most a time; otherwise one run, about no conversation.
   */
  readonly forEach?: boolean
}

// ── Which conversations ─────────────────────────────────────────────────────

export type ConditionField =
  | 'inbox'
  | 'team'
  | 'site'
  | 'status'
  | 'priority'
  | 'sentiment'
  | 'assignee'
  | 'tags'
  /** The contact is known to the site (signed identity). */
  | 'identified'
  /** The site's opening hours, now. */
  | 'hours'
  /** The words of the message that set the automation off. */
  | 'message'
  /** Minutes since the last message. */
  | 'idle'
  /** A value of the conversation's data (`key`). */
  | 'data'
  /** What an earlier step gave (`key`: the step's id). */
  | 'step'

export type ConditionOperator =
  /** One of `values`. */
  | 'is'
  | 'is_not'
  | 'empty'
  | 'not_empty'
  | 'has'
  | 'has_not'
  | 'contains'
  | 'not_contains'
  | 'equals'
  | 'not_equals'
  | 'yes'
  | 'no'
  | 'open'
  | 'closed'
  /** A number of minutes, for `idle`. */
  | 'more_than'
  | 'less_than'

export interface ConditionRule {
  readonly field: ConditionField
  readonly op: ConditionOperator
  readonly values: readonly string[]
  readonly key?: string
}

export interface Condition {
  readonly match: 'all' | 'any'
  readonly rules: readonly ConditionRule[]
}

// ── What it does ────────────────────────────────────────────────────────────

interface StepBase {
  /** `s1`, `s2`… — what a citation `{{etape.s2}}` names. */
  readonly id: string
}

export interface AssignStep extends StepBase {
  readonly kind: 'assign'
  /**
   * `agent`: a given one; `least_busy`: the active member of `teamId` with the fewest open
   * conversations; `round_robin`: its members in turn; `nobody`: back to the queue.
   */
  readonly to: 'agent' | 'least_busy' | 'round_robin' | 'nobody'
  readonly agentId?: string
  readonly teamId?: string
}

export interface TransferStep extends StepBase {
  readonly kind: 'transfer'
  readonly inboxId?: string
  readonly teamId?: string
}

export interface TagStep extends StepBase {
  readonly kind: 'tag'
  readonly add: readonly string[]
  readonly remove: readonly string[]
}

export interface PriorityStep extends StepBase {
  readonly kind: 'priority'
  readonly priority: 'low' | 'normal' | 'high' | 'urgent'
}

export interface StatusStep extends StepBase {
  readonly kind: 'status'
  /** `open`: to the agents (and out of the AI's hands); `snoozed`: on hold for `hours`. */
  readonly status: 'open' | 'resolved' | 'snoozed'
  readonly hours?: number
}

export interface ReplyStep extends StepBase {
  readonly kind: 'reply'
  /** May cite: `{{contact.prenom}}`… */
  readonly body: string
}

export interface NoteStep extends StepBase {
  readonly kind: 'note'
  readonly body: string
}

export interface NotifyStep extends StepBase {
  readonly kind: 'notify'
  readonly to: 'assignee' | 'team' | 'supervisors' | 'agents'
  readonly agentIds?: readonly string[]
  readonly teamId?: string
  readonly text: string
}

export interface WebhookStep extends StepBase {
  readonly kind: 'webhook'
  readonly url: string
  /** Header values may name an environment variable: `${CRM_TOKEN}`. */
  readonly headers: readonly { readonly name: string; readonly value: string }[]
  /** JSON, with citations; empty: the conversation as the API gives it. */
  readonly body: string
}

export interface AiStep extends StepBase {
  readonly kind: 'ai'
  /** `classify`: one of `choices`; `write`: a text. Either is `{{etape.<id>}}`. */
  readonly mode: 'classify' | 'write'
  readonly prompt: string
  readonly choices: readonly string[]
}

/**
 * « Demander l'e-mail du visiteur »: the widget shows a card to leave it — when the contact
 * has none. `text` says why; empty, the widget's own words.
 */
export interface AskEmailStep extends StepBase {
  readonly kind: 'ask_email'
  readonly text: string
}

export interface DataStep extends StepBase {
  readonly kind: 'data'
  readonly key: string
  readonly value: string
}

export interface BranchPath {
  readonly id: string
  readonly label: string
  readonly condition: Condition
  /** « Sinon »: taken when no other path is. Last. */
  readonly otherwise: boolean
  readonly steps: readonly AutomationStep[]
}

export interface BranchStep extends StepBase {
  readonly kind: 'branch'
  readonly paths: readonly BranchPath[]
}

export interface WaitStep extends StepBase {
  readonly kind: 'wait'
  readonly amount: number
  readonly unit: 'minutes' | 'hours' | 'days'
  /** Stop there if the visitor wrote meanwhile (a reminder that is no longer needed). */
  readonly unlessReply: boolean
}

export type AutomationStep =
  | AssignStep
  | TransferStep
  | TagStep
  | PriorityStep
  | StatusStep
  | ReplyStep
  | NoteStep
  | NotifyStep
  | WebhookStep
  | AiStep
  | DataStep
  | AskEmailStep
  | BranchStep
  | WaitStep

export type AutomationStepKind = AutomationStep['kind']

// ── The automation, and its runs ────────────────────────────────────────────

export interface AutomationDefinition {
  readonly name: string
  readonly description: string
  readonly trigger: AutomationTrigger
  readonly condition: Condition
  readonly steps: readonly AutomationStep[]
}

export interface Automation extends AutomationDefinition {
  readonly id: string
  readonly active: boolean
  /** `webhook`: the address to call, with its key — shown in full to supervisors. */
  readonly webhookUrl: string | null
  readonly createdBy: string
  readonly updatedAt: string
  readonly lastRunAt: string | null
  /** Runs over the last seven days, and how many failed. */
  readonly runs7d: number
  readonly failed7d: number
}

export type AutomationRunStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'succeeded'
  | 'failed'
  /** Stopped by a wait whose visitor answered, or by a supervisor. */
  | 'stopped'

/** What one step did, in a run. */
export interface RunStepRecord {
  readonly id: string
  readonly kind: AutomationStepKind
  readonly status: 'succeeded' | 'failed' | 'skipped'
  /** What it did, as data: the agent given, the path taken, the AI's answer… */
  readonly detail?: string
  /** A branch: the path it took. */
  readonly path?: string
  readonly error?: string
  readonly ms?: number
}

export interface AutomationRun {
  readonly id: string
  readonly automationId: string
  readonly status: AutomationRunStatus
  readonly conversationId: string | null
  readonly contactName: string | null
  /** What set it off: an event, a time, an agent's name. */
  readonly cause: string
  readonly steps: readonly RunStepRecord[]
  readonly error: string | null
  readonly createdAt: string
  readonly finishedAt: string | null
  /** A wait's end. */
  readonly resumeAt: string | null
}

export interface AutomationRunList {
  readonly items: readonly AutomationRun[]
}

/** The automations an agent may start from a conversation. */
export interface AutomationButton {
  readonly id: string
  readonly name: string
  readonly description: string
}

/** What the editor offers: who, where, which tags. */
export interface AutomationChoices {
  readonly inboxes: readonly { readonly id: string; readonly name: string }[]
  readonly teams: readonly { readonly id: string; readonly name: string }[]
  readonly sites: readonly {
    readonly id: string
    readonly name: string
    readonly timezone: string
  }[]
  readonly agents: readonly { readonly id: string; readonly name: string }[]
  readonly tags: readonly { readonly name: string; readonly color: string }[]
  readonly ai: boolean
}
