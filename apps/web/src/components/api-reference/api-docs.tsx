'use client'

import { Markdown, headings, unescapeText } from '@/components/markdown'
import { Button } from '@/components/ui/button'
import { Hint } from '@/components/ui/tooltip'
import { ApiFailure, api } from '@/lib/api'
import { $t } from '@/lib/i18n'
import { messageFor } from '@/lib/messages'
import { useInbox } from '@/lib/store/inbox'
import { useTitle } from '@/lib/title'
import { cn } from '@/lib/utils'
import type { DocSection } from '@chat/contracts'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronRight,
  FileJson,
  KeyRound,
  Search,
  TextAlignStart,
} from 'lucide-react'
import Link from 'next/link'
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * The documentation of the Messagerie's API and MCP server (D16) — basedb's documentation
 * screen, as is: the sections the server writes from what runs (`api/documentation.ts`),
 * laid out as a documentation site.
 *
 * Three columns that scroll on their own: the sections, grouped by topic, on the left; ONE
 * section at a time in the middle; and the headings of that section on the right, with the
 * one being read lit. The page is `/documentation`; its `#fragment` names the section and,
 * after a slash, the heading, so that Back and a copied link land where they should.
 *
 * Breakpoints are CONTAINER queries, not viewport ones: the application's own sidebar takes
 * 16rem of whatever the window offers. The navigation appears from `@4xl` (56rem) and the
 * table of contents from `@6xl` (72rem) of the room this component actually gets.
 */

const codeOf = (error: unknown) => (error instanceof ApiFailure ? error.code : 'INTERNAL_ERROR')

/** Prefix of every heading's DOM id: a slug like `colonnes` must not collide with the app's. */
const HEADING_PREFIX = 'doc-'

/** How far under the top edge a heading is when it starts to count as the one being read. */
const SPY_OFFSET = 96

/** Where a followed heading rests below the top edge — the `scroll-mt-6` of the headings. */
const REST_OFFSET = 24

interface DocPage {
  /** Unique within the documentation, and what the URL fragment carries. */
  readonly slug: string
  /** Unescaped: the generator neutralizes a label for viewers that interpret HTML. */
  readonly title: string
  readonly group: string
  readonly markdown: string
}

interface DocGroup {
  readonly name: string
  readonly pages: readonly DocPage[]
}

/**
 * Pages from sections.
 *
 * Section ids are table names, plus a few fixed ones — and a table may be called
 * `relations` or `conventions`. A duplicate would make two pages one, so the later takes a
 * suffix: the payload is deterministic, hence so are the slugs.
 */
function toPages(sections: readonly DocSection[]): DocPage[] {
  const taken = new Set<string>()
  return sections.map((section) => {
    let slug = section.id
    for (let n = 2; taken.has(slug); n += 1) slug = `${section.id}-${n}`
    taken.add(slug)
    return {
      slug,
      title: unescapeText(section.title),
      // An API that predates `group` sends none: everything then falls into one group.
      group: section.group || $t('Documentation'),
      markdown: section.markdown,
    }
  })
}

/** Groups in order of first appearance, which is the order the generator wrote them in. */
function toGroups(pages: readonly DocPage[]): DocGroup[] {
  const groups: { name: string; pages: DocPage[] }[] = []
  for (const page of pages) {
    const group = groups.find((g) => g.name === page.group)
    if (group === undefined) groups.push({ name: page.group, pages: [page] })
    else group.pages.push(page)
  }
  return groups
}

/** Lower case and no accents: "ecrire" finds "Écrire". */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
}

// ── The URL fragment ──────────────────────────────────────────────────────────────────

interface Target {
  readonly slug: string | undefined
  /** The slug of a heading on that page, when the link named one. */
  readonly heading: string | undefined
}

/** `#page` or `#page/heading`; undefined when the fragment is not ours. */
function readTarget(): Target | undefined {
  if (typeof window === 'undefined') return undefined
  let raw = window.location.hash.slice(1)
  try {
    raw = decodeURIComponent(raw)
  } catch {
    // A malformed escape is somebody's typo: read the fragment as it stands.
  }
  if (raw === '') return undefined
  const [slug, heading] = raw.split('/')
  return { slug, heading: heading === '' ? undefined : heading }
}

/**
 * `replaceState` and `pushState`, never `location.hash =`: assigning the fragment makes the
 * browser scroll to an element of that id, and the ancestor it would scroll is the
 * application's `overflow-hidden` frame.
 */
function writeTarget(slug: string, heading: string | undefined, mode: 'push' | 'replace'): void {
  const hash = heading === undefined ? `#${slug}` : `#${slug}/${heading}`
  if (window.location.hash === hash) return
  if (mode === 'push') window.history.pushState(null, '', hash)
  else window.history.replaceState(null, '', hash)
}

