'use client'

import { create } from 'zustand'

/**
 * How the inbox calls an agent: a sound, and a notification of the desktop when the tab
 * is not in front. Per browser — a shared office computer is not a personal laptop.
 */

const STORAGE_KEY = 'chat.alerts'

export type DesktopPermission = 'default' | 'granted' | 'denied' | 'unsupported'

interface AlertSettings {
  readonly sound: boolean
  readonly desktop: boolean
  readonly permission: DesktopPermission
  setSound: (on: boolean) => void
  /** Turning it on asks the browser — from the click, the only moment it may be asked. */
  setDesktop: (on: boolean) => Promise<void>
  initialize: () => void
}

function currentPermission(): DesktopPermission {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

function save(sound: boolean, desktop: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ sound, desktop }))
  } catch {
    // A blocked storage costs the choice on the next visit, nothing more.
  }
}

export const useAlertSettings = create<AlertSettings>((set, get) => ({
  sound: true,
  desktop: false,
  permission: 'default',

  setSound: (sound) => {
    save(sound, get().desktop)
    set({ sound })
  },

  setDesktop: async (on) => {
    let permission = currentPermission()
    if (on && permission === 'default') permission = await Notification.requestPermission()
    const desktop = on && permission === 'granted'
    save(get().sound, desktop)
    set({ desktop, permission })
  },

  initialize: () => {
    let stored: { sound?: unknown; desktop?: unknown } = {}
    try {
      stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')
    } catch {
      // Unreadable storage: the defaults stand.
    }
    const permission = currentPermission()
    set({
      sound: stored.sound !== false,
      desktop: stored.desktop === true && permission === 'granted',
      permission,
    })
  },
}))
