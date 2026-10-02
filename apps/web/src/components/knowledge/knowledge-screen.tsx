'use client'

import { useBasedbUrl } from '@/components/app/app-shell'
import { Chip, type Tint } from '@/components/app/chip'
import { ScreenHeader, Slash } from '@/components/app/screen-header'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Hint } from '@/components/ui/tooltip'
import { addressOf, idOfWord, wordOf, wordsAfter } from '@/lib/address'
import { api } from '@/lib/api'
import { $t, $tp, msg } from '@/lib/i18n'
import { messageFor } from '@/lib/messages'
import { dayLabel } from '@/lib/time'
import { useTitle } from '@/lib/title'
import { useAddressBar } from '@/lib/use-address-bar'
import { cn } from '@/lib/utils'
import type { KnowledgeItem, SettingsOverview, SettingsRow } from '@chat/contracts'
import {
  Archive,
  BookOpen,
  Check,
  ChevronDown,
  Ellipsis,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  Globe,
  Library,
  LoaderCircle,
  Maximize2,
  MessagesSquare,
  Minimize2,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArticleEditor } from './article-editor'

/**
 * The knowledge the AI answers from, written in place: the
 * categories, their articles, and an editor that saves as one types. The articles stay in
 * basedb (« Articles », « Catégories »); the published ones are indexed for the AI, which
 * cites them. Writing is a supervisor's; agents read.
 */

type Status = 'Brouillon' | 'En révision' | 'Publié' | 'Archivé'

const STATUSES: readonly { readonly value: Status; readonly label: string; readonly tint: Tint }[] =
  [
    { value: 'Brouillon', label: msg('Brouillon'), tint: 'zinc' },
    { value: 'En révision', label: msg('En révision'), tint: 'amber' },
    { value: 'Publié', label: msg('Publié'), tint: 'emerald' },
    { value: 'Archivé', label: msg('Archivé'), tint: 'sky' },
  ]

type Shelf =
  | { readonly kind: 'all' }
  | { readonly kind: 'none' }
  | { readonly kind: 'category'; readonly id: string }
  | { readonly kind: 'promoted' }

type Filter = 'all' | 'published' | 'drafts'

const FILTERS: readonly (readonly [Filter, string])[] = [
  ['all', msg('Tous')],
  ['published', msg('Publiés')],
  ['drafts', msg('À publier')],
]

type SaveState = 'idle' | 'pending' | 'saving' | 'saved'

