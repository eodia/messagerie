'use client'

import { CodeGroup } from '@/components/api-reference/code-block'
import { $t } from '@/lib/i18n'
import {
  type Align,
  type Block,
  type CalloutKind,
  type Inline,
  type ListItem,
  parseInline,
  parseMarkdown,
} from '@/lib/markdown'
import { cn } from '@/lib/utils'
import { Info, Lightbulb, type LucideIcon, OctagonAlert, TriangleAlert } from 'lucide-react'
import { Fragment, type ReactNode, memo, useMemo } from 'react'

export { headings, slugify, unescapeText } from '@/lib/markdown'

/**
 * Renderer for the documentation of chapter 08 §9.4.
 *
 * It draws the closed subset the generator emits — see `lib/markdown.ts`, which parses it —
 * and NOTHING else. An unknown construct is shown as text, which is the safe outcome.
 *
 * It never uses `dangerouslySetInnerHTML`: every fragment below becomes a React text node,
 * and React escapes those. That is why the parser UNDOES the escaping the generator applied
 * — that escaping protects viewers which interpret HTML, and here the protection comes from
 * React itself. Showing `&lt;img` to the reader would be the bug, not the safety.
 */

export interface MarkdownProps {
  readonly source: string
  /**
   * Turns on heading anchors: each heading gets the id `idPrefix + slug` — the same slug
   * `headings()` returns — and a link to itself.
   */
  readonly idPrefix?: string
  /**
   * Called with a heading's DOM id when its anchor is followed. Without it the anchor is a
   * plain `#fragment` link; a page that scrolls inside its own container wants to do the
   * scrolling itself, so the browser does not move the wrong ancestor.
   */
  readonly onAnchor?: (id: string) => void
  readonly className?: string
}

interface Context {
  readonly idPrefix: string | undefined
  readonly onAnchor: ((id: string) => void) | undefined
}

/**
 * Positions in a parsed document ARE identities: the tree is derived from an immutable
 * source and never reordered while it is drawn. Pairing them up front keeps the index out
 * of the render callbacks, where it would read as the array-index key it is not.
 */
function positions<T>(items: readonly T[]): ReadonlyArray<readonly [string, T]> {
  return items.map((item, index) => [String(index), item] as const)
}

// ── Method badges ─────────────────────────────────────────────────────────────────────

const METHOD_TONE: Readonly<Record<string, string>> = {
  GET: 'bg-sky-500/10 text-sky-700 ring-sky-500/25 dark:text-sky-300',
  POST: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300',
  PATCH: 'bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-300',
  PUT: 'bg-violet-500/10 text-violet-700 ring-violet-500/25 dark:text-violet-300',
  DELETE: 'bg-rose-500/10 text-rose-700 ring-rose-500/25 dark:text-rose-300',
}

/** Just the verb's colour, for a verb that sits inside a longer piece of code. */
const METHOD_TEXT: Readonly<Record<string, string>> = {
  GET: 'text-sky-700 dark:text-sky-300',
  POST: 'text-emerald-700 dark:text-emerald-300',
  PATCH: 'text-amber-700 dark:text-amber-300',
  PUT: 'text-violet-700 dark:text-violet-300',
  DELETE: 'text-rose-700 dark:text-rose-300',
}

function MethodBadge({ method }: { readonly method: string }) {
  return (
    <span
      className={cn(
        'inline-flex min-w-[3.75rem] items-center justify-center rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wide ring-1 ring-inset',
        METHOD_TONE[method],
      )}
    >
      {method}
    </span>
  )
}

/** A cell that is exactly `` `GET` `` (or another verb) is drawn as a badge. */
const METHOD_CELL = /^`(GET|POST|PATCH|PUT|DELETE)`$/

/** Inline code that opens with a verb and a path: `GET /api/…`. */
const METHOD_CODE = /^(GET|POST|PATCH|PUT|DELETE) (\/\S*)$/

// ── Inline ────────────────────────────────────────────────────────────────────────────

