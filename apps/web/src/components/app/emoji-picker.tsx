'use client'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Segmented } from '@/components/ui/segmented'
import { Skeleton } from '@/components/ui/skeleton'
import { Hint } from '@/components/ui/tooltip'
import { ApiFailure, api } from '@/lib/api'
import { $t, msg } from '@/lib/i18n'
import { messageFor } from '@/lib/messages'
import { cn } from '@/lib/utils'
import type { GifHit } from '@chat/contracts'
import {
  Clock,
  Film,
  Flag,
  Heart,
  Leaf,
  Lightbulb,
  LoaderCircle,
  type LucideIcon,
  Plane,
  Search,
  Smile,
  Trophy,
  UsersRound,
  UtensilsCrossed,
} from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Every emoji the system draws, found by their French names — emojibase's, read when the
 * picker first opens —, in skin tones; the last ones chosen first. And, beside them, GIPHY's
 * GIFs, when the server has its key: a GIF chosen goes with the message as a file.
 */

interface Emoji {
  readonly emoji: string
  readonly label: string
  /** Its name and its keywords, folded — what a search reads. */
  readonly words: string
  readonly group: number
  /** Light to dark, when it takes a tone. */
  readonly skins?: readonly string[]
}

interface Raw {
  readonly emoji: string
  readonly label: string
  readonly tags?: readonly string[]
  readonly group?: number
  readonly order?: number
  readonly version?: number
  readonly skins?: readonly { readonly emoji: string; readonly tone?: number | readonly number[] }[]
}

const GROUPS: readonly {
  readonly group: number
  readonly label: string
  readonly icon: LucideIcon
}[] = [
  { group: 0, label: msg('Visages et émotions'), icon: Smile },
  { group: 1, label: msg('Personnes et gestes'), icon: UsersRound },
  { group: 3, label: msg('Animaux et nature'), icon: Leaf },
  { group: 4, label: msg('Nourriture et boissons'), icon: UtensilsCrossed },
  { group: 5, label: msg('Voyages et lieux'), icon: Plane },
  { group: 6, label: msg('Activités'), icon: Trophy },
  { group: 7, label: msg('Objets'), icon: Lightbulb },
  { group: 8, label: msg('Symboles'), icon: Heart },
  { group: 9, label: msg('Drapeaux'), icon: Flag },
]

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

/** Whether the system draws an emoji in colour — a box or a grey glyph, it does not. */
function draws(emoji: string): boolean {
  const canvas = document.createElement('canvas')
  canvas.width = 24
  canvas.height = 24
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return true
  context.textBaseline = 'top'
  context.font = '20px sans-serif'
  context.fillText(emoji, 0, 0)
  const { data } = context.getImageData(0, 0, 24, 24)
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] ?? 0) > 0 && (data[i] !== data[i + 1] || data[i + 1] !== data[i + 2])) {
      return true
    }
  }
  return false
}

let loading: Promise<readonly Emoji[]> | null = null

/** The emoji, once per page — those of a newer Unicode than the system draws left out. */
function loadEmoji(): Promise<readonly Emoji[]> {
  loading ??= import('emojibase-data/fr/data.json')
    .then((module) => {
      const raw = ((module as { default?: unknown }).default ?? module) as readonly Raw[]
      const newest = draws('🫨') ? 15 : draws('🫠') ? 14 : 13
      return [...raw]
        .filter((e) => e.group !== undefined && e.group !== 2 && (e.version ?? 0) <= newest)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((e) => {
          const toned = (e.skins ?? []).filter((s) => typeof s.tone === 'number')
          return {
            emoji: e.emoji,
            label: e.label,
            words: fold(`${e.label} ${(e.tags ?? []).join(' ')}`),
            group: e.group as number,
            ...(toned.length === 5 ? { skins: toned.map((s) => s.emoji) } : {}),
          }
        })
    })
    .catch((error: unknown) => {
      loading = null
      throw error
    })
  return loading
}

