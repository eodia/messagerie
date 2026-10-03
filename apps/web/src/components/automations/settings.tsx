'use client'

import { CopyButton } from '@/components/app/copy-button'
import { ChoiceMenu, Toggles } from '@/components/settings/field-input'
import { Field, LinesField, ToggleField } from '@/components/settings/kit/controls'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Textarea } from '@/components/ui/textarea'
import { Hint } from '@/components/ui/tooltip'
import {
  BARE,
  type Draft,
  FIELD_LABELS,
  OPERATORS,
  OPERATOR_LABELS,
  PRIORITY_CHOICES,
  STEP_LABELS,
  TRIGGER_LABELS,
  aboutConversation,
  allSteps,
  newRule,
  newTrigger,
  problemText,
  stepProblem,
  valueChoices,
} from '@/lib/automations'
import { $t, msg } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type {
  Automation,
  AutomationChoices,
  AutomationStep,
  AutomationTrigger,
  BranchPath,
  Condition,
  ConditionField,
  ConditionRule,
} from '@chat/contracts'
import { Braces, Plus, RefreshCw, TriangleAlert, X } from 'lucide-react'
import { type ReactNode, useId, useRef, useState } from 'react'
import { TRIGGER_ICONS, TRIGGER_TONE } from './flow'
import { TriggerPicker } from './picker'

/**
 * The settings of what is chosen on the flow: the trigger and the conversations it keeps,
 * a step, a path. Texts may cite the conversation — `{{contact.prenom}}` —, chosen from a
 * menu rather than remembered.
 */

type Choices = AutomationChoices | null

export function Section({
  title,
  hint,
  children,
}: {
  readonly title: string
  readonly hint?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <section className="space-y-3 border-t pt-4 first:border-t-0 first:pt-0">
      <header className="space-y-1">
        <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {title}
        </h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </header>
      {children}
    </section>
  )
}

