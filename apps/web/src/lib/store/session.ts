'use client'

import { create } from 'zustand'
import {
  SignedOut,
  accessToken,
  changePassword,
  mustChangePassword,
  signIn,
  signOut,
  usesBasedb,
} from '../basedb-session'

/**
 * Whether someone is signed in — to basedb, whose session the inbox shares (D4). Without
 * basedb, in development, the chat server's development identity always is.
 */

interface SessionState {
  /** `must-change`: signed in with a temporary password, which basedb wants replaced. */
  readonly status: 'checking' | 'signed-in' | 'signed-out' | 'must-change'
  /** The temporary password must be typed again: the page was reloaded since the sign-in. */
  readonly needsCurrent: boolean
  /** Asks basedb's session for a token: there is one, or there is none. */
  check: () => Promise<void>
  /** `beforeEntering`: what the screen shows of the success before the inbox replaces it. */
  signIn: (email: string, password: string, beforeEntering?: () => Promise<void>) => Promise<void>
  /** Replaces the temporary password — typed at sign-in, or given again as `current`. */
  choosePassword: (next: string, current?: string) => Promise<void>
  signOut: () => Promise<void>
  /** The API found no session any more: back to the sign-in. */
  signedOut: () => void
}

/** The temporary password, between the sign-in and its replacement — in memory only. */
let temporary: string | null = null

export const useSession = create<SessionState>((set, get) => ({
  status: 'checking',
  needsCurrent: false,

  check: async () => {
    if (!usesBasedb()) {
      set({ status: 'signed-in' })
      return
    }
    try {
      await accessToken()
      // A temporary password still in force, the page reloaded since the sign-in.
      if (await mustChangePassword())
        set({ status: 'must-change', needsCurrent: temporary === null })
      else set({ status: 'signed-in' })
    } catch (error) {
      if (!(error instanceof SignedOut)) throw error
      set({ status: 'signed-out' })
    }
  },

  signIn: async (email, password, beforeEntering) => {
    await signIn(email, password)
    if (await mustChangePassword()) {
      temporary = password
      set({ status: 'must-change', needsCurrent: false })
      return
    }
    await beforeEntering?.()
    await get().check()
  },

  choosePassword: async (next, current) => {
    await changePassword(current ?? temporary ?? '', next)
    temporary = null
    await get().check()
  },

  signOut: async () => {
    await signOut()
    // A clean page: nothing of the last agent's inbox stays in memory.
    window.location.assign('/')
  },

  signedOut: () => {
    if (get().status !== 'signed-out') set({ status: 'signed-out' })
  },
}))
