/**
 * The search of the command palette — basedb's (`lib/search.ts`), as it is, so that Ctrl+K
 * finds things the same way in both: what it matches, how it ranks, what it remembers.
 *
 * Nothing here talks to the API: the palette gathers what it can search — tables, views,
 * dashboards, commands, rows — and this file decides which of them answer a text, and in
 * what order. Four kinds of match, from the surest to the loosest: the text itself, the
 * start of one of its words, the starts of several (`nc` or `ncl` for « Nouveau client »,
 * `nouvtab` for « Nouvelle table »), and the text typed with a slip — a letter swapped,
 * forgotten or doubled. Accents and case never count: `eleve` finds « Élève ».
 *
 * Every word typed must be found somewhere — in the title, a technical name, keywords or
 * where the thing lives: `ventes clients` finds the table « Clients » of the base
 * « Ventes ». What was opened often and lately comes first among equals.
 */

/** One code point in, one code point out: the offsets of a match are those of the text. */
function foldChar(char: string): string {
  const folded = char.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  return Array.from(folded)[0] ?? char
}

/** The text without accents nor case, code point for code point. */
export function fold(text: string): string {
  return Array.from(text, foldChar).join('')
}

/** What separates two words of a title, a name or a path. */
const SEPARATOR = /[\s\-_./\\:·,;()'’"«»[\]{}#@+|]/u

/** The words typed, folded — the palette's prefixes already taken off. */
export function tokensOf(query: string): string[] {
  return fold(query)
    .split(/\s+/u)
    .map((token) => token.replace(/^[«"'“]+|[»"'”?!.,;:]+$/gu, ''))
    .filter((token) => token !== '')
}

/** Where each word of a folded text starts, in code points. */
function wordStarts(chars: readonly string[]): number[] {
  const starts: number[] = []
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i] as string
    if (SEPARATOR.test(char)) continue
    const before = chars[i - 1]
    // A word starts after a separator, and where letters and digits meet: `table2`, `v2mail`.
    if (before === undefined || SEPARATOR.test(before) || /\d/u.test(char) !== /\d/u.test(before)) {
      starts.push(i)
    }
  }
  return starts
}

/**
 * Whether two words differ by at most `max` slips — a letter replaced, added, dropped, or
 * two neighbours swapped (the optimal string alignment distance).
 */
export function within(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false
  if (a === b) return true
  let previous2: number[] = []
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let value = Math.min(
        (previous[j] as number) + 1,
        (row[j - 1] as number) + 1,
        (previous[j - 1] as number) + cost,
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, (previous2[j - 2] as number) + 1)
      }
      row.push(value)
      if (value < best) best = value
    }
    // Every way through this row already costs more than allowed: no need to go on.
    if (best > max) return false
    previous2 = previous
    previous = row
  }
  return (previous[b.length] as number) <= max
}

/** How many slips a word of this length may carry and still be recognized. */
const slipsFor = (length: number): number => (length >= 8 ? 2 : length >= 4 ? 1 : 0)

/** The scores of each kind of match, out of 100. */
export const MATCH = {
  exact: 100,
  prefix: 90,
  word: 76,
  inside: 58,
  initials: 54,
  slip: 42,
  scattered: 20,
} as const

/**
 * How well one typed word matches a folded text, out of 100 — `0` when it does not.
 *
 * A single letter only counts at the start of a word: `a` inside every title would
 * match everything, which is matching nothing. `strict`: from the start of words only —
 * for keywords and places, where `velo` inside « développeurs » is a coincidence.
 */
