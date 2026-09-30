import type { ComponentChildren } from 'preact'

/**
 * The little Markdown an answer uses — paragraphs, lists, **bold**, *italic*, `code`,
 * links — turned into elements, never into HTML: nothing a message says can become markup
 * in the host page. A link opens elsewhere, and only http(s) or mailto.
 */

const INLINE =
  /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s<>()]+[^\s<>().,;:!?])/g

function safeHref(href: string): string | null {
  return /^(https?:|mailto:)/i.test(href) ? href : null
}

function inline(text: string): ComponentChildren[] {
  const parts: ComponentChildren[] = []
  let last = 0
  for (const match of text.matchAll(INLINE)) {
    const token = match[0]
    const at = match.index ?? 0
    if (at > last) parts.push(text.slice(last, at))
    if (token.startsWith('**')) parts.push(<strong>{token.slice(2, -2)}</strong>)
    else if (token.startsWith('`')) parts.push(<code>{token.slice(1, -1)}</code>)
    else if (token.startsWith('[')) {
      const [, label = '', href = ''] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token) ?? []
      const safe = safeHref(href)
      parts.push(
        safe ? (
          <a href={safe} target="_blank" rel="noopener noreferrer">
            {label}
          </a>
        ) : (
          label
        ),
      )
    } else if (token.startsWith('http')) {
      parts.push(
        <a href={token} target="_blank" rel="noopener noreferrer">
          {token.replace(/^https?:\/\//, '')}
        </a>,
      )
    } else parts.push(<em>{token.slice(1, -1)}</em>)
    last = at + token.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

export function Markdown({ text }: { readonly text: string }) {
  const blocks: ComponentChildren[] = []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let list: { ordered: boolean; items: string[] } | null = null
  let paragraph: string[] = []

  // Built by pushing, never reordered: a message's blocks and lines need no keys.
  const flushParagraph = () => {
    if (paragraph.length === 0) return
    const children: ComponentChildren[] = []
    for (const line of paragraph) {
      if (children.length > 0) children.push(<br />)
      children.push(...inline(line))
    }
    blocks.push(<p>{children}</p>)
    paragraph = []
  }
  const flushList = () => {
    if (!list) return
    const items: ComponentChildren[] = []
    for (const item of list.items) items.push(<li>{inline(item)}</li>)
    blocks.push(list.ordered ? <ol>{items}</ol> : <ul>{items}</ul>)
    list = null
  }

  for (const line of lines) {
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (bullet || numbered) {
      flushParagraph()
      const ordered = numbered !== null
      if (!list || list.ordered !== ordered) {
        flushList()
        list = { ordered, items: [] }
      }
      list.items.push((bullet ?? numbered)?.[1] ?? '')
    } else if (line.trim() === '') {
      flushParagraph()
      flushList()
    } else {
      flushList()
      paragraph.push(line.replace(/^#{1,6}\s+/, ''))
    }
  }
  flushParagraph()
  flushList()
  return <div class="md">{blocks}</div>
}
