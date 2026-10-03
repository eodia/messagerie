'use client'

import { create } from 'zustand'
import { api } from '../api'
import { type PushState, pushState, refresh, subscribe, unsubscribe } from '../push'

/**
 * How the inbox calls an agent: a sound, and a notification of the desktop when the tab
 * is not in front. Per browser — a shared office computer is not a personal laptop.
 *
 * Beyond the open inbox (D23): this device, by Web Push — the server keeps it —, and the
 * agent's mailbox, which their account keeps.
 */

const STORAGE_KEY = 'chat.alerts'

export type DesktopPermission = 'default' | 'granted' | 'denied' | 'unsupported'

interface AlertSettings {
  readonly sound: boolean
  readonly desktop: boolean
  readonly permission: DesktopPermission
  /** This device's alerts while the inbox is closed. */
  readonly push: PushState
  /** The server writes e-mails; null until read. */
  readonly emailAvailable: boolean
  readonly email: boolean
  readonly address: string | null
  /** The server's push key, once read. */
  readonly pushKey: string | null
  setSound: (on: boolean) => void
  /** Turning it on asks the browser — from the click, the only moment it may be asked. */
  setDesktop: (on: boolean) => Promise<void>
  setPush: (on: boolean) => Promise<void>
  setEmail: (on: boolean) => Promise<void>
  initialize: () => void
  /** Once signed in: what the server knows of one's alerts, and this device's again. */
  loadChannels: () => Promise<void>
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
  push: 'unsupported',
  emailAvailable: false,
  email: false,
  address: null,
  pushKey: null,

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

  setPush: async (on) => {
    const key = get().pushKey
    if (!key) return
    try {
      const push = on
        ? await subscribe(key, (subscription) => api.subscribeDevice(subscription))
        : await unsubscribe((endpoint) => api.unsubscribeDevice(endpoint))
      set({ push, permission: currentPermission() })
    } catch {
      set({ push: await pushState() })
    }
  },

  setEmail: async (on) => {
    set({ email: on })
    try {
      await api.setEmailAlerts(on)
    } catch {
      set({ email: !on })
    }
  },

  loadChannels: async () => {
    try {
      const channels = await api.alerts()
      set({
        pushKey: channels.pushKey,
        emailAvailable: channels.emailAvailable,
        email: channels.email,
        address: channels.address,
      })
      const push = await refresh(channels.pushKey, (subscription) =>
        api.subscribeDevice(subscription),
      )
      set({ push })
    } catch {
      // The menu shows what it knows; the next start tries again.
    }
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
