'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The place an address names, its names aside: `lea-martin-9f0c3b2a71de` and
 * `visiteur-f9e2-9f0c3b2a71de` are the same conversation.
 */
const placeOf = (address: string) => address.replace(/[^/?]*-([0-9a-f]{12})(?=[/?]|$)/g, '$1')

/**
 * The last address a screen wrote. A screen that comes on it — another tab's studio — is on
 * an entry the app wrote, not one the router just opened: its first gesture opens another.
 */
let lastWritten: string | null = null

/**
 * Keeps the address bar in step with the screen, and follows the browser's back and forward
 * — basedb's, with one more rule: a thing renamed is the same place, its entry is replaced.
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
    const here = `${window.location.pathname}${window.location.search}`
    // Already what the address says — a reload, a bookmark: the entry is the screen's.
    if (next === here) {
      written.current = true
      lastWritten = here
      return
    }
    // Moved since by someone else, no click nor key: a back or a forward — Next hears it
    // first and renders before this hook does. It is followed, not overwritten.
    if (written.current && here !== lastWritten && !gesture.current) return
    const ours = written.current || here === lastWritten
    const push = gesture.current && ours && placeOf(next) !== placeOf(here)
    gesture.current = false
    written.current = true
    lastWritten = next
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
      // Once every listener of this back or forward has run — a screen's tabs follow it too
      // — and the renders they cause: React renders at once on a popstate.
      setTimeout(() => {
        if (traversing.current !== mine) return
        void following
          .current()
          .catch(() => undefined)
          .finally(() => {
            if (traversing.current !== mine) return
            traversing.current = 0
            // The entry gone to is the screen's now: what it settles on replaces it.
            lastWritten = `${window.location.pathname}${window.location.search}`
            settle((n) => n + 1)
          })
      }, 0)
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
