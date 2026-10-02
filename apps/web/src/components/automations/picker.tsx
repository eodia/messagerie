'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  STEP_GROUPS,
  STEP_HINTS,
  STEP_LABELS,
  TRIGGER_GROUPS,
  TRIGGER_HINTS,
  TRIGGER_LABELS,
} from '@/lib/automations'
import { $t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { AutomationStepKind, AutomationTriggerKind } from '@chat/contracts'
import { type LucideIcon, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { STEP_ICONS, STEP_TONES, TRIGGER_ICONS, TRIGGER_TONE } from './flow'

/**
 * What to add to a flow, or what sets it off: the kinds by groups, each with what it does,
 * found by typing — the first one found taken with Enter.
 */

interface Option<T extends string> {
  readonly kind: T
  readonly label: string
  readonly hint: string
  readonly icon: LucideIcon
  readonly tone: string
}

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()

function KindPicker<T extends string>({
  open,
  title,
  description,
  groups,
  current,
  onPick,
  onClose,
}: {
  readonly open: boolean
  readonly title: string
  readonly description: string
  readonly groups: readonly { readonly label: string; readonly options: readonly Option<T>[] }[]
  readonly current?: T
  readonly onPick: (kind: T) => void
  readonly onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const shown = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean)
    return groups
      .map((g) => ({
        ...g,
        options: g.options.filter((o) => {
          const text = fold(`${o.label} ${o.hint}`)
          return words.every((w) => text.includes(w))
        }),
      }))
      .filter((g) => g.options.length > 0)
  }, [groups, query])
  const first = shown[0]?.options[0]

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setQuery('')
          onClose()
        }
      }}
    >
      <DialogContent className="max-w-2xl gap-0 p-0">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="px-5 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && first) {
                  e.preventDefault()
                  setQuery('')
                  onPick(first.kind)
                }
              }}
              placeholder={$t('Chercher…')}
              aria-label={$t('Chercher')}
              className="h-9 pl-8"
            />
          </div>
        </div>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto border-t px-5 py-4 scroll-discret">
          {shown.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {$t('Rien ne correspond.')}
            </p>
          )}
          {shown.map((group) => (
            <section key={group.label} className="space-y-2">
              <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {group.label}
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {group.options.map((option) => {
                  const Icon = option.icon
                  return (
                    <button
                      key={option.kind}
                      type="button"
                      onClick={() => {
                        setQuery('')
                        onPick(option.kind)
                      }}
                      className={cn(
                        'flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                        'hover:border-foreground/25 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        option.kind === current && 'border-primary bg-primary/5',
                        option === first && query !== '' && 'border-foreground/25',
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-8 shrink-0 items-center justify-center rounded-md',
                          option.tone,
                        )}
                      >
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{option.label}</span>
                        <span className="block text-xs text-muted-foreground">{option.hint}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function StepPicker({
  open,
  ai,
  onPick,
  onClose,
}: {
  readonly open: boolean
  /** Whether the server has a model: « Demander à l'IA » says so when it has none. */
  readonly ai: boolean
  readonly onPick: (kind: AutomationStepKind) => void
  readonly onClose: () => void
}) {
  const groups = useMemo(
    () =>
      STEP_GROUPS.map((g) => ({
        label: $t(g.label),
        options: g.kinds.map((kind) => ({
          kind,
          label: $t(STEP_LABELS[kind]),
          hint:
            kind === 'ai' && !ai
              ? $t('Demande un modèle d’IA sur le serveur (CHAT_AI_API_KEY).')
              : $t(STEP_HINTS[kind]),
          icon: STEP_ICONS[kind],
          tone: STEP_TONES[kind],
        })),
      })),
    [ai],
  )
  return (
    <KindPicker
      open={open}
      title={$t('Ajouter une étape')}
      description={$t('Ce que fait l’automatisation, à cet endroit du flux.')}
      groups={groups}
      onPick={onPick}
      onClose={onClose}
    />
  )
}

export function TriggerPicker({
  open,
  current,
  onPick,
  onClose,
}: {
  readonly open: boolean
  readonly current: AutomationTriggerKind
  readonly onPick: (kind: AutomationTriggerKind) => void
  readonly onClose: () => void
}) {
  const groups = useMemo(
    () =>
      TRIGGER_GROUPS.map((g) => ({
        label: $t(g.label),
        options: g.kinds.map((kind) => ({
          kind,
          label: $t(TRIGGER_LABELS[kind]),
          hint: $t(TRIGGER_HINTS[kind]),
          icon: TRIGGER_ICONS[kind],
          tone: TRIGGER_TONE,
        })),
      })),
    [],
  )
  return (
    <KindPicker
      open={open}
      title={$t('Déclencheur')}
      description={$t('Ce qui lance l’automatisation.')}
      groups={groups}
      current={current}
      onPick={onPick}
      onClose={onClose}
    />
  )
}
