import type {
  AutomationChoices,
  AutomationDefinition,
  AutomationRun,
  AutomationStep,
  AutomationStepKind,
  AutomationTrigger,
  AutomationTriggerKind,
  BranchPath,
  Condition,
  ConditionField,
  ConditionOperator,
  ConditionRule,
  RunStepRecord,
} from '@chat/contracts'
import { $t, $tp, intlLocale, msg } from './i18n'

/**
 * An automation in the editor (D20): its definition as the server keeps it, the tree of
 * its steps walked, changed and said in words. The server checks it again; what keeps it
 * from running is told here first, on the step.
 */

export type Draft = AutomationDefinition

export const TRIGGER_LABELS: Readonly<Record<AutomationTriggerKind, string>> = {
  conversation_created: msg('Nouvelle conversation'),
  visitor_message: msg('Message du visiteur'),
  handed_off: msg('L’IA passe la main'),
  assigned: msg('Conversation attribuée'),
  transferred: msg('Conversation transférée'),
  resolved: msg('Conversation résolue'),
  reopened: msg('Conversation rouverte'),
  sentiment_changed: msg('L’humeur change'),
  no_reply: msg('Visiteur sans réponse'),
  schedule: msg('À heure fixe'),
  button: msg('Bouton dans la conversation'),
  webhook: msg('Appel d’un autre système'),
}

export const TRIGGER_HINTS: Readonly<Record<AutomationTriggerKind, string>> = {
  conversation_created: msg('Dès qu’un visiteur commence une conversation.'),
  visitor_message: msg('Chaque fois que le visiteur écrit.'),
  handed_off: msg('L’IA transfère la conversation aux conseillers.'),
  assigned: msg('La conversation est confiée à quelqu’un, ou remise dans la file.'),
  transferred: msg('La conversation change de boîte ou d’équipe.'),
  resolved: msg('Un conseiller ou l’IA clôt la conversation.'),
  reopened: msg('Une conversation résolue reprend.'),
  sentiment_changed: msg('L’IA lit une autre humeur dans les mots du visiteur.'),
  no_reply: msg('Le visiteur attend une réponse depuis un délai choisi.'),
  schedule: msg('Chaque heure, chaque jour ou chaque semaine.'),
  button: msg('Un conseiller la lance depuis la conversation.'),
  webhook: msg('Un CRM, un ERP… appelle son adresse.'),
}

export const TRIGGER_GROUPS: readonly {
  readonly label: string
  readonly kinds: readonly AutomationTriggerKind[]
}[] = [
  {
    label: msg('Dans les conversations'),
    kinds: [
      'conversation_created',
      'visitor_message',
      'handed_off',
      'assigned',
      'transferred',
      'resolved',
      'reopened',
      'sentiment_changed',
    ],
  },
  { label: msg('Avec le temps'), kinds: ['no_reply', 'schedule'] },
  { label: msg('À la demande'), kinds: ['button', 'webhook'] },
]

export const STEP_LABELS: Readonly<Record<AutomationStepKind, string>> = {
  assign: msg('Attribuer'),
  transfer: msg('Transférer'),
  tag: msg('Étiqueter'),
  priority: msg('Changer la priorité'),
  status: msg('Changer le statut'),
  reply: msg('Répondre au visiteur'),
  note: msg('Ajouter une note'),
  ask_email: msg('Demander l’e-mail du visiteur'),
  notify: msg('Prévenir'),
  webhook: msg('Appeler une adresse'),
  ai: msg('Demander à l’IA'),
  data: msg('Noter une donnée'),
  branch: msg('Condition'),
  wait: msg('Attendre'),
}

