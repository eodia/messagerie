'use client'

import { create } from 'zustand'

/**
 * The width of the inbox's panes — the conversations on the left, the details on the right.
 * basedb's `lib/store/panels.ts`, for two panes on either side of the thread.
 *
 * A preference of this browser, like the sidebar's, and restored the same way: after mount,
 * because `localStorage` does not exist where Next.js renders first.
 */

const STORAGE_KEY = 'chat.panels'

export type PanelKey = 'list' | 'details'

interface Bounds {
  readonly min: number
  readonly initial: number
  readonly max: number
}

/**
 * The list's minimum still holds its four filters side by side, counts included; the
 * details' still holds a label and its value on one line.
 */
export const PANEL_BOUNDS: Readonly<Record<PanelKey, Bounds>> = {
  list: { min: 304, initial: 320, max: 480 },
  details: { min: 280, initial: 320, max: 560 },
}

/**
 * What the thread keeps whatever the panes' widths — basedb's `MAIN_MIN`: an AI answer and
 * its verdict buttons, the composer, still have room to be read. The panes enforce it
 * against the space they are actually given, which only they can measure.
 */
export const THREAD_MIN = 480

/** A width within the pane's own bounds. */
export function clampWidth(panel: PanelKey, width: number): number {
  const { min, max } = PANEL_BOUNDS[panel]
  return Math.round(Math.max(min, Math.min(width, max)))
}

interface PanelsState {
  readonly widths: Readonly<Partial<Record<PanelKey, number>>>
  /** Sets a width, in memory — called on every move of a drag. */
  resize: (panel: PanelKey, width: number) => void
  /** Writes the widths to storage — called once the drag is over. */
  persist: () => void
  /** Back to the width the pane is designed for. */
  reset: (panel: PanelKey) => void
  /** Reads the stored widths. Client only. */
  initialize: () => void
}

export const usePanels = create<PanelsState>((set, get) => ({
  widths: {},

  resize: (panel, width) => set({ widths: { ...get().widths, [panel]: clampWidth(panel, width) } }),

  persist: () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(get().widths))
    } catch {
      // A blocked storage costs the width on the next visit, nothing more.
    }
  },

  reset: (panel) => {
    const { [panel]: _dropped, ...rest } = get().widths
    set({ widths: rest })
    get().persist()
  },

  initialize: () => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw === null) return
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const widths: Partial<Record<PanelKey, number>> = {}
      for (const panel of Object.keys(PANEL_BOUNDS) as PanelKey[]) {
        const width = parsed[panel]
        if (typeof width === 'number' && Number.isFinite(width)) {
          widths[panel] = clampWidth(panel, width)
        }
      }
      set({ widths })
    } catch {
      // A corrupted value opens the panes at their default width.
    }
  },
}))