/**
 * A break opportunity after each slash.
 *
 * A route is long and has no spaces, so without help a table column either overflows or
 * breaks it in the middle of a word. At a slash is where a path reads best when it has to
 * wrap — and an identifier, which has no slash, never breaks at all.
 */
function Breakable({ value }: { readonly value: string }) {
  if (!value.includes('/')) return value
  return positions(value.split(/(?<=\/)/)).map(([key, part]) => (
    <Fragment key={key}>
      {part}
      <wbr />
    </Fragment>
  ))
}

/** Code this short is one word to the eye: `2026-09-18` must not wrap at its hyphens. */
const ATOMIC_CODE_LENGTH = 28

function InlineCode({ value }: { readonly value: string }) {
  const verb = METHOD_CODE.exec(value)
  return (
    // `break-words`, not `anywhere`: the latter also shrinks the box's minimum width, which
    // lets a table squeeze an identifier down to one letter per line.
    <code
      className={cn(
        'box-decoration-clone break-words rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em] font-medium text-foreground ring-1 ring-inset ring-border',
        value.length <= ATOMIC_CODE_LENGTH && 'whitespace-nowrap',
      )}
    >
      {verb === null ? (
        <Breakable value={value} />
      ) : (
        <>
          <span className={cn('font-semibold', METHOD_TEXT[verb[1] as string])}>{verb[1]}</span>{' '}
          <Breakable value={verb[2] as string} />
        </>
      )}
    </code>
  )
}

function InlineView({ nodes }: { readonly nodes: readonly Inline[] }) {
  return positions(nodes).map(([key, node]) => {
    if (node.type === 'text') return node.value
    if (node.type === 'code') return <InlineCode key={key} value={node.value} />
    return (
      <strong key={key} className="font-semibold text-foreground">
        <InlineView nodes={node.children} />
      </strong>
    )
  })
}

// ── Blocks ────────────────────────────────────────────────────────────────────────────

const CALLOUTS: Readonly<
  Record<CalloutKind, { title: string; icon: LucideIcon; box: string; accent: string }>
> = {
  NOTE: {
    title: $t('Note||encadré de texte'),
    icon: Info,
    box: 'border-sky-500 bg-sky-500/10',
    accent: 'text-sky-700 dark:text-sky-300',
  },
  TIP: {
    title: $t('Astuce'),
    icon: Lightbulb,
    box: 'border-emerald-500 bg-emerald-500/10',
    accent: 'text-emerald-700 dark:text-emerald-300',
  },
  IMPORTANT: {
    title: $t('Important'),
    icon: OctagonAlert,
    box: 'border-violet-500 bg-violet-500/10',
    accent: 'text-violet-700 dark:text-violet-300',
  },
  WARNING: {
    title: $t('Attention'),
    icon: TriangleAlert,
    box: 'border-amber-500 bg-amber-500/10',
    accent: 'text-amber-700 dark:text-amber-300',
  },
}

function Callout({
  kind,
  blocks,
  context,
}: {
  readonly kind: CalloutKind
  readonly blocks: readonly Block[]
  readonly context: Context
}) {
  const tone = CALLOUTS[kind]
  const Icon = tone.icon
  return (
    <div
      role="note"
      className={cn('my-6 flex gap-3 rounded-r-lg border-l-[3px] px-4 py-3.5 text-sm', tone.box)}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', tone.accent)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={cn('mb-1 text-[13px] font-semibold', tone.accent)}>{tone.title}</p>
        <div className="leading-6 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-2">
          <Blocks blocks={blocks} context={context} />
        </div>
      </div>
    </div>
  )
}

const ALIGN: Readonly<Record<Align, string>> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
}