function Warning({ children }: { readonly children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2.5 py-2 text-xs text-amber-800 dark:text-amber-300">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

// ── Citations ───────────────────────────────────────────────────────────────

const CITATIONS: readonly {
  readonly group: string
  readonly items: readonly [string, string][]
}[] = [
  {
    group: msg('Le contact'),
    items: [
      ['contact.prenom', msg('Prénom')],
      ['contact.nom', msg('Nom complet')],
      ['contact.email', msg('E-mail')],
      ['contact.telephone', msg('Téléphone')],
    ],
  },
  {
    group: msg('La conversation'),
    items: [
      ['message.texte', msg('Message du visiteur')],
      ['conversation.lien', msg('Lien dans l’inbox')],
      ['conversation.boite', msg('Boîte de réception')],
      ['conversation.equipe', msg('Équipe')],
      ['conversation.conseiller', msg('Conseiller')],
      ['conversation.priorite', msg('Priorité')],
      ['conversation.etiquettes', msg('Étiquettes')],
      ['conversation.resume', msg('Résumé de l’IA')],
      ['conversation.site', msg('Site')],
    ],
  },
]

/** The steps before `id` whose result can be cited. */
function earlierOutputs(draft: Draft, id: string | null): AutomationStep[] {
  const steps = allSteps(draft.steps)
  const at = id === null ? steps.length : steps.findIndex((s) => s.id === id)
  return steps
    .slice(0, at < 0 ? steps.length : at)
    .filter((s) => ['ai', 'webhook', 'data', 'assign'].includes(s.kind))
}

function CiteMenu({
  draft,
  stepId,
  onCite,
}: {
  readonly draft: Draft
  readonly stepId: string | null
  readonly onCite: (citation: string) => void
}) {
  const outputs = earlierOutputs(draft, stepId)
  return (
    <DropdownMenu>
      <Hint label={$t('Citer la conversation dans le texte')}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
            <Braces className="size-3.5" />
            {$t('Citer')}
          </Button>
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent align="end" className="max-h-80 w-60 overflow-y-auto">
        {CITATIONS.map((group, index) => (
          <div key={group.group}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {$t(group.group)}
            </DropdownMenuLabel>
            {group.items.map(([path, label]) => (
              <DropdownMenuItem
                key={path}
                onSelect={() => onCite(`{{${path}}}`)}
                className="text-xs"
              >
                {$t(label)}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
        {outputs.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {$t('Résultat d’une étape')}
            </DropdownMenuLabel>
            {outputs.map((s) => (
              <DropdownMenuItem
                key={s.id}
                onSelect={() => onCite(`{{etape.${s.id}}}`)}
                className="text-xs"
              >
                <span className="font-mono text-[11px] text-muted-foreground">{s.id}</span>
                {$t(STEP_LABELS[s.kind])}
              </DropdownMenuItem>
            ))}
          </>
        )}
        {draft.trigger.kind === 'webhook' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onCite('{{webhook.}}')} className="text-xs">
              {$t('Un champ de l’appel reçu')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A text that may cite: what is chosen in « Citer » goes where the caret is. */
function CitingText({
  label,
  value,
  onChange,
  draft,
  stepId,
  placeholder,
  rows = 4,
  mono = false,
  hint,
}: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly draft: Draft
  readonly stepId: string | null
  readonly placeholder?: string
  readonly rows?: number
  readonly mono?: boolean
  readonly hint?: ReactNode
}) {
  const id = useId()
  const area = useRef<HTMLTextAreaElement>(null)
  const cite = (citation: string) => {
    const el = area.current
    const at = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    onChange(value.slice(0, at) + citation + value.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      const caret = at + citation.length - (citation.endsWith('.}}') ? 2 : 0)
      el?.setSelectionRange(caret, caret)
    })
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="flex-1 text-sm font-medium">
          {label}
        </label>
        <CiteMenu draft={draft} stepId={stepId} onCite={cite} />
      </div>
      <Textarea
        id={id}
        ref={area}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn('resize-y text-sm', mono && 'font-mono text-xs')}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

// ── Conditions ──────────────────────────────────────────────────────────────

const FIELDS_IN_ORDER: readonly ConditionField[] = [
  'message',
  'channel',
  'inbox',
  'team',
  'site',
  'status',
  'priority',
  'sentiment',
  'assignee',
  'tags',
  'identified',
  'hours',
  'idle',
  'data',
  'step',
]

function RuleRow({
  rule,
  draft,
  stepId,
  choices,
  onChange,
  onRemove,
}: {
  readonly rule: ConditionRule
  readonly draft: Draft
  readonly stepId: string | null
  readonly choices: Choices
  readonly onChange: (rule: ConditionRule) => void
  readonly onRemove: () => void
}) {
  const fieldId = useId()
  const named = valueChoices(rule.field, choices)
  const outputs = earlierOutputs(draft, stepId)
  const fields = FIELDS_IN_ORDER.filter((f) => f !== 'step' || outputs.length > 0)
  return (
    <div className="space-y-2 rounded-lg border bg-muted/20 p-2.5">
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <ChoiceMenu
            id={fieldId}
            value={rule.field}
            choices={fields.map((f) => ({ id: f, label: $t(FIELD_LABELS[f]) }))}
            onChange={(f) => f && onChange(newRule(f as ConditionField))}
            allowNone={false}
            disabled={false}
          />
        </div>
        <Hint label={$t('Retirer la règle')}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onRemove}
            aria-label={$t('Retirer la règle')}
          >
            <X className="size-4" />
          </Button>
        </Hint>
      </div>
      {rule.field === 'data' && (
        <Input
          value={rule.key ?? ''}
          onChange={(e) => onChange({ ...rule, key: e.target.value })}
          placeholder={$t('Nom de la donnée (ex. : commande)')}
          className="h-8 text-xs"
        />
      )}
      {rule.field === 'step' && (
        <ChoiceMenu
          id={`${fieldId}-step`}
          value={rule.key ?? null}
          choices={outputs.map((s) => ({
            id: s.id,
            label: `${s.id} · ${$t(STEP_LABELS[s.kind])}`,
          }))}
          onChange={(key) => onChange({ ...rule, key: key ?? '' })}
          allowNone={false}
          disabled={false}
        />
      )}
      <Segmented
        value={rule.op}
        onValueChange={(op) => onChange({ ...rule, op, values: BARE.has(op) ? [] : rule.values })}
        options={OPERATORS[rule.field].map((op) => ({ value: op, label: $t(OPERATOR_LABELS[op]) }))}
        className="flex h-auto w-full flex-wrap"
        itemClassName="flex-none"
        aria-label={$t('Comparaison')}
      />
      {!BARE.has(rule.op) &&
        (named !== null ? (
          <Toggles
            value={rule.values}
            choices={named}
            onChange={(values) => onChange({ ...rule, values })}
            disabled={false}
          />
        ) : rule.field === 'idle' ? (
          <Input
            type="number"
            min={1}
            value={rule.values[0] ?? ''}
            onChange={(e) => onChange({ ...rule, values: [e.target.value] })}
            className="h-8 w-28 text-xs"
            aria-label={$t('Minutes')}
          />
        ) : (
          <LinesField
            id={`${fieldId}-values`}
            value={rule.values.join('\n')}
            onChange={(text) => onChange({ ...rule, values: text.split('\n').filter(Boolean) })}
            placeholder={$t('Un mot, Entrée, un autre…')}
          />
        ))}
    </div>
  )
}

export function ConditionEditor({
  condition,
  draft,
  stepId,
  choices,
  onChange,
  empty,
}: {
  readonly condition: Condition
  readonly draft: Draft
  readonly stepId: string | null
  readonly choices: Choices
  readonly onChange: (condition: Condition) => void
  /** What no rule means here. */
  readonly empty: string
}) {
  const set = (rules: ConditionRule[]) => onChange({ ...condition, rules })
  return (
    <div className="space-y-2">
      {condition.rules.length > 1 && (
        <Segmented
          value={condition.match}
          onValueChange={(match) => onChange({ ...condition, match })}
          options={[
            { value: 'all', label: $t('Toutes les règles') },
            { value: 'any', label: $t('L’une des règles') },
          ]}
          className="w-full"
          aria-label={$t('Règles à remplir')}
        />
      )}
      {condition.rules.length === 0 && <p className="text-xs text-muted-foreground">{empty}</p>}
      {condition.rules.map((rule, index) => (
        <RuleRow
          // biome-ignore lint/suspicious/noArrayIndexKey: rules have no id; their place is it
          key={index}
          rule={rule}
          draft={draft}
          stepId={stepId}
          choices={choices}
          onChange={(next) => set(condition.rules.map((r, i) => (i === index ? next : r)))}
          onRemove={() => set(condition.rules.filter((_, i) => i !== index))}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full gap-1.5"
        onClick={() => set([...condition.rules, newRule()])}
      >
        <Plus className="size-3.5" />
        {$t('Ajouter une règle')}
      </Button>
    </div>
  )
}

// ── The trigger ─────────────────────────────────────────────────────────────

const WEEKDAY_CHOICES = [
  msg('Lundi'),
  msg('Mardi'),
  msg('Mercredi'),
  msg('Jeudi'),
  msg('Vendredi'),
  msg('Samedi'),
  msg('Dimanche'),
]

function WebhookAddress({
  automation,
  onRenew,
}: {
  readonly automation: Automation | null
  readonly onRenew: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  if (automation?.webhookUrl == null) {
    return (
      <p className="text-xs text-muted-foreground">
        {$t('Son adresse apparaît ici une fois l’automatisation enregistrée.')}
      </p>
    )
  }
  const url = automation.webhookUrl
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-lg border bg-muted/40 py-1.5 pr-1.5 pl-2.5">
        <code className="min-w-0 flex-1 truncate font-mono text-[11px]">{url}</code>
        <CopyButton text={url} label={$t('Copier l’adresse')} />
      </div>
      <p className="text-xs text-muted-foreground">
        {$t(
          'Un POST en JSON ; ses champs se citent {{webhook.champ}}. Un « conversationId » dans le corps fait agir l’automatisation sur cette conversation. L’adresse contient sa clé : gardez-la secrète.',
        )}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        className="gap-1.5"
        onClick={() => {
          setBusy(true)
          void onRenew().finally(() => setBusy(false))
        }}
      >
        <RefreshCw className="size-3.5" />
        {$t('Changer la clé')}
      </Button>
    </div>
  )
}

export function TriggerSettings({
  draft,
  automation,
  choices,
  onChange,
  onRenewKey,
}: {
  readonly draft: Draft
  readonly automation: Automation | null
  readonly choices: Choices
  readonly onChange: (patch: Partial<Draft>) => void
  readonly onRenewKey: () => Promise<void>
}) {
  const [picking, setPicking] = useState(false)
  const t = draft.trigger
  const Icon = TRIGGER_ICONS[t.kind]
  const timezone = t.schedule?.timezone ?? choices?.sites[0]?.timezone ?? 'Europe/Paris'
  const setTrigger = (trigger: AutomationTrigger) => onChange({ trigger })
  const schedule = t.schedule
  const zones = [...new Set([timezone, ...(choices?.sites ?? []).map((s) => s.timezone)])]

  return (
    <div className="space-y-5">
      <Section title={$t('Ce qui la lance')}>
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left hover:bg-accent/50"
        >
          <span className={cn('flex size-8 items-center justify-center rounded-md', TRIGGER_TONE)}>
            <Icon className="size-4" />
          </span>
          <span className="min-w-0 flex-1 text-sm font-medium">{$t(TRIGGER_LABELS[t.kind])}</span>
          <span className="text-xs text-muted-foreground">{$t('Changer')}</span>
        </button>
        <TriggerPicker
          open={picking}
          current={t.kind}
          onPick={(kind) => {
            setPicking(false)
            if (kind !== t.kind) setTrigger(newTrigger(kind, timezone))
          }}
          onClose={() => setPicking(false)}
        />

        {t.kind === 'no_reply' && (
          <Field
            label={$t('Délai sans réponse, en minutes')}
            hint={$t(
              'Le dernier message est celui du visiteur, la conversation est ouverte ou avec l’IA : une fois par message laissé sans réponse.',
            )}
          >
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                max={10080}
                value={t.minutes ?? 15}
                onChange={(e) => setTrigger({ ...t, minutes: Number(e.target.value) || 1 })}
                className="h-8 w-28"
              />
            )}
          </Field>
        )}

        {t.kind === 'schedule' && schedule && (
          <div className="space-y-3">
            <Segmented
              value={schedule.every}
              onValueChange={(every) => setTrigger({ ...t, schedule: { ...schedule, every } })}
              options={[
                { value: 'hour', label: $t('Chaque heure') },
                { value: 'day', label: $t('Chaque jour') },
                { value: 'weekdays', label: $t('En semaine') },
                { value: 'week', label: $t('Chaque semaine') },
              ]}
              className="grid h-auto w-full grid-cols-2"
              aria-label={$t('Fréquence')}
            />
            <div className="flex flex-wrap items-end gap-2">
              {schedule.every === 'week' && (
                <div className="min-w-32 flex-1">
                  <ChoiceMenu
                    id="automation-weekday"
                    value={String(schedule.weekday)}
                    choices={WEEKDAY_CHOICES.map((d, i) => ({ id: String(i + 1), label: $t(d) }))}
                    onChange={(day) =>
                      setTrigger({ ...t, schedule: { ...schedule, weekday: Number(day) || 1 } })
                    }
                    allowNone={false}
                    disabled={false}
                  />
                </div>
              )}
              <Input
                type="time"
                value={schedule.at}
                onChange={(e) =>
                  setTrigger({ ...t, schedule: { ...schedule, at: e.target.value || '09:00' } })
                }
                className="h-9 w-28"
                aria-label={$t('Heure')}
              />
              <div className="min-w-40 flex-1">
                <ChoiceMenu
                  id="automation-timezone"
                  value={schedule.timezone}
                  choices={zones.map((z) => ({ id: z, label: z }))}
                  onChange={(zone) =>
                    setTrigger({ ...t, schedule: { ...schedule, timezone: zone ?? timezone } })
                  }
                  allowNone={false}
                  disabled={false}
                />
              </div>
            </div>
            <ToggleField
              label={$t('Pour chaque conversation')}
              hint={$t(
                'Une exécution par conversation des 90 derniers jours que la condition retient — 200 au plus à chaque fois. Sinon, une seule, sans conversation.',
              )}
              checked={t.forEach === true}
              onChange={(forEach) => setTrigger({ ...t, forEach })}
            />
          </div>
        )}

        {t.kind === 'button' && (
          <p className="text-xs text-muted-foreground">
            {$t(
              'Les conseillers la trouvent dans le menu « Automatisations » des conversations que la condition retient.',
            )}
          </p>
        )}
        {t.kind === 'webhook' && <WebhookAddress automation={automation} onRenew={onRenewKey} />}
      </Section>

      {aboutConversation(t) && t.kind !== 'webhook' && (
        <Section
          title={$t('Pour les conversations qui…')}
          hint={$t('Lue au moment où l’automatisation se lance.')}
        >
          <ConditionEditor
            condition={draft.condition}
            draft={draft}
            stepId={null}
            choices={choices}
            onChange={(condition) => onChange({ condition })}
            empty={$t('Toutes les conversations.')}
          />
        </Section>
      )}

      <Section title={$t('Description')}>
        <Textarea
          rows={2}
          value={draft.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder={$t('À quoi elle sert, pour l’équipe.')}
          className="text-sm"
          aria-label={$t('Description')}
        />
      </Section>
    </div>
  )
}

// ── A step ──────────────────────────────────────────────────────────────────

function Pick({
  label,
  value,
  choices,
  onChange,
  allowNone = false,
}: {
  readonly label: string
  readonly value: string | null | undefined
  readonly choices: readonly { readonly id: string; readonly label: string }[]
  readonly onChange: (value: string | undefined) => void
  readonly allowNone?: boolean
}) {
  return (
    <Field label={label}>
      {(id) => (
        <ChoiceMenu
          id={id}
          value={value ?? null}
          choices={choices}
          onChange={(v) => onChange(v ?? undefined)}
          allowNone={allowNone}
          disabled={false}
        />
      )}
    </Field>
  )
}

const named = (list: readonly { id: string; name: string }[] | undefined) =>
  (list ?? []).map((x) => ({ id: x.id, label: x.name }))

function OutputHint({ step }: { readonly step: AutomationStep }) {
  return (
    <p className="rounded-md bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">
      {$t('Son résultat se cite {citation} et se teste dans une condition.', {
        citation: `{{etape.${step.id}}}`,
      })}
    </p>
  )
}

export function StepSettings({
  step,
  draft,
  choices,
  onChange,
}: {
  readonly step: AutomationStep
  readonly draft: Draft
  readonly choices: Choices
  readonly onChange: (step: AutomationStep) => void
}) {
  const problem = stepProblem(step, draft)
  const warning = problem && <Warning>{problemText(problem)}</Warning>
  switch (step.kind) {
    case 'assign':
      return (
        <div className="space-y-4">
          {warning}
          <Segmented
            value={step.to}
            onValueChange={(to) => onChange({ ...step, to })}
            options={[
              { value: 'least_busy', label: $t('Moins occupé') },
              { value: 'round_robin', label: $t('Tour de rôle') },
              { value: 'agent', label: $t('Quelqu’un') },
              { value: 'nobody', label: $t('Personne') },
            ]}
            className="grid h-auto w-full grid-cols-2"
            aria-label={$t('À qui')}
          />
          <p className="text-xs text-muted-foreground">
            {step.to === 'least_busy'
              ? $t(
                  'Au membre actif de l’équipe qui a le moins de conversations ouvertes, sous sa limite de conversations simultanées.',
                )
              : step.to === 'round_robin'
                ? $t('Aux membres actifs de l’équipe, chacun son tour, sous leur limite.')
                : step.to === 'agent'
                  ? $t('Toujours au même conseiller.')
                  : $t('La conversation retourne dans la file de sa boîte.')}
          </p>
          {(step.to === 'least_busy' || step.to === 'round_robin') && (
            <Pick
              label={$t('Équipe')}
              value={step.teamId}
              choices={named(choices?.teams)}
              onChange={(teamId) => onChange({ ...step, ...(teamId ? { teamId } : {}) })}
            />
          )}
          {step.to === 'agent' && (
            <Pick
              label={$t('Conseiller')}
              value={step.agentId}
              choices={named(choices?.agents)}
              onChange={(agentId) => onChange({ ...step, ...(agentId ? { agentId } : {}) })}
            />
          )}
          {step.to !== 'nobody' && <OutputHint step={step} />}
        </div>
      )
    case 'transfer':
      return (
        <div className="space-y-4">
          {warning}
          <Pick
            label={$t('Boîte de réception')}
            value={step.inboxId}
            choices={named(choices?.inboxes)}
            allowNone
            onChange={(inboxId) => {
              const { inboxId: _, ...rest } = step
              onChange(inboxId ? { ...rest, inboxId } : rest)
            }}
          />
          <Pick
            label={$t('Équipe')}
            value={step.teamId}
            choices={named(choices?.teams)}
            allowNone
            onChange={(teamId) => {
              const { teamId: _, ...rest } = step
              onChange(teamId ? { ...rest, teamId } : rest)
            }}
          />
          <p className="text-xs text-muted-foreground">
            {$t(
              'La conversation quitte son conseiller et l’IA ; ceux qui répondent là-bas sont prévenus.',
            )}
          </p>
        </div>
      )
    case 'tag': {
      const tags = (choices?.tags ?? []).map((t) => ({ id: t.name, label: t.name }))
      return (
        <div className="space-y-4">
          {warning}
          <Field label={$t('Ajouter')}>
            {() => (
              <Toggles
                value={step.add}
                choices={tags}
                onChange={(add) => onChange({ ...step, add })}
                disabled={false}
              />
            )}
          </Field>
          <Field label={$t('Retirer')}>
            {() => (
              <Toggles
                value={step.remove}
                choices={tags}
                onChange={(remove) => onChange({ ...step, remove })}
                disabled={false}
              />
            )}
          </Field>
        </div>
      )
    }
    case 'priority':
      return (
        <Segmented
          value={step.priority}
          onValueChange={(priority) => onChange({ ...step, priority })}
          options={PRIORITY_CHOICES.map((p) => ({ value: p.id, label: $t(p.label) }))}
          className="w-full"
          aria-label={$t('Priorité')}
        />
      )
    case 'status':
      return (
        <div className="space-y-4">
          <Segmented
            value={step.status}
            onValueChange={(status) =>
              onChange(
                status === 'snoozed'
                  ? { id: step.id, kind: 'status', status, hours: step.hours ?? 24 }
                  : { id: step.id, kind: 'status', status },
              )
            }
            options={[
              { value: 'open', label: $t('Aux conseillers') },
              { value: 'resolved', label: $t('Résolue') },
              { value: 'snoozed', label: $t('En attente') },
            ]}
            className="w-full"
            aria-label={$t('Statut')}
          />
          <p className="text-xs text-muted-foreground">
            {step.status === 'open'
              ? $t('Sortie des mains de l’IA, rouverte ou réveillée : elle revient dans la file.')
              : step.status === 'resolved'
                ? $t('La conversation est close ; un nouveau message du visiteur la rouvre.')
                : $t('Hors de la file jusqu’au délai, ou jusqu’à ce que le visiteur écrive.')}
          </p>
          {step.status === 'snoozed' && (
            <Field label={$t('Pendant (heures)')}>
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={1}
                  value={step.hours ?? 24}
                  onChange={(e) => onChange({ ...step, hours: Number(e.target.value) || 1 })}
                  className="h-8 w-28"
                />
              )}
            </Field>
          )}
        </div>
      )
    case 'reply':
    case 'note':
      return (
        <div className="space-y-4">
          {warning}
          <CitingText
            label={step.kind === 'reply' ? $t('Message au visiteur') : $t('Note pour l’équipe')}
            value={step.body}
            onChange={(body) => onChange({ ...step, body })}
            draft={draft}
            stepId={step.id}
            rows={6}
            placeholder={
              step.kind === 'reply'
                ? $t('Bonjour {{contact.prenom}}, …')
                : $t('À rappeler avant midi : {{message.texte}}')
            }
            hint={
              step.kind === 'reply'
                ? $t('Signé du nom de l’automatisation. Une conversation avec l’IA y reste.')
                : undefined
            }
          />
        </div>
      )
    case 'send':
      return (
        <div className="space-y-4">
          {warning}
          <Segmented
            value={step.channel}
            onValueChange={(channel) =>
              onChange(
                channel === 'email'
                  ? { id: step.id, kind: 'send', channel, body: step.body }
                  : { ...step, channel },
              )
            }
            options={[
              { value: 'sms', label: $t('SMS / RCS') },
              { value: 'email', label: $t('E-mail') },
            ]}
            aria-label={$t('Canal')}
            className="w-full"
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {step.channel === 'sms'
              ? $t(
                  'Au numéro du contact : en RCS si le numéro d’envoi le permet et que son téléphone le lit, en SMS sinon. Une conversation par SMS ou RCS l’envoie sur place ; sinon, celle de son téléphone, ouverte au besoin. Sans numéro, l’étape passe.',
                )
              : $t(
                  'À l’adresse du contact : par l’adresse e-mail du site, ou par les e-mails du serveur. Sans adresse, l’étape passe.',
                )}
          </p>
          {step.channel === 'sms' && (choices?.numbers.length ?? 0) > 1 && (
            <Field label={$t('Depuis')}>
              {(id) => (
                <ChoiceMenu
                  id={id}
                  value={step.numberId ?? null}
                  choices={(choices?.numbers ?? []).map((n) => ({ id: n.id, label: n.name }))}
                  onChange={(numberId) =>
                    onChange(
                      numberId
                        ? { ...step, numberId }
                        : { id: step.id, kind: 'send', channel: step.channel, body: step.body },
                    )
                  }
                  allowNone
                  disabled={false}
                />
              )}
            </Field>
          )}
          <CitingText
            label={$t('Message')}
            value={step.body}
            onChange={(body) => onChange({ ...step, body })}
            draft={draft}
            stepId={step.id}
            rows={5}
            placeholder={$t('Bonjour {{contact.prenom}}, …')}
            hint={$t('Signé du nom du site. La conversation reste dans la file.')}
          />
        </div>
      )
    case 'ask_email':
      return (
        <div className="space-y-4">
          <CitingText
            label={$t('Ce que dit la carte')}
            value={step.text}
            onChange={(text) => onChange({ ...step, text })}
            draft={draft}
            stepId={step.id}
            rows={3}
            placeholder={$t('Laissez-nous votre e-mail : nous vous répondons dès que possible.')}
            hint={$t(
              'Le widget montre une carte pour laisser son adresse — une fois par conversation, et seulement si le contact n’en a pas.',
            )}
          />
        </div>
      )
    case 'notify':
      return (
        <div className="space-y-4">
          {warning}
          <Segmented
            value={step.to}
            onValueChange={(to) => onChange({ ...step, to })}
            options={[
              { value: 'assignee', label: $t('Son conseiller') },
              { value: 'team', label: $t('Une équipe') },
              { value: 'supervisors', label: $t('Superviseurs') },
              { value: 'agents', label: $t('Des personnes') },
            ]}
            className="grid h-auto w-full grid-cols-2"
            aria-label={$t('Qui prévenir')}
          />
          {step.to === 'team' && (
            <Pick
              label={$t('Équipe')}
              value={step.teamId}
              choices={named(choices?.teams)}
              onChange={(teamId) => onChange({ ...step, ...(teamId ? { teamId } : {}) })}
            />
          )}
          {step.to === 'agents' && (
            <Field label={$t('Personnes')}>
              {() => (
                <Toggles
                  value={step.agentIds ?? []}
                  choices={named(choices?.agents)}
                  onChange={(agentIds) => onChange({ ...step, agentIds })}
                  disabled={false}
                />
              )}
            </Field>
          )}
          <CitingText
            label={$t('Ce que dit la notification')}
            value={step.text}
            onChange={(text) => onChange({ ...step, text })}
            draft={draft}
            stepId={step.id}
            rows={2}
            placeholder={$t('{{contact.nom}} attend depuis 10 minutes')}
            hint={$t('Dans leur cloche, et sur leur bureau s’ils ont activé les notifications.')}
          />
        </div>
      )
    case 'webhook':
      return (
        <div className="space-y-4">
          {warning}
          <Field
            label={$t('Adresse')}
            hint={$t('Un POST en JSON. HTTPS, vers une adresse publique.')}
          >
            {(id) => (
              <Input
                id={id}
                value={step.url}
                onChange={(e) => onChange({ ...step, url: e.target.value })}
                placeholder="https://crm.exemple.fr/api/tickets"
                className="h-8 font-mono text-xs"
              />
            )}
          </Field>
          <Field
            label={$t('En-têtes')}
            hint={$t(
              'Une valeur peut nommer une variable du serveur : ${CRM_TOKEN}. Jamais de secret ici.',
            )}
          >
            {() => (
              <div className="space-y-1.5">
                {step.headers.map((header, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: headers have no id; their place is it
                  <div key={index} className="flex gap-1.5">
                    <Input
                      value={header.name}
                      onChange={(e) =>
                        onChange({
                          ...step,
                          headers: step.headers.map((h, i) =>
                            i === index ? { ...h, name: e.target.value } : h,
                          ),
                        })
                      }
                      placeholder="Authorization"
                      className="h-8 w-32 font-mono text-xs"
                      aria-label={$t('Nom')}
                    />
                    <Input
                      value={header.value}
                      onChange={(e) =>
                        onChange({
                          ...step,
                          headers: step.headers.map((h, i) =>
                            i === index ? { ...h, value: e.target.value } : h,
                          ),
                        })
                      }
                      placeholder="Bearer ${CRM_TOKEN}"
                      className="h-8 min-w-0 flex-1 font-mono text-xs"
                      aria-label={$t('Valeur')}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={$t('Retirer l’en-tête')}
                      onClick={() =>
                        onChange({ ...step, headers: step.headers.filter((_, i) => i !== index) })
                      }
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() =>
                    onChange({ ...step, headers: [...step.headers, { name: '', value: '' }] })
                  }
                >
                  <Plus className="size-3.5" />
                  {$t('Ajouter un en-tête')}
                </Button>
              </div>
            )}
          </Field>
          <CitingText
            label={$t('Corps')}
            value={step.body}
            onChange={(body) => onChange({ ...step, body })}
            draft={draft}
            stepId={step.id}
            rows={6}
            mono
            placeholder={'{\n  "client": "{{contact.email}}",\n  "demande": "{{message.texte}}"\n}'}
            hint={$t('Vide : la conversation et le contact, tels quels.')}
          />
          <OutputHint step={step} />
        </div>
      )
    case 'ai':
      return (
        <div className="space-y-4">
          {warning}
          {choices?.ai === false && (
            <Warning>
              {$t('Aucun modèle d’IA n’est configuré sur le serveur : cette étape échouera.')}
            </Warning>
          )}
          <Segmented
            value={step.mode}
            onValueChange={(mode) => onChange({ ...step, mode })}
            options={[
              { value: 'classify', label: $t('Classer') },
              { value: 'write', label: $t('Rédiger') },
            ]}
            className="w-full"
            aria-label={$t('Ce que fait l’IA')}
          />
          <CitingText
            label={$t('Consigne')}
            value={step.prompt}
            onChange={(prompt) => onChange({ ...step, prompt })}
            draft={draft}
            stepId={step.id}
            rows={4}
            placeholder={
              step.mode === 'classify'
                ? $t('Quel est le sujet de la demande ?')
                : $t('Résume la demande en une phrase pour le CRM.')
            }
            hint={$t(
              'L’IA lit la conversation, données personnelles masquées si le serveur le demande.',
            )}
          />
          {step.mode === 'classify' && (
            <Field
              label={$t('Réponses possibles')}
              hint={$t('L’IA en choisit une ; une condition s’en sert ensuite.')}
            >
              {(id) => (
                <LinesField
                  id={id}
                  value={step.choices.join('\n')}
                  onChange={(text) =>
                    onChange({ ...step, choices: text.split('\n').filter(Boolean) })
                  }
                  placeholder={$t('Sinistre, Contrat, Paiement…')}
                />
              )}
            </Field>
          )}
          <OutputHint step={step} />
        </div>
      )
    case 'data':
      return (
        <div className="space-y-4">
          {warning}
          <Field label={$t('Nom de la donnée')}>
            {(id) => (
              <Input
                id={id}
                value={step.key}
                onChange={(e) => onChange({ ...step, key: e.target.value })}
                placeholder={$t('canal')}
                className="h-8"
              />
            )}
          </Field>
          <CitingText
            label={$t('Valeur')}
            value={step.value}
            onChange={(value) => onChange({ ...step, value })}
            draft={draft}
            stepId={step.id}
            rows={2}
          />
          <p className="text-xs text-muted-foreground">
            {$t('Jointe à la conversation, dans le volet des conseillers ; l’IA la lit aussi.')}
          </p>
        </div>
      )
    case 'wait':
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              value={step.amount}
              onChange={(e) => onChange({ ...step, amount: Number(e.target.value) || 1 })}
              className="h-8 w-24"
              aria-label={$t('Durée')}
            />
            <Segmented
              value={step.unit}
              onValueChange={(unit) => onChange({ ...step, unit })}
              options={[
                { value: 'minutes', label: $t('minutes') },
                { value: 'hours', label: $t('heures') },
                { value: 'days', label: $t('jours') },
              ]}
              className="flex-1"
              aria-label={$t('Unité')}
            />
          </div>
          <ToggleField
            label={$t('Sauf si le visiteur écrit entre-temps')}
            hint={$t('L’exécution s’arrête là : une relance qui n’a plus lieu d’être.')}
            checked={step.unlessReply}
            onChange={(unlessReply) => onChange({ ...step, unlessReply })}
          />
        </div>
      )
    case 'branch':
      return null
  }
}

export function PathSettings({
  path,
  draft,
  choices,
  onChange,
}: {
  readonly path: BranchPath
  readonly draft: Draft
  readonly choices: Choices
  readonly onChange: (path: BranchPath) => void
}) {
  // A path's rules read what steps before its condition gave.
  const branch = allSteps(draft.steps).find(
    (s) => s.kind === 'branch' && s.paths.some((p) => p.id === path.id),
  )
  return (
    <div className="space-y-5">
      <Section title={$t('Nom du chemin')}>
        <Input
          value={path.label}
          onChange={(e) => onChange({ ...path, label: e.target.value })}
          className="h-8"
          aria-label={$t('Nom du chemin')}
        />
      </Section>
      {path.otherwise ? (
        <p className="text-xs text-muted-foreground">
          {$t('Pris quand aucun autre chemin ne l’est.')}
        </p>
      ) : (
        <Section
          title={$t('Pris si…')}
          hint={$t(
            'Les chemins sont lus dans l’ordre : le premier dont la condition tient est pris.',
          )}
        >
          <ConditionEditor
            condition={path.condition}
            draft={draft}
            stepId={branch?.id ?? null}
            choices={choices}
            onChange={(condition) => onChange({ ...path, condition })}
            empty={$t('Toujours pris.')}
          />
        </Section>
      )}
    </div>
  )
}
