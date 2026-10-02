'use client'

import { create } from 'zustand'

/**
 * The sidebar, full or reduced to its icons, and its « Administration » open or folded —
 * remembered by this browser, as in basedb.
 */

const STORAGE_KEY = 'chat.sidebar'
const ADMIN_KEY = 'chat.sidebar.admin'

interface SidebarState {
  readonly collapsed: boolean
  readonly adminOpen: boolean
  toggle: () => void
  setAdminOpen: (open: boolean) => void
  initialize: () => void
}

function remember(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // A blocked storage costs the choice on the next visit, nothing more.
  }
}

export const useSidebar = create<SidebarState>((set, get) => ({
  collapsed: false,
  adminOpen: false,

  toggle: () => {
    const collapsed = !get().collapsed
    remember(STORAGE_KEY, collapsed ? 'collapsed' : 'open')
    set({ collapsed })
  },

  setAdminOpen: (adminOpen) => {
    remember(ADMIN_KEY, adminOpen ? 'open' : 'folded')
    set({ adminOpen })
  },

  initialize: () => {
    try {
      set({
        collapsed: window.localStorage.getItem(STORAGE_KEY) === 'collapsed',
        adminOpen: window.localStorage.getItem(ADMIN_KEY) === 'open',
      })
    } catch {
      // Unreadable storage: the sidebar opens full, its administration folded.
    }
  },
}))
