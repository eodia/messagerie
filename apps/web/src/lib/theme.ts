'use client'

import { create } from 'zustand'

/**
 * The theme — a preference, and what that preference resolves to.
 *
 * The two are kept apart on purpose. `preference` is what the person chose, `system`
 * included; `theme` is the class actually on `<html>`. Collapsing them would make
 * "suivre le système" indistinguishable from "sombre" the moment the system is dark,
 * and the menu could no longer show which of the two is ticked.
 */

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'chat.theme'

interface ThemeState {
  readonly preference: ThemePreference
  readonly theme: ResolvedTheme
  setPreference: (preference: ThemePreference) => void
  /** Reads storage and the system, and wires the system listener. Client only. */
  initialize: () => () => void
}

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolve(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? systemTheme() : preference
}

/** Puts the class where Tailwind's `dark` variant looks for it. */
function apply(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
}

export const useTheme = create<ThemeState>((set) => ({
  preference: 'system',
  theme: 'light',

  setPreference: (preference) => {
    const theme = resolve(preference)
    apply(theme)
    try {
      window.localStorage.setItem(STORAGE_KEY, preference)
    } catch {
      // A blocked storage costs the preference on the next visit, nothing more.
    }
    set({ preference, theme })
  },

  initialize: () => {
    let preference: ThemePreference = 'system'
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored === 'light' || stored === 'dark' || stored === 'system') preference = stored
    } catch {
      // Same as above: an unreadable storage means the system preference wins.
    }
    const theme = resolve(preference)
    apply(theme)
    set({ preference, theme })

    // The system can change under a running page — a scheduled switch at dusk, a laptop
    // lid closing. Only followed while the preference IS `system`.
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (useTheme.getState().preference !== 'system') return
      const next = systemTheme()
      apply(next)
      set({ theme: next })
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  },
}))
