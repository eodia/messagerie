'use client'

import { ScreenHeader, Slash } from '@/components/app/screen-header'
import { RowsSkeleton } from '@/components/app/skeletons'
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
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Hint } from '@/components/ui/tooltip'
import { NEW_WORD, addressOf, idOfWord, wordOf, wordsAfter } from '@/lib/address'
import { ApiFailure, api } from '@/lib/api'
import { END_NODE, type Slot, TRIGGER_NODE } from '@/lib/automation-layout'
import { TEMPLATES } from '@/lib/automation-templates'
import {
  type Draft,
  RUN_LABELS,
  STEP_LABELS,
  TRIGGER_LABELS,
  causeText,
  draftProblem,
  emptyDraft,
  findPath,
  findStep,
  freshId,
  insertStep,
  locate,
  moveStep,
  newStep,
  problemText,
  removeStep,
  replacePath,
  replaceStep,
  runError,
  stepRecordText,
} from '@/lib/automations'
import { $t, intlLocale } from '@/lib/i18n'
import { messageFor } from '@/lib/messages'
import { inboxTime } from '@/lib/time'
import { useTitle } from '@/lib/title'
import { useAddressBar } from '@/lib/use-address-bar'
import { cn } from '@/lib/utils'
import type {
  Automation,
  AutomationChoices,
  AutomationRun,
  AutomationStep,
  ConversationSummary,
} from '@chat/contracts'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Ellipsis,
  LayoutTemplate,
  LoaderCircle,
  Play,
  Plus,
  Split,
  Square,
  Trash2,
  Workflow,
  X,
  Zap,
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FlowCanvas, STEP_ICONS, TRIGGER_TONE } from './flow'
import { StepPicker } from './picker'
import { PathSettings, StepSettings, TriggerSettings } from './settings'

/**
 * « Automatisations » (D20) — basedb's editor, made for conversations: the automations on
 * the left, the chosen one's flow in the middle, and on the right the settings of what is
 * chosen on the flow, or its runs. A draft is saved off; it is switched on once nothing
 * keeps it from running.
 */

const BASE = '/automatisations'
const POLL_MS = 5000

type Selection = string | 'new' | null

const automationWord = (a: Automation) => wordOf(a.id, a.name, 'automatisation')

