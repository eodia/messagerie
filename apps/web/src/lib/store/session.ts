'use client'

import type { Agent } from '@chat/contracts'
import { create } from 'zustand'
import { AuthFailure, authState, setUp, signIn, signOut } from '../session'

/**
 * Whether someone is signed in (D19) — the chat server says, from its session cookie.
 * Without a session, in development, the server's development identity answers the
 * inbox's requests: the inbox then works without signing in.
 */

interface SessionState {
  readonly status: 'checking' | 'signed-in' | 'signed-out'
  /** Nobody can sign in yet: the sign-in screen creates the first supervisor. */
  readonly setup: boolean
  /** The identity provider's name, when the server has one. */
  readonly sso: string | null
  /** The server writes e-mails: « Mot de passe oublié ? » sends a link (D23). */
  readonly forgot: boolean
  /** The agent the session is — null in development without one. */
  readonly agent: Agent | null
  check: () => Promise<void>
  /** `beforeEntering`: what the screen shows of the success before the inbox replaces it. */
  signIn: (email: string, password: string, beforeEntering?: () => Promise<void>) => Promise<void>
  setUp: (name: string, email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  /** The API found no session any more: back to the sign-in. */
  signedOut: () => void
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'checking',
  setup: false,
  sso: null,
  forgot: false,
  agent: null,

  check: async () => {
    try {
      const state = await authState()
      set({ setup: state.setup, sso: state.sso, forgot: state.forgot, agent: state.agent })
      if (state.agent) {
        set({ status: 'signed-in' })
        return
      }
      // No session: in development the server may stand in — the inbox's own answer says.
      set({ status: 'signed-in' })
    } catch (error) {
      if (!(error instanceof AuthFailure)) throw error
      set({ status: 'signed-out' })
    }
  },

  signIn: async (email, password, beforeEntering) => {
    await signIn({ email, password })
    await beforeEntering?.()
    await get().check()
  },

  setUp: async (name, email, password) => {
    await setUp({ name, email, password })
    await get().check()
  },

  signOut: async () => {
    await signOut().catch(() => {})
    // A clean page: nothing of the last agent's inbox stays in memory.
    window.location.assign('/')
  },

  signedOut: () => {
    if (get().status !== 'signed-out') set({ status: 'signed-out' })
  },
}))
