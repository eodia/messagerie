'use client'

import { ColorBadge } from '@/components/app/chip'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Segmented } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/switch'
import { Hint } from '@/components/ui/tooltip'
import { $t, $tp, msg } from '@/lib/i18n'
import { type InboxFilter, useInbox } from '@/lib/store/inbox'
import { type ListFilters, activeCount, useListFilters } from '@/lib/store/list-filters'
import { cn } from '@/lib/utils'
import type { ConversationSummary, Priority, Sentiment, TagOption } from '@chat/contracts'
import { Check, ListFilter, Search, X } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { ContactAvatar } from './labels'
import { loadOptions } from './tag-picker'

/**
 * The list's filters, in full: what the tabs show, then whom, which tags, how urgent, in
 * what mood, which team and site, what is unread or kept waiting — and the order. The
 * active ones also show as chips under the tabs, each taken off by its cross.
 */

const STATES: readonly { readonly value: InboxFilter; readonly label: string }[] = [
  { value: 'all', label: msg('Actives') },
  { value: 'ai', label: msg('IA') },
  { value: 'open', label: msg('Ouvertes') },
  { value: 'unassigned', label: msg('En file') },
  { value: 'resolved', label: msg('Résolues') },
]

export const PRIORITIES: readonly { readonly value: Priority; readonly label: string }[] = [
  { value: 'urgent', label: msg('Urgente') },
  { value: 'high', label: msg('Haute') },
  { value: 'normal', label: msg('Normale') },
  { value: 'low', label: msg('Basse') },
]

export const SENTIMENTS: readonly { readonly value: Sentiment; readonly label: string }[] = [
  { value: 'negative', label: msg('Négatif') },
  { value: 'neutral', label: msg('Neutre') },
  { value: 'positive', label: msg('Positif') },
]

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