export function AutomationsScreen() {
  useTitle([$t('Automatisations')])
  const [automations, setAutomations] = useState<readonly Automation[] | null>(null)
  const [choices, setChoices] = useState<AutomationChoices | null>(null)
  const [selected, setSelected] = useState<Selection>(null)
  const [seed, setSeed] = useState<{ readonly n: number; readonly draft: Draft | null }>({
    n: 0,
    draft: null,
  })
  const [error, setError] = useState<string | null>(null)
  const [arrived, setArrived] = useState(false)

  const load = useCallback(async () => {
    try {
      const list = await api.automations()
      setAutomations(list)
      setError(null)
      return list
    } catch (failure) {
      setError(messageFor(failure instanceof ApiFailure ? failure.code : 'INTERNAL_ERROR'))
      return null
    }
  }, [])

  const follow = useCallback((list: readonly Automation[]) => {
    const word = wordsAfter(BASE)?.[0]
    if (word === NEW_WORD) {
      setSeed((s) => ({ n: s.n + 1, draft: null }))
      setSelected('new')
      return
    }
    const id = word
      ? idOfWord(
          word,
          list.map((a) => a.id),
        )
      : null
    setSelected(id ?? list[0]?.id ?? null)
  }, [])

  useEffect(() => {
    void api.automationChoices().then(setChoices, () => setChoices(null))
    void load().then((list) => {
      if (list) follow(list)
      setArrived(true)
    })
  }, [load, follow])

  const current =
    selected === null || selected === 'new'
      ? null
      : (automations?.find((a) => a.id === selected) ?? null)
  const address = !arrived
    ? null
    : selected === 'new'
      ? addressOf(BASE, NEW_WORD)
      : current
        ? addressOf(BASE, automationWord(current))
        : BASE
  useAddressBar(address, async () => {
    if (automations) follow(automations)
  })

  const createFrom = (draft: Draft | null) => {
    setSeed((s) => ({ n: s.n + 1, draft }))
    setSelected('new')
  }

  const toggle = async (automation: Automation, active: boolean) => {
    try {
      await api.setAutomationActive(automation.id, active)
      await load()
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'AUTOMATION_INVALID') {
        setSelected(automation.id)
        setError(problemText(String(failure.details.problem ?? '')))
      } else {
        setError(messageFor(failure instanceof ApiFailure ? failure.code : 'INTERNAL_ERROR'))
      }
    }
  }

  return (
    <>
      <ScreenHeader>
        <span className="text-muted-foreground">{$t('Administration')}</span>
        <Slash />
        <span className="font-medium">{$t('Automatisations')}</span>
      </ScreenHeader>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r">
          <div className="p-3">
            <NewButton onCreate={createFrom} choices={choices} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 scroll-discret">
            {automations === null && error === null && (
              <RowsSkeleton rows={4} avatar={false} className="p-0" />
            )}
            {automations?.length === 0 && (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                {$t(
                  'Aucune automatisation. Faites faire à la messagerie ce que l’équipe refait à la main.',
                )}
              </p>
            )}
            {automations?.map((a) => (
              <div
                key={a.id}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-2',
                  selected === a.id ? 'bg-accent' : 'hover:bg-accent/60',
                )}
              >
                <button
                  type="button"
                  onClick={() => setSelected(a.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="flex items-center gap-1.5 text-xs font-medium">
                    <Zap
                      className={cn(
                        'size-3.5 shrink-0',
                        a.active ? 'text-primary' : 'text-muted-foreground',
                      )}
                    />
                    <span className="truncate">{a.name}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {$t(TRIGGER_LABELS[a.trigger.kind])}
                    {a.runs7d > 0 && (
                      <>
                        {' · '}
                        {$t('{count} en 7 j', { count: a.runs7d })}
                        {a.failed7d > 0 && (
                          <span className="text-destructive">
                            {' · '}
                            {$t('{count} en échec', { count: a.failed7d })}
                          </span>
                        )}
                      </>
                    )}
                  </span>
                </button>
                <Switch
                  checked={a.active}
                  onCheckedChange={(v) => void toggle(a, v)}
                  aria-label={
                    a.active
                      ? $t('Arrêter {name}', { name: a.name })
                      : $t('Activer {name}', { name: a.name })
                  }
                />
              </div>
            ))}
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          {error !== null && (
            <div className="flex shrink-0 items-center gap-2 border-b bg-destructive/8 px-4 py-2 text-sm text-destructive">
              <span className="min-w-0 flex-1">{error}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={$t('Fermer le message')}
                onClick={() => setError(null)}
              >
                <X className="size-4" />
              </Button>
            </div>
          )}
          {selected === null ? (
            <Welcome onCreate={createFrom} choices={choices} />
          ) : (
            <Editor
              key={selected === 'new' ? `new:${seed.n}` : selected}
              automation={current}
              initial={selected === 'new' ? (seed.draft ?? emptyDraft()) : null}
              choices={choices}
              onSaved={async (saved) => {
                await load()
                setSelected(saved.id)
              }}
              onReload={async () => {
                await load()
              }}
              onDeleted={async () => {
                const list = await load()
                setSelected(list?.[0]?.id ?? null)
              }}
            />
          )}
        </main>
      </div>
    </>
  )
}