interface Article {
  readonly id: string
  readonly title: string
  readonly content: string
  readonly status: Status
  readonly categoryId: string | null
  readonly siteIds: readonly string[]
  readonly authorId: string | null
  readonly reviewedOn: string | null
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')

function articleOf(row: SettingsRow): Article {
  const v = row.values
  const status = STATUSES.find((s) => s.value === v.Statut)?.value ?? 'Brouillon'
  return {
    id: row.id,
    title: text(v.Titre),
    content: text(v.Contenu),
    status,
    categoryId: text(v.Catégorie) || null,
    siteIds: Array.isArray(v.Sites)
      ? v.Sites.filter((s): s is string => typeof s === 'string')
      : [],
    authorId: text(v.Auteur) || null,
    reviewedOn: text(v['Relu le']) || null,
  }
}

const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

const today = () => new Date().toISOString().slice(0, 10)

const codeOf = (failure: unknown) => (failure as { code?: string }).code ?? 'INTERNAL_ERROR'

const BASE = '/connaissance'

export function KnowledgeScreen() {
  const basedbUrl = useBasedbUrl()
  const [overview, setOverview] = useState<SettingsOverview | null>(null)
  const [articles, setArticles] = useState<Article[] | null>(null)
  const [categories, setCategories] = useState<SettingsRow[]>([])
  const [sites, setSites] = useState<SettingsRow[]>([])
  const [index, setIndex] = useState<KnowledgeItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [shelf, setShelf] = useState<Shelf>({ kind: 'all' })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [focus, setFocus] = useState(false)
  const [saving, setSaving] = useState<SaveState>('idle')

  const load = useCallback(async () => {
    try {
      const [nextOverview, rows, cats, siteRows, indexed] = await Promise.all([
        api.settings(),
        api.settingsRows('articles'),
        api.settingsRows('categories'),
        api.settingsRows('sites'),
        api.knowledge().catch(() => [] as KnowledgeItem[]),
      ])
      setOverview(nextOverview)
      setArticles(rows.map(articleOf))
      setCategories(cats)
      setSites(siteRows)
      setIndex(indexed)
    } catch (failure) {
      setError(codeOf(failure))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // The address: the article open — and the article an address names, once they are read.
  // `?nouveau` starts one (the palette's « Nouvel article »). Nothing is written before the
  // address was followed.
  const [arrived, setArrived] = useState(false)
  const opened = articles?.find((a) => a.id === selectedId) ?? null
  const address = !arrived
    ? null
    : opened
      ? addressOf(BASE, wordOf(opened.id, opened.title, 'article'))
      : BASE
  const follow = () => {
    if (articles === null) return
    const word = wordsAfter(BASE)?.[0] ?? new URLSearchParams(window.location.search).get('article')
    if (!word) return setSelectedId(null)
    const id =
      idOfWord(
        word,
        articles.map((a) => a.id),
      ) ?? articles.find((a) => a.id === word)?.id
    if (id) setSelectedId(id)
    else {
      setSelectedId(null)
      setError('ROW_NOT_FOUND')
    }
  }
  useAddressBar(address, async () => follow())
  useTitle([opened?.title || null, $t('Connaissances')])
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when the articles are read
  useEffect(() => {
    if (arrived || articles === null || overview === null) return
    setArrived(true)
    if (new URLSearchParams(window.location.search).has('nouveau') && overview.canEdit) {
      void create()
    } else follow()
  }, [articles, overview])

  // ── Saving as one types: after a pause, the changed fields go to basedb ─────────────
  const pending = useRef<{ id: string; values: Record<string, unknown> } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    const next = pending.current
    pending.current = null
    if (!next) return
    setSaving('saving')
    try {
      await api.updateRow('articles', next.id, next.values)
      setSaving('saved')
    } catch (failure) {
      setSaving('idle')
      setError(codeOf(failure))
    }
  }, [])

  const write = useCallback(
    (id: string, values: { readonly title?: string; readonly content?: string }) => {
      setArticles((all) => all?.map((a) => (a.id === id ? { ...a, ...values } : a)) ?? all)
      const fields: Record<string, unknown> = {}
      // A title is required: an emptied one waits to be written again.
      if (values.title?.trim()) fields.Titre = values.title
      if (values.content !== undefined) fields.Contenu = values.content
      if (Object.keys(fields).length === 0) return
      if (pending.current && pending.current.id !== id) void flush()
      pending.current = { id, values: { ...pending.current?.values, ...fields } }
      setSaving('pending')
      clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), 900)
    },
    [flush],
  )

  // Leaving the screen or the page: what was typed is saved first.
  useEffect(() => {
    const leaving = (event: BeforeUnloadEvent) => {
      if (!pending.current) return
      void flush()
      event.preventDefault()
    }
    window.addEventListener('beforeunload', leaving)
    return () => {
      window.removeEventListener('beforeunload', leaving)
      void flush()
    }
  }, [flush])

  async function setFields(id: string, values: Record<string, unknown>, patch: Partial<Article>) {
    await flush()
    setArticles((all) => all?.map((a) => (a.id === id ? { ...a, ...patch } : a)) ?? all)
    setSaving('saving')
    try {
      await api.updateRow('articles', id, values)
      setSaving('saved')
      // The index follows a publication: read again once the AI had the time to.
      if ('Statut' in values) setTimeout(() => void api.knowledge().then(setIndex), 4000)
    } catch (failure) {
      setSaving('idle')
      setError(codeOf(failure))
      void load()
    }
  }

  async function create() {
    await flush()
    try {
      const row = await api.createRow('articles', {
        Titre: $t('Nouvel article'),
        ...(shelf.kind === 'category' ? { Catégorie: shelf.id } : {}),
      })
      await load()
      if (shelf.kind === 'promoted') setShelf({ kind: 'all' })
      setFilter('all')
      setQuery('')
      setSelectedId(row.id)
    } catch (failure) {
      setError(codeOf(failure))
    }
  }