export function scoreToken(token: string, text: string, strict = false): number {
  if (token === '' || text === '') return 0
  if (text === token) return MATCH.exact
  if (text.startsWith(token)) return MATCH.prefix
  const chars = Array.from(text)
  const starts = wordStarts(chars)
  const joined = chars.join('')
  for (const start of starts) {
    if (joined.startsWith(token, offsetOf(chars, start))) return MATCH.word
  }
  if (!strict && token.length >= 2 && text.includes(token)) return MATCH.inside
  if (token.length >= 2) {
    const found = chain(Array.from(token), chars, starts, 0)
    if (found !== null) return found[0]?.[0] === starts[0] ? MATCH.initials : MATCH.initials - 8
  }
  const slips = slipsFor(Array.from(token).length)
  if (slips > 0) {
    // A slip is rarely on the first letter: `nuit` is no `quitter` with one letter wrong.
    const words = text.split(SEPARATOR).filter((w) => w !== '' && w[0] === token[0])
    for (const word of words) {
      // The word typed whole with a slip, or the start of one being typed with a slip.
      if (within(token, word, slips)) return MATCH.slip
      if (word.length > token.length && within(token, word.slice(0, token.length), slips)) {
        return MATCH.slip - 6
      }
    }
  }
  if (!strict && token.length >= 3) {
    const found = scattered(token, chars)
    // Letters in order, from the start of a word: `fctr` for « facture », not for « perfect ».
    if (found !== null && starts.includes(found[0] as number)) {
      const span = (found[found.length - 1] as number) - (found[0] as number) + 1
      const tightness = Array.from(token).length / span
      if (tightness >= 0.5) return Math.round(MATCH.scattered + 16 * tightness)
    }
  }
  return 0
}

/**
 * The token as the starts of several words, in order: `ncl` is « N·ouveau » and « Cl·ient »,
 * `nouvtab` « Nouv·elle » and « Tab·le ». Each piece as `[start, length]` in code points —
 * `null` when the token cannot be read so, or only as the start of one word.
 */
function chain(
  token: readonly string[],
  chars: readonly string[],
  starts: readonly number[],
  from: number,
): ReadonlyArray<readonly [number, number]> | null {
  // What cannot be read from a word on stays so: remembered, the search stays linear in
  // the words of a long description rather than trying every way through them.
  const failed = new Set<number>()
  const walk = (
    at: number,
    word: number,
    pieces: ReadonlyArray<readonly [number, number]>,
  ): ReadonlyArray<readonly [number, number]> | null => {
    if (at === token.length) return pieces.length >= 2 ? pieces : null
    const key = at * (starts.length + 1) + word
    if (failed.has(key)) return null
    for (let w = word; w < starts.length; w++) {
      const start = starts[w] as number
      const end = starts[w + 1] ?? chars.length
      let shared = 0
      while (
        at + shared < token.length &&
        start + shared < end &&
        chars[start + shared] === token[at + shared] &&
        !SEPARATOR.test(chars[start + shared] as string)
      ) {
        shared++
      }
      // The longest piece first: `nouvtab` reads « Nouv » + « tab » before « N » + « ouv… ».
      for (let length = shared; length >= 1; length--) {
        const found = walk(at + length, w + 1, [...pieces, [start, length]])
        if (found !== null) return found
      }
    }
    // Only a piece-less failure is kept: one piece short of two may succeed later.
    if (pieces.length > 0) failed.add(key)
    return null
  }
  return walk(0, from, [])
}

/** The UTF-16 offset of a code point, for `startsWith` — titles may hold emoji. */
function offsetOf(chars: readonly string[], index: number): number {
  let offset = 0
  for (let i = 0; i < index; i++) offset += (chars[i] as string).length
  return offset
}

/** The letters of `token` found in order in `chars`, each as early as it can be. */
function scattered(token: string, chars: readonly string[]): number[] | null {
  const wanted = Array.from(token)
  const found: number[] = []
  let from = 0
  for (const letter of wanted) {
    let at = -1
    for (let i = from; i < chars.length; i++) {
      if (chars[i] === letter) {
        at = i
        break
      }
    }
    if (at === -1) return null
    found.push(at)
    from = at + 1
  }
  return found
}

/** What the palette searches in a thing, from what it is called to where it lives. */
export interface Searchable {
  readonly title: string
  /** The technical name — `clients`, `b_…_ventes` —, which a developer types. */
  readonly name?: string
  /** Other words it answers to: « sombre » for the dark theme. */
  readonly keywords?: string
  /** Where it lives — its base, its project, its table. */
  readonly context?: string
}

