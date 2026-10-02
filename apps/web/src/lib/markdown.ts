/**
 * Parser for the closed Markdown subset of the readable documentation — chapter 08 §9.4.
 *
 * The generator (`packages/core/src/catalog/documentation.ts`) emits a small subset and this
 * file understands exactly that: `###`/`####` headings, paragraphs, `-` lists nested by two
 * spaces, GFM tables, `> [!KIND]` callouts, fenced blocks with an info string, and inline
 * `code` and **bold**. Anything else is kept as text, which is the safe outcome.
 *
 * It produces a small tree and NEVER HTML. The renderer turns that tree into React elements,
 * and every string in it ends up as a React text node, which React escapes itself.
 *
 * That is why this parser UNDOES the escaping the generator applied (`escapeLabel`: HTML
 * entities such as `&lt;`, and backslash escapes such as `\*`). That escaping protects
 * viewers that interpret HTML; here the protection comes from React, and showing `&lt;img`
 * to the reader would be the bug, not the safety. Code spans and fenced blocks are the
 * exception: the generator writes them verbatim, so they are shown verbatim.
 *
 * No imports, on purpose: it runs as-is under Node, which is how it is checked against a
 * real payload.
 */

// ── Tree ──────────────────────────────────────────────────────────────────────────────

export type CalloutKind = 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING'

export type Inline =
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'code'; readonly value: string }
  | { readonly type: 'bold'; readonly children: readonly Inline[] }

export interface ListItem {
  /** Raw inline source: the renderer parses it, so a cell and an item share one path. */
  readonly text: string
  readonly children: readonly ListItem[]
}

export interface CodeBlock {
  /** The language as written in the info string, lower-cased; empty when there is none. */
  readonly lang: string
  /** The `title="…"` of the info string: what labels the block's tab. */
  readonly title: string | undefined
  /** Verbatim: never unescaped, never trimmed. */
  readonly body: string
}

export type Align = 'left' | 'center' | 'right'

export type Block =
  | {
      readonly type: 'heading'
      readonly level: 3 | 4
      /** Raw inline source, for rendering. */
      readonly raw: string
      /** What the reader sees, without markup: the TOC label and the source of the slug. */
      readonly text: string
      readonly id: string
    }
  | { readonly type: 'paragraph'; readonly text: string }
  | { readonly type: 'list'; readonly items: readonly ListItem[] }
  | {
      readonly type: 'table'
      readonly header: readonly string[]
      readonly align: readonly (Align | undefined)[]
      readonly rows: readonly (readonly string[])[]
    }
  | { readonly type: 'callout'; readonly kind: CalloutKind; readonly blocks: readonly Block[] }
  | { readonly type: 'quote'; readonly blocks: readonly Block[] }
  /** Consecutive fences: ONE group, drawn as tabs when there are several. */
  | { readonly type: 'codegroup'; readonly blocks: readonly CodeBlock[] }

export interface Heading {
  readonly id: string
  readonly text: string
  readonly level: 3 | 4
}

// ── Text: undoing the generator's escaping ────────────────────────────────────────────

const ENTITY_CHAR: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  amp: '&',
  '#39': "'",
}

/** ASCII punctuation: what a backslash may escape, as in CommonMark. */
const ESCAPABLE = /[!-/:-@[-`{-~]/

/**
 * The escaped form back to the label the user typed — for a title, which is not Markdown.
 *
 * ONE pass, left to right: `&amp;lt;` must give the text `&lt;`, and a second pass over the
 * result of the first would turn it into `<`.
 */
export function unescapeText(text: string): string {
  return text.replace(
    /\\([!-/:-@[-`{-~])|&(lt|gt|quot|apos|amp|#39);/g,
    (_, escaped: string | undefined, entity: string | undefined) =>
      escaped ?? ENTITY_CHAR[entity ?? ''] ?? '',
  )
}

// ── Inline ────────────────────────────────────────────────────────────────────────────

/** Length of the run of backticks that starts at `at`. */
function runLength(text: string, at: number): number {
  let end = at
  while (text[end] === '`') end += 1
  return end - at
}

/** Start of the next run of EXACTLY `length` backticks, from `from`; -1 when there is none. */
function findRun(text: string, from: number, length: number): number {
  let at = from
  while (at < text.length) {
    if (text[at] !== '`') {
      at += 1
      continue
    }
    const run = runLength(text, at)
    if (run === length) return at
    at += run
  }
  return -1
}

/** Where the `**` that closes a bold span is; code spans and escapes are stepped over. */
function findBoldEnd(text: string, from: number): number {
  let at = from
  while (at < text.length) {
    const char = text[at]
    if (char === '\\') {
      at += 2
    } else if (char === '`') {
      const run = runLength(text, at)
      const close = findRun(text, at + run, run)
      at = close === -1 ? at + run : close + run
    } else if (char === '*' && text[at + 1] === '*') {
      return at
    } else {
      at += 1
    }
  }
  return -1
}

