'use client'

import { create } from 'zustand'

/** The sidebar, full or reduced to its icons — remembered by this browser, as in basedb. */

const STORAGE_KEY = 'chat.sidebar'

interface SidebarState {
  readonly collapsed: boolean
  toggle: () => void
  initialize: () => void
}

export const useSidebar = create<SidebarState>((set, get) => ({
  collapsed: false,

  toggle: () => {
    const collapsed = !get().collapsed
    try {
      window.localStorage.setItem(STORAGE_KEY, collapsed ? 'collapsed' : 'open')
    } catch {
      // A blocked storage costs the choice on the next visit, nothing more.
    }
    set({ collapsed })
  },

  initialize: () => {
    try {
      set({ collapsed: window.localStorage.getItem(STORAGE_KEY) === 'collapsed' })
    } catch {
      // Unreadable storage: the sidebar opens full.
    }
  },
}))