/** How much each part of a thing counts: its title above all, where it lives the least. */
const WEIGHTS = { title: 1, name: 0.9, keywords: 0.75, context: 0.55 } as const

/** A thing's folded parts, computed once per thing rather than once per keystroke. */
export interface Prepared {
  readonly title: string
  readonly name: string
  readonly keywords: string
  readonly context: string
}

export function prepare(item: Searchable): Prepared {
  return {
    title: fold(item.title),
    name: fold(item.name ?? ''),
    keywords: fold(item.keywords ?? ''),
    context: fold(item.context ?? ''),
  }
}

/**
 * How well a thing answers the words typed — `0` when one of them is found nowhere, or
 * when all are found only where it lives: `factures` lists the table « Factures », not
 * each of its columns.
 *
 * The average of each word's best match, so that typing more words does not by itself
 * rank higher; plus a bonus when the words, in the order typed, are the title itself or
 * its start.
 */
export function scoreOf(tokens: readonly string[], item: Prepared): number {
  if (tokens.length === 0) return 0
  let total = 0
  let own = false
  for (const token of tokens) {
    const itself = Math.max(
      scoreToken(token, item.title) * WEIGHTS.title,
      scoreToken(token, item.name) * WEIGHTS.name,
      scoreToken(token, item.keywords, true) * WEIGHTS.keywords,
    )
    const best = Math.max(itself, scoreToken(token, item.context, true) * WEIGHTS.context)
    if (best === 0) return 0
    if (itself > 0) own = true
    total += best
  }
  if (!own) return 0
  let score = total / tokens.length
  const phrase = tokens.join(' ')
  if (tokens.length > 1) {
    if (item.title === phrase) score += 20
    else if (item.title.startsWith(phrase)) score += 14
    else if (item.title.includes(phrase)) score += 8
  }
  return score
}

/**
 * The code points of a title to highlight for the words typed: each word where it was
 * found — whole, at a word's start, inside —, else its initials, else its letters in order.
 * A word found only elsewhere (a keyword, the base) highlights nothing.
 */
export function highlights(title: string, tokens: readonly string[]): ReadonlySet<number> {
  const chars = Array.from(fold(title))
  const text = chars.join('')
  const lit = new Set<number>()
  const starts = wordStarts(chars)
  const light = (from: number, length: number) => {
    for (let i = from; i < from + length; i++) lit.add(i)
  }
  for (const token of tokens) {
    const length = Array.from(token).length
    const start = starts.find((s) => text.startsWith(token, offsetOf(chars, s)))
    if (start !== undefined) {
      light(start, length)
      continue
    }
    const inside = length >= 2 ? indexOfToken(chars, token) : -1
    if (inside !== -1) {
      light(inside, length)
      continue
    }
    const pieces = length >= 2 ? chain(Array.from(token), chars, starts, 0) : null
    if (pieces !== null) {
      for (const [from, count] of pieces) light(from, count)
      continue
    }
    if (length >= 3) {
      for (const i of scattered(token, chars) ?? []) lit.add(i)
    }
  }
  return lit
}

/** Where a token starts among code points, `-1` if nowhere. */
function indexOfToken(chars: readonly string[], token: string): number {
  const wanted = Array.from(token)
  outer: for (let i = 0; i + wanted.length <= chars.length; i++) {
    for (let j = 0; j < wanted.length; j++) {
      if (chars[i + j] !== wanted[j]) continue outer
    }
    return i
  }
  return -1
}

/** The title cut in runs, each highlighted or not — what the palette draws. */
export function runsOf(
  title: string,
  lit: ReadonlySet<number>,
): ReadonlyArray<{ readonly text: string; readonly lit: boolean }> {
  const runs: Array<{ text: string; lit: boolean }> = []
  Array.from(title).forEach((char, i) => {
    const on = lit.has(i)
    const last = runs[runs.length - 1]
    if (last !== undefined && last.lit === on) last.text += char
    else runs.push({ text: char, lit: on })
  })
  return runs
}

