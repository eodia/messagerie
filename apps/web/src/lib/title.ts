'use client'

import { useEffect } from 'react'
import { PRODUCT_NAME } from './product'

/**
 * The browser tab's title, kept in step with what is open — basedb's `useTitle`.
 *
 * `metadata.title` is static: the server does not know which conversation someone opened.
 * So the screen sets it once it knows. It is not decoration: two tabs of the inbox read
 * « Léa Martin — Service client » and « Garde-fous », not « Messagerie » twice; and it is
 * what the history and a bookmark keep.
 *
 * The most specific segment comes FIRST, because a tab strip truncates from the right. The
 * count of what waits for the reader goes before it all: « (3) Léa Martin — … ».
 */

let place = ''
let waiting = 0

function write(): void {
  const title = place === '' ? PRODUCT_NAME : `${place} · ${PRODUCT_NAME}`
  document.title = waiting > 0 ? `(${waiting}) ${title}` : title
}

/** What waits for the reader, counted before the title. */
export function titleCount(count: number): void {
  waiting = count
  write()
}

export function useTitle(segments: ReadonlyArray<string | null | undefined>): void {
  // Joined before the effect: an array literal is a new reference on every render.
  const joined = segments
    .map((segment) => segment?.trim())
    .filter((segment): segment is string => segment !== undefined && segment !== '')
    .join(' — ')

  useEffect(() => {
    place = joined
    write()
  }, [joined])
}