export const STEP_HINTS: Readonly<Record<AutomationStepKind, string>> = {
  assign: msg('À un conseiller, au moins occupé d’une équipe, ou à tour de rôle.'),
  transfer: msg('Vers une autre boîte de réception ou une autre équipe.'),
  tag: msg('Ajouter ou retirer des étiquettes.'),
  priority: msg('Basse, normale, haute ou urgente.'),
  status: msg('Aux conseillers, résolue, ou en attente.'),
  reply: msg('Un message au visiteur, signé de l’automatisation.'),
  note: msg('Une note que seule l’équipe lit.'),
  ask_email: msg('Le widget lui propose de laisser son adresse.'),
  notify: msg('Une ligne dans la cloche des conseillers choisis.'),
  webhook: msg('Envoyer la conversation à un CRM, un ERP, un outil interne.'),
  ai: msg('Classer la demande, ou rédiger un texte.'),
  data: msg('Une valeur jointe à la conversation.'),
  branch: msg('Des chemins selon la conversation.'),
  wait: msg('Reprendre plus tard, sauf si le visiteur a écrit.'),
}

export const STEP_GROUPS: readonly {
  readonly label: string
  readonly kinds: readonly AutomationStepKind[]
}[] = [
  {
    label: msg('La conversation'),
    kinds: ['assign', 'transfer', 'tag', 'priority', 'status', 'data'],
  },
  { label: msg('Écrire'), kinds: ['reply', 'note', 'ask_email', 'notify'] },
  { label: msg('Autres systèmes et IA'), kinds: ['webhook', 'ai'] },
  { label: msg('Le déroulement'), kinds: ['branch', 'wait'] },
]

// ── Conditions ──────────────────────────────────────────────────────────────

export const FIELD_LABELS: Readonly<Record<ConditionField, string>> = {
  inbox: msg('Boîte de réception'),
  team: msg('Équipe'),
  site: msg('Site'),
  status: msg('Statut'),
  priority: msg('Priorité'),
  sentiment: msg('Humeur'),
  assignee: msg('Conseiller'),
  tags: msg('Étiquettes'),
  identified: msg('Client identifié'),
  hours: msg('Horaires du site'),
  message: msg('Message du visiteur'),
  idle: msg('Sans message depuis'),
  data: msg('Donnée de la conversation'),
  step: msg('Résultat d’une étape'),
}