function NewButton({
  onCreate,
  choices,
}: {
  readonly onCreate: (draft: Draft | null) => void
  readonly choices: AutomationChoices | null
}) {
  return (
    <div className="flex">
      <Button className="flex-1 gap-1.5 rounded-r-none" size="sm" onClick={() => onCreate(null)}>
        <Plus className="size-4" />
        {$t('Nouvelle automatisation')}
      </Button>
      <DropdownMenu>
        <Hint label={$t('Partir d’un modèle')}>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              className="rounded-l-none border-l border-primary-foreground/20 px-2"
              aria-label={$t('Partir d’un modèle')}
            >
              <ChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent align="start" className="w-80">
          <DropdownMenuLabel className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {$t('Modèles')}
          </DropdownMenuLabel>
          {TEMPLATES.map((t) => (
            <DropdownMenuItem
              key={t.key}
              onSelect={() => onCreate(t.make(choices))}
              className="flex-col items-start gap-0.5"
            >
              <span className="text-sm">{$t(t.name)}</span>
              <span className="text-xs text-muted-foreground">{$t(t.hint)}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function Welcome({
  onCreate,
  choices,
}: {
  readonly onCreate: (draft: Draft | null) => void
  readonly choices: AutomationChoices | null
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-discret">
      <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
        <div className="space-y-2">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/12 text-primary">
            <Workflow className="size-5" />
          </div>
          <h2 className="text-lg font-semibold">{$t('Ce que l’équipe refait à la main')}</h2>
          <p className="text-sm text-muted-foreground">
            {$t(
              'Une automatisation part d’un événement — un message, un transfert, un délai, une heure — et agit sur la conversation : l’attribuer, l’étiqueter, répondre, prévenir, appeler un autre système. Partez d’un modèle, ou d’une page blanche.',
            )}
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => onCreate(t.make(choices))}
              className="flex items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors hover:border-foreground/25 hover:bg-accent/50"
            >
              <LayoutTemplate className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{$t(t.name)}</span>
                <span className="block text-xs text-muted-foreground">{$t(t.hint)}</span>
              </span>
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onCreate(null)}>
          <Plus className="size-4" />
          {$t('Page blanche')}
        </Button>
      </div>
    </div>
  )
}

// ── The editor ──────────────────────────────────────────────────────────────

function useRuns(automation: Automation | null, tick: number) {
  const [runs, setRuns] = useState<readonly AutomationRun[] | null>(null)
  useEffect(() => {
    void tick
    if (automation === null) {
      setRuns([])
      return
    }
    let alive = true
    const read = () =>
      api.automationRuns(automation.id).then(
        (list) => alive && setRuns(list.items),
        () => alive && setRuns((r) => r ?? []),
      )
    void read()
    const timer = setInterval(read, POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [automation, tick])
  return runs
}

function Editor({
  automation,
  initial,
  choices,
  onSaved,
  onReload,
  onDeleted,
}: {
  readonly automation: Automation | null
  readonly initial: Draft | null
  readonly choices: AutomationChoices | null
  readonly onSaved: (saved: Automation) => Promise<void>
  readonly onReload: () => Promise<void>
  readonly onDeleted: () => Promise<void>
}) {
  const definitionOf = (a: Automation): Draft => ({
    name: a.name,
    description: a.description,
    trigger: a.trigger,
    condition: a.condition,
    steps: a.steps,
  })
  const [draft, setDraft] = useState<Draft>(() => initial ?? definitionOf(automation as Automation))
  const [savedAs, setSavedAs] = useState(() =>
    automation ? JSON.stringify(definitionOf(automation)) : '',
  )
  const [selected, setSelected] = useState<string>(TRIGGER_NODE)
  const [tab, setTab] = useState<'settings' | 'runs'>('settings')
  const [focus, setFocus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{
    readonly text: string
    readonly step: string | null
  } | null>(null)
  const [picking, setPicking] = useState<Slot | null>(null)
  const [runsTick, setRunsTick] = useState(0)
  const [shownRun, setShownRun] = useState<string | null>(null)
  const runs = useRuns(automation, runsTick)
  const run = runs?.find((r) => r.id === shownRun) ?? null
  const dirty = JSON.stringify(draft) !== savedAs
  const problem = draftProblem(draft)

  const select = useCallback((id: string) => {
    setSelected(id)
    setTab('settings')
  }, [])
  const pick = useCallback((slot: Slot) => setPicking(slot), [])

  const setSteps = (edit: (steps: readonly AutomationStep[]) => AutomationStep[]) =>
    setDraft((d) => ({ ...d, steps: edit(d.steps) }))

  const insert = (slot: Slot, kind: AutomationStep['kind']) => {
    const step = newStep(kind, draft.steps)
    setDraft((d) => ({ ...d, steps: insertStep(d.steps, slot.path, slot.index, step) }))
    setSelected(step.id)
    setFocus(step.id)
    setTab('settings')
    setShownRun(null)
  }

  const fail = (failure: unknown) => {
    if (failure instanceof ApiFailure && failure.code === 'AUTOMATION_INVALID') {
      const step = typeof failure.details.step === 'string' ? failure.details.step : null
      setError({ text: problemText(String(failure.details.problem ?? '')), step })
      if (step && findStep(draft.steps, step)) select(step)
      return
    }
    setError({
      text: messageFor(failure instanceof ApiFailure ? failure.code : 'INTERNAL_ERROR'),
      step: null,
    })
  }

  const save = async (activate?: boolean) => {
    setBusy(true)
    setError(null)
    try {
      let saved =
        automation === null
          ? await api.createAutomation(draft)
          : await api.saveAutomation(automation.id, draft)
      if (activate !== undefined && activate !== saved.active) {
        saved = await api.setAutomationActive(saved.id, activate)
      }
      const kept = definitionOf(saved)
      setDraft(kept)
      setSavedAs(JSON.stringify(kept))
      await onSaved(saved)
    } catch (failure) {
      fail(failure)
    } finally {
      setBusy(false)
    }
  }

  // Ctrl+S saves, as in a document.
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const remove = async () => {
    if (automation === null) return
    setBusy(true)
    try {
      await api.deleteAutomation(automation.id)
      await onDeleted()
    } catch (failure) {
      fail(failure)
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
        <Input
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          aria-label={$t('Nom de l’automatisation')}
          className="h-8 w-72 max-w-full font-medium"
          maxLength={120}
        />
        {automation !== null && (
          <Hint
            label={
              !automation.active && problem
                ? problemText(problem.problem)
                : automation.active
                  ? $t('Elle tourne : l’arrêter')
                  : $t('L’activer')
            }
          >
            <label htmlFor="automation-active" className="flex items-center gap-2 text-xs">
              <Switch
                id="automation-active"
                checked={automation.active}
                disabled={busy || (!automation.active && problem !== null)}
                onCheckedChange={(v) => void save(v)}
              />
              {automation.active ? $t('Active') : $t('Arrêtée')}
            </label>
          </Hint>
        )}
        <div className="flex-1" />
        {dirty && automation !== null && (
          <span className="text-xs text-muted-foreground">
            {$t('Modifications non enregistrées')}
          </span>
        )}
        {automation !== null && (
          <TryRun
            automation={automation}
            disabled={busy || dirty}
            onRan={(id) => {
              setRunsTick((t) => t + 1)
              setShownRun(id)
              setTab('runs')
            }}
            onError={fail}
          />
        )}
        <Button onClick={() => void save()} disabled={busy || !dirty} size="sm" className="gap-1.5">
          {busy && <LoaderCircle className="size-3.5 animate-spin" />}
          {automation === null ? $t('Créer') : $t('Enregistrer')}
        </Button>
        {automation !== null && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={$t('Autres actions')}>
                <Ellipsis className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                disabled={busy}
                onSelect={() => void remove()}
              >
                <Trash2 className="size-4" />
                {$t('Supprimer l’automatisation')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {error !== null && (
        <div className="flex shrink-0 items-center gap-2 border-b bg-destructive/8 px-4 py-2 text-sm text-destructive">
          <span className="min-w-0 flex-1">
            {error.step !== null && <span className="font-mono">{error.step} · </span>}
            {error.text}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={$t('Fermer le message')}
            onClick={() => setError(null)}
          >
            <X className="size-4" />
          </Button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <FlowCanvas
            draft={draft}
            choices={choices}
            selected={tab === 'settings' ? selected : ''}
            onSelect={select}
            onPick={pick}
            run={run}
            focus={focus}
          />
          <StepPicker
            open={picking !== null}
            ai={choices?.ai ?? true}
            onPick={(kind) => {
              if (picking !== null) insert(picking, kind)
              setPicking(null)
            }}
            onClose={() => setPicking(null)}
          />
          {run !== null && (
            <div className="absolute top-3 left-3 z-10 flex max-w-[calc(100%-1.5rem)] items-center gap-2 whitespace-nowrap rounded-full border bg-card px-3 py-1 text-xs shadow-sm">
              <RunDot status={run.status} />
              <span className="truncate font-medium">
                {$t(RUN_LABELS[run.status])}
                {run.contactName ? ` · ${run.contactName}` : ''}
              </span>
              <button
                type="button"
                onClick={() => setShownRun(null)}
                className="ml-1 rounded-sm text-muted-foreground hover:text-foreground"
                aria-label={$t('Ne plus montrer cette exécution')}
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}
          {draft.steps.length === 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center">
              <p className="rounded-full bg-card/90 px-3 py-1 text-xs text-muted-foreground shadow-xs">
                {$t('Réglez le déclencheur, puis ajoutez ce qu’elle doit faire.')}
              </p>
            </div>
          )}
        </div>
        <aside className="flex w-[360px] shrink-0 flex-col border-l bg-background">
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as 'settings' | 'runs')}
            className="flex min-h-0 flex-1 flex-col gap-0"
          >
            <div className="border-b px-3">
              <TabsList>
                <TabsTrigger value="settings">{$t('Réglages')}</TabsTrigger>
                <TabsTrigger value="runs" disabled={automation === null}>
                  {$t('Exécutions')}
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="settings" className="min-h-0 flex-1 overflow-y-auto scroll-discret">
              <Inspector
                draft={draft}
                automation={automation}
                choices={choices}
                selected={selected}
                onSelect={select}
                onDraft={(patch) => setDraft((d) => ({ ...d, ...patch }))}
                onSteps={setSteps}
                onPick={pick}
                onRenewKey={async () => {
                  if (automation === null) return
                  await api.renewAutomationKey(automation.id).catch(fail)
                  await onReload()
                }}
              />
            </TabsContent>
            <TabsContent value="runs" className="min-h-0 flex-1 overflow-y-auto scroll-discret">
              <Runs
                runs={runs}
                draft={draft}
                shown={shownRun}
                onShow={(id) => setShownRun((now) => (now === id ? null : id))}
                onStop={async (id) => {
                  await api.stopAutomationRun(id).catch(fail)
                  setRunsTick((t) => t + 1)
                }}
              />
            </TabsContent>
          </Tabs>
        </aside>
      </div>
    </div>
  )
}

function Pane({
  icon,
  title,
  id,
  tone,
  footer,
  children,
}: {
  readonly icon: ReactNode
  readonly title: string
  readonly id?: string
  readonly tone: string
  readonly footer?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <span className={cn('flex size-7 items-center justify-center rounded-md', tone)}>
          {icon}
        </span>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
        {id !== undefined && (
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            {id}
          </span>
        )}
      </div>
      <div className="flex-1 px-4 pb-4">{children}</div>
      {footer !== undefined && (
        <div className="sticky bottom-0 flex items-center gap-1 border-t bg-background px-2 py-2">
          {footer}
        </div>
      )}
    </div>
  )
}

function Inspector({
  draft,
  automation,
  choices,
  selected,
  onSelect,
  onDraft,
  onSteps,
  onPick,
  onRenewKey,
}: {
  readonly draft: Draft
  readonly automation: Automation | null
  readonly choices: AutomationChoices | null
  readonly selected: string
  readonly onSelect: (id: string) => void
  readonly onDraft: (patch: Partial<Draft>) => void
  readonly onSteps: (edit: (steps: readonly AutomationStep[]) => AutomationStep[]) => void
  readonly onPick: (slot: Slot) => void
  readonly onRenewKey: () => Promise<void>
}) {
  if (selected === TRIGGER_NODE || selected === END_NODE) {
    return (
      <Pane icon={<Zap className="size-4" />} title={$t('Déclencheur')} tone={TRIGGER_TONE}>
        <TriggerSettings
          draft={draft}
          automation={automation}
          choices={choices}
          onChange={onDraft}
          onRenewKey={onRenewKey}
        />
        {draft.steps.length === 0 && (
          <Button
            variant="outline"
            size="sm"
            className="mt-6 w-full gap-1.5"
            onClick={() => onPick({ path: null, index: 0 })}
          >
            <Plus className="size-4" />
            {$t('Ajouter une étape')}
          </Button>
        )}
      </Pane>
    )
  }

  const step = findStep(draft.steps, selected)
  if (step !== null) {
    const where = locate(draft.steps, step.id)
    const Icon = STEP_ICONS[step.kind]
    return (
      <Pane
        icon={<Icon className="size-4" />}
        title={$t(STEP_LABELS[step.kind])}
        id={step.id}
        tone="bg-muted text-foreground"
        footer={
          <>
            <Hint label={$t('Monter l’étape')}>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={where === null || where.index === 0}
                onClick={() => onSteps((s) => moveStep(s, step.id, -1))}
                aria-label={$t('Monter l’étape')}
              >
                <ArrowUp className="size-4" />
              </Button>
            </Hint>
            <Hint label={$t('Descendre l’étape')}>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={where === null || where.index === where.length - 1}
                onClick={() => onSteps((s) => moveStep(s, step.id, 1))}
                aria-label={$t('Descendre l’étape')}
              >
                <ArrowDown className="size-4" />
              </Button>
            </Hint>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-destructive hover:text-destructive"
              onClick={() => {
                onSteps((s) => removeStep(s, step.id))
                onSelect(TRIGGER_NODE)
              }}
            >
              <Trash2 className="size-4" />
              {step.kind === 'branch'
                ? $t('Retirer la condition et ses chemins')
                : $t('Retirer l’étape')}
            </Button>
          </>
        }
      >
        {step.kind === 'branch' ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {$t(
                'Les chemins sont lus dans l’ordre : le premier dont la condition tient est pris.',
              )}
            </p>
            {step.paths.map((path) => (
              <button
                key={path.id}
                type="button"
                onClick={() => onSelect(path.id)}
                className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent/50"
              >
                <Split className="size-3.5 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{path.label || $t('Chemin')}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{path.id}</span>
              </button>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1.5"
              onClick={() => {
                const id = freshId(draft.steps, 'p')
                // A new path goes before « Sinon », which stays last.
                const otherwise = step.paths.findIndex((p) => p.otherwise)
                const paths = [...step.paths]
                paths.splice(otherwise < 0 ? paths.length : otherwise, 0, {
                  id,
                  label: $t('Chemin {n}', { n: paths.length + 1 }),
                  otherwise: false,
                  condition: { match: 'all', rules: [] },
                  steps: [],
                })
                onSteps((s) => replaceStep(s, step.id, { ...step, paths }))
                onSelect(id)
              }}
            >
              <Plus className="size-3.5" />
              {$t('Ajouter un chemin')}
            </Button>
          </div>
        ) : (
          <StepSettings
            key={step.id}
            step={step}
            draft={draft}
            choices={choices}
            onChange={(next) => onSteps((s) => replaceStep(s, step.id, next))}
          />
        )}
      </Pane>
    )
  }

  const found = findPath(draft.steps, selected)
  if (found !== null) {
    const { branch, path } = found
    return (
      <Pane
        icon={<Split className="size-4" />}
        title={path.otherwise ? $t('Chemin « Sinon »') : $t('Chemin')}
        id={path.id}
        tone="bg-amber-500/15 text-amber-700 dark:text-amber-300"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => onSelect(branch.id)}>
              {$t('Tous les chemins')}
            </Button>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-destructive hover:text-destructive"
              disabled={branch.paths.length === 1}
              onClick={() => {
                onSteps((s) =>
                  replaceStep(s, branch.id, {
                    ...branch,
                    paths: branch.paths.filter((p) => p.id !== path.id),
                  }),
                )
                onSelect(branch.id)
              }}
            >
              <Trash2 className="size-4" />
              {$t('Retirer le chemin')}
            </Button>
          </>
        }
      >
        <PathSettings
          path={path}
          draft={draft}
          choices={choices}
          onChange={(next) => onSteps((s) => replacePath(s, path.id, next))}
        />
        <Button
          variant="outline"
          size="sm"
          className="mt-6 w-full gap-1.5"
          onClick={() => onPick({ path: path.id, index: path.steps.length })}
        >
          <Plus className="size-4" />
          {$t('Ajouter une étape à ce chemin')}
        </Button>
      </Pane>
    )
  }

  return (
    <p className="p-6 text-center text-sm text-muted-foreground">
      {$t('Choisissez une étape sur le flux pour la régler.')}
    </p>
  )
}

/** « Essayer » : a run now, on a conversation chosen among the latest — for real. */
function TryRun({
  automation,
  disabled,
  onRan,
  onError,
}: {
  readonly automation: Automation
  readonly disabled: boolean
  readonly onRan: (run: string) => void
  readonly onError: (failure: unknown) => void
}) {
  const [list, setList] = useState<readonly ConversationSummary[] | null>(null)
  const [busy, setBusy] = useState(false)
  const needs = !(automation.trigger.kind === 'schedule' && !automation.trigger.forEach)
  const hint = disabled
    ? $t('Enregistrez d’abord : l’essai exécute ce qui est enregistré')
    : undefined

  const run = async (conversationId: string | null) => {
    setBusy(true)
    try {
      const { runId } = await api.tryAutomation(automation.id, conversationId)
      onRan(runId)
    } catch (failure) {
      onError(failure)
    } finally {
      setBusy(false)
    }
  }

  if (!needs) {
    return (
      <Hint label={hint}>
        <span className="inline-flex">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || disabled}
            onClick={() => void run(null)}
            className="gap-1.5"
          >
            <Play className="size-3.5" />
            {$t('Essayer')}
          </Button>
        </span>
      </Hint>
    )
  }
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open && list === null) void api.conversations().then(setList, () => setList([]))
      }}
    >
      <Hint label={hint}>
        <span className="inline-flex">
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={busy || disabled} className="gap-1.5">
              <Play className="size-3.5" />
              {$t('Essayer sur une conversation')}
            </Button>
          </DropdownMenuTrigger>
        </span>
      </Hint>
      <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {$t('Ce qu’elle fait, elle le fait pour de bon.')}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {list === null && <RowsSkeleton rows={4} avatar={false} className="p-0" />}
        {list?.length === 0 && (
          <p className="px-2 py-3 text-sm text-muted-foreground">{$t('Aucune conversation.')}</p>
        )}
        {list?.slice(0, 20).map((c) => (
          <DropdownMenuItem
            key={c.id}
            onSelect={() => void run(c.id)}
            className="flex-col items-start gap-0"
          >
            <span className="text-sm">{c.contact.name}</span>
            <span className="w-full truncate text-xs text-muted-foreground">{c.preview}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const RUN_TONES: Readonly<Record<AutomationRun['status'], string>> = {
  queued: 'bg-zinc-400',
  running: 'bg-sky-500 animate-pulse',
  waiting: 'bg-sky-500',
  succeeded: 'bg-emerald-500',
  failed: 'bg-destructive',
  stopped: 'bg-zinc-400',
}

function RunDot({ status }: { readonly status: AutomationRun['status'] }) {
  return <span className={cn('inline-block size-2 shrink-0 rounded-full', RUN_TONES[status])} />
}

/** The runs, newest first; one chosen is laid over the flow, and told step by step. */
function Runs({
  runs,
  draft,
  shown,
  onShow,
  onStop,
}: {
  readonly runs: readonly AutomationRun[] | null
  readonly draft: Draft
  readonly shown: string | null
  readonly onShow: (id: string) => void
  readonly onStop: (id: string) => Promise<void>
}) {
  const now = new Date()
  if (runs === null) {
    return <RowsSkeleton rows={5} avatar={false} />
  }
  if (runs.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">
        {$t('Pas encore d’exécution. « Essayer » en lance une sur la conversation de votre choix.')}
      </p>
    )
  }
  return (
    <div className="space-y-1 p-2">
      <p className="px-2 pt-1 pb-2 text-xs text-muted-foreground">
        {$t(
          'Les 100 dernières, gardées 90 jours. Choisissez-en une pour voir le chemin qu’elle a pris.',
        )}
      </p>
      {runs.map((run) => {
        const open = run.id === shown
        return (
          <div
            key={run.id}
            className={cn(
              'rounded-md border',
              open ? 'border-primary/50 bg-accent/40' : 'border-transparent',
            )}
          >
            <button
              type="button"
              onClick={() => onShow(run.id)}
              aria-expanded={open}
              className="w-full rounded-md px-2 py-1.5 text-left hover:bg-accent/60"
            >
              <span className="flex items-center gap-2 text-xs">
                <RunDot status={run.status} />
                <span className="font-medium">{$t(RUN_LABELS[run.status])}</span>
                {run.contactName && (
                  <span className="truncate text-muted-foreground">· {run.contactName}</span>
                )}
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">
                  {inboxTime(run.createdAt, now)}
                </span>
              </span>
              <span className="block pl-4 text-[11px] text-muted-foreground">
                {causeText(run.cause)}
                {run.error && run.status !== 'succeeded' && ` · ${runError(run.error)}`}
              </span>
            </button>
            {open && (
              <div className="space-y-1 px-2 pb-2 pl-6">
                <ol className="space-y-0.5 text-xs">
                  {run.steps.map((record, index) => {
                    const step = findStep(draft.steps, record.id)
                    return (
                      <li
                        key={`${record.id}-${index}`}
                        className={cn(
                          'flex gap-1.5',
                          record.status === 'failed' ? 'text-destructive' : 'text-muted-foreground',
                        )}
                      >
                        <span className="font-mono text-[11px]">{record.id}</span>
                        <span className="min-w-0">
                          {$t(STEP_LABELS[step?.kind ?? record.kind])} — {stepRecordText(record)}
                        </span>
                      </li>
                    )
                  })}
                </ol>
                {run.resumeAt && run.status === 'waiting' && (
                  <p className="text-[11px] text-muted-foreground">
                    {$t('Reprend le {date}', {
                      date: new Intl.DateTimeFormat(intlLocale(), {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      }).format(new Date(run.resumeAt)),
                    })}
                  </p>
                )}
                {(run.status === 'waiting' || run.status === 'queued') && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-xs"
                    onClick={() => void onStop(run.id)}
                  >
                    <Square className="size-3" />
                    {$t('Arrêter cette exécution')}
                  </Button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