  async function remove(id: string) {
    await flush()
    try {
      await api.deleteRow('articles', id)
      setSelectedId(null)
      await load()
    } catch (failure) {
      setError(codeOf(failure))
    }
  }

  async function addCategory(name: string) {
    try {
      const row = await api.createRow('categories', { Nom: name })
      await load()
      setShelf({ kind: 'category', id: row.id })
    } catch (failure) {
      setError(codeOf(failure))
    }
  }

  const canEdit = overview?.canEdit ?? false
  const all = articles ?? []
  const passages = useMemo(
    () => new Map(index.filter((i) => i.source === 'article').map((i) => [i.id, i.passages])),
    [index],
  )
  const promoted = index.filter((i) => i.source === 'conversation')
  const categoryName = (id: string | null) =>
    text(categories.find((c) => c.id === id)?.values.Nom) || null

  const onShelf = all.filter((a) => {
    switch (shelf.kind) {
      case 'all':
        return true
      case 'none':
        return a.categoryId === null
      case 'category':
        return a.categoryId === shelf.id
      case 'promoted':
        return false
    }
  })
  const searched = fold(query.trim())
  const shown = onShelf.filter(
    (a) =>
      (filter === 'all' || (filter === 'published') === (a.status === 'Publié')) &&
      (searched === '' || fold(`${a.title} ${a.content}`).includes(searched)),
  )
  const selected = all.find((a) => a.id === selectedId) ?? null
  // Focus is on an article: without one, the shelves and the list come back.
  const focused = focus && selected !== null
  const shelfTitle =
    shelf.kind === 'all'
      ? $t('Tous les articles')
      : shelf.kind === 'none'
        ? $t('Sans catégorie')
        : shelf.kind === 'promoted'
          ? $t('Conversations promues')
          : (categoryName(shelf.id) ?? $t('Catégorie'))