/** The tags one can filter on: those « Étiquettes » defines, and those found on rows. */
function useTags(rows: readonly ConversationSummary[]) {
  const [options, setOptions] = useState<TagOption[]>([])
  useEffect(() => {
    void loadOptions().then(setOptions)
  }, [])
  return useMemo(() => {
    const counts = new Map<string, { color: string; count: number }>()
    for (const option of options) counts.set(option.name, { color: option.color, count: 0 })
    for (const row of rows) {
      for (const tag of row.tags) {
        const known = counts.get(tag.label)
        counts.set(tag.label, { color: known?.color ?? tag.color, count: (known?.count ?? 0) + 1 })
      }
    }
    return [...counts.entries()]
      .map(([label, { color, count }]) => ({ label, color, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  }, [options, rows])
}

export function FiltersButton({ rows }: { readonly rows: readonly ConversationSummary[] }) {
  const filters = useListFilters()
  const filter = useInbox((s) => s.filter)
  const count = activeCount(filters) + (filter === 'resolved' ? 1 : 0)
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Hint label={$t('Filtres et tri')}>
        <PopoverTrigger asChild>
          <Button
            variant={count > 0 ? 'secondary' : 'ghost'}
            size="sm"
            aria-label={$t('Filtres et tri')}
            className="relative h-8 gap-1.5 px-2"
          >
            <ListFilter className="size-3.5" />
            {count > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-[10px] leading-4 font-semibold text-primary-foreground tabular-nums">
                {count}
              </span>
            )}
          </Button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent align="end" className="w-[22rem] p-0">
        <FiltersPanel rows={rows} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}

function FiltersPanel({
  rows,
  onClose,
}: {
  readonly rows: readonly ConversationSummary[]
  readonly onClose: () => void
}) {
  const filters = useListFilters()
  const { set, toggle, clear } = useListFilters.getState()
  const filter = useInbox((s) => s.filter)
  const { setFilter } = useInbox.getState()
  const agents = useInbox((s) => s.agents)
  const me = useInbox((s) => s.me)
  const teams = useInbox((s) => s.directory.teams)
  const tags = useTags(rows)
  const sites = useMemo(() => [...new Set(rows.map((r) => r.site))].sort(), [rows])
  const [tagQuery, setTagQuery] = useState('')
  const [agentQuery, setAgentQuery] = useState('')

  const shownTags = tags.filter(
    (t) => tagQuery.trim() === '' || fold(t.label).includes(fold(tagQuery.trim())),
  )
  const others = agents.filter((a) => a.id !== me?.id)
  const shownAgents = others.filter(
    (a) => agentQuery.trim() === '' || fold(a.name).includes(fold(agentQuery.trim())),
  )

  return (
    <div className="flex max-h-[min(36rem,80vh)] flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <span className="flex-1 text-sm font-semibold">{$t('Filtres')}</span>
        {(activeCount(filters) > 0 || filter === 'resolved') && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => {
              clear()
              if (filter === 'resolved') setFilter('all')
            }}
          >
            {$t('Tout effacer')}
          </Button>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3 scroll-discret">
        <Group label={$t('Trier par')}>
          <Segmented
            aria-label={$t('Trier par')}
            value={filters.sort}
            onValueChange={(sort) => set({ sort })}
            options={[
              { value: 'recent', label: $t('Récentes') },
              { value: 'waiting', label: $t('Attente') },
              { value: 'priority', label: $t('Priorité') },
            ]}
            className="w-full"
          />
        </Group>

        <Group label={$t('État')}>
          <Pills>
            {STATES.map((s) => (
              <Pill key={s.value} on={filter === s.value} onClick={() => setFilter(s.value)}>
                {$t(s.label)}
              </Pill>
            ))}
          </Pills>
        </Group>

        <Group label={$t('Affectée à')}>
          <Pills>
            <Pill on={filters.assignees.includes('me')} onClick={() => toggle('assignees', 'me')}>
              {$t('Moi')}
            </Pill>
            <Pill
              on={filters.assignees.includes('none')}
              onClick={() => toggle('assignees', 'none')}
            >
              {$t('Personne')}
            </Pill>
            {(others.length > 8 ? shownAgents.slice(0, 8) : others).map((agent) => (
              <Pill
                key={agent.id}
                on={filters.assignees.includes(agent.id)}
                onClick={() => toggle('assignees', agent.id)}
              >
                <ContactAvatar name={agent.name} className="-ml-1 size-4 text-[7px]" />
                {agent.name}
              </Pill>
            ))}
          </Pills>
          {others.length > 8 && (
            <SearchField
              value={agentQuery}
              onChange={setAgentQuery}
              label={$t('Chercher un conseiller')}
            />
          )}
        </Group>

        <Group
          label={$t('Étiquettes')}
          aside={
            filters.tags.length > 1 && (
              <Segmented
                aria-label={$t('Étiquettes cochées')}
                value={filters.tagMode}
                onValueChange={(tagMode) => set({ tagMode })}
                options={[
                  { value: 'any', label: $t('Au moins une') },
                  { value: 'all', label: $t('Toutes') },
                ]}
                className="h-6"
                itemClassName="px-2 text-[10px]"
              />
            )
          }
        >
          {tags.length > 6 && (
            <SearchField
              value={tagQuery}
              onChange={setTagQuery}
              label={$t('Chercher une étiquette')}
            />
          )}
          {tags.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {$t('Aucune étiquette pour l’instant.')}
            </p>
          ) : (
            <ul className="max-h-40 space-y-0.5 overflow-y-auto scroll-discret">
              {shownTags.map((tag) => {
                const on = filters.tags.includes(tag.label)
                return (
                  <li key={tag.label}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle('tags', tag.label)}
                      className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted/60"
                    >
                      <span
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center rounded-[4px] border',
                          on && 'border-primary bg-primary text-primary-foreground',
                        )}
                      >
                        {on && <Check className="size-3" strokeWidth={3} />}
                      </span>
                      <ColorBadge color={tag.color} className="min-w-0 shrink">
                        <span className="truncate">{tag.label}</span>
                      </ColorBadge>
                      <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
                        {tag.count}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Group>

        <Group label={$t('Priorité')}>
          <Pills>
            {PRIORITIES.map((p) => (
              <Pill
                key={p.value}
                on={filters.priorities.includes(p.value)}
                onClick={() => toggle('priorities', p.value)}
              >
                {$t(p.label)}
              </Pill>
            ))}
          </Pills>
        </Group>

        <Group label={$t('Sentiment')}>
          <Pills>
            {SENTIMENTS.map((s) => (
              <Pill
                key={s.value}
                on={filters.sentiments.includes(s.value)}
                onClick={() => toggle('sentiments', s.value)}
              >
                {$t(s.label)}
              </Pill>
            ))}
          </Pills>
        </Group>

        {teams.length > 0 && (
          <Group label={$t('Équipe')}>
            <Pills>
              {teams.map((t) => (
                <Pill
                  key={t.id}
                  on={filters.teams.includes(t.id)}
                  onClick={() => toggle('teams', t.id)}
                >
                  {t.name}
                </Pill>
              ))}
            </Pills>
          </Group>
        )}

        {sites.length > 1 && (
          <Group label={$t('Site')}>
            <Pills>
              {sites.map((site) => (
                <Pill
                  key={site}
                  on={filters.sites.includes(site)}
                  onClick={() => toggle('sites', site)}
                >
                  {site}
                </Pill>
              ))}
            </Pills>
          </Group>
        )}

        <Group label={$t('Le visiteur attend une réponse')}>
          <Segmented
            aria-label={$t('Le visiteur attend une réponse')}
            value={filters.waiting === null ? 'any' : String(filters.waiting)}
            onValueChange={(v) => set({ waiting: v === 'any' ? null : (Number(v) as 5 | 30) })}
            options={[
              { value: 'any', label: $t('Peu importe') },
              { value: '5', label: $t('5 min et plus') },
              { value: '30', label: $t('30 min et plus') },
            ]}
            className="w-full"
          />
        </Group>

        <div className="space-y-2.5">
          <SwitchRow
            label={$t('Non lues seulement')}
            checked={filters.unread}
            onChange={(unread) => set({ unread })}
          />
          <SwitchRow
            label={$t('Clients identifiés seulement')}
            checked={filters.identified}
            onChange={(identified) => set({ identified })}
          />
        </div>
      </div>

      <div className="flex items-center justify-end border-t px-4 py-2.5">
        <Button size="sm" className="h-8 text-xs" onClick={onClose}>
          {$t('Voir les conversations')}
        </Button>
      </div>
    </div>
  )
}

function Group({
  label,
  aside,
  children,
}: {
  readonly label: string
  readonly aside?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <section className="space-y-2">
      <div className="flex h-6 items-center gap-2">
        <h4 className="flex-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </h4>
        {aside}
      </div>
      {children}
    </section>
  )
}

function Pills({ children }: { readonly children: ReactNode }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>
}

function Pill({
  on,
  onClick,
  children,
}: {
  readonly on: boolean
  readonly onClick: () => void
  readonly children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors',
        on
          ? 'border-primary/40 bg-primary/10 font-medium text-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {on && <Check className="size-3" />}
      {children}
    </button>
  )
}

function SearchField({
  value,
  onChange,
  label,
}: {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly label: string
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={`${label}…`}
        aria-label={label}
        className="h-7 w-full rounded-md border bg-muted/40 pr-2 pl-7 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25"
      />
    </div>
  )
}

function SwitchRow({
  label,
  checked,
  onChange,
}: {
  readonly label: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the switch inside is the control
    <label className="flex cursor-pointer items-center gap-3 text-sm">
      <span className="flex-1">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )
}

/** The active filters, as chips under the tabs — each taken off by its cross. */
export function ActiveFilters() {
  const filters = useListFilters()
  const { toggle, set, clear } = useListFilters.getState()
  const agents = useInbox((s) => s.agents)
  const teams = useInbox((s) => s.directory.teams)
  if (activeCount(filters) === 0) return null

  const chips: { key: string; label: ReactNode; off: () => void }[] = [
    ...filters.assignees.map((a) => ({
      key: `a-${a}`,
      label:
        a === 'me'
          ? $t('À moi')
          : a === 'none'
            ? $t('En file')
            : (agents.find((x) => x.id === a)?.name ?? a),
      off: () => toggle('assignees', a),
    })),
    ...filters.tags.map((t) => ({
      key: `t-${t}`,
      label: `# ${t}`,
      off: () => toggle('tags', t),
    })),
    ...filters.priorities.map((p) => ({
      key: `p-${p}`,
      label: $t(PRIORITIES.find((x) => x.value === p)?.label ?? p),
      off: () => toggle('priorities', p),
    })),
    ...filters.sentiments.map((s) => ({
      key: `s-${s}`,
      label: $t('Sentiment {name}', {
        name: $t(SENTIMENTS.find((x) => x.value === s)?.label ?? s).toLowerCase(),
      }),
      off: () => toggle('sentiments', s),
    })),
    ...filters.teams.map((t) => ({
      key: `e-${t}`,
      label: teams.find((x) => x.id === t)?.name ?? t,
      off: () => toggle('teams', t),
    })),
    ...filters.sites.map((s) => ({ key: `w-${s}`, label: s, off: () => toggle('sites', s) })),
    ...(filters.unread
      ? [{ key: 'u', label: $t('Non lues'), off: () => set({ unread: false }) }]
      : []),
    ...(filters.identified
      ? [{ key: 'i', label: $t('Identifiés'), off: () => set({ identified: false }) }]
      : []),
    ...(filters.waiting !== null
      ? [
          {
            key: 'wait',
            label: $t('Attend {count} min et plus', { count: filters.waiting }),
            off: () => set({ waiting: null }),
          },
        ]
      : []),
  ]

  return (
    <div className="flex flex-wrap items-center gap-1 border-b px-3 py-1.5">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex h-6 max-w-40 items-center gap-1 rounded-md bg-primary/10 pr-0.5 pl-2 text-[11px] font-medium"
        >
          <span className="truncate">{chip.label}</span>
          <button
            type="button"
            aria-label={$t('Retirer le filtre')}
            onClick={chip.off}
            className="rounded-sm p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={clear}
        className="ml-auto text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        {$tp(chips.length, 'Effacer le filtre', 'Effacer les {count} filtres')}
      </button>
    </div>
  )
}

export type { ListFilters }
