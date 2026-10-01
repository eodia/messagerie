import type { JSONContent } from '@tiptap/react'

/**
 * The little Markdown a message uses — the widget's (`apps/widget/src/markdown.tsx`):
 * paragraphs, line breaks, lists, quotes (`> `), **bold**, *italic*, ***both***, ~~struck~~,
 * `code`, [links](https://…) and bare addresses — and two tags Markdown lacks:
 * <u>underlined</u>, <span color="red">coloured</span>, in a few named colours that each
 * reader draws its way. The composer writes it, the inbox and the widget read it. A single
 * line break is a line break, as in a chat — not a space, as in Markdown.
 */

/** The colours a text may take — named, so that each reader draws them on its background. */
export const TEXT_COLORS = ['red', 'orange', 'green', 'blue', 'violet', 'grey'] as const
export type TextColor = (typeof TEXT_COLORS)[number]

export type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'bold' | 'italic' | 'bolditalic' | 'strike' | 'underline'
      readonly children: readonly Inline[]
    }
  | { readonly kind: 'color'; readonly color: TextColor; readonly children: readonly Inline[] }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'link'; readonly href: string; readonly children: readonly Inline[] }

type Lines = readonly (readonly Inline[])[]

export type Block =
  | { readonly kind: 'paragraph'; readonly lines: Lines }
  | { readonly kind: 'quote'; readonly lines: Lines }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly items: Lines }

const INLINE =
  /(<u>[\s\S]+?<\/u>|<span color="(?:red|orange|green|blue|violet|grey)">[\s\S]+?<\/span>|\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|~~[^~]+~~|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s<>()]+[^\s<>().,;:!?])/g

/** Only addresses a click can safely follow. */
export const safeHref = (href: string): string | null =>
  /^(https?:|mailto:)/i.test(href) ? href : null

export function parseInline(text: string): Inline[] {
  const parts: Inline[] = []
  let last = 0
  for (const match of text.matchAll(INLINE)) {
    const token = match[0]
    const at = match.index ?? 0
    if (at > last) parts.push({ kind: 'text', text: text.slice(last, at) })
    if (token.startsWith('<u>'))
      parts.push({ kind: 'underline', children: parseInline(token.slice(3, -4)) })
    else if (token.startsWith('<span')) {
      const [, color = 'grey', inner = ''] =
        /^<span color="(\w+)">([\s\S]*)<\/span>$/.exec(token) ?? []
      parts.push({ kind: 'color', color: color as TextColor, children: parseInline(inner) })
    } else if (token.startsWith('***'))
      parts.push({ kind: 'bolditalic', children: parseInline(token.slice(3, -3)) })
    else if (token.startsWith('**'))
      parts.push({ kind: 'bold', children: parseInline(token.slice(2, -2)) })
    else if (token.startsWith('~~'))
      parts.push({ kind: 'strike', children: parseInline(token.slice(2, -2)) })
    else if (token.startsWith('`')) parts.push({ kind: 'code', text: token.slice(1, -1) })
    else if (token.startsWith('[')) {
      const [, label = '', href = ''] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token) ?? []
      const safe = safeHref(href)
      parts.push(
        safe
          ? { kind: 'link', href: safe, children: parseInline(label) }
          : { kind: 'text', text: label },
      )
    } else if (token.startsWith('http')) {
      parts.push({ kind: 'link', href: token, children: [{ kind: 'text', text: token }] })
    } else parts.push({ kind: 'italic', children: parseInline(token.slice(1, -1)) })
    last = at + token.length
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) })
  return parts
}

