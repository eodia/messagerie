import type { Condition, ConditionRule, Metadata } from '@chat/contracts'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { agents, contacts, conversationTags, conversations, messages } from '../db/schema.js'
import { availability } from '../settings/hours.js'
import type { Settings } from '../settings/settings.js'

/**
 * What an automation looks at (D20): a conversation as it is now — its contact, its tags,
 * the message that set it off, whether its site is open — and what the run's steps gave.
 * The condition and the citations read the same.
 */

export interface Subject {
  readonly conversation: {
    readonly id: string
    readonly status: string
    readonly inboxId: string | null
    readonly teamId: string | null
    readonly siteId: string
    readonly siteName: string
    readonly priority: string
    readonly sentiment: string | null
    readonly assigneeId: string | null
    readonly assignee: string | null
    readonly summary: string | null
    readonly lastMessageAt: Date
    readonly data: Metadata
  } | null
  readonly contact: {
    readonly id: string
    readonly name: string
    readonly email: string | null
    readonly phone: string | null
    readonly identified: boolean
  } | null
  readonly tags: readonly string[]
  /** The words of the message that set it off. */
  readonly message: string | null
  /** The survey answer that set it off (`survey_answered`). */
  readonly survey: {
    readonly scale: string
    readonly score: number
    readonly comment: string | null
  } | null
  /** The site's hours, now: `null` when nobody can tell. */
  readonly open: boolean | null
}

export const EMPTY_SUBJECT: Subject = {
  conversation: null,
  contact: null,
  tags: [],
  message: null,
  survey: null,
  open: null,
}

/** The conversations' subjects, by id — one query of each kind, whatever their number. */
export async function loadSubjects(
  db: Db,
  settings: Settings,
  ids: readonly string[],
  now = new Date(),
): Promise<Map<string, Subject>> {
  const found = new Map<string, Subject>()
  if (ids.length === 0) return found
  const rows = await db
    .select({ conversation: conversations, contact: contacts, assignee: agents.name })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .leftJoin(agents, eq(agents.id, conversations.assigneeId))
    .where(inArray(conversations.id, [...ids]))
  const tags = await db
    .select({ conversationId: conversationTags.conversationId, label: conversationTags.label })
    .from(conversationTags)
    .where(inArray(conversationTags.conversationId, [...ids]))
  const sites = new Map((await settings.sites()).map((s) => [s.id, s]))
  const hours = new Map<string, boolean | null>()
  for (const { conversation: c, contact, assignee } of rows) {
    if (!hours.has(c.siteId)) {
      const site = sites.get(c.siteId)
      hours.set(
        c.siteId,
        site
          ? availability(
              await settings.openingSlots(site.id),
              await settings.closures(site.id),
              site.timezone,
              now,
            ).open
          : null,
      )
    }
    found.set(c.id, {
      conversation: {
        id: c.id,
        status: c.status,
        inboxId: c.inboxId,
        teamId: c.teamId,
        siteId: c.siteId,
        siteName: c.siteName,
        priority: c.priority,
        sentiment: c.sentiment,
        assigneeId: c.assigneeId,
        assignee,
        summary: c.summary,
        lastMessageAt: c.lastMessageAt,
        data: c.data,
      },
      contact: {
        id: contact.id,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        identified: contact.identified,
      },
      tags: tags.filter((t) => t.conversationId === c.id).map((t) => t.label),
      message: null,
      survey: null,
      open: hours.get(c.siteId) ?? null,
    })
  }
  return found
}

/** One conversation's subject, with the message that set the run off, if any. */
export async function loadSubject(
  db: Db,
  settings: Settings,
  conversationId: string | null,
  messageId: string | null = null,
): Promise<Subject> {
  if (conversationId === null) return EMPTY_SUBJECT
  const subject = (await loadSubjects(db, settings, [conversationId])).get(conversationId)
  if (!subject) return EMPTY_SUBJECT
  if (messageId === null) return subject
  const [message] = await db
    .select({ body: messages.body, meta: messages.meta })
    .from(messages)
    .where(and(eq(messages.id, messageId), isNull(messages.deletedAt)))
  const event = message?.meta.event
  return {
    ...subject,
    message: message?.body ?? null,
    survey:
      event?.type === 'survey_answered'
        ? { scale: event.scale, score: event.score, comment: event.comment }
        : null,
  }
}

/** The visitor's last words in the conversation — what `visitor_message` gets when retried. */
export async function lastVisitorMessage(db: Db, conversationId: string): Promise<string | null> {
  const [row] = await db
    .select({ body: messages.body })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.author, 'contact')))
    .orderBy(desc(messages.createdAt))
    .limit(1)
  return row?.body ?? null
}

// ── The condition ───────────────────────────────────────────────────────────

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .trim()

function textRule(rule: ConditionRule, value: string | null): boolean {
  const seen = fold(value ?? '')
  const wanted = rule.values.map(fold).filter((v) => v !== '')
  switch (rule.op) {
    case 'empty':
      return seen === ''
    case 'not_empty':
      return seen !== ''
    case 'contains':
      return wanted.some((w) => seen.includes(w))
    case 'not_contains':
      return !wanted.some((w) => seen.includes(w))
    case 'equals':
      return wanted.some((w) => seen === w)
    case 'not_equals':
      return !wanted.some((w) => seen === w)
    default:
      return false
  }
}