function Table({ block }: { readonly block: Extract<Block, { type: 'table' }> }) {
  return (
    // The wrapper scrolls, not the page: a wide table keeps its columns and stays inside
    // the article.
    <div className="scroll-discret my-6 overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-muted/50">
          <tr className="border-b">
            {positions(block.header).map(([key, cell]) => (
              <th
                key={key}
                scope="col"
                className={cn(
                  'whitespace-nowrap px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground',
                  ALIGN[block.align[Number(key)] ?? 'left'],
                )}
              >
                <InlineView nodes={parseInline(cell, true)} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {positions(block.rows).map(([rowKey, row]) => (
            <tr key={rowKey} className="align-top">
              {positions(row).map(([key, cell]) => {
                const method = METHOD_CELL.exec(cell.trim())
                return (
                  <td
                    key={key}
                    className={cn('px-4 py-2.5', ALIGN[block.align[Number(key)] ?? 'left'])}
                  >
                    {method === null ? (
                      <InlineView nodes={parseInline(cell, true)} />
                    ) : (
                      <MethodBadge method={method[1] as string} />
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function List({
  items,
  nested = false,
}: { readonly items: readonly ListItem[]; nested?: boolean }) {
  return (
    <ul
      className={cn(
        'space-y-2 pl-6 marker:text-muted-foreground',
        nested ? 'mt-2 list-[circle]' : 'my-4 list-disc',
      )}
    >
      {positions(items).map(([key, item]) => (
        <li key={key} className="pl-1">
          <InlineView nodes={parseInline(item.text)} />
          {item.children.length > 0 && <List items={item.children} nested />}
        </li>
      ))}
    </ul>
  )
}

function Heading({
  block,
  context,
}: {
  readonly block: Extract<Block, { type: 'heading' }>
  readonly context: Context
}) {
  // The page's own title is the `h1`, so the generator's `###` is the next level down.
  const Tag = block.level === 3 ? 'h2' : 'h3'
  const id = context.idPrefix === undefined ? undefined : `${context.idPrefix}${block.id}`

  return (
    <Tag
      id={id}
      className={cn(
        'group scroll-mt-6 font-semibold tracking-tight text-foreground',
        block.level === 3 ? 'mt-12 mb-4 text-xl' : 'mt-8 mb-3 text-base',
      )}
    >
      <InlineView nodes={parseInline(block.raw)} />
      {id !== undefined && (
        <a
          href={`#${id}`}
          onClick={(event) => {
            if (context.onAnchor === undefined) return
            event.preventDefault()
            context.onAnchor(id)
          }}
          aria-label={$t('Lien vers « {text} »', { text: block.text })}
          className="ml-2 font-normal text-muted-foreground no-underline opacity-0 transition-opacity hover:text-primary focus-visible:opacity-100 group-hover:opacity-100"
        >
          #
        </a>
      )}
    </Tag>
  )
}

function BlockView({ block, context }: { readonly block: Block; readonly context: Context }) {
  switch (block.type) {
    case 'heading':
      return <Heading block={block} context={context} />
    case 'paragraph':
      return (
        <p className="my-4 text-pretty">
          <InlineView nodes={parseInline(block.text)} />
        </p>
      )
    case 'list':
      return <List items={block.items} />
    case 'table':
      return <Table block={block} />
    case 'callout':
      return <Callout kind={block.kind} blocks={block.blocks} context={context} />
    case 'quote':
      return (
        <blockquote className="my-5 border-l-2 pl-4 text-muted-foreground">
          <Blocks blocks={block.blocks} context={context} />
        </blockquote>
      )
    case 'codegroup':
      return <CodeGroup blocks={block.blocks} />
  }
}

function Blocks({
  blocks,
  context,
}: {
  readonly blocks: readonly Block[]
  readonly context: Context
}): ReactNode {
  return positions(blocks).map(([key, block]) => (
    <BlockView key={key} block={block} context={context} />
  ))
}

export const Markdown = memo(function Markdown({
  source,
  idPrefix,
  onAnchor,
  className,
}: MarkdownProps) {
  const blocks = useMemo(() => parseMarkdown(source), [source])
  const context = useMemo(() => ({ idPrefix, onAnchor }), [idPrefix, onAnchor])

  return (
    <div
      className={cn(
        'text-[15px] leading-7 text-foreground/85 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        className,
      )}
    >
      <Blocks blocks={blocks} context={context} />
    </div>
  )
})