/** What a search finds: the name first, then a word of it, then a keyword. */
function find(all: readonly Emoji[], query: string): Emoji[] {
  const tokens = fold(query).split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return []
  const scored: { readonly emoji: Emoji; readonly score: number }[] = []
  for (const emoji of all) {
    let score = 0
    for (const token of tokens) {
      const label = fold(emoji.label)
      const s = label.startsWith(token)
        ? 3
        : ` ${label}`.includes(` ${token}`)
          ? 2
          : ` ${emoji.words}`.includes(` ${token}`)
            ? 1
            : emoji.words.includes(token)
              ? 0.5
              : 0
      if (s === 0) {
        score = 0
        break
      }
      score += s
    }
    if (score > 0) scored.push({ emoji, score })
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 180)
    .map((s) => s.emoji)
}

const RECENT_KEY = 'chat.emoji.recent'
const TONE_KEY = 'chat.emoji.tone'

function read<T>(key: string, fallback: T, valid: (value: unknown) => value is T): T {
  try {
    const stored = JSON.parse(window.localStorage.getItem(key) ?? 'null') as unknown
    return valid(stored) ? stored : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Forgotten next time, nothing more.
  }
}

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === 'string')
const isTone = (value: unknown): value is number =>
  typeof value === 'number' && value >= 0 && value <= 5

/** No tone, then light to dark — shown on a raised hand. */
const TONES = ['✋', '✋🏻', '✋🏼', '✋🏽', '✋🏾', '✋🏿'] as const