function choiceRule(rule: ConditionRule, value: string | null): boolean {
  switch (rule.op) {
    case 'is':
      return value !== null && rule.values.includes(value)
    case 'is_not':
      return value === null || !rule.values.includes(value)
    case 'empty':
      return value === null
    case 'not_empty':
      return value !== null
    default:
      return false
  }
}

function dataValue(data: Metadata, key: string): string | null {
  const value = (data as Record<string, unknown>)[key]
  if (value === undefined || value === null) return null
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

export function ruleHolds(
  rule: ConditionRule,
  subject: Subject,
  outputs: Readonly<Record<string, string>>,
  now = new Date(),
): boolean {
  const c = subject.conversation
  switch (rule.field) {
    case 'message':
      return textRule(rule, subject.message)
    case 'step':
      return textRule(rule, outputs[rule.key ?? ''] ?? null)
    case 'hours':
      // Without hours to read, the site is taken to be open.
      return rule.op === 'open' ? subject.open !== false : subject.open === false
    case 'identified':
      return subject.contact !== null && subject.contact.identified === (rule.op === 'yes')
    default:
      break
  }
  if (c === null) return false
  switch (rule.field) {
    case 'inbox':
      return choiceRule(rule, c.inboxId)
    case 'team':
      return choiceRule(rule, c.teamId)
    case 'site':
      return choiceRule(rule, c.siteId)
    case 'status':
      return choiceRule(rule, c.status)
    case 'priority':
      return choiceRule(rule, c.priority)
    case 'sentiment':
      return choiceRule(rule, c.sentiment)
    case 'assignee':
      return choiceRule(rule, c.assigneeId)
    case 'tags': {
      const tags = new Set(subject.tags.map(fold))
      const any = rule.values.some((v) => tags.has(fold(v)))
      return rule.op === 'has' ? any : !any
    }
    case 'idle': {
      const minutes = (now.getTime() - c.lastMessageAt.getTime()) / 60_000
      const limit = Number(rule.values[0] ?? Number.NaN)
      if (Number.isNaN(limit)) return false
      return rule.op === 'more_than' ? minutes > limit : minutes < limit
    }
    case 'data':
      return textRule(rule, dataValue(c.data, rule.key ?? ''))
    case 'score': {
      const limit = Number(rule.values[0] ?? Number.NaN)
      if (subject.survey === null || Number.isNaN(limit)) return false
      return rule.op === 'more_than' ? subject.survey.score > limit : subject.survey.score < limit
    }
    default:
      return false
  }
}

/** Whether the subject meets the condition — no rule, always. */
export function holds(
  condition: Condition,
  subject: Subject,
  outputs: Readonly<Record<string, string>> = {},
  now = new Date(),
): boolean {
  if (condition.rules.length === 0) return true
  const each = (rule: ConditionRule) => ruleHolds(rule, subject, outputs, now)
  return condition.match === 'any' ? condition.rules.some(each) : condition.rules.every(each)
}

// ── Citations ───────────────────────────────────────────────────────────────

const PRIORITY: Readonly<Record<string, string>> = {
  low: 'basse',
  normal: 'normale',
  high: 'haute',
  urgent: 'urgente',
}

/** What `{{…}}` may name, for a run: French names, as the editor offers them. */
export function scopeOf(
  subject: Subject,
  outputs: Readonly<Record<string, string>>,
  extra: {
    readonly automation: string
    readonly webOrigin: string
    readonly inboxName: string | null
    readonly teamName: string | null
    readonly input: unknown
  },
): Record<string, unknown> {
  const c = subject.conversation
  const contact = subject.contact
  const [first, ...rest] = (contact?.name ?? '').split(/\s+/)
  return {
    contact: contact
      ? {
          nom: contact.name,
          prenom: first ?? '',
          nom_de_famille: rest.join(' '),
          email: contact.email ?? '',
          telephone: contact.phone ?? '',
        }
      : {},
    conversation: c
      ? {
          id: c.id,
          lien: `${extra.webOrigin}/conversations/${c.id}`,
          site: c.siteName,
          boite: extra.inboxName ?? '',
          equipe: extra.teamName ?? '',
          conseiller: c.assignee ?? '',
          priorite: PRIORITY[c.priority] ?? c.priority,
          resume: c.summary ?? '',
          etiquettes: subject.tags.join(', '),
        }
      : {},
    message: { texte: subject.message ?? '' },
    enquete: subject.survey
      ? {
          note: subject.survey.score,
          sur: subject.survey.scale === 'nps' ? 10 : 5,
          commentaire: subject.survey.comment ?? '',
        }
      : {},
    donnees: c?.data ?? {},
    etape: outputs,
    webhook: extra.input ?? {},
    automatisation: { nom: extra.automation },
  }
}

function lookup(scope: unknown, path: string): unknown {
  let at: unknown = scope
  for (const part of path.split('.')) {
    if (at === null || typeof at !== 'object') return undefined
    at = (at as Record<string, unknown>)[part]
  }
  return at
}

const asText = (value: unknown): string =>
  value === undefined || value === null
    ? ''
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value)

/** `{{contact.prenom}}` and its kind, replaced; what names nothing, by nothing. */
export function render(
  template: string,
  scope: Record<string, unknown>,
  escaped: (text: string) => string = (t) => t,
): string {
  return template.replace(/\{\{\s*([\p{L}\w.-]+)\s*\}\}/gu, (_all, path: string) =>
    escaped(asText(lookup(scope, path))),
  )
}

/** For a citation inside a JSON string: quotes and lines escaped. */
export const jsonEscape = (text: string): string => JSON.stringify(text).slice(1, -1)
