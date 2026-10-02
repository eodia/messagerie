'use client'

import {
  type Token,
  type TokenKind,
  highlight,
  labelFor,
} from '@/components/api-reference/highlight'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { $t } from '@/lib/i18n'
import type { CodeBlock } from '@/lib/markdown'
import { cn } from '@/lib/utils'
import { Check, Copy } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Fenced code, as the documentation shows it — chapter 08 §9.4.
 *
 * The surface is dark in BOTH themes, like the code blocks of every documentation site worth
 * imitating: a snippet reads as a snippet, and one palette serves the two. What varies with
 * the theme is only how deep the surface sits against the page (`--code`).
 *
 * Consecutive fences arrive here as ONE group. A lone block gets a label; several get tabs,
 * named by their titles — the same call in cURL and in JavaScript, one click apart.
 */

const TONE: Readonly<Record<TokenKind, string>> = {
  string: 'text-syn-string',
  number: 'text-syn-number',
  keyword: 'text-syn-keyword',
  comment: 'text-syn-comment italic',
  property: 'text-syn-property',
  function: 'text-syn-function',
  punct: 'text-code-foreground/55',
}

/** How long "Copié" stays on the button before it goes back to "Copier". */
const FEEDBACK_MS = 1600

/**
 * Puts text on the clipboard; false when nothing worked.
 *
 * The asynchronous API needs a secure context and a permission the page may not have — an
 * intranet served over plain HTTP is the ordinary case for this product — so the old
 * `execCommand` path is kept as the way out rather than failing silently.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard !== undefined) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Refused: fall through to the selection-based copy.
  }

  const area = document.createElement('textarea')
  try {
    area.value = text
    area.setAttribute('readonly', '')
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
    document.body.appendChild(area)
    area.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
  }
}

function CopyButton({ text }: { readonly text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // A timer that outlives the button would set state on a component that is gone.
  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = async () => {
    setState((await copyText(text)) ? 'copied' : 'failed')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), FEEDBACK_MS)
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={$t('Copier le code')}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors',
        'text-code-foreground/65 hover:bg-code-foreground/10 hover:text-code-foreground',
        state === 'copied' && 'text-syn-string hover:text-syn-string',
        state === 'failed' && 'text-syn-number hover:text-syn-number',
      )}
    >
      {state === 'copied' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {/* Announced, not just drawn: the label change is the only feedback there is. */}
      <span aria-live="polite">
        {state === 'copied' ? $t('Copié') : state === 'failed' ? $t('Non copié') : $t('Copier')}
      </span>
    </button>
  )
}

function Highlighted({ tokens }: { readonly tokens: readonly Token[] }) {
  // A token list is derived from the source and never reordered, so its position is its
  // identity — hence the counter rather than a callback index.
  let position = 0
  return tokens.map((token) => {
    position += 1
    return token.kind === undefined ? (
      token.text
    ) : (
      <span key={position} className={TONE[token.kind]}>
        {token.text}
      </span>
    )
  })
}

function Snippet({ block }: { readonly block: CodeBlock }) {
  const tokens = useMemo(() => highlight(block.lang, block.body), [block.lang, block.body])
  return (
    <pre className="scroll-discret overflow-x-auto px-4 py-3.5 font-mono text-[13px] leading-6">
      <code>
        <Highlighted tokens={tokens} />
      </code>
    </pre>
  )
}

export function CodeGroup({ blocks }: { readonly blocks: readonly CodeBlock[] }) {
  const [active, setActive] = useState(0)
  const current = blocks[Math.min(active, blocks.length - 1)]
  if (current === undefined) return null

  const header =
    'flex h-10 items-center justify-between gap-3 border-b border-code-border pr-2 pl-4'

  if (blocks.length === 1) {
    return (
      <figure className="my-6 overflow-hidden rounded-lg border border-code-border bg-code text-code-foreground">
        <div className={header}>
          <span className="text-xs font-medium text-code-foreground/65">
            {labelFor(current.lang, current.title)}
          </span>
          <CopyButton text={current.body} />
        </div>
        <Snippet block={current} />
      </figure>
    )
  }

  // The group is a fixed list from one document, never reordered: a block's position is its
  // identity, and the tab value is that position.
  const tabs = blocks.map((block, index) => ({ block, value: String(index) }))

  return (
    <figure className="my-6 overflow-hidden rounded-lg border border-code-border bg-code text-code-foreground">
      <Tabs value={String(active)} onValueChange={(next) => setActive(Number(next))}>
        <div className={header}>
          {/* The kit's tab strip draws a rule and a mark for a light page; on this surface
              the rule moves to the header and the colours follow the code palette. */}
          <TabsList className="h-10 gap-5 border-0">
            {tabs.map(({ block, value }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="text-code-foreground/60 hover:text-code-foreground data-[state=active]:text-code-foreground"
              >
                {labelFor(block.lang, block.title)}
              </TabsTrigger>
            ))}
          </TabsList>
          <CopyButton text={current.body} />
        </div>
        {tabs.map(({ block, value }) => (
          <TabsContent key={value} value={value}>
            <Snippet block={block} />
          </TabsContent>
        ))}
      </Tabs>
    </figure>
  )
}