export function EmojiPicker({
  onPick,
  onGif,
  children,
  side = 'top',
}: {
  readonly onPick: (emoji: string) => void
  /** A GIF chosen, as a file — given, the picker has its GIF tab. */
  readonly onGif?: (file: File) => void
  /** The button that opens it. */
  readonly children: ReactNode
  readonly side?: 'top' | 'bottom'
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'emoji' | 'gif'>('emoji')
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side={side}
        align="start"
        className="flex w-[352px] flex-col overflow-hidden p-0"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div className="space-y-2 border-b p-2">
          {onGif && (
            <Segmented
              aria-label={$t('Emoji ou GIF')}
              value={tab}
              onValueChange={setTab}
              className="w-full"
              options={[
                {
                  value: 'emoji',
                  label: (
                    <>
                      <Smile className="size-3.5" />
                      {$t('Emoji')}
                    </>
                  ),
                },
                {
                  value: 'gif',
                  label: (
                    <>
                      <Film className="size-3.5" />
                      {$t('GIF')}
                    </>
                  ),
                },
              ]}
            />
          )}
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              // biome-ignore lint/a11y/noAutofocus: the picker opens to be searched
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                tab === 'emoji' ? $t('Rechercher un emoji…') : $t('Rechercher sur GIPHY…')
              }
              aria-label={tab === 'emoji' ? $t('Rechercher un emoji') : $t('Rechercher un GIF')}
              className="h-8 w-full rounded-md border bg-muted/40 pr-2 pl-8 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25"
            />
          </div>
        </div>
        {tab === 'emoji' ? (
          <EmojiPanel
            query={query}
            onPick={(emoji) => {
              onPick(emoji)
              setOpen(false)
            }}
          />
        ) : (
          <GifPanel
            query={query}
            onPick={(file) => {
              onGif?.(file)
              setOpen(false)
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

function EmojiPanel({
  query,
  onPick,
}: {
  readonly query: string
  readonly onPick: (emoji: string) => void
}) {
  const [all, setAll] = useState<readonly Emoji[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [recent, setRecent] = useState<string[]>(() => read(RECENT_KEY, [], isStrings))
  const [tone, setTone] = useState<number>(() => read(TONE_KEY, 0, isTone))
  const [toning, setToning] = useState(false)
  const [hover, setHover] = useState<Emoji | null>(null)
  const [shown, setShown] = useState<number>(-1)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadEmoji()
      .then(setAll)
      .catch(() => setFailed(true))
  }, [])

  const byGroup = useMemo(() => {
    const groups = new Map<number, Emoji[]>()
    for (const emoji of all ?? [])
      groups.set(emoji.group, [...(groups.get(emoji.group) ?? []), emoji])
    return groups
  }, [all])
  const found = useMemo(() => (all && query.trim() ? find(all, query) : null), [all, query])
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new search, nothing hovered
  useEffect(() => setHover(null), [query])
  const recentItems = useMemo(
    () =>
      recent.map(
        (emoji) =>
          all?.find((e) => e.emoji === emoji || e.skins?.includes(emoji)) ?? {
            emoji,
            label: emoji,
            words: '',
            group: -1,
          },
      ),
    [recent, all],
  )

  const toned = (emoji: Emoji) =>
    tone > 0 && emoji.skins ? (emoji.skins[tone - 1] ?? emoji.emoji) : emoji.emoji

  function pick(emoji: Emoji, as = toned(emoji)) {
    const next = [as, ...recent.filter((e) => e !== as)].slice(0, 27)
    setRecent(next)
    write(RECENT_KEY, next)
    onPick(as)
  }

  function chooseTone(next: number) {
    setTone(next)
    write(TONE_KEY, next)
    setToning(false)
  }

  // The group in view, for the bar above.
  function scrolled() {
    const box = scroller.current
    if (!box) return
    let current = -1
    for (const section of box.querySelectorAll<HTMLElement>('[data-group]')) {
      if (section.offsetTop - box.scrollTop <= 8) current = Number(section.dataset.group)
    }
    setShown(current)
  }

  function jump(group: number) {
    const section = scroller.current?.querySelector<HTMLElement>(`[data-group="${group}"]`)
    if (section && scroller.current) scroller.current.scrollTop = section.offsetTop
  }

  const cell = (emoji: Emoji, as?: string) => (
    <button
      key={as ?? emoji.emoji}
      type="button"
      aria-label={emoji.label}
      onClick={() => pick(emoji, as)}
      onMouseEnter={() => setHover(emoji)}
      onFocus={() => setHover(emoji)}
      className="flex size-9 items-center justify-center rounded-md text-[22px] leading-none transition-transform hover:scale-110 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
    >
      {as ?? toned(emoji)}
    </button>
  )

  return (
    <>
      {!found && (
        <div className="flex items-center justify-between border-b px-1.5 py-1">
          {[
            ...(recent.length > 0 ? [{ group: -1, label: msg('Récents'), icon: Clock }] : []),
            ...GROUPS,
          ].map((g) => (
            <Hint key={g.group} label={$t(g.label)}>
              <button
                type="button"
                aria-label={$t(g.label)}
                onClick={() => jump(g.group)}
                className={cn(
                  'flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                  shown === g.group && 'bg-accent text-foreground',
                )}
              >
                <g.icon className="size-4" />
              </button>
            </Hint>
          ))}
        </div>
      )}
      <div
        ref={scroller}
        onScroll={scrolled}
        className="relative h-64 overflow-y-auto px-1.5 pb-1.5 scroll-discret"
      >
        {all === null ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {failed ? (
              $t('Les emoji n’ont pas pu être chargés.')
            ) : (
              <div className="grid w-full grid-cols-8 gap-1.5 self-start p-2">
                {Array.from({ length: 40 }, (_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
                  <Skeleton key={i} className="aspect-square rounded-md" />
                ))}
              </div>
            )}
          </div>
        ) : found ? (
          found.length === 0 ? (
            <p className="px-3 py-10 text-center text-xs text-muted-foreground">
              {$t('Aucun emoji ne correspond.')}
            </p>
          ) : (
            <div className="grid grid-cols-9 pt-1.5">{found.map((emoji) => cell(emoji))}</div>
          )
        ) : (
          <>
            {recent.length > 0 && (
              <section data-group={-1}>
                <GroupTitle>{$t('Récents')}</GroupTitle>
                <div className="grid grid-cols-9">
                  {recentItems.map((emoji, i) => cell(emoji, recent[i]))}
                </div>
              </section>
            )}
            {GROUPS.map((g) => (
              <section key={g.group} data-group={g.group}>
                <GroupTitle>{$t(g.label)}</GroupTitle>
                <div className="grid grid-cols-9">
                  {(byGroup.get(g.group) ?? []).map((emoji) => cell(emoji))}
                </div>
              </section>
            ))}
          </>
        )}
      </div>
      <div className="flex h-11 items-center gap-2 border-t px-2.5">
        {hover ? (
          <>
            <span className="text-2xl leading-none">{toned(hover)}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground first-letter:uppercase">
              {hover.label}
            </span>
          </>
        ) : (
          <span className="flex-1 text-xs text-muted-foreground">{$t('Choisissez un emoji')}</span>
        )}
        {toning ? (
          <span className="flex items-center gap-0.5">
            {TONES.map((hand, index) => (
              <button
                key={hand}
                type="button"
                aria-label={index === 0 ? $t('Sans teinte') : $t('Teinte {n}', { n: index })}
                onClick={() => chooseTone(index)}
                className={cn(
                  'flex size-7 items-center justify-center rounded-md text-lg hover:bg-accent',
                  tone === index && 'bg-accent',
                )}
              >
                {hand}
              </button>
            ))}
          </span>
        ) : (
          <Hint label={$t('Teinte de peau')}>
            <button
              type="button"
              aria-label={$t('Teinte de peau')}
              onClick={() => setToning(true)}
              className="flex size-7 items-center justify-center rounded-md text-lg hover:bg-accent"
            >
              {TONES[tone]}
            </button>
          </Hint>
        )}
      </div>
    </>
  )
}

function GroupTitle({ children }: { readonly children: ReactNode }) {
  return (
    <h3 className="sticky top-0 z-10 bg-popover/95 px-1 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase backdrop-blur-sm">
      {children}
    </h3>
  )
}

function GifPanel({
  query,
  onPick,
}: {
  readonly query: string
  readonly onPick: (file: File) => void
}) {
  const [hits, setHits] = useState<GifHit[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const [picking, setPicking] = useState<string | null>(null)

  // GIPHY counts the calls: asked once the typing pauses.
  useEffect(() => {
    let stale = false
    setError(null)
    const timer = setTimeout(
      () => {
        api
          .gifs(query)
          .then((found) => {
            if (stale) return
            setHits(found)
            setMore(found.length >= 24)
          })
          .catch((failure: unknown) => {
            if (stale) return
            setHits([])
            setError(failure instanceof ApiFailure ? failure.code : 'INTERNAL_ERROR')
          })
      },
      query ? 350 : 0,
    )
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [query])

  async function next() {
    try {
      const found = await api.gifs(query, hits?.length ?? 0)
      setHits((all) => [...(all ?? []), ...found.filter((f) => !all?.some((a) => a.id === f.id))])
      setMore(found.length >= 24)
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.code : 'INTERNAL_ERROR')
    }
  }

  async function pick(hit: GifHit) {
    setPicking(hit.id)
    try {
      const blob = await api.gifFile(hit.id)
      const name = `${
        hit.title
          .normalize('NFKD')
          .replace(/\p{M}/gu, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 40) || 'gif'
      }.gif`
      onPick(new File([blob], name, { type: 'image/gif' }))
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.code : 'INTERNAL_ERROR')
    } finally {
      setPicking(null)
    }
  }

  return (
    <>
      <div className="h-[19rem] overflow-y-auto p-1.5 scroll-discret">
        {error ? (
          <p className="px-4 py-12 text-center text-xs text-muted-foreground">
            {messageFor(error)}
          </p>
        ) : hits === null ? (
          <div className="grid grid-cols-3 gap-1.5">
            {Array.from({ length: 9 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
              <Skeleton key={i} className="aspect-video rounded-md" />
            ))}
          </div>
        ) : hits.length === 0 ? (
          <p className="px-4 py-12 text-center text-xs text-muted-foreground">
            {$t('Aucun GIF ne correspond.')}
          </p>
        ) : (
          <>
            <div className="columns-2 gap-1.5">
              {hits.map((hit) => (
                <button
                  key={hit.id}
                  type="button"
                  disabled={picking !== null}
                  onClick={() => void pick(hit)}
                  aria-label={hit.title || $t('GIF')}
                  className="relative mb-1.5 block w-full overflow-hidden rounded-md bg-muted outline-none ring-ring/50 hover:ring-2 focus-visible:ring-[3px] disabled:opacity-60"
                  style={{ aspectRatio: `${hit.width} / ${hit.height}` }}
                >
                  <img src={hit.preview} alt="" loading="lazy" className="size-full object-cover" />
                  {picking === hit.id && (
                    <span className="absolute inset-0 flex items-center justify-center bg-background/60">
                      <LoaderCircle className="size-5 animate-spin" />
                    </span>
                  )}
                </button>
              ))}
            </div>
            {more && (
              <button
                type="button"
                onClick={() => void next()}
                className="mt-1 w-full rounded-md py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {$t('Plus de GIF')}
              </button>
            )}
          </>
        )}
      </div>
      <div className="flex h-8 items-center justify-end border-t px-2.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
        {$t('Propulsé par GIPHY')}
      </div>
    </>
  )
}
