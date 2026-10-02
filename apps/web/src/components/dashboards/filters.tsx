'use client'

import { ChoiceMenu } from '@/components/settings/field-input'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Hint } from '@/components/ui/tooltip'
import { labelsOf } from '@/lib/analytics'
import { api } from '@/lib/api'
import { $t, intlLocale, msg } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type {
  AnalyticsSource,
  CardLink,
  ColumnType,
  DashboardCard,
  DashboardFilter,
  DashboardFilterKind,
  FilterValues,
} from '@chat/contracts'
import { CalendarDays, ChevronDown, ListFilter, Pencil, Plus, Trash2, Type, X } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'

/**
 * A dashboard's filters (D22) — basedb's parameters: one control per filter above the
 * cards — a period, values to pick, a text —, each tied or not to every card, on a column of
 * its question. Chosen, a value replaces what the card filters on that column.
 */

export const FILTER_ICONS: Readonly<Record<DashboardFilterKind, typeof CalendarDays>> = {
  period: CalendarDays,
  choice: ListFilter,
  text: Type,
}

/** The column types a filter of each kind bears on — the server's own rule. */
export const FITS: Readonly<Record<DashboardFilterKind, readonly ColumnType[]>> = {
  period: ['date'],
  choice: ['text', 'boolean'],
  text: ['text'],
}

const PERIODS: readonly { readonly value: readonly string[]; readonly label: string }[] = [
  { value: ['1', 'days'], label: msg('Aujourd’hui') },
  { value: ['7', 'days'], label: msg('7 derniers jours') },
  { value: ['30', 'days'], label: msg('30 derniers jours') },
  { value: ['90', 'days'], label: msg('90 derniers jours') },
  { value: ['12', 'months'], label: msg('12 derniers mois') },
]

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i])

/** A period, in words: « 30 derniers jours », « du 1 sept. au 30 sept. », « Toute la période ». */
export function periodText(value: readonly string[]): string {
  if (value.length === 0) return $t('Toute la période')
  const preset = PERIODS.find((p) => same(p.value, value))
  if (preset) return $t(preset.label)
  if (value[0] === 'between') {
    const day = new Intl.DateTimeFormat(intlLocale(), { day: 'numeric', month: 'short' })
    const at = (v: string | undefined) => (v ? day.format(new Date(v)) : '…')
    return $t('du {from} au {to}', { from: at(value[1]), to: at(value[2]) })
  }
  const n = Number(value[0])
  return value[1] === 'months'
    ? $t('{count} derniers mois', { count: n })
    : value[1] === 'weeks'
      ? $t('{count} dernières semaines', { count: n })
      : $t('{count} derniers jours', { count: n })
}

/** The columns of a source a filter of `kind` may bear on. */
export function fittingColumns(source: AnalyticsSource | undefined, kind: DashboardFilterKind) {
  return (source?.columns ?? []).filter((c) => FITS[kind].includes(c.type))
}

/** The column a new filter is tied to on a card, if it has one: its dates, the same column. */
export function suggestedColumn(
  card: DashboardCard,
  filter: Pick<DashboardFilter, 'kind' | 'column'>,
  sources: readonly AnalyticsSource[],
): string | null {
  if (card.question?.mode !== 'builder') return null
  const question = card.question
  const source = sources.find(
    (s) => question?.mode === 'builder' && s.key === question.query.source,
  )
  const columns = fittingColumns(source, filter.kind)
  if (filter.kind === 'period') return columns.find((c) => c.name === 'created_at')?.name ?? null
  return columns.find((c) => c.name === filter.column)?.name ?? null
}

// ── The bar of controls ─────────────────────────────────────────────────────

