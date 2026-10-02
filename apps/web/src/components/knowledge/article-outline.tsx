'use client'

import { $t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { Editor } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'

/**
 * An article's outline, as Notion draws it: a dash per heading, stacked in the margin —
 * shorter for a sub-heading, darker for the section one is reading. On hover, the
 * headings themselves; a click scrolls to one. Shown from two headings on: with one, there
 * is nothing to find.
 */

interface Heading {
  readonly level: number
  readonly text: string
  readonly pos: number
}

function headingsOf(editor: Editor): Heading[] {
  const found: Heading[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      found.push({ level: Number(node.attrs.level) || 2, text: node.textContent.trim(), pos })
      return false
    }
    return true
  })
  return found.filter((h) => h.text !== '')
}

/** The element that scrolls the article: the closest ancestor that can. */
function scrollerOf(element: HTMLElement): HTMLElement | null {
  for (let at = element.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at)
    if (overflowY === 'auto' || overflowY === 'scroll') return at
  }
  return null
}

/** What sits on top of the article as it scrolls: the toolbar, when it is there. */
const READING_LINE = 96

export function ArticleOutline({ editor }: { readonly editor: Editor }) {
  // The editor re-renders this on each transaction: the headings are read afresh.
  const headings = headingsOf(editor)
  const [current, setCurrent] = useState(0)
  /** The heading clicked: it stays the current one until the reader scrolls by hand. */
  const chosen = useRef<number | null>(null)
  const key = headings.map((h) => h.pos).join(',')

  useEffect(() => {
    void key
    const scroller = scrollerOf(editor.view.dom)
    if (!scroller) return
    let frame = 0
    const follow = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (chosen.current !== null) {
          setCurrent(chosen.current)
          return
        }
        const all = headingsOf(editor)
        // At the bottom, the last section is the one read — however short it is.
        if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
          setCurrent(Math.max(0, all.length - 1))
          return
        }
        const top = scroller.getBoundingClientRect().top + READING_LINE
        let reading = 0
        all.forEach((heading, index) => {
          const dom = editor.view.nodeDOM(heading.pos)
          if (dom instanceof HTMLElement && dom.getBoundingClientRect().top <= top) reading = index
        })
        setCurrent(reading)
      })
    }
    // Scrolled by hand: the reading position speaks again.
    const byHand = () => {
      chosen.current = null
    }
    follow()
    scroller.addEventListener('scroll', follow, { passive: true })
    for (const event of ['wheel', 'touchmove', 'keydown', 'pointerdown'] as const) {
      scroller.addEventListener(event, byHand, { passive: true })
    }
    return () => {
      cancelAnimationFrame(frame)
      scroller.removeEventListener('scroll', follow)
      for (const event of ['wheel', 'touchmove', 'keydown', 'pointerdown'] as const) {
        scroller.removeEventListener(event, byHand)
      }
    }
  }, [editor, key])

  if (headings.length < 2) return null

  const go = (heading: Heading, index: number) => {
    const dom = editor.view.nodeDOM(heading.pos)
    if (!(dom instanceof HTMLElement)) return
    chosen.current = index
    setCurrent(index)
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    dom.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' })
  }

  return (
    // In the article's right margin, beside the text; it stays in view as one scrolls.
    <div className="pointer-events-none absolute top-0 -right-9 bottom-0 hidden w-6 sm:block">
      <nav
        aria-label={$t('Sommaire')}
        className="group pointer-events-auto sticky top-[30vh] flex flex-col items-end gap-2 py-2"
      >
        {headings.map((heading, index) => (
          <button
            key={heading.pos}
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={() => go(heading, index)}
            className="flex h-1.5 w-6 items-center justify-end"
          >
            <span
              className={cn(
                'h-0.5 rounded-full transition-colors',
                heading.level === 2 ? 'w-4' : 'w-2.5',
                index === current ? 'bg-foreground' : 'bg-muted-foreground/30',
              )}
            />
          </button>
        ))}

        {/* The headings themselves, over the dashes: on hover, or reached by the keyboard. */}
        <div className="invisible absolute top-0 right-0 z-20 w-60 translate-x-1 rounded-lg border bg-popover p-1 opacity-0 shadow-md transition-[opacity,transform] duration-150 group-focus-within:visible group-focus-within:translate-x-0 group-focus-within:opacity-100 group-hover:visible group-hover:translate-x-0 group-hover:opacity-100 motion-reduce:transition-none">
          <p className="px-2 pt-1 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {$t('Sommaire')}
          </p>
          <ol>
            {headings.map((heading, index) => (
              <li key={heading.pos}>
                <button
                  type="button"
                  onClick={() => go(heading, index)}
                  className={cn(
                    'block w-full truncate rounded-md py-1 pr-2 text-left text-xs transition-colors hover:bg-accent',
                    heading.level === 2 ? 'pl-2' : 'pl-5',
                    index === current ? 'font-medium text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {heading.text}
                </button>
              </li>
            ))}
          </ol>
        </div>
      </nav>
    </div>
  )
}
