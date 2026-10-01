'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { addressOf, wordsAfter } from './address'

/**
 * A screen's tabs, in its address: `/parametrage/sites/horaires`. `words` gives each tab's
 * word, `null` for the one the screen opens on — which the address then does not name.
 *
 * Returns the tab, the way to choose one, and the tab's address — its studio's base: the
 * studio writes it, with the row it opens, as one entry of the history. Back and forward
 * come back to the tab the address says.
 */
export function useAddressTab<T extends string>(
  base: string,
  words: Readonly<Record<T, string | null>>,
): readonly [T, (tab: T) => void, string] {
  // The words are the screen's constant: read through a ref, they never change a hook.
  const known = useRef(words)
  known.current = words

  const read = useCallback((): T => {
    const all = known.current
    const tabs = Object.keys(all) as T[]
    const first = wordsAfter(base)?.[0]
    return (
      tabs.find((t) => all[t] !== null && all[t] === first) ??
      tabs.find((t) => all[t] === null) ??
      (tabs[0] as T)
    )
  }, [base])
  const [tab, setTab] = useState<T>(read)

  useEffect(() => {
    const followed = () => setTab(read())
    window.addEventListener('popstate', followed)
    return () => window.removeEventListener('popstate', followed)
  }, [read])

  return [tab, setTab, addressOf(base, words[tab])] as const
}