  return (
    <>
      <ScreenHeader
        tools={
          <>
            {selected && <Saving state={saving} />}
            {selected && (
              <Hint
                label={
                  focus
                    ? $t('Revoir les catégories et la liste')
                    : $t('Masquer les catégories et la liste')
                }
              >
                <Button
                  variant={focus ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-pressed={focus}
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => setFocus((f) => !f)}
                >
                  {focus ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                  {$t('Mode concentration')}
                </Button>
              </Hint>
            )}
            <Button variant="outline" size="sm" asChild className="h-8 gap-1.5 text-xs">
              <a href={basedbUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5" />
                {$t('Ouvrir dans basedb')}
              </a>
            </Button>
          </>
        }
      >
        <span className="font-medium">{$t('Connaissances')}</span>
        {selected && (
          <>
            <Slash />
            <span className="truncate text-muted-foreground">
              {selected.title || $t('Sans titre')}
            </span>
          </>
        )}
      </ScreenHeader>

      {error && (
        <div className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/5 px-4 py-1.5 text-sm text-destructive">
          <span className="flex-1">{messageFor(error)}</span>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setError(null)}>
            {$t('Fermer')}
          </Button>
        </div>
      )}

      {articles === null ? (
        <div className="flex flex-1 items-center justify-center">
          {!error && <LoaderCircle className="size-5 animate-spin text-muted-foreground" />}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* The shelves: every article, a category, or the promoted conversations. */}
          {!focused && (
            <nav
              aria-label={$t('Catégories')}
              className="flex w-56 shrink-0 flex-col border-r bg-muted/20"
            >
              <div className="flex-1 space-y-0.5 overflow-y-auto p-2 scroll-discret">
                <ShelfRow
                  icon={Library}
                  label={$t('Tous les articles')}
                  count={all.length}
                  active={shelf.kind === 'all'}
                  onClick={() => setShelf({ kind: 'all' })}
                />
                <MicroLabel>{$t('Catégories')}</MicroLabel>
                {categories.map((category) => {
                  const on = shelf.kind === 'category' && shelf.id === category.id
                  return (
                    <ShelfRow
                      key={category.id}
                      icon={on ? FolderOpen : Folder}
                      label={text(category.values.Nom) || $t('Sans nom')}
                      count={all.filter((a) => a.categoryId === category.id).length}
                      active={on}
                      onClick={() => setShelf({ kind: 'category', id: category.id })}
                    />
                  )
                })}
                {all.some((a) => a.categoryId === null) && (
                  <ShelfRow
                    icon={Folder}
                    label={$t('Sans catégorie')}
                    count={all.filter((a) => a.categoryId === null).length}
                    active={shelf.kind === 'none'}
                    onClick={() => setShelf({ kind: 'none' })}
                    muted
                  />
                )}
                {canEdit && <NewCategory onCreate={(name) => void addCategory(name)} />}
                <MicroLabel>{$t('Appris des conversations')}</MicroLabel>
                <ShelfRow
                  icon={MessagesSquare}
                  label={$t('Conversations promues')}
                  count={promoted.length}
                  active={shelf.kind === 'promoted'}
                  onClick={() => setShelf({ kind: 'promoted' })}
                />
              </div>
              <div className="space-y-1 border-t p-3 text-[11px] leading-relaxed text-muted-foreground">
                <span className="flex items-center gap-1.5 font-medium text-foreground">
                  <Sparkles className="size-3.5 text-violet-600 dark:text-violet-300" />
                  {$tp(
                    index.reduce((sum, i) => sum + i.passages, 0),
                    '{count} passage indexé',
                    '{count} passages indexés',
                  )}
                </span>
                <p>
                  {$t('L’IA répond à partir des articles publiés et des conversations promues.')}
                </p>
              </div>
            </nav>
          )}

          {/* The articles of the shelf. */}
          {!focused && (
            <section className="flex w-80 shrink-0 flex-col border-r">
              <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{shelfTitle}</span>
                {canEdit && shelf.kind !== 'promoted' && (
                  <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void create()}>
                    <Plus className="size-3.5" />
                    {$t('Nouvel article')}
                  </Button>
                )}
              </div>
              {shelf.kind === 'promoted' ? (
                <PromotedList items={promoted} basedbUrl={basedbUrl} />
              ) : (
                <>
                  <div className="space-y-2.5 border-b px-3 pt-3">
                    <div className="relative">
                      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={$t('Rechercher dans les articles…')}
                        aria-label={$t('Rechercher dans les articles')}
                        className="h-8 w-full rounded-lg border bg-muted/40 pr-2 pl-8 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25"
                      />
                    </div>
                    <div className="flex gap-4 text-xs">
                      {FILTERS.map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={filter === value}
                          onClick={() => setFilter(value)}
                          className={cn(
                            'relative pb-2 font-medium transition-colors',
                            filter === value
                              ? 'text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary'
                              : 'text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {$t(label)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <ul className="flex-1 overflow-y-auto scroll-discret">
                    {shown.map((article) => (
                      <li key={article.id}>
                        <ArticleRow
                          article={article}
                          category={shelf.kind === 'all' ? categoryName(article.categoryId) : null}
                          passages={passages.get(article.id) ?? 0}
                          selected={article.id === selectedId}
                          onSelect={() => {
                            void flush()
                            setSelectedId(article.id)
                          }}
                        />
                      </li>
                    ))}
                    {shown.length === 0 && (
                      <li className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-muted-foreground">
                        <BookOpen className="size-5" />
                        {query
                          ? $t('Aucun article ne correspond.')
                          : canEdit
                            ? $t('Aucun article ici : « Nouvel article » en commence un.')
                            : $t('Aucun article ici.')}
                      </li>
                    )}
                  </ul>
                  <div className="border-t px-3 py-2 text-[11px] text-muted-foreground">
                    {$tp(onShelf.length, '{count} article', '{count} articles')}
                  </div>
                </>
              )}
            </section>
          )}

          {/* The article, written in place. */}
          <section className="min-w-0 flex-1 overflow-y-auto bg-background scroll-discret">
            {selected ? (
              <ArticlePane
                key={selected.id}
                article={selected}
                canEdit={canEdit}
                categories={categories}
                sites={sites}
                author={overview?.users.find((u) => u.id === selected.authorId)?.name ?? null}
                passages={passages.get(selected.id) ?? 0}
                onWrite={(values) => write(selected.id, values)}
                onFields={(values, patch) => void setFields(selected.id, values, patch)}
                onDelete={() => void remove(selected.id)}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
                <span className="flex size-12 items-center justify-center rounded-xl bg-muted">
                  <FileText className="size-5 text-muted-foreground" />
                </span>
                <p className="max-w-sm text-sm text-muted-foreground">
                  {canEdit
                    ? $t(
                        'Choisissez un article, ou commencez-en un : l’IA s’en sert dès qu’il est publié.',
                      )
                    : $t('Choisissez un article pour le lire.')}
                </p>
                {canEdit && (
                  <Button size="sm" className="gap-1.5" onClick={() => void create()}>
                    <Plus className="size-3.5" />
                    {$t('Nouvel article')}
                  </Button>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </>
  )
}

function MicroLabel({ children }: { readonly children: string }) {
  return (
    <div className="px-2 pt-4 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </div>
  )
}

function Saving({ state }: { readonly state: SaveState }) {
  if (state === 'idle') return null
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
      {state === 'saved' ? (
        <>
          <Check className="size-3.5 text-primary" />
          {$t('Enregistré')}
        </>
      ) : (
        <>
          <LoaderCircle className="size-3.5 animate-spin" />
          {$t('Enregistrement…')}
        </>
      )}
    </span>
  )
}

function ShelfRow({
  icon: Icon,
  label,
  count,
  active,
  onClick,
  muted = false,
}: {
  readonly icon: typeof Folder
  readonly label: string
  readonly count: number
  readonly active: boolean
  readonly onClick: () => void
  readonly muted?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] transition-colors hover:bg-accent',
        active && 'bg-accent font-medium',
        muted && !active && 'text-muted-foreground',
      )}
    >
      <Icon
        className={cn('size-4 shrink-0', active ? 'text-foreground' : 'text-muted-foreground')}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-[11px] text-muted-foreground tabular-nums">{count}</span>
    </button>
  )
}

function NewCategory({ onCreate }: { readonly onCreate: (name: string) => void }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Plus className="size-4" />
        {$t('Nouvelle catégorie')}
      </button>
    )
  }
  const close = () => {
    setAdding(false)
    setName('')
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (name.trim()) onCreate(name.trim())
        close()
      }}
      className="px-0.5 py-0.5"
    >
      <input
        // biome-ignore lint/a11y/noAutofocus: the field the writer just asked for
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          if (!name.trim()) close()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') close()
        }}
        maxLength={80}
        placeholder={$t('Nom de la catégorie')}
        aria-label={$t('Nom de la catégorie')}
        className="h-8 w-full rounded-lg border bg-background px-2 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25"
      />
    </form>
  )
}

