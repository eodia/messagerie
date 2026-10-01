'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Keeps the address bar in step with the screen, and follows the browser's back and forward
 * — basedb's, as is.
 *
 * `address` is what the screen shows — `null` while there is nothing to say yet. `follow`
 * goes where the address now says, once the browser has moved to another entry of its
 * history.
 *
 * ONE ENTRY PER GESTURE. A click or a key opens a new entry in the history; whatever the
 * screen then settles on by itself — the first conversation it opens, a name made canonical
 * — replaces it rather than adding another, or « précédent » would have to be pressed twice.
 * The first address the screen writes replaces the one it was reached by, and so does
 * everything a back or a forward makes the screen do: the entry is the one the browser
 * went to.
 *
 * Nothing is written while a back or a forward is being followed: the screen passes through
 * states on its way there, and an entry left behind by a quick second click must not
 * receive them.
 */
export function useAddressBar(address: string | null, follow: () => Promise<void>): void {
  const wanted = useRef(address)
  wanted.current = address
  const following = useRef(follow)
  following.current = follow
  /** A click or a key since the last entry was written. */
  const gesture = useRef(false)
  const written = useRef(false)
  /** The back or forward being followed, `0` for none. */
  const traversing = useRef(0)
  /** Moves once one is followed: the render it causes carries where it led. */
  const [settled, settle] = useState(0)

  const write = useCallback(() => {
    const next = wanted.current
    if (next === null || traversing.current !== 0) return
    // Already what the address says — a reload, a bookmark: the entry is the screen's.
    if (next === `${window.location.pathname}${window.location.search}`) {
      written.current = true
      return
    }
    const push = gesture.current && written.current
    gesture.current = false
    written.current = true
    if (push) window.history.pushState(null, '', next)
    else window.history.replaceState(null, '', next)
  }, [])

  useEffect(() => {
    void address
    void settled
    write()
  }, [address, settled, write])

  useEffect(() => {
    let traversal = 0
    const touched = () => {
      gesture.current = true
    }
    const traversed = () => {
      gesture.current = false
      traversal += 1
      const mine = traversal
      traversing.current = mine
      void following
        .current()
        .catch(() => undefined)
        .finally(() => {
          if (traversing.current !== mine) return
          traversing.current = 0
          settle((n) => n + 1)
        })
    }
    // Captured: a component that stops the event must not keep the gesture from counting.
    window.addEventListener('pointerdown', touched, true)
    window.addEventListener('keydown', touched, true)
    window.addEventListener('popstate', traversed)
    return () => {
      window.removeEventListener('pointerdown', touched, true)
      window.removeEventListener('keydown', touched, true)
      window.removeEventListener('popstate', traversed)
    }
  }, [])
}