/**
 * Whether a text reads as a question put to someone rather than a name looked for —
 * then the copilot is offered first. A question mark, a question word to start with, or
 * a sentence too long to be a name.
 *
 * `questionWords`: the words a question starts with, in the reader's language, folded.
 */
export function looksLikeQuestion(query: string, questionWords: ReadonlySet<string>): boolean {
  const text = query.trim()
  if (text === '') return false
  if (/[?？¿؟]$/u.test(text)) return true
  const tokens = tokensOf(text)
  if (tokens.length >= 5) return true
  return tokens.length >= 2 && questionWords.has(tokens[0] as string)
}

/** A record's identifier, as the API writes it: a UUID. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

/**
 * A few words of a long text around what was found in it, the match kept whole: what a
 * row found by its description shows of it.
 */
export function excerpt(
  text: string,
  tokens: readonly string[],
  width = 64,
): { readonly text: string; readonly lit: ReadonlySet<number> } {
  const flat = text.replace(/\s+/gu, ' ').trim()
  const chars = Array.from(flat)
  if (chars.length <= width) return { text: flat, lit: highlights(flat, tokens) }
  const folded = Array.from(fold(flat))
  let at = -1
  for (const token of tokens) {
    at = indexOfToken(folded, token)
    if (at !== -1) break
  }
  const start = Math.max(0, Math.min(at === -1 ? 0 : at - 16, chars.length - width))
  const cut = chars.slice(start, start + width).join('')
  const shown = `${start > 0 ? '…' : ''}${cut}${start + width < chars.length ? '…' : ''}`
  return { text: shown, lit: highlights(shown, tokens) }
}

// ── What was opened: the palette's memory ───────────────────────────────────────────

/** A thing opened from the palette, as its « Récents » show it again. */
export interface Visit {
  readonly key: string
  readonly count: number
  /** Milliseconds since the epoch. */
  readonly last: number
  /** How to show it, and where it led — the inbox's address. */
  readonly title: string
  readonly subtitle: string | null
  readonly kind: string
  readonly href: string | null
}

const VISITS_KEY = 'chat.search.v1'
/** The memory's size: enough for a month of work, small enough to read at every keystroke. */
const VISITS_LIMIT = 150

/** What this browser opened from the palette — a convenience, never a source of truth. */
export function visits(): readonly Visit[] {
  try {
    const raw = window.localStorage.getItem(VISITS_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (v): v is Visit =>
        typeof v === 'object' &&
        v !== null &&
        typeof (v as Visit).key === 'string' &&
        typeof (v as Visit).count === 'number' &&
        typeof (v as Visit).last === 'number' &&
        typeof (v as Visit).title === 'string',
    )
  } catch {
    return []
  }
}

/** Remembers a thing opened: once more, and now. */
export function remember(visit: Omit<Visit, 'count' | 'last'>, now = Date.now()): void {
  try {
    const known = visits()
    const was = known.find((v) => v.key === visit.key)
    const next: Visit = { ...visit, count: (was?.count ?? 0) + 1, last: now }
    const kept = [next, ...known.filter((v) => v.key !== visit.key)].slice(0, VISITS_LIMIT)
    window.localStorage.setItem(VISITS_KEY, JSON.stringify(kept))
  } catch {
    // A private window: the palette simply does not remember.
  }
}

/** Forgets a thing — gone, or asked to be forgotten. */
export function forgetVisit(key: string): void {
  try {
    const kept = visits().filter((v) => v.key !== key)
    window.localStorage.setItem(VISITS_KEY, JSON.stringify(kept))
  } catch {
    // Nothing to forget in a storage that cannot be read.
  }
}

/**
 * The bonus of a thing opened often and lately, out of about 40: how many times, with a
 * ceiling, then how long ago — within the hour, the day, the week.
 */
export function frecency(visit: Visit | undefined, now = Date.now()): number {
  if (visit === undefined) return 0
  const often = Math.min(22, 7 * Math.log2(1 + visit.count))
  const age = now - visit.last
  const hour = 3_600_000
  const lately = age < hour ? 18 : age < 24 * hour ? 11 : age < 7 * 24 * hour ? 5 : 0
  return often + lately
}