/** Scrolls `container` — and only it — so that `element` rests just under its top edge. */
function scrollToElement(container: HTMLElement, element: HTMLElement, smooth: boolean): void {
  const top =
    element.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop -
    REST_OFFSET
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  container.scrollTo({ top, behavior: smooth && !reduced ? 'smooth' : 'auto' })
}

// ── Left: navigation ──────────────────────────────────────────────────────────────────

function Navigation({
  groups,
  current,
  onSelect,
}: {
  readonly groups: readonly DocGroup[]
  readonly current: string
  readonly onSelect: (slug: string) => void
}) {
  const [filter, setFilter] = useState('')
  const query = fold(filter.trim())

  const shown =
    query === ''
      ? groups
      : groups
          .map((group) => ({
            name: group.name,
            pages: group.pages.filter((page) => fold(page.title).includes(query)),
          }))
          .filter((group) => group.pages.length > 0)

  return (
    <aside
      aria-label={$t('Sections de la documentation')}
      className="hidden w-64 shrink-0 flex-col border-r @4xl:flex"
    >
      <div className="px-4 pt-4 pb-3">
        <div className="flex h-8 items-center gap-2 rounded-lg border bg-background px-2.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/25">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => event.key === 'Escape' && setFilter('')}
            placeholder={$t('Filtrer…')}
            aria-label={$t('Filtrer les sections')}
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
          {filter !== '' && (
            <button
              type="button"
              onClick={() => setFilter('')}
              className="text-xs text-muted-foreground hover:text-foreground"
              aria-label={$t('Effacer le filtre')}
            >
              ×
            </button>
          )}
        </div>
      </div>

      <nav className="scroll-discret min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pt-1 pb-8">
        {shown.map((group) => (
          <div key={group.name}>
            <p className="mb-1.5 px-3.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {group.name}
            </p>
            <ul className="border-l">
              {group.pages.map((page) => {
                const active = page.slug === current
                return (
                  <li key={page.slug}>
                    <a
                      href={`#${page.slug}`}
                      title={page.title}
                      aria-current={active ? 'page' : undefined}
                      onClick={(event) => {
                        event.preventDefault()
                        onSelect(page.slug)
                      }}
                      className={cn(
                        '-ml-px block truncate border-l-2 py-1.5 pr-2 pl-3.5 text-sm transition-colors',
                        active
                          ? 'border-primary bg-primary/[0.08] font-medium text-foreground'
                          : 'border-transparent text-muted-foreground hover:border-foreground/25 hover:text-foreground',
                      )}
                    >
                      {page.title}
                    </a>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
        {shown.length === 0 && (
          <p className="px-3.5 text-xs text-muted-foreground">
            {$t('Aucune section ne correspond.')}
          </p>
        )}
      </nav>
    </aside>
  )
}

// ── Right: on this page ───────────────────────────────────────────────────────────────

interface Entry {
  readonly id: string
  readonly text: string
}

/**
 * The headings of the page, the one being read lit.
 *
 * The lit heading is the last whose top has passed a line a little under the top edge — and
 * the last of all once the end is reached, because a short final section could never get
 * there otherwise. Its state lives HERE and not in the page: a scroll event must re-draw a
 * list of links, not the whole article.
 */
function OnThisPage({
  entries,
  scroller,
  onFollow,
}: {
  readonly entries: readonly Entry[]
  readonly scroller: RefObject<HTMLDivElement | null>
  readonly onFollow: (domId: string) => void
}) {
  const [active, setActive] = useState<string | undefined>(entries[0]?.id)

  useEffect(() => {
    const container = scroller.current
    if (container === null || entries.length === 0) return

    let frame = 0
    const update = () => {
      frame = 0
      const line = container.getBoundingClientRect().top + SPY_OFFSET
      let found = entries[0]?.id
      for (const entry of entries) {
        const element = document.getElementById(`${HEADING_PREFIX}${entry.id}`)
        if (element === null) continue
        if (element.getBoundingClientRect().top > line) break
        found = entry.id
      }
      const scrollable = container.scrollHeight > container.clientHeight + 8
      const atEnd = container.scrollTop + container.clientHeight >= container.scrollHeight - 4
      setActive(scrollable && atEnd ? entries[entries.length - 1]?.id : found)
    }

    // One update per frame, however many scroll events came in.
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update)
    }

    update()
    container.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      container.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      cancelAnimationFrame(frame)
    }
  }, [entries, scroller])

  if (entries.length === 0) return null

  return (
    <nav aria-label={$t('Sur cette page')}>
      <p className="mb-3 flex items-center gap-2 text-xs font-semibold text-foreground">
        <TextAlignStart className="size-3.5 text-muted-foreground" />
        {$t('Sur cette page')}
      </p>
      <ul className="border-l">
        {entries.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#${HEADING_PREFIX}${entry.id}`}
              onClick={(event) => {
                event.preventDefault()
                setActive(entry.id)
                onFollow(`${HEADING_PREFIX}${entry.id}`)
              }}
              className={cn(
                '-ml-px block border-l-2 py-1 pr-2 pl-3 text-[13px] leading-5 transition-colors',
                active === entry.id
                  ? 'border-primary font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {entry.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

// ── Centre: the page ──────────────────────────────────────────────────────────────────

function Neighbour({
  page,
  direction,
  onSelect,
}: {
  readonly page: DocPage
  readonly direction: 'previous' | 'next'
  readonly onSelect: (slug: string) => void
}) {
  const next = direction === 'next'
  return (
    <a
      href={`#${page.slug}`}
      onClick={(event) => {
        event.preventDefault()
        onSelect(page.slug)
      }}
      className={cn(
        'group flex min-w-0 flex-col gap-1 rounded-lg border p-4 transition-colors hover:border-primary/50 hover:bg-primary/5',
        next && 'items-end text-right',
      )}
    >
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {!next && (
          <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" />
        )}
        {next ? $t('Suivant') : $t('Précédent')}
        {next && (
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        )}
      </span>
      <span className="max-w-full truncate text-sm font-medium text-foreground">{page.title}</span>
      <span className="text-xs text-muted-foreground">{page.group}</span>
    </a>
  )
}

/**
 * The OpenAPI specification, downloaded as a file rather than linked: a link would open a
 * tab with no `Authorization` header — the inbox's token lives in memory.
 */
function SpecDownload() {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const download = async () => {
    setBusy(true)
    setFailure(null)
    try {
      const spec = await api.openApiSpec()
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' }),
      )
      // Attached for the click: a detached anchor is not honoured by every browser.
      const link = document.createElement('a')
      link.href = url
      link.download = 'messagerie.openapi.json'
      document.body.append(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      setFailure(messageFor(codeOf(error)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Hint label={failure ?? $t('Télécharger la spécification OpenAPI 3.1')}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void download()}
        disabled={busy}
        className={cn(failure !== null && 'border-destructive/40 text-destructive')}
      >
        <FileJson />
        {busy ? $t('Export…') : failure !== null ? $t('Échec — réessayer') : 'openapi.json'}
      </Button>
    </Hint>
  )
}

/** The tokens, one click from the pages that explain them. */
function TokenButton() {
  const supervisor = useInbox((s) => s.me?.role === 'supervisor')
  if (!supervisor) return null
  return (
    <Hint label={$t('Créer un jeton pour l’API REST ou le MCP')}>
      <Button variant="outline" size="sm" asChild>
        <Link href="/parametrage/api">
          <KeyRound />
          {$t('Jetons')}
        </Link>
      </Button>
    </Hint>
  )
}

function DocsBody({ pages }: { readonly pages: readonly DocPage[] }) {
  const groups = useMemo(() => toGroups(pages), [pages])
  // Previous and next follow what the navigation shows, which is grouped — not the payload.
  const ordered = useMemo(() => groups.flatMap((group) => group.pages), [groups])

  const [target, setTarget] = useState<Target>(
    () => readTarget() ?? { slug: undefined, heading: undefined },
  )
  const scroller = useRef<HTMLDivElement>(null)

  const index = Math.max(
    0,
    ordered.findIndex((page) => page.slug === target.slug),
  )
  const page = ordered[index] as DocPage
  const previous = ordered[index - 1]
  const next = ordered[index + 1]

  useTitle([page.title, $t('Documentation')])

  const entries = useMemo(
    () =>
      headings(page.markdown)
        .filter((heading) => heading.level === 3)
        .map(({ id, text }) => ({ id, text })),
    [page.markdown],
  )

  /** Opens a page: an entry in the history, so that Back returns to the one before. */
  const open = useCallback((slug: string) => {
    setTarget({ slug, heading: undefined })
    writeTarget(slug, undefined, 'push')
  }, [])

  /** Follows a heading of the current page: the scroll is ours, the fragment only follows. */
  const follow = useCallback(
    (domId: string) => {
      const container = scroller.current
      const element = document.getElementById(domId)
      if (container !== null && element !== null) scrollToElement(container, element, true)
      writeTarget(page.slug, domId.slice(HEADING_PREFIX.length), 'replace')
    },
    [page.slug],
  )

  // The page in the URL: written when the documentation opens (without an entry of its own),
  // and read back when the fragment changes under us — Back, Forward, an edited address.
  useEffect(() => {
    writeTarget(page.slug, target.slug === page.slug ? target.heading : undefined, 'replace')
  }, [page.slug, target])

  useEffect(() => {
    const onHashChange = () => {
      const read = readTarget()
      if (read !== undefined) setTarget(read)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // Leaving the documentation leaves the fragment behind otherwise: a `#clients` on the
  // grid of another table.
  useEffect(
    () => () => {
      if (readTarget() !== undefined) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
      }
    },
    [],
  )

  // A new page starts at its top — or at the heading its link named.
  useEffect(() => {
    const container = scroller.current
    if (container === null) return
    const anchor = target.slug === page.slug ? target.heading : undefined
    const element =
      anchor === undefined ? null : document.getElementById(`${HEADING_PREFIX}${anchor}`)
    if (element !== null) scrollToElement(container, element, false)
    else container.scrollTo({ top: 0 })
  }, [page.slug, target])

  return (
    <div className="@container flex min-h-0 flex-1">
      <Navigation groups={groups} current={page.slug} onSelect={open} />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-3 border-b px-4 @2xl:px-6">
          <nav
            aria-label={$t('Fil d’Ariane')}
            className="hidden min-w-0 items-center gap-1.5 text-sm text-muted-foreground @4xl:flex"
          >
            <span className="max-w-[10rem] truncate">{$t('Documentation')}</span>
            <ChevronRight className="size-3.5 shrink-0" />
            <span className="shrink-0">{page.group}</span>
            <ChevronRight className="size-3.5 shrink-0" />
            <span className="truncate font-medium text-foreground">{page.title}</span>
          </nav>

          {/* Below the navigation's breakpoint the sections are one search away: a list of
              every page, each with the section it belongs to. */}
          <div className="min-w-0 flex-1 @4xl:hidden">
            <select
              value={page.slug}
              onChange={(event) => open(event.target.value)}
              aria-label={$t('Section de la documentation')}
              className="h-8 w-full rounded-md border bg-background px-2 text-sm font-medium"
            >
              {groups.map((group) => (
                <optgroup key={group.name} label={group.name}>
                  {group.pages.map((option) => (
                    <option key={option.slug} value={option.slug}>
                      {option.title}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Pushes the actions right when the breadcrumb is what sits on the left. */}
          <div className="hidden flex-1 @4xl:block" />

          <div className="flex shrink-0 items-center gap-2">
            <TokenButton />
            <SpecDownload />
          </div>
        </div>

        {/* Under the bar, so that the article and its table of contents start on one line. */}
        <div className="flex min-h-0 flex-1">
          <div ref={scroller} className="scroll-discret min-w-0 flex-1 overflow-y-auto">
            <article className="mx-auto max-w-[46rem] px-5 py-8 @2xl:px-10 @2xl:py-12">
              <h1 className="mb-8 text-balance text-3xl font-semibold tracking-tight text-foreground">
                {page.title}
              </h1>

              <Markdown
                key={page.slug}
                source={page.markdown}
                idPrefix={HEADING_PREFIX}
                onAnchor={follow}
              />

              <nav
                aria-label={$t('Pagination')}
                className="mt-16 grid gap-3 border-t pt-8 @2xl:grid-cols-2"
              >
                {previous === undefined ? (
                  <span className="hidden @2xl:block" />
                ) : (
                  <Neighbour page={previous} direction="previous" onSelect={open} />
                )}
                {next !== undefined && <Neighbour page={next} direction="next" onSelect={open} />}
              </nav>
            </article>
          </div>

          <aside
            aria-label={$t('Sur cette page')}
            className="scroll-discret hidden w-56 shrink-0 overflow-y-auto py-12 pr-4 pl-2 @6xl:block"
          >
            <OnThisPage key={page.slug} entries={entries} scroller={scroller} onFollow={follow} />
          </aside>
        </div>
      </div>
    </div>
  )
}

/** Something to say where there is no documentation to draw. */
function Notice({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-muted">
          <BookOpen className="size-6 text-muted-foreground" />
        </span>
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
    </div>
  )
}

export function ApiDocs() {
  const [sections, setSections] = useState<readonly DocSection[] | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api
      .apiDocs()
      .then((doc) => {
        if (alive) setSections(doc.sections)
      })
      .catch((error: unknown) => {
        if (alive) setFailure(messageFor(codeOf(error)))
      })
    return () => {
      alive = false
    }
  }, [])

  const pages = useMemo(() => (sections === null ? [] : toPages(sections)), [sections])

  if (pages.length > 0) return <DocsBody pages={pages} />
  if (failure !== null) return <Notice>{failure}</Notice>
  return <Notice>{$t('Chargement de la documentation…')}</Notice>
}