export const OPERATORS: Readonly<Record<ConditionField, readonly ConditionOperator[]>> = {
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

export const OPERATOR_LABELS: Readonly<Record<ConditionOperator, string>> = {
  is: msg('est'),
  is_not: msg('n’est pas'),
  empty: msg('est vide'),
  not_empty: msg('n’est pas vide'),
  has: msg('contient l’une de'),
  has_not: msg('ne contient aucune de'),
  contains: msg('contient'),
  not_contains: msg('ne contient pas'),
  equals: msg('vaut'),
  not_equals: msg('ne vaut pas'),
  yes: msg('oui'),
  no: msg('non'),
  open: msg('ouvert en ce moment'),
  closed: msg('fermé en ce moment'),
  more_than: msg('plus de (minutes)'),
  less_than: msg('moins de (minutes)'),
}

/** The operators that ask for no value. */
export const BARE: ReadonlySet<ConditionOperator> = new Set([
  'empty',
  'not_empty',
  'yes',
  'no',
  'open',
  'closed',
])

export const STATUS_CHOICES = [
  { id: 'ai', label: msg('Avec l’IA') },
  { id: 'open', label: msg('Ouverte') },
  { id: 'pending', label: msg('En attente') },
  { id: 'resolved', label: msg('Résolue') },
] as const

export const PRIORITY_CHOICES = [
  { id: 'low', label: msg('Basse') },
  { id: 'normal', label: msg('Normale') },
  { id: 'high', label: msg('Haute') },
  { id: 'urgent', label: msg('Urgente') },
] as const

export const SENTIMENT_CHOICES = [
  { id: 'positive', label: msg('Positive') },
  { id: 'neutral', label: msg('Neutre') },
  { id: 'negative', label: msg('Négative') },
] as const

/** The choices a rule on `field` picks among, when it picks. */
export function valueChoices(
  field: ConditionField,
  choices: AutomationChoices | null,
): readonly { readonly id: string; readonly label: string }[] | null {
  const labelled = (list: readonly { id: string; name: string }[] | undefined) =>
    (list ?? []).map((x) => ({ id: x.id, label: x.name }))
  switch (field) {
    case 'inbox':
      return labelled(choices?.inboxes)
    case 'team':
      return labelled(choices?.teams)
    case 'site':
      return labelled(choices?.sites)
    case 'assignee':
      return labelled(choices?.agents)
    case 'tags':
      return (choices?.tags ?? []).map((t) => ({ id: t.name, label: t.name }))
    case 'status':
      return STATUS_CHOICES.map((c) => ({ id: c.id, label: $t(c.label) }))
    case 'priority':
      return PRIORITY_CHOICES.map((c) => ({ id: c.id, label: $t(c.label) }))
    case 'sentiment':
      return SENTIMENT_CHOICES.map((c) => ({ id: c.id, label: $t(c.label) }))
    default:
      return null
  }
}

export const newRule = (field: ConditionField = 'inbox'): ConditionRule => ({
  field,
  op: OPERATORS[field][0] as ConditionOperator,
  values: field === 'idle' ? ['30'] : [],
})

/** A rule in a few words: « Boîte de réception est Service client ». */
export function ruleText(rule: ConditionRule, choices: AutomationChoices | null): string {
  const field = $t(FIELD_LABELS[rule.field])
  const op = $t(OPERATOR_LABELS[rule.op])
  if (BARE.has(rule.op)) return `${field} ${op}`
  const named = valueChoices(rule.field, choices)
  const values = rule.values.map((v) => named?.find((c) => c.id === v)?.label ?? v).join(', ')
  const key = rule.key ? ` ${rule.key}` : ''
  return `${field}${key} ${op} ${values || '…'}`
}

export function conditionText(condition: Condition, choices: AutomationChoices | null): string {
  if (condition.rules.length === 0) return ''
  return condition.rules
    .map((r) => ruleText(r, choices))
    .join(condition.match === 'any' ? $t(' ou ') : $t(' et '))
}

// ── The tree of steps ───────────────────────────────────────────────────────

/** Every step, those of the paths included, in order. */
export function allSteps(steps: readonly AutomationStep[]): AutomationStep[] {
  return steps.flatMap((s) =>
    s.kind === 'branch' ? [s, ...s.paths.flatMap((p) => allSteps(p.steps))] : [s],
  )
}

export function allPaths(steps: readonly AutomationStep[]): BranchPath[] {
  return allSteps(steps).flatMap((s) => (s.kind === 'branch' ? [...s.paths] : []))
}

export function findStep(steps: readonly AutomationStep[], id: string): AutomationStep | null {
  return allSteps(steps).find((s) => s.id === id) ?? null
}

export function findPath(
  steps: readonly AutomationStep[],
  id: string,
): {
  readonly branch: Extract<AutomationStep, { kind: 'branch' }>
  readonly path: BranchPath
} | null {
  for (const step of allSteps(steps)) {
    if (step.kind !== 'branch') continue
    const path = step.paths.find((p) => p.id === id)
    if (path) return { branch: step, path }
  }
  return null
}

/** The next free id: `s4` after `s3`, `p2` after `p1`. */
export function freshId(steps: readonly AutomationStep[], prefix: 's' | 'p'): string {
  const used = prefix === 's' ? allSteps(steps).map((s) => s.id) : allPaths(steps).map((p) => p.id)
  const top = Math.max(0, ...used.map((id) => Number(id.slice(1)) || 0))
  return `${prefix}${top + 1}`
}

/** A sequence changed where it is — the root (`null`) or a path. */
function editSequence(
  steps: readonly AutomationStep[],
  path: string | null,
  edit: (sequence: readonly AutomationStep[]) => AutomationStep[],
): AutomationStep[] {
  if (path === null) return edit(steps)
  return steps.map((step) =>
    step.kind === 'branch'
      ? {
          ...step,
          paths: step.paths.map((p) =>
            p.id === path
              ? { ...p, steps: edit(p.steps) }
              : { ...p, steps: editSequence(p.steps, path, edit) },
          ),
        }
      : step,
  )
}

export function insertStep(
  steps: readonly AutomationStep[],
  path: string | null,
  index: number,
  step: AutomationStep,
): AutomationStep[] {
  return editSequence(steps, path, (s) => [...s.slice(0, index), step, ...s.slice(index)])
}

export function replaceStep(
  steps: readonly AutomationStep[],
  id: string,
  next: AutomationStep,
): AutomationStep[] {
  return steps.map((step) => {
    if (step.id === id) return next
    if (step.kind !== 'branch') return step
    return {
      ...step,
      paths: step.paths.map((p) => ({ ...p, steps: replaceStep(p.steps, id, next) })),
    }
  })
}

export function replacePath(
  steps: readonly AutomationStep[],
  id: string,
  next: BranchPath,
): AutomationStep[] {
  return steps.map((step) =>
    step.kind === 'branch'
      ? {
          ...step,
          paths: step.paths.map((p) =>
            p.id === id ? next : { ...p, steps: replacePath(p.steps, id, next) },
          ),
        }
      : step,
  )
}

export function removeStep(steps: readonly AutomationStep[], id: string): AutomationStep[] {
  return steps
    .filter((s) => s.id !== id)
    .map((step) =>
      step.kind === 'branch'
        ? { ...step, paths: step.paths.map((p) => ({ ...p, steps: removeStep(p.steps, id) })) }
        : step,
    )
}

/** Where a step sits: its sequence, its place, how long the sequence is. */
export function locate(
  steps: readonly AutomationStep[],
  id: string,
  path: string | null = null,
): { readonly path: string | null; readonly index: number; readonly length: number } | null {
  const index = steps.findIndex((s) => s.id === id)
  if (index >= 0) return { path, index, length: steps.length }
  for (const step of steps) {
    if (step.kind !== 'branch') continue
    for (const p of step.paths) {
      const found = locate(p.steps, id, p.id)
      if (found) return found
    }
  }
  return null
}

export function moveStep(
  steps: readonly AutomationStep[],
  id: string,
  by: -1 | 1,
): AutomationStep[] {
  const where = locate(steps, id)
  if (!where) return [...steps]
  return editSequence(steps, where.path, (sequence) => {
    const next = [...sequence]
    const to = where.index + by
    if (to < 0 || to >= next.length) return next
    const [moved] = next.splice(where.index, 1)
    if (moved) next.splice(to, 0, moved)
    return next
  })
}

const NO_RULES: Condition = { match: 'all', rules: [] }

export function newStep(
  kind: AutomationStepKind,
  steps: readonly AutomationStep[],
): AutomationStep {
  const id = freshId(steps, 's')
  switch (kind) {
    case 'assign':
      return { id, kind, to: 'least_busy' }
    case 'transfer':
      return { id, kind }
    case 'tag':
      return { id, kind, add: [], remove: [] }
    case 'priority':
      return { id, kind, priority: 'high' }
    case 'status':
      return { id, kind, status: 'open' }
    case 'reply':
    case 'note':
      return { id, kind, body: '' }
    case 'ask_email':
      return { id, kind, text: '' }
    case 'notify':
      return { id, kind, to: 'assignee', agentIds: [], text: '' }
    case 'webhook':
      return { id, kind, url: '', headers: [], body: '' }
    case 'ai':
      return { id, kind, mode: 'classify', prompt: '', choices: [] }
    case 'data':
      return { id, kind, key: '', value: '' }
    case 'wait':
      return { id, kind, amount: 1, unit: 'hours', unlessReply: true }
    case 'branch': {
      const first = Number(freshId(steps, 'p').slice(1))
      return {
        id,
        kind,
        paths: [
          { id: `p${first}`, label: $t('Si'), otherwise: false, condition: NO_RULES, steps: [] },
          {
            id: `p${first + 1}`,
            label: $t('Sinon'),
            otherwise: true,
            condition: NO_RULES,
            steps: [],
          },
        ],
      }
    }
  }
}

export const emptyDraft = (): Draft => ({
  name: $t('Nouvelle automatisation'),
  description: '',
  trigger: { kind: 'conversation_created' },
  condition: NO_RULES,
  steps: [],
})

export function newTrigger(kind: AutomationTriggerKind, timezone: string): AutomationTrigger {
  if (kind === 'no_reply') return { kind, minutes: 15 }
  if (kind === 'schedule') {
    return { kind, forEach: true, schedule: { every: 'day', at: '09:00', weekday: 1, timezone } }
  }
  return { kind }
}

// ── What keeps it from running ──────────────────────────────────────────────

export const PROBLEMS: Readonly<Record<string, string>> = {
  no_steps: msg('Ajoutez au moins une étape.'),
  needs_conversation: msg(
    'Cette étape agit sur une conversation : choisissez « pour chaque conversation ».',
  ),
  agent_missing: msg('Choisissez le conseiller.'),
  team_missing: msg('Choisissez l’équipe.'),
  target_missing: msg('Choisissez une boîte ou une équipe.'),
  tag_missing: msg('Choisissez au moins une étiquette.'),
  body_missing: msg('Écrivez le message.'),
  text_missing: msg('Écrivez ce que dit la notification.'),
  url_missing: msg('Indiquez l’adresse à appeler.'),
  prompt_missing: msg('Écrivez la consigne de l’IA.'),
  choices_missing: msg('Donnez au moins deux réponses possibles.'),
  key_missing: msg('Nommez la donnée.'),
  step_unknown: msg('Une condition lit une étape qui ne vient pas avant.'),
  name: msg('Donnez un nom à l’automatisation.'),
  schedule: msg('L’horaire n’est pas valable.'),
  too_many_steps: msg('Soixante étapes au plus.'),
  too_deep: msg('Quatre conditions imbriquées au plus.'),
}

export const problemText = (problem: string): string =>
  $t(PROBLEMS[problem] ?? msg('Ce réglage n’est pas valable.'))

const NEEDS_CONVERSATION = new Set<AutomationStepKind>([
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

export const aboutConversation = (trigger: AutomationTrigger): boolean =>
  !(trigger.kind === 'schedule' && !trigger.forEach)

/** What keeps a step from running — the server's own check, said before saving. */
export function stepProblem(step: AutomationStep, draft: Draft): string | null {
  if (!aboutConversation(draft.trigger) && NEEDS_CONVERSATION.has(step.kind)) {
    return 'needs_conversation'
  }
  switch (step.kind) {
    case 'assign':
      if (step.to === 'agent' && !step.agentId) return 'agent_missing'
      if ((step.to === 'least_busy' || step.to === 'round_robin') && !step.teamId) {
        return 'team_missing'
      }
      return null
    case 'transfer':
      return step.inboxId || step.teamId ? null : 'target_missing'
    case 'tag':
      return step.add.length + step.remove.length > 0 ? null : 'tag_missing'
    case 'reply':
    case 'note':
      return step.body.trim() === '' ? 'body_missing' : null
    case 'notify':
      if (step.text.trim() === '') return 'text_missing'
      return step.to === 'team' && !step.teamId ? 'team_missing' : null
    case 'webhook':
      return /^https?:\/\//.test(step.url.trim()) ? null : 'url_missing'
    case 'ai':
      if (step.prompt.trim() === '') return 'prompt_missing'
      return step.mode === 'classify' && step.choices.length < 2 ? 'choices_missing' : null
    case 'data':
      return step.key.trim() === '' ? 'key_missing' : null
    default:
      return null
  }
}

export function draftProblem(draft: Draft): { problem: string; step?: string } | null {
  if (draft.name.trim() === '') return { problem: 'name' }
  if (draft.steps.length === 0) return { problem: 'no_steps' }
  for (const step of allSteps(draft.steps)) {
    const problem = stepProblem(step, draft)
    if (problem) return { problem, step: step.id }
  }
  return null
}

// ── Said in words ───────────────────────────────────────────────────────────

const nameIn = (list: readonly { id: string; name: string }[] | undefined, id?: string) =>
  list?.find((x) => x.id === id)?.name ?? '…'

export function waitText(amount: number, unit: 'minutes' | 'hours' | 'days'): string {
  switch (unit) {
    case 'minutes':
      return $tp(amount, '{count} minute', '{count} minutes')
    case 'hours':
      return $tp(amount, '{count} heure', '{count} heures')
    case 'days':
      return $tp(amount, '{count} jour', '{count} jours')
  }
}

/** What a step does, in a line — the card's second line. */
export function stepSummary(step: AutomationStep, choices: AutomationChoices | null): string {
  switch (step.kind) {
    case 'assign':
      if (step.to === 'nobody') return $t('Remettre dans la file')
      if (step.to === 'agent')
        return $t('À {name}', { name: nameIn(choices?.agents, step.agentId) })
      return step.to === 'least_busy'
        ? $t('Au moins occupé de {team}', { team: nameIn(choices?.teams, step.teamId) })
        : $t('À tour de rôle dans {team}', { team: nameIn(choices?.teams, step.teamId) })
    case 'transfer':
      return [
        step.inboxId ? nameIn(choices?.inboxes, step.inboxId) : null,
        step.teamId ? nameIn(choices?.teams, step.teamId) : null,
      ]
        .filter(Boolean)
        .join(' · ')
    case 'tag':
      return [...step.add.map((t) => `+ ${t}`), ...step.remove.map((t) => `− ${t}`)].join('  ')
    case 'priority':
      return $t(PRIORITY_CHOICES.find((p) => p.id === step.priority)?.label ?? step.priority)
    case 'status':
      return step.status === 'open'
        ? $t('Aux conseillers')
        : step.status === 'resolved'
          ? $t('Résolue')
          : $t('En attente {duration}', { duration: waitText(step.hours ?? 24, 'hours') })
    case 'reply':
    case 'note':
      return step.body
    case 'ask_email':
      return step.text || $t('Avec les mots du widget')
    case 'notify':
      return step.text
    case 'webhook':
      return step.url.replace(/^https?:\/\//, '')
    case 'ai':
      return step.mode === 'classify' ? step.choices.join(' · ') : step.prompt
    case 'data':
      return step.key ? `${step.key} = ${step.value}` : ''
    case 'branch':
      return $tp(step.paths.length, '{count} chemin', '{count} chemins')
    case 'wait':
      return step.unlessReply
        ? $t('{duration}, sauf réponse du visiteur', { duration: waitText(step.amount, step.unit) })
        : waitText(step.amount, step.unit)
  }
}

const WEEKDAYS = [
  msg('lundi'),
  msg('mardi'),
  msg('mercredi'),
  msg('jeudi'),
  msg('vendredi'),
  msg('samedi'),
  msg('dimanche'),
]

export function triggerSummary(trigger: AutomationTrigger): string {
  switch (trigger.kind) {
    case 'no_reply':
      return $t('Après {duration} sans réponse', {
        duration: waitText(trigger.minutes ?? 15, 'minutes'),
      })
    case 'schedule': {
      const s = trigger.schedule
      if (!s) return ''
      const when =
        s.every === 'hour'
          ? $t('Toutes les heures, à la minute {at}', { at: s.at.slice(3) })
          : s.every === 'week'
            ? $t('Le {day} à {at}', {
                day: $t(WEEKDAYS[s.weekday - 1] ?? WEEKDAYS[0] ?? ''),
                at: s.at,
              })
            : s.every === 'weekdays'
              ? $t('Du lundi au vendredi à {at}', { at: s.at })
              : $t('Chaque jour à {at}', { at: s.at })
      return trigger.forEach ? $t('{when}, pour chaque conversation', { when }) : when
    }
    default:
      return $t(TRIGGER_HINTS[trigger.kind])
  }
}

// ── Runs ────────────────────────────────────────────────────────────────────

const RUN_ERRORS: Readonly<Record<string, string>> = {
  VISITOR_REPLIED: msg('Le visiteur a écrit pendant l’attente.'),
  AUTOMATION_OFF: msg('L’automatisation a été arrêtée.'),
  AUTOMATION_GONE: msg('L’automatisation a été supprimée.'),
  STEP_GONE: msg('L’étape où elle attendait a été retirée.'),
  STOPPED: msg('Arrêtée à la main.'),
  INTERRUPTED: msg('Le serveur s’est arrêté pendant l’exécution.'),
  BUDGET: msg('Trop longue : arrêtée après cent secondes.'),
  TIMEOUT: msg('Pas de réponse à temps.'),
  BODY_NOT_JSON: msg('Le corps n’est pas du JSON valable une fois les citations remplacées.'),
  NOT_SNOOZABLE: msg('Seule une conversation des conseillers se met en attente.'),
  AI_UNAVAILABLE: msg('Aucun modèle d’IA n’est configuré.'),
  WEBHOOK_TARGET_REJECTED: msg('Adresse refusée : HTTPS, vers une adresse publique.'),
  CONVERSATION_NOT_FOUND: msg('Pas de conversation à qui l’appliquer.'),
  AGENT_NOT_FOUND: msg('Ce conseiller n’est plus actif.'),
  INBOX_NOT_FOUND: msg('Cette boîte n’existe plus.'),
  TEAM_NOT_FOUND: msg('Cette équipe n’existe plus, ou ne répond pas dans cette boîte.'),
}

export function runError(code: string | null | undefined): string {
  if (!code) return ''
  if (code.startsWith('HTTP_'))
    return $t('L’adresse a répondu {status}.', { status: code.slice(5) })
  return $t(RUN_ERRORS[code] ?? msg('Erreur : {code}'), { code })
}

const SKIPS: Readonly<Record<string, string>> = {
  no_agent: msg('personne de libre dans l’équipe'),
  unchanged: msg('déjà fait'),
  nobody: msg('personne à prévenir'),
  empty: msg('message vide'),
  not_needed: msg('le visiteur a déjà une adresse, ou on la lui a demandée'),
}

export function stepRecordText(record: RunStepRecord): string {
  if (record.status === 'failed') return runError(record.error)
  if (record.status === 'skipped') return $t(SKIPS[record.detail ?? ''] ?? msg('passée'))
  if (record.kind === 'wait' && record.detail) {
    return $t('reprend le {date}', {
      date: new Intl.DateTimeFormat(intlLocale(), {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(record.detail)),
    })
  }
  return record.detail ?? $t('fait')
}

export function causeText(cause: string): string {
  const [type, rest] = [cause.split(':')[0], cause.split(':').slice(1).join(':')]
  switch (type) {
    case 'event':
      return $t(TRIGGER_LABELS[rest as AutomationTriggerKind] ?? rest)
    case 'button':
      return $t('Lancée par {name}', { name: rest })
    case 'test':
      return $t('Essai de {name}', { name: rest })
    case 'schedule':
      return $t('À heure fixe')
    case 'webhook':
      return $t('Appel d’un autre système')
    default:
      return cause
  }
}

export const RUN_LABELS: Readonly<Record<AutomationRun['status'], string>> = {
  queued: msg('En file'),
  running: msg('En cours'),
  waiting: msg('En attente'),
  succeeded: msg('Réussie'),
  failed: msg('Échouée'),
  stopped: msg('Arrêtée'),
}
