import type { InboxItem } from '@chat/contracts'

/**
 * Where the reader is, as the address bar says it — basedb's way: words a person can read,
 * in French, the screen's state and nothing else.
 *
 *   /conversations/<boîte>[/<conversation>][?filtre=ia|ouvertes|en-file|resolues]
 *   /contacts[/<contact>]
 *   /connaissance[/<article>]
 *   /parametrage/<groupe>[/<onglet>][/<ligne>|/nouveau]    /outils[/<outil>]
 *   /widget[/<site>]
 *
 * `<boîte>` is the inbox's name made a word (`service-client`), `toutes` for all of them.
 * A thing chosen in a list is its name and the end of its id (`lea-martin-9f0c3b2a71de`):
 * the id finds it, the name only reads well — renamed since, it is still reached, and the
 * address is then written again with its new name.
 */

/** A text as an address says it: lower case, without accents, words joined by dashes. */
export function slugOf(text: string, max = 48): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/ø/g, 'o')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '')
}

/** All the inboxes, in the address. */
const ALL = 'toutes'
/** How much of an id the address keeps: its random end, enough among a team's conversations. */
const TAIL = 12

const compact = (id: string) => id.replace(/-/g, '').toLowerCase()

/** An inbox's word: its name — with the end of its id when another inbox shares it. */
export function inboxWord(inbox: InboxItem, inboxes: readonly InboxItem[]): string {
  const word = slugOf(inbox.name) || 'boite'
  const shared =
    word === ALL ||
    inboxes.some((other) => other.id !== inbox.id && (slugOf(other.name) || 'boite') === word)
  return shared ? `${word}-${compact(inbox.id).slice(-6)}` : word
}

export const inboxOfWord = (word: string, inboxes: readonly InboxItem[]): InboxItem | null =>
  inboxes.find((inbox) => inboxWord(inbox, inboxes) === word) ?? null

/** A thing's word: its name, then the end of its id. */
export const wordOf = (id: string, name: string, fallback: string): string =>
  `${slugOf(name, 40) || fallback}-${compact(id).slice(-TAIL)}`

/** The end of the id a word carries — `null` if it carries none. */
export const tailOf = (word: string): string | null =>
  /([0-9a-f]{12})$/i.exec(word)?.[1]?.toLowerCase() ?? null

/** The thing a word names, among those known — `null` if none. */
export function idOfWord(word: string, ids: Iterable<string>): string | null {
  const tail = tailOf(word)
  if (!tail) return null
  for (const id of ids) if (compact(id).endsWith(tail)) return id
  return null
}

/** A conversation's word: who it is with, then the end of its id. */
export const conversationWord = (id: string, name: string): string =>
  wordOf(id, name, 'conversation')

/** The conversation a word names, among those the reader sees — `null` if none. */
export const conversationOfWord = idOfWord

/** A row not saved yet, in a settings screen's address. */
export const NEW_WORD = 'nouveau'

/**
 * The words of the address after `base` — `[]` on `base` itself, `null` on another screen.
 */
export function wordsAfter(base: string, pathname = window.location.pathname): string[] | null {
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return null
  try {
    return pathname.slice(base.length).split('/').filter(Boolean).map(decodeURIComponent)
  } catch {
    return null
  }
}

/** `base`, then the words given, each made safe for an address. */
export const addressOf = (base: string, ...words: readonly (string | null)[]): string =>
  [base, ...words.filter((w): w is string => w !== null).map(encodeURIComponent)].join('/')

export type ListFilter = 'all' | 'ai' | 'open' | 'unassigned' | 'resolved'

const FILTER_WORDS: Readonly<Record<ListFilter, string | null>> = {
  all: null,
  ai: 'ia',
  open: 'ouvertes',
  unassigned: 'en-file',
  resolved: 'resolues',
}

/** What the conversations' screen shows: its inbox, its tab, the conversation open. */
export interface ConversationsPlace {
  /** The inbox's word, `null` for all of them; `undefined`: the address names none. */
  readonly inbox: string | null | undefined
  readonly conversation: string | null
  readonly filter: ListFilter
}

export function conversationsAddress(
  inboxId: string | null,
  filter: ListFilter,
  open: { readonly id: string; readonly name: string } | null,
  inboxes: readonly InboxItem[],
): string {
  const inbox = inboxId === null ? null : inboxes.find((i) => i.id === inboxId)
  let path = `/conversations/${encodeURIComponent(inbox ? inboxWord(inbox, inboxes) : ALL)}`
  if (open) path += `/${encodeURIComponent(conversationWord(open.id, open.name))}`
  const word = FILTER_WORDS[filter]
  return word ? `${path}?filtre=${word}` : path
}

/** What an address says of the conversations' screen — `null` if it is another screen. */
export function conversationsPlace(pathname: string, search: string): ConversationsPlace | null {
  let parts: string[]
  try {
    parts = pathname.split('/').filter(Boolean).map(decodeURIComponent)
  } catch {
    return null
  }
  if (parts[0] !== 'conversations') return null
  const asked = new URLSearchParams(search).get('filtre')
  const filter = (Object.keys(FILTER_WORDS) as ListFilter[]).find(
    (key) => FILTER_WORDS[key] === asked,
  )
  const scope = parts[1]
  return {
    inbox: scope === undefined ? undefined : scope === ALL ? null : scope,
    conversation: parts[2] ?? null,
    filter: filter ?? 'all',
  }
}