function StatusChip({ status }: { readonly status: Status }) {
  const known = STATUSES.find((s) => s.value === status) ?? STATUSES[0]
  return <Chip tint={known.tint}>{$t(known.label)}</Chip>
}

function ArticleRow({
  article,
  category,
  passages,
  selected,
  onSelect,
}: {
  readonly article: Article
  readonly category: string | null
  readonly passages: number
  readonly selected: boolean
  readonly onSelect: () => void
}) {
  const excerpt = article.content
    .replace(/[#*_`>[\]()|~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'relative flex w-full flex-col gap-1 border-b px-3 py-3 text-left transition-colors',
        selected ? 'bg-accent' : 'hover:bg-muted/50',
      )}
    >
      {selected && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}
      <span className="flex items-start gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {article.title || $t('Sans titre')}
        </span>
        <StatusChip status={article.status} />
      </span>
      {excerpt && <span className="line-clamp-2 text-xs text-muted-foreground">{excerpt}</span>}
      {(category || passages > 0) && (
        <span className="flex items-center gap-3 text-[11px] text-muted-foreground">
          {category && (
            <span className="flex min-w-0 items-center gap-1 truncate">
              <Folder className="size-3 shrink-0" />
              {category}
            </span>
          )}
          {passages > 0 && (
            <span className="flex shrink-0 items-center gap-1">
              <Sparkles className="size-3 text-violet-600 dark:text-violet-300" />
              {$tp(passages, '{count} passage', '{count} passages')}
            </span>
          )}
        </span>
      )}
    </button>
  )
}

