'use client'

import { create } from 'zustand'

/**
 * How an agent arranged the details panel: its blocks' order, and those they hid — kept in
 * this browser, like the panes' widths.
 */

export const BLOCKS = [
  'summary',
  'conversation',
  'pages',
  'site',
  'declared',
  'data',
  'tools',
] as const
export type BlockId = (typeof BLOCKS)[number]

const KEY = 'chat.details.layout'

interface Layout {
  readonly order: readonly BlockId[]
  readonly hidden: readonly BlockId[]
}

const DEFAULT: Layout = { order: BLOCKS, hidden: [] }

function read(): Layout {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return DEFAULT
    const stored = JSON.parse(raw) as Partial<Layout>
    const known = (ids: unknown): BlockId[] =>
      Array.isArray(ids) ? ids.filter((id): id is BlockId => BLOCKS.includes(id as BlockId)) : []
    const order = known(stored.order)
    // A block added since it was arranged goes at the end.
    return {
      order: [...order, ...BLOCKS.filter((id) => !order.includes(id))],
      hidden: known(stored.hidden),
    }
  } catch {
    return DEFAULT
  }
}

function keep(layout: Layout): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(layout))
  } catch {
    // Forgotten at the next visit, nothing more.
  }
}

interface LayoutState extends Layout {
  /** Arranging the panel: the blocks as a list to reorder and show or hide. */
  readonly arranging: boolean
  initialize: () => void
  setArranging: (arranging: boolean) => void
  /** Moves a block to `index` in the order. */
  move: (id: BlockId, index: number) => void
  toggle: (id: BlockId) => void
  reset: () => void
}

export const useDetailsLayout = create<LayoutState>((set, get) => {
  const save = (layout: Layout) => {
    set(layout)
    keep(layout)
  }
  return {
    ...DEFAULT,
    arranging: false,
    initialize: () => set(read()),
    setArranging: (arranging) => set({ arranging }),
    move: (id, index) => {
      const order = get().order.filter((b) => b !== id)
      order.splice(Math.max(0, Math.min(index, order.length)), 0, id)
      save({ order, hidden: get().hidden })
    },
    toggle: (id) => {
      const hidden = get().hidden.includes(id)
        ? get().hidden.filter((b) => b !== id)
        : [...get().hidden, id]
      save({ order: get().order, hidden })
    },
    reset: () => save(DEFAULT),
  }
})
