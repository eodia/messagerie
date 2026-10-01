'use client'

import { type Inline, parseBlocks } from '@/lib/rich-text'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

/**
 * A message's text as the widget shows it to the visitor: its little Markdown turned into
 * elements, never into HTML. A link opens elsewhere, and only http(s) or mailto.
 */
export function RichText({
  text,
  className,
}: { readonly text: string; readonly className?: string }) {
  return (
    <div className={cn('rich-text', className)}>
      {parseBlocks(text).map((block, index) =>
        block.kind === 'paragraph' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the blocks of one message, in order
          <p key={index}>
            {block.lines.map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the lines of one paragraph, in order
              <span key={i}>
                {i > 0 && <br />}
                {inline(line)}
              </span>
            ))}
          </p>
        ) : block.ordered ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the blocks of one message, in order
          <ol key={index}>{items(block.items)}</ol>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: the blocks of one message, in order
          <ul key={index}>{items(block.items)}</ul>
        ),
      )}
    </div>
  )
}

const items = (list: readonly (readonly Inline[])[]) =>
  // biome-ignore lint/suspicious/noArrayIndexKey: the items of one list, in order
  list.map((item, i) => <li key={i}>{inline(item)}</li>)

function inline(parts: readonly Inline[]): ReactNode[] {
  return parts.map((part, i) => {
    switch (part.kind) {
      case 'text':
        // biome-ignore lint/suspicious/noArrayIndexKey: the runs of one line, in order
        return <span key={i}>{part.text}</span>
      case 'code':
        // biome-ignore lint/suspicious/noArrayIndexKey: the runs of one line, in order
        return <code key={i}>{part.text}</code>
      case 'bold':
        // biome-ignore lint/suspicious/noArrayIndexKey: the runs of one line, in order
        return <strong key={i}>{inline(part.children)}</strong>
      case 'italic':
        // biome-ignore lint/suspicious/noArrayIndexKey: the runs of one line, in order
        return <em key={i}>{inline(part.children)}</em>
      case 'bolditalic':
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: the runs of one line, in order
          <strong key={i}>
            <em>{inline(part.children)}</em>
          </strong>
        )
      case 'strike':
        // biome-ignore lint/suspicious/noArrayIndexKey: the runs of one line, in order
        return <s key={i}>{inline(part.children)}</s>
      case 'link':
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: the runs of one line, in order
          <a key={i} href={part.href} target="_blank" rel="noopener noreferrer">
            {inline(part.children)}
          </a>
        )
    }
  })
}