/** A quoted line's words — `> ` at its start —, or `null`. */
const quoted = (line: string): string | null => /^\s*>\s?(.*)$/.exec(line)?.[1] ?? null

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let list: { ordered: boolean; items: Inline[][] } | null = null
  let paragraph: Inline[][] = []
  let quote: Inline[][] = []
  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', lines: paragraph })
    paragraph = []
  }
  const flushQuote = () => {
    if (quote.length > 0) blocks.push({ kind: 'quote', lines: quote })
    quote = []
  }
  const flushList = () => {
    if (list) blocks.push({ kind: 'list', ...list })
    list = null
  }
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    const said = quoted(line)
    if (said !== null) {
      flushParagraph()
      flushList()
      quote.push(parseInline(said))
      continue
    }
    flushQuote()
    if (bullet || numbered) {
      flushParagraph()
      const ordered = numbered !== null
      if (!list || list.ordered !== ordered) {
        flushList()
        list = { ordered, items: [] }
      }
      list.items.push(parseInline((bullet ?? numbered)?.[1] ?? ''))
    } else if (line.trim() === '') {
      flushParagraph()
      flushList()
    } else {
      flushList()
      paragraph.push(parseInline(line.replace(/^#{1,6}\s+/, '')))
    }
  }
  flushParagraph()
  flushQuote()
  flushList()
  return blocks
}

// ── For the editor: Markdown in, as the HTML it reads ────────────────────────────────

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function inlineHtml(parts: readonly Inline[]): string {
  return parts
    .map((part) => {
      switch (part.kind) {
        case 'text':
          return escapeHtml(part.text)
        case 'code':
          return `<code>${escapeHtml(part.text)}</code>`
        case 'bold':
          return `<strong>${inlineHtml(part.children)}</strong>`
        case 'italic':
          return `<em>${inlineHtml(part.children)}</em>`
        case 'bolditalic':
          return `<strong><em>${inlineHtml(part.children)}</em></strong>`
        case 'strike':
          return `<s>${inlineHtml(part.children)}</s>`
        case 'underline':
          return `<u>${inlineHtml(part.children)}</u>`
        case 'color':
          return `<span data-color="${part.color}">${inlineHtml(part.children)}</span>`
        case 'link':
          return `<a href="${escapeHtml(part.href)}">${inlineHtml(part.children)}</a>`
      }
    })
    .join('')
}

/**
 * A draft as the editor takes it. Each line is a paragraph of its own — an empty one for a
 * blank line —, so that a draft comes back as it was typed.
 */
export function draftHtml(markdown: string): string {
  const out: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let quote: string[] = []
  const flush = () => {
    if (quote.length > 0) {
      out.push(`<blockquote>${quote.map((q) => `<p>${q}</p>`).join('')}</blockquote>`)
      quote = []
    }
    if (!list) return
    const tag = list.ordered ? 'ol' : 'ul'
    out.push(`<${tag}>${list.items.map((i) => `<li><p>${i}</p></li>`).join('')}</${tag}>`)
    list = null
  }
  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    const said = quoted(line)
    if (said !== null) {
      if (list) flush()
      quote.push(inlineHtml(parseInline(said)))
    } else if (bullet || numbered) {
      if (quote.length > 0) flush()
      const ordered = numbered !== null
      if (!list || list.ordered !== ordered) {
        flush()
        list = { ordered, items: [] }
      }
      list.items.push(inlineHtml(parseInline((bullet ?? numbered)?.[1] ?? '')))
    } else {
      flush()
      out.push(`<p>${inlineHtml(parseInline(line))}</p>`)
    }
  }
  flush()
  return out.join('')
}

// ── From the editor: its document, as Markdown ───────────────────────────────────────

type Mark = NonNullable<JSONContent['marks']>[number]

const has = (marks: readonly Mark[] | undefined, type: string) =>
  marks?.some((m) => m.type === type) ?? false

/** One run of text with its marks — the spaces at its edges kept outside the markers. */
function run(node: JSONContent): string {
  const text = node.text ?? ''
  const [, lead = '', core = '', trail = ''] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text) ?? []
  if (core === '') return text
  const { marks } = node
  let out = core
  if (has(marks, 'code')) out = `\`${out}\``
  else {
    const bold = has(marks, 'bold')
    const italic = has(marks, 'italic')
    if (bold && italic) out = `***${out}***`
    else if (bold) out = `**${out}**`
    else if (italic) out = `*${out}*`
    if (has(marks, 'strike')) out = `~~${out}~~`
  }
  if (has(marks, 'underline')) out = `<u>${out}</u>`
  const color = marks?.find((m) => m.type === 'textColor')?.attrs?.color as string | undefined
  if (color && (TEXT_COLORS as readonly string[]).includes(color)) {
    out = `<span color="${color}">${out}</span>`
  }
  return `${lead}${out}${trail}`
}

/** A line's inline content: runs, links around theirs, hard breaks as line breaks. */
function inlineMarkdown(nodes: readonly JSONContent[] | undefined): string {
  let out = ''
  let link: { href: string; text: string } | null = null
  const close = () => {
    if (link) out += safeHref(link.href) ? `[${link.text}](${link.href})` : link.text
    link = null
  }
  for (const node of nodes ?? []) {
    if (node.type === 'hardBreak') {
      close()
      out += '\n'
      continue
    }
    if (node.type !== 'text') continue
    const href = node.marks?.find((m) => m.type === 'link')?.attrs?.href as string | undefined
    if (href && link?.href === href) {
      link.text += run(node)
      continue
    }
    close()
    if (href) {
      // A bare address typed as such stays bare.
      if (node.text === href) out += href
      else link = { href, text: run(node) }
    } else out += run(node)
  }
  close()
  return out
}

function blockMarkdown(node: JSONContent): string[] {
  if (node.type === 'paragraph') return [inlineMarkdown(node.content)]
  if (node.type === 'blockquote') {
    return (node.content ?? [])
      .flatMap(blockMarkdown)
      .flatMap((line) => line.split('\n'))
      .map((line) => `> ${line}`)
  }
  if (node.type === 'bulletList' || node.type === 'orderedList') {
    return (node.content ?? []).map((item, index) => {
      const text = (item.content ?? []).flatMap(blockMarkdown).join(' ').replace(/\n/g, ' ')
      return `${node.type === 'orderedList' ? `${index + 1}.` : '-'} ${text}`
    })
  }
  return (node.content ?? []).flatMap(blockMarkdown)
}

/** The editor's document as the message's text — a line per paragraph. */
export function draftMarkdown(doc: JSONContent): string {
  return (doc.content ?? []).flatMap(blockMarkdown).join('\n').replace(/\s+$/, '')
}

/** The words alone, the markers gone — for a one-line preview. */
export function plainOf(markdown: string): string {
  return markdown
    .replace(/<\/?u>|<span color="\w+">|<\/span>/g, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1')
    .replace(/(\*\*\*|\*\*|~~|`)(.+?)\1/g, '$2')
    .replace(/\*([^*\s][^*]*)\*/g, '$1')
    .replace(/^\s*[-*•]\s+/gm, '')
}