function PromotedList({
  items,
  basedbUrl,
}: {
  readonly items: readonly KnowledgeItem[]
  readonly basedbUrl: string
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="border-b px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
        {$t(
          'Des conversations bien résolues, promues depuis leur menu ⋯ puis relues : l’IA s’en sert comme d’exemples.',
        )}
      </p>
      <ul className="flex-1 overflow-y-auto scroll-discret">
        {items.map((item) => (
          <li key={item.id} className="border-b px-3 py-3">
            <div className="truncate text-sm">{item.title}</div>
            <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
              <Sparkles className="size-3 text-violet-600 dark:text-violet-300" />
              {$tp(item.passages, '{count} passage', '{count} passages')}
              {item.indexedAt && <span>, {dayLabel(item.indexedAt)}</span>}
            </div>
          </li>
        ))}
        {items.length === 0 && (
          <li className="px-6 py-12 text-center text-sm text-muted-foreground">
            {$t('Aucune conversation promue n’est encore indexée.')}
          </li>
        )}
      </ul>
      <a
        href={basedbUrl}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1.5 border-t px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ExternalLink className="size-3.5" />
        {$t('Relire les conversations promues dans basedb')}
      </a>
    </div>
  )
}

function ArticlePane({
  article,
  canEdit,
  categories,
  sites,
  author,
  passages,
  onWrite,
  onFields,
  onDelete,
}: {
  readonly article: Article
  readonly canEdit: boolean
  readonly categories: readonly SettingsRow[]
  readonly sites: readonly SettingsRow[]
  readonly author: string | null
  readonly passages: number
  readonly onWrite: (values: { readonly title?: string; readonly content?: string }) => void
  readonly onFields: (values: Record<string, unknown>, patch: Partial<Article>) => void
  readonly onDelete: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const title = useRef<HTMLTextAreaElement>(null)
  const published = article.status === 'Publié'
  const category = categories.find((c) => c.id === article.categoryId)

  // A new article opens with its title selected, ready to be typed over.
  const fresh = useRef(article.title === $t('Nouvel article'))
  useEffect(() => {
    if (canEdit && fresh.current) title.current?.select()
  }, [canEdit])

  const setStatus = (status: Status) =>
    onFields(
      { Statut: status, ...(status === 'Publié' ? { 'Relu le': today() } : {}) },
      { status, ...(status === 'Publié' ? { reviewedOn: today() } : {}) },
    )

  return (
    <article className="mx-auto max-w-3xl px-10 pt-6 pb-10">
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={!canEdit}>
            <button
              type="button"
              aria-label={$t('Statut')}
              className="inline-flex items-center gap-1 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25"
            >
              <StatusChip status={article.status} />
              {canEdit && <ChevronDown className="size-3.5 text-muted-foreground" />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={article.status}
              onValueChange={(value) => setStatus(value as Status)}
            >
              {STATUSES.map((s) => (
                <DropdownMenuRadioItem key={s.value} value={s.value}>
                  {$t(s.label)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={!canEdit}>
            <button
              type="button"
              className="inline-flex h-7 max-w-56 items-center gap-1.5 rounded-md border px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:hover:bg-transparent"
            >
              <Folder className="size-3.5 shrink-0" />
              <span className="truncate">{text(category?.values.Nom) || $t('Sans catégorie')}</span>
              {canEdit && <ChevronDown className="size-3 shrink-0" />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={article.categoryId ?? ''}
              onValueChange={(value) =>
                onFields({ Catégorie: value || null }, { categoryId: value || null })
              }
            >
              <DropdownMenuRadioItem value="">{$t('Sans catégorie')}</DropdownMenuRadioItem>
              {categories.map((c) => (
                <DropdownMenuRadioItem key={c.id} value={c.id}>
                  {text(c.values.Nom) || $t('Sans nom')}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <SitesPicker
          sites={sites}
          chosen={article.siteIds}
          disabled={!canEdit}
          onChange={(ids) => onFields({ Sites: ids }, { siteIds: ids })}
        />

        {canEdit && (
          <div className="ml-auto flex items-center gap-1">
            {published ? (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setStatus('Brouillon')}
              >
                {$t('Dépublier')}
              </Button>
            ) : (
              <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setStatus('Publié')}>
                <Check className="size-3.5" />
                {$t('Publier')}
              </Button>
            )}
            <DropdownMenu onOpenChange={(open) => !open && setConfirming(false)}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={$t('Plus d’actions')}>
                  <Ellipsis className="text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {article.status !== 'Archivé' && (
                  <>
                    <DropdownMenuItem onSelect={() => setStatus('Archivé')}>
                      <Archive />
                      {$t('Archiver')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={(event) => {
                    if (confirming) return onDelete()
                    event.preventDefault()
                    setConfirming(true)
                  }}
                >
                  <Trash2 />
                  {confirming ? $t('Confirmer la suppression') : $t('Supprimer')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {!published && (
        <div className="mb-6 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3.5 py-2.5 text-sm text-amber-900 dark:text-amber-200">
          <Sparkles className="mt-0.5 size-4 shrink-0" />
          <span>
            {article.status === 'Archivé'
              ? $t('Archivé : l’IA ne s’en sert plus.')
              : $t('Brouillon : l’IA ne s’en sert pas tant qu’il n’est pas publié.')}
          </span>
        </div>
      )}

      <textarea
        ref={title}
        value={article.title}
        readOnly={!canEdit}
        onChange={(event) => onWrite({ title: event.target.value.replace(/\n/g, ' ') })}
        onKeyDown={(event) => {
          // Enter goes on to the text, as in a document.
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget
              .closest('article')
              ?.querySelector<HTMLElement>('[contenteditable="true"]')
              ?.focus()
          }
        }}
        placeholder={$t('Titre de l’article')}
        aria-label={$t('Titre de l’article')}
        rows={1}
        className="field-sizing-content w-full resize-none bg-transparent text-3xl leading-tight font-semibold tracking-tight outline-none placeholder:text-muted-foreground/60"
      />
      <div className="mt-2 mb-8 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {author && <span>{$t('Par {name}', { name: author })}</span>}
        {article.reviewedOn && (
          <span>{$t('Relu le {date}', { date: dayLabel(article.reviewedOn) })}</span>
        )}
        {published && (
          <span className="flex items-center gap-1">
            <Sparkles className="size-3 text-violet-600 dark:text-violet-300" />
            {passages > 0
              ? $tp(
                  passages,
                  'Indexé pour l’IA : {count} passage',
                  'Indexé pour l’IA : {count} passages',
                )
              : $t('En cours d’indexation pour l’IA')}
          </span>
        )}
      </div>

      <ArticleEditor
        markdown={article.content}
        editable={canEdit}
        onChange={(content) => onWrite({ content })}
      />
    </article>
  )
}

function SitesPicker({
  sites,
  chosen,
  disabled,
  onChange,
}: {
  readonly sites: readonly SettingsRow[]
  readonly chosen: readonly string[]
  readonly disabled: boolean
  readonly onChange: (ids: string[]) => void
}) {
  const names = chosen.map((id) => text(sites.find((s) => s.id === id)?.values.Nom)).filter(Boolean)
  return (
    <Popover>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          className="inline-flex h-7 max-w-56 items-center gap-1.5 rounded-md border px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:hover:bg-transparent"
        >
          <Globe className="size-3.5 shrink-0" />
          <span className="truncate">
            {names.length === 0 ? $t('Tous les sites') : names.join(', ')}
          </span>
          {!disabled && <ChevronDown className="size-3 shrink-0" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        <p className="px-2 pt-1.5 pb-1 text-[11px] text-muted-foreground">
          {$t('Aucun site coché : l’article vaut pour tous.')}
        </p>
        {sites.map((site) => {
          const on = chosen.includes(site.id)
          return (
            <button
              key={site.id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={on}
              onClick={() =>
                onChange(on ? chosen.filter((id) => id !== site.id) : [...chosen, site.id])
              }
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
            >
              <span
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded border',
                  on && 'border-primary bg-primary text-primary-foreground',
                )}
              >
                {on && <Check className="size-3" />}
              </span>
              <span className="truncate">{text(site.values.Nom) || $t('Sans nom')}</span>
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
