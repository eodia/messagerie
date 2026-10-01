import type { Agent, ConversationSummary, InboxItem } from '@chat/contracts'
import { fold, prepare, scoreOf, tokensOf } from './search'

/**
 * The list's search, the palette's way: the words matched as basedb matches them — accents
 * and case aside, a slip forgiven, initials —, the best answer first. `#étiquette` and
 * `@conseiller` narrow to a tag, to an assignee; `@moi` is the reader.
 */
export interface ListQuery {
  /** The words without the prefixed ones: what the server looks for in the messages. */
  readonly text: string
  readonly tokens: readonly string[]
  readonly tags: readonly string[]
  readonly people: readonly string[]
}

export function parseListQuery(query: string): ListQuery {
  const tags: string[] = []
  const people: string[] = []
  const words: string[] = []
  for (const word of query.trim().split(/\s+/u)) {
    if (word.length > 1 && word.startsWith('#')) tags.push(fold(word.slice(1)))
    else if (word.length > 1 && word.startsWith('@')) people.push(fold(word.slice(1)))
    else if (word !== '' && word !== '#' && word !== '@') words.push(word)
  }
  const text = words.join(' ')
  return { text, tokens: tokensOf(text), tags, people }
}

const SEPARATOR = /[\s\-_'’.]+/u

/**
 * The code points of a text that say the words typed, as typed — accents and case aside,
 * but no initials nor scattered letters: in a sentence, those are coincidences.
 */
export function wordsLit(text: string, words: readonly string[]): ReadonlySet<number> {
  const chars = Array.from(fold(text))
  const lit = new Set<number>()
  for (const word of words) {
    const wanted = Array.from(word)
    if (wanted.length < 2) continue
    for (let i = 0; i + wanted.length <= chars.length; i++) {
      if (wanted.every((char, j) => chars[i + j] === char)) {
        for (let j = 0; j < wanted.length; j++) lit.add(i + j)
      }
    }
  }
  return lit
}

/** Whether a text says every word typed — then it explains why its row was found. */
export const saysAll = (text: string, words: readonly string[]): boolean => {
  const folded = fold(text)
  return words.every((word) => folded.includes(word))
}

/** Whether one of the words of `text` starts with `part` — both folded. */
const startsAWord = (text: string, part: string) =>
  fold(text)
    .split(SEPARATOR)
    .some((word) => word.startsWith(part))

/** Whether a conversation has every tag and assignee asked with `#` and `@`. */
export function holds(summary: ConversationSummary, query: ListQuery, me: Agent | null): boolean {
  return (
    query.tags.every((tag) => summary.tags.some((t) => startsAWord(t.label, tag))) &&
    query.people.every((person) =>
      person === 'moi'
        ? me !== null && summary.assigneeId === me.id
        : summary.assignee !== null && startsAWord(summary.assignee, person),
    )
  )
}

/**
 * The conversations that answer the query, the best first — the newest first among equals,
 * as the rows come. Who it is counts most; what was said last, the email, the tags and the
 * assignee next; the site and the inbox only alongside another match.
 */
export function searchConversations(
  rows: readonly ConversationSummary[],
  query: ListQuery,
  me: Agent | null,
  inboxes: readonly InboxItem[],
): ConversationSummary[] {
  const scored: { readonly summary: ConversationSummary; readonly score: number }[] = []
  for (const summary of rows) {
    if (!holds(summary, query, me)) continue
    if (query.tokens.length === 0) {
      scored.push({ summary, score: 0 })
      continue
    }
    const inbox = inboxes.find((i) => i.id === summary.inboxId)
    const score = scoreOf(
      query.tokens,
      prepare({
        title: summary.contact.name,
        keywords: [
          summary.preview,
          summary.contact.email ?? '',
          ...summary.tags.map((t) => t.label),
          summary.assignee ?? '',
        ].join(' '),
        context: [summary.site, inbox?.name ?? ''].join(' '),
      }),
    )
    if (score > 0) scored.push({ summary, score })
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.summary)
}
