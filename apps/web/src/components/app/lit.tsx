'use client'

import { highlights, runsOf } from '@/lib/search'

/**
 * A text with what was typed lit — basedb's highlighting. `lit`: the code points to light,
 * when already known (an excerpt's); otherwise found from `tokens`.
 */
export function Lit({
  text,
  tokens = [],
  lit,
}: {
  readonly text: string
  readonly tokens?: readonly string[]
  readonly lit?: ReadonlySet<number>
}) {
  const on = lit ?? (tokens.length > 0 ? highlights(text, tokens) : null)
  if (on === null || on.size === 0) return <>{text}</>
  return (
    <>
      {runsOf(text, on).map((run, i) =>
        run.lit ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the runs of one text, in order
          <mark key={i} className="rounded-sm bg-primary/20 text-foreground">
            {run.text}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: the runs of one text, in order
          <span key={i}>{run.text}</span>
        ),
      )}
    </>
  )
}