/**
 * Splits a line into text, `code` and **bold**.
 *
 * `inTable` is GFM's one special case: inside a table, a code span may carry `\|` for a pipe
 * that would otherwise end the cell, and the backslash is not part of the code.
 */
export function parseInline(text: string, inTable = false): Inline[] {
  const out: Inline[] = []
  let buffer = ''
  const flush = () => {
    if (buffer === '') return
    out.push({ type: 'text', value: buffer })
    buffer = ''
  }

  let at = 0
  while (at < text.length) {
    const char = text[at] as string

    if (char === '\\' && at + 1 < text.length && ESCAPABLE.test(text[at + 1] as string)) {
      buffer += text[at + 1]
      at += 2
      continue
    }

    if (char === '&') {
      const entity = /^&(lt|gt|quot|apos|amp|#39);/.exec(text.slice(at, at + 7))
      if (entity !== null) {
        buffer += ENTITY_CHAR[entity[1] as string]
        at += entity[0].length
        continue
      }
    }

    if (char === '`') {
      const run = runLength(text, at)
      const close = findRun(text, at + run, run)
      if (close === -1) {
        // An unclosed backtick is a backtick.
        buffer += text.slice(at, at + run)
        at += run
        continue
      }
      flush()
      const value = text.slice(at + run, close)
      out.push({ type: 'code', value: inTable ? value.replace(/\\\|/g, '|') : value })
      at = close + run
      continue
    }

    if (char === '*' && text[at + 1] === '*') {
      const close = findBoldEnd(text, at + 2)
      if (close > at + 2) {
        flush()
        out.push({ type: 'bold', children: parseInline(text.slice(at + 2, close), inTable) })
        at = close + 2
        continue
      }
    }

    buffer += char
    at += 1
  }

  flush()
  return out
}

/** The text of an inline run without its markup. */
export function inlineToText(nodes: readonly Inline[]): string {
  let out = ''
  for (const node of nodes) out += node.type === 'bold' ? inlineToText(node.children) : node.value
  return out
}

// ── Slugs ─────────────────────────────────────────────────────────────────────────────

/** A stable anchor: accents folded, lower case, hyphens between runs of anything else. */
export function slugify(text: string): string {
  const slug = text
    .normalize('NFD')
    // `\p{M}`: the combining marks NFD splits the accents into.
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug === '' ? 'section' : slug
}

/** A slug that no earlier heading of the same document has taken. */
function uniqueSlug(text: string, seen: Map<string, number>): string {
  const slug = slugify(text)
  const count = (seen.get(slug) ?? 0) + 1
  seen.set(slug, count)
  return count === 1 ? slug : `${slug}-${count}`
}

// ── Blocks ────────────────────────────────────────────────────────────────────────────

const FENCE = /^(`{3,})[ \t]*(.*)$/
const HEADING = /^(#{3,4}) +(.+?)[ \t]*$/
const BULLET = /^( *)- +(.*)$/
const CALLOUT_MARK = /^\[!(NOTE|TIP|IMPORTANT|WARNING)\][ \t]*$/i
const TABLE_RULE = /^\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)*\|?$/

/**
 * The cells of a table row.
 *
 * A pipe ends a cell unless a backslash escapes it — and the escaped pair is consumed as a
 * PAIR, so that `\\|` (an escaped backslash, then a real pipe) splits where it should. The
 * cell keeps its escapes: the inline parser undoes them, like anywhere else.
 */
function splitRow(line: string): string[] {
  const text = line.trim()
  const cells: string[] = []
  let cell = ''
  let at = text.startsWith('|') ? 1 : 0

  while (at < text.length) {
    const char = text[at] as string
    if (char === '\\' && at + 1 < text.length) {
      cell += char + text[at + 1]
      at += 2
    } else if (char === '|') {
      cells.push(cell.trim())
      cell = ''
      at += 1
    } else {
      cell += char
      at += 1
    }
  }
  // A row that ends with its closing pipe has nothing left over; one that does not has a
  // last cell.
  if (cell.trim() !== '') cells.push(cell.trim())
  return cells
}

function alignOf(cell: string): Align | undefined {
  const left = cell.startsWith(':')
  const right = cell.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  return left ? 'left' : undefined
}

/** Does line `at` begin something other than a paragraph? */
function startsBlock(lines: readonly string[], at: number): boolean {
  const line = lines[at] as string
  if (FENCE.test(line) || HEADING.test(line) || line.startsWith('>') || /^- /.test(line)) {
    return true
  }
  const next = lines[at + 1]
  return line.trimStart().startsWith('|') && next !== undefined && TABLE_RULE.test(next.trim())
}

interface Draft {
  readonly indent: number
  text: string
  readonly children: Draft[]
}

/** Bullets nested by indentation; an indented line that is no bullet continues the last one. */
function parseList(lines: readonly string[]): ListItem[] {
  const roots: Draft[] = []
  const stack: Draft[] = []

  for (const line of lines) {
    const bullet = BULLET.exec(line)
    if (bullet === null) {
      const last = stack[stack.length - 1]
      if (last !== undefined) last.text += ` ${line.trim()}`
      continue
    }

    const item: Draft = {
      indent: (bullet[1] as string).length,
      text: bullet[2] as string,
      children: [],
    }
    while (stack.length > 0 && (stack[stack.length - 1] as Draft).indent >= item.indent) stack.pop()
    const parent = stack[stack.length - 1]
    if (parent === undefined) roots.push(item)
    else parent.children.push(item)
    stack.push(item)
  }

  return roots
}

function parseBlocks(lines: readonly string[], seen: Map<string, number>): Block[] {
  const blocks: Block[] = []
  // Blank lines between fences do NOT end the group; any other block does.
  let fences: CodeBlock[] = []
  const endGroup = () => {
    if (fences.length === 0) return
    blocks.push({ type: 'codegroup', blocks: fences })
    fences = []
  }

  let at = 0
  while (at < lines.length) {
    const line = lines[at] as string

    if (line.trim() === '') {
      at += 1
      continue
    }

    const fence = FENCE.exec(line)
    if (fence !== null) {
      const ticks = (fence[1] as string).length
      const info = fence[2] as string
      const body: string[] = []
      at += 1
      // An unclosed fence runs to the end of the document, as in CommonMark.
      while (at < lines.length) {
        const candidate = (lines[at] as string).trim()
        if (/^`{3,}$/.test(candidate) && candidate.length >= ticks) break
        body.push(lines[at] as string)
        at += 1
      }
      at += 1
      fences.push({
        lang: (/^[^\s{]*/.exec(info)?.[0] ?? '').toLowerCase(),
        title: /\btitle="([^"]*)"/.exec(info)?.[1],
        body: body.join('\n'),
      })
      continue
    }

    endGroup()

    const heading = HEADING.exec(line)
    if (heading !== null) {
      const raw = heading[2] as string
      const text = inlineToText(parseInline(raw))
      blocks.push({
        type: 'heading',
        level: (heading[1] as string).length === 3 ? 3 : 4,
        raw,
        text,
        id: uniqueSlug(text, seen),
      })
      at += 1
      continue
    }

    if (line.startsWith('>')) {
      const inner: string[] = []
      while (at < lines.length && (lines[at] as string).startsWith('>')) {
        inner.push((lines[at] as string).replace(/^>[ \t]?/, ''))
        at += 1
      }
      const mark = CALLOUT_MARK.exec(inner[0] ?? '')
      if (mark === null) {
        blocks.push({ type: 'quote', blocks: parseBlocks(inner, seen) })
      } else {
        blocks.push({
          type: 'callout',
          kind: (mark[1] as string).toUpperCase() as CalloutKind,
          blocks: parseBlocks(inner.slice(1), seen),
        })
      }
      continue
    }

    const rule = lines[at + 1]
    if (line.trimStart().startsWith('|') && rule !== undefined && TABLE_RULE.test(rule.trim())) {
      const header = splitRow(line)
      const align = splitRow(rule).map(alignOf)
      const rows: string[][] = []
      at += 2
      while (at < lines.length && (lines[at] as string).trimStart().startsWith('|')) {
        // A short row is padded and a long one is cut, as GFM does: the grid stays a grid.
        const cells = splitRow(lines[at] as string).slice(0, header.length)
        while (cells.length < header.length) cells.push('')
        rows.push(cells)
        at += 1
      }
      blocks.push({ type: 'table', header, align, rows })
      continue
    }

    if (BULLET.test(line)) {
      const items: string[] = []
      while (at < lines.length) {
        const candidate = lines[at] as string
        if (candidate.trim() === '' || !(BULLET.test(candidate) || /^\s/.test(candidate))) break
        items.push(candidate)
        at += 1
      }
      blocks.push({ type: 'list', items: parseList(items) })
      continue
    }

    // A paragraph. Its first line is always taken — even one that looked like a block and
    // failed to be one, such as a `|` line with no rule under it — so the loop advances.
    const text: string[] = [line.trim()]
    at += 1
    while (at < lines.length && (lines[at] as string).trim() !== '' && !startsBlock(lines, at)) {
      text.push((lines[at] as string).trim())
      at += 1
    }
    blocks.push({ type: 'paragraph', text: text.join(' ') })
  }

  endGroup()
  return blocks
}

/** Parses a document of the subset. Headings get ids that are unique within it. */
export function parseMarkdown(source: string): Block[] {
  return parseBlocks(source.split(/\r?\n/), new Map())
}

/**
 * The `###` and `####` headings of a document — id and text — for a table of contents.
 *
 * The ids are the ones `parseMarkdown` gives the rendered headings, so a link built from
 * them lands on the heading it names. A `###` inside a fenced block is code, not a heading.
 */
export function headings(source: string): Heading[] {
  const found: Heading[] = []
  for (const block of parseMarkdown(source)) {
    if (block.type === 'heading') found.push({ id: block.id, text: block.text, level: block.level })
  }
  return found
}