function Control({
  filter,
  value,
  sources,
  editing,
  onChange,
  onEdit,
}: {
  readonly filter: DashboardFilter
  readonly value: readonly string[]
  readonly sources: readonly AnalyticsSource[]
  readonly editing: boolean
  readonly onChange: (value: readonly string[]) => void
  readonly onEdit: () => void
}) {
  const Icon = FILTER_ICONS[filter.kind]
  const labels = useMemo(() => labelsOf(sources), [sources])
  const [options, setOptions] = useState<readonly string[] | null>(null)
  const [from, setFrom] = useState(value[0] === 'between' ? (value[1] ?? '') : '')
  const [to, setTo] = useState(value[0] === 'between' ? (value[2] ?? '') : '')
  const said = (v: string) => {
    const label = filter.column ? labels.get(filter.column)?.get(v) : undefined
    return label ? $t(label) : v
  }
  const summary =
    filter.kind === 'period'
      ? periodText(value)
      : filter.kind === 'text'
        ? null
        : value.length === 0
          ? $t('Toutes')
          : value.length === 1
            ? said(value[0] as string)
            : $t('{count} choisies', { count: value.length })
  const active = value.length > 0

  const shell = (children: ReactNode) => (
    <div className="flex items-center gap-0.5">
      {children}
      {editing && (
        <Hint label={$t('Modifier le filtre')}>
          <Button variant="ghost" size="icon-sm" className="size-7" onClick={onEdit}>
            <Pencil className="size-3.5 text-muted-foreground" />
          </Button>
        </Hint>
      )}
    </div>
  )

  if (filter.kind === 'text') {
    return shell(
      <div className="flex h-8 items-center gap-1.5 rounded-md border bg-background pr-1 pl-2.5 text-xs">
        <Icon className="size-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">{filter.label}</span>
        <Input
          value={value[0] ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? [] : [e.target.value])}
          placeholder={$t('contient…')}
          aria-label={filter.label}
          className="h-6 w-36 border-0 px-1 text-xs shadow-none focus-visible:ring-0"
        />
      </div>,
    )
  }

  return shell(
    <DropdownMenu
      onOpenChange={(open) => {
        if (
          open &&
          filter.kind === 'choice' &&
          options === null &&
          filter.source &&
          filter.column
        ) {
          void api.filterValues(filter.source, filter.column).then(setOptions, () => setOptions([]))
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs transition-colors hover:bg-accent',
            active && 'border-primary/40 bg-primary/5',
          )}
        >
          <Icon className="size-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">{filter.label}</span>
          <span className="max-w-40 truncate font-medium">{summary}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {filter.kind === 'period' ? (
          <>
            <DropdownMenuRadioGroup
              value={JSON.stringify(value)}
              onValueChange={(v) => onChange(JSON.parse(v) as string[])}
            >
              {PERIODS.map((p) => (
                <DropdownMenuRadioItem key={p.label} value={JSON.stringify(p.value)}>
                  {$t(p.label)}
                </DropdownMenuRadioItem>
              ))}
              <DropdownMenuRadioItem value="[]">{$t('Toute la période')}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {$t('Entre deux dates')}
            </DropdownMenuLabel>
            <div className="flex items-center gap-1.5 px-2 pb-2">
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-8 text-xs"
                aria-label={$t('Du')}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-8 text-xs"
                aria-label={$t('Au')}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
            <DropdownMenuItem
              disabled={from === '' || to === ''}
              onSelect={() => onChange(['between', from, `${to}T23:59:59`])}
            >
              {$t('Appliquer ces dates')}
            </DropdownMenuItem>
          </>
        ) : (
          <>
            {options === null && (
              <div className="space-y-2 p-2">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-3/5" />
              </div>
            )}
            {options?.length === 0 && (
              <p className="px-2 py-2 text-xs text-muted-foreground">{$t('Aucune valeur.')}</p>
            )}
            <div className="max-h-72 overflow-y-auto">
              {options?.map((option) => (
                <DropdownMenuCheckboxItem
                  key={option}
                  checked={value.includes(option)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={(on) =>
                    onChange(on ? [...value, option] : value.filter((v) => v !== option))
                  }
                >
                  {said(option)}
                </DropdownMenuCheckboxItem>
              ))}
            </div>
            {active && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onChange([])}>
                  <X />
                  {$t('Toutes')}
                </DropdownMenuItem>
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>,
  )
}

export function FilterBar({
  filters,
  values,
  sources,
  editing,
  onChange,
  onEdit,
  onAdd,
}: {
  readonly filters: readonly DashboardFilter[]
  readonly values: FilterValues
  readonly sources: readonly AnalyticsSource[]
  readonly editing: boolean
  readonly onChange: (id: string, value: readonly string[]) => void
  readonly onEdit: (filter: DashboardFilter) => void
  readonly onAdd: () => void
}) {
  if (filters.length === 0 && !editing) return null
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
      {filters.map((filter) => (
        <Control
          key={filter.id}
          filter={filter}
          value={values[filter.id] ?? filter.default}
          sources={sources}
          editing={editing}
          onChange={(value) => onChange(filter.id, value)}
          onEdit={() => onEdit(filter)}
        />
      ))}
      {editing && (
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 border-dashed text-xs"
          onClick={onAdd}
        >
          <Plus className="size-3.5" />
          {$t('Filtre')}
        </Button>
      )}
    </div>
  )
}

// ── Making a filter, and tying it to the cards ──────────────────────────────

const KIND_LABELS: Readonly<Record<DashboardFilterKind, string>> = {
  period: msg('Période'),
  choice: msg('Valeurs à choisir'),
  text: msg('Texte'),
}

export function FilterEditor({
  filter,
  cards,
  sources,
  onSave,
  onRemove,
  onClose,
}: {
  /** `null`: a new one. */
  readonly filter: DashboardFilter | null
  readonly cards: readonly DashboardCard[]
  readonly sources: readonly AnalyticsSource[]
  /** The filter, and each card's links as they now stand. */
  readonly onSave: (filter: DashboardFilter, links: Readonly<Record<string, string | null>>) => void
  readonly onRemove?: () => void
  readonly onClose: () => void
}) {
  const [draft, setDraft] = useState<DashboardFilter>(
    () =>
      filter ?? {
        id: Math.random().toString(36).slice(2, 10),
        label: $t('Période'),
        kind: 'period',
        default: ['30', 'days'],
      },
  )
  const questions = cards.filter((c) => c.kind === 'question' && c.question)
  const linkOf = (card: DashboardCard) =>
    card.links?.find((l) => l.filter === draft.id)?.column ?? null
  // Each card's column for this filter: what it had, or — new — what fits.
  const [links, setLinks] = useState<Readonly<Record<string, string | null>>>(() =>
    Object.fromEntries(
      questions.map((card) => [
        card.id,
        filter ? linkOf(card) : suggestedColumn(card, draft, sources),
      ]),
    ),
  )
  // A kind or a column changed: the cards tied by suggestion follow.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on the filter's kind and column only
  useEffect(() => {
    if (filter) return
    setLinks(
      Object.fromEntries(questions.map((card) => [card.id, suggestedColumn(card, draft, sources)])),
    )
  }, [draft.kind, draft.column])

  const source = sources.find((s) => s.key === (draft.source ?? 'conversations'))
  const ready =
    draft.label.trim() !== '' && (draft.kind !== 'choice' || (draft.source && draft.column))

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>{filter ? $t('Modifier le filtre') : $t('Nouveau filtre')}</DialogTitle>
          <DialogDescription>
            {$t(
              'Un contrôle au-dessus des cartes. Choisissez les graphiques qu’il filtre, et sur quelle colonne.',
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-5 overflow-y-auto px-6 pb-5 scroll-discret">
          <div className="space-y-2">
            <Label htmlFor="filter-label">{$t('Nom')}</Label>
            <Input
              id="filter-label"
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              className="h-9"
            />
          </div>
          <div className="space-y-2">
            <Label>{$t('Sorte')}</Label>
            <Segmented
              value={draft.kind}
              onValueChange={(kind) =>
                setDraft({
                  id: draft.id,
                  label: draft.label,
                  kind,
                  default: kind === 'period' ? ['30', 'days'] : [],
                  ...(kind === 'choice' ? { source: 'conversations', column: 'inbox' } : {}),
                })
              }
              options={(Object.keys(KIND_LABELS) as DashboardFilterKind[]).map((kind) => ({
                value: kind,
                label: $t(KIND_LABELS[kind]),
              }))}
              className="w-full"
              aria-label={$t('Sorte de filtre')}
            />
          </div>
          {draft.kind === 'choice' && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>{$t('Valeurs tirées de')}</Label>
                <ChoiceMenu
                  id="filter-source"
                  value={draft.source ?? null}
                  choices={sources.map((s) => ({ id: s.key, label: $t(s.label) }))}
                  onChange={(key) => {
                    const next = sources.find((s) => s.key === key)
                    setDraft({
                      ...draft,
                      ...(next ? { source: next.key } : {}),
                      ...(next ? { column: fittingColumns(next, 'choice')[0]?.name } : {}),
                    })
                  }}
                  allowNone={false}
                  disabled={false}
                />
              </div>
              <div className="space-y-2">
                <Label>{$t('Colonne')}</Label>
                <ChoiceMenu
                  id="filter-column"
                  value={draft.column ?? null}
                  choices={fittingColumns(source, 'choice').map((c) => ({
                    id: c.name,
                    label: $t(c.label),
                  }))}
                  onChange={(column) => column && setDraft({ ...draft, column })}
                  allowNone={false}
                  disabled={false}
                />
              </div>
            </div>
          )}
          {draft.kind === 'period' && (
            <div className="space-y-2">
              <Label>{$t('Valeur à l’ouverture')}</Label>
              <ChoiceMenu
                id="filter-default"
                value={JSON.stringify(draft.default)}
                choices={[
                  ...PERIODS.map((p) => ({ id: JSON.stringify(p.value), label: $t(p.label) })),
                  { id: '[]', label: $t('Toute la période') },
                ]}
                onChange={(v) =>
                  setDraft({ ...draft, default: v ? (JSON.parse(v) as string[]) : [] })
                }
                allowNone={false}
                disabled={false}
              />
            </div>
          )}

          <section className="space-y-2 border-t pt-4">
            <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {$t('Graphiques filtrés')}
            </h3>
            {questions.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {$t('Aucune question sur ce tableau.')}
              </p>
            )}
            <ul className="divide-y rounded-lg border">
              {questions.map((card) => {
                const sql = card.question?.mode === 'sql'
                const cardSource =
                  card.question?.mode === 'builder'
                    ? sources.find(
                        (s) =>
                          card.question?.mode === 'builder' && s.key === card.question.query.source,
                      )
                    : undefined
                const columns = fittingColumns(cardSource, draft.kind)
                const column = links[card.id] ?? null
                const unusable = sql || columns.length === 0
                return (
                  <li key={card.id} className="flex items-center gap-3 px-3 py-2">
                    <Switch
                      checked={column !== null}
                      disabled={unusable}
                      onCheckedChange={(on) =>
                        setLinks((l) => ({
                          ...l,
                          [card.id]: on
                            ? (suggestedColumn(card, draft, sources) ?? columns[0]?.name ?? null)
                            : null,
                        }))
                      }
                      aria-label={$t('Filtrer « {title} »', {
                        title: card.title || $t('Sans titre'),
                      })}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{card.title || $t('Sans titre')}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {sql
                          ? $t('Une question en SQL ne suit pas les filtres.')
                          : columns.length === 0
                            ? $t('Aucune colonne de ce genre dans « {source} ».', {
                                source: cardSource ? $t(cardSource.label) : '—',
                              })
                            : cardSource
                              ? $t(cardSource.label)
                              : ''}
                      </div>
                    </div>
                    {column !== null && !unusable && (
                      <div className="w-44 shrink-0">
                        <ChoiceMenu
                          id={`link-${card.id}`}
                          value={column}
                          choices={columns.map((c) => ({ id: c.name, label: $t(c.label) }))}
                          onChange={(next) => next && setLinks((l) => ({ ...l, [card.id]: next }))}
                          allowNone={false}
                          disabled={false}
                        />
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        </div>
        <DialogFooter className="border-t px-6 py-3">
          {onRemove && (
            <Button
              variant="ghost"
              size="sm"
              className="mr-auto gap-1.5 text-destructive hover:text-destructive"
              onClick={onRemove}
            >
              <Trash2 className="size-3.5" />
              {$t('Retirer le filtre')}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>
            {$t('Annuler')}
          </Button>
          <Button
            size="sm"
            disabled={!ready}
            onClick={() => onSave({ ...draft, label: draft.label.trim() }, links)}
          >
            {filter ? $t('Enregistrer') : $t('Ajouter le filtre')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The cards with this filter's links as the editor left them. */
export function relinked(
  cards: readonly DashboardCard[],
  filterId: string,
  links: Readonly<Record<string, string | null>>,
): DashboardCard[] {
  return cards.map((card) => {
    if (!(card.id in links)) return card
    const others: CardLink[] = (card.links ?? []).filter((l) => l.filter !== filterId)
    const column = links[card.id]
    const next = column ? [...others, { filter: filterId, column }] : others
    const { links: _, ...rest } = card
    return next.length > 0 ? { ...rest, links: next } : rest
  })
}
