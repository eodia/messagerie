'use client'

import { create } from 'zustand'

/** The command palette: whether it is open, and what it opens with. */
interface PaletteState {
  readonly open: boolean
  /** What the field holds when it opens — a prefix, a letter typed elsewhere. */
  readonly seed: string
  show: (seed?: string) => void
  hide: () => void
}

export const usePalette = create<PaletteState>((set) => ({
  open: false,
  seed: '',
  show: (seed = '') => set({ open: true, seed }),
  hide: () => set({ open: false }),
}))

/** Ctrl+K, or ⌘K on a Mac — by the physical key, so that it works on any layout. */
export const isPaletteKey = (event: KeyboardEvent): boolean =>
  (event.ctrlKey || event.metaKey) &&
  !event.altKey &&
  !event.shiftKey &&
  (event.code === 'KeyK' || event.key.toLowerCase() === 'k')
