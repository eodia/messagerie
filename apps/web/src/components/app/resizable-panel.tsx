'use client'

import { Hint } from '@/components/ui/tooltip'
import { $t } from '@/lib/i18n'
import { PANEL_BOUNDS, type PanelKey, THREAD_MIN, usePanels } from '@/lib/store/panels'
import { cn } from '@/lib/utils'
import { type ReactNode, useCallback, useId, useRef } from 'react'

/** The step of an arrow key on the handle; Shift makes it four times larger. */
const STEP = 16

/**
 * A pane beside the thread whose width is dragged from its inner edge — basedb's
 * `ResizablePanel`, on either side: the conversations on the left, the details on the right.
 *
 * The handle is the pane's border, widened for the pointer: a drag moves it, a double
 * click puts the default width back, and from the keyboard it is a separator the arrows
 * move. The width is this browser's preference, kept between visits; the thread always
 * keeps enough room to be read, whatever was stored.
 */
export function ResizablePanel({
  panel,
  side,
  as: Tag = 'aside',
  label,
  className,
  children,
}: {
  readonly panel: PanelKey
  /** Where the pane sits; its handle is on the other edge, against the thread. */
  readonly side: 'left' | 'right'
  readonly as?: 'aside' | 'section'
  /** What the handle resizes, for a screen reader: « la liste », « le panneau ». */
  readonly label: string
  readonly className?: string
  readonly children: ReactNode
}) {
  const bounds = PANEL_BOUNDS[panel]
  const width = usePanels((s) => s.widths[panel] ?? bounds.initial)
  const resize = usePanels((s) => s.resize)
  const persist = usePanels((s) => s.persist)
  const reset = usePanels((s) => s.reset)
  const pane = useRef<HTMLElement>(null)
  const id = useId()
  // Toward the thread the pane grows: rightward for the left one, leftward for the right.
  const grows = side === 'left' ? 1 : -1

  /** The widest the pane may be now: the thread keeps `THREAD_MIN`, the other pane its own. */
  const room = useCallback((): number => {
    const self = pane.current
    const parent = self?.parentElement
    if (self === null || parent === null || parent === undefined) return Number.POSITIVE_INFINITY
    let others = 0
    for (const child of Array.from(parent.children)) {
      if (child !== self && child.hasAttribute('data-panel')) {
        others += child.getBoundingClientRect().width
      }
    }
    return parent.getBoundingClientRect().width - others - THREAD_MIN
  }, [])

  const apply = useCallback(
    (next: number, limit: number) => resize(panel, Math.min(next, limit)),
    [panel, resize],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const handle = e.currentTarget
      handle.setPointerCapture(e.pointerId)
      // The width as DRAWN, which the window may have narrowed below the stored one, and
      // measured from the origin rather than step by step: a dropped event must not drift.
      const start = pane.current?.getBoundingClientRect().width ?? width
      const limit = room()
      const origin = e.clientX
      // The whole page takes the resize cursor and stops selecting text while it lasts:
      // the pointer leaves the thin handle on the first move.
      const body = document.body.style
      const previous = { cursor: body.cursor, userSelect: body.userSelect }
      body.cursor = 'col-resize'
      body.userSelect = 'none'

      const move = (ev: PointerEvent) => apply(start + grows * (ev.clientX - origin), limit)
      const up = () => {
        handle.removeEventListener('pointermove', move)
        handle.removeEventListener('pointerup', up)
        handle.removeEventListener('pointercancel', up)
        body.cursor = previous.cursor
        body.userSelect = previous.userSelect
        persist()
      }
      handle.addEventListener('pointermove', move)
      handle.addEventListener('pointerup', up)
      handle.addEventListener('pointercancel', up)
    },
    [width, grows, room, apply, persist],
  )

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = (e.shiftKey ? STEP * 4 : STEP) * grows
    const drawn = pane.current?.getBoundingClientRect().width ?? width
    if (e.key === 'ArrowRight') apply(drawn + step, room())
    else if (e.key === 'ArrowLeft') apply(drawn - step, room())
    else if (e.key === 'Home') resize(panel, bounds.min)
    else if (e.key === 'End') apply(bounds.max, room())
    else if (e.key === 'Enter') reset(panel)
    else return
    e.preventDefault()
    persist()
  }

  return (
    <Tag
      ref={pane}
      id={id}
      data-panel={panel}
      // It may shrink, down to its minimum: a thread that must keep its room — the window
      // narrowed, the other pane opened — takes it from the panes rather than overflow.
      className={cn('relative flex flex-col', side === 'left' ? 'border-r' : 'border-l', className)}
      // `100%` is the area the panes share with the thread: a width stored in a wider
      // window gives way here rather than squeezing the thread.
      style={{ width, minWidth: bounds.min, maxWidth: `calc(100% - ${THREAD_MIN}px)` }}
    >
      {/* The focusable window splitter of the ARIA Authoring Practices. */}
      <Hint label={$t('Glisser pour redimensionner — double-clic : largeur par défaut')}>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={$t('Redimensionner {label}', { label })}
          aria-controls={id}
          aria-valuenow={width}
          aria-valuemin={bounds.min}
          aria-valuemax={bounds.max}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onDoubleClick={() => reset(panel)}
          onKeyDown={onKeyDown}
          className={cn(
            'absolute inset-y-0 z-30 w-1.5 cursor-col-resize outline-none transition-colors hover:bg-primary/40 focus-visible:bg-primary/60 active:bg-primary/60',
            side === 'left' ? '-right-[3px]' : '-left-[3px]',
          )}
        />
      </Hint>
      {children}
    </Tag>
  )
}
