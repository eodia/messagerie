import type { Node as PmNode } from '@tiptap/pm/model'
import { type EditorState, Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { Extension } from '@tiptap/react'

/**
 * The AI's proofreading of a draft, shown in it: each word it would change struck in red,
 * what it would write instead in green beside it. A click on the green accepts that one;
 * the composer offers to accept them all. Typing anything else forgets them — the draft
 * is read again after the next pause.
 *
 * The draft goes to the AI as plain text, a line per paragraph; what comes back is
 * compared word by word. A change across a line, or of the structure, is not offered.
 */

export interface Correction {
  readonly id: number
  /** Where the words replaced are, in the editor's document. */
  readonly from: number
  readonly to: number
  readonly removed: string
  readonly insert: string
}

interface ProofState {
  readonly corrections: readonly Correction[]
  readonly decorations: DecorationSet
}

type Meta =
  | { readonly set: readonly Correction[] }
  | { readonly accepted: readonly number[] }
  | { readonly clear: true }

export const proofKey = new PluginKey<ProofState>('proofreading')

const EMPTY: ProofState = { corrections: [], decorations: DecorationSet.empty }

function decorate(doc: PmNode, corrections: readonly Correction[]): DecorationSet {
  const decorations: Decoration[] = []
  for (const c of corrections) {
    if (c.to > c.from) {
      decorations.push(
        Decoration.inline(c.from, c.to, {
          class: c.insert === '' ? 'proof-old proof-pick' : 'proof-old',
          'data-proof': String(c.id),
        }),
      )
    }
    if (c.insert !== '') {
      decorations.push(
        Decoration.widget(
          c.to,
          () => {
            const element = document.createElement('span')
            element.className = 'proof-new proof-pick'
            element.dataset.proof = String(c.id)
            element.textContent = c.insert
            element.contentEditable = 'false'
            return element
          },
          { side: 1, key: `proof-${c.id}-${c.insert}`, ignoreSelection: true },
        ),
      )
    }
  }
  return DecorationSet.create(doc, decorations)
}

export const Proofreading = Extension.create({
  name: 'proofreading',
  addProseMirrorPlugins() {
    return [
      new Plugin<ProofState>({
        key: proofKey,
        state: {
          init: () => EMPTY,
          apply(tr: Transaction, value: ProofState, _old: EditorState, next: EditorState) {
            const meta = tr.getMeta(proofKey) as Meta | undefined
            if (meta && 'clear' in meta) return EMPTY
            if (meta && 'set' in meta) {
              return { corrections: meta.set, decorations: decorate(next.doc, meta.set) }
            }
            if (!tr.docChanged) return value
            // Someone typed: what was read is no longer what is written.
            if (!(meta && 'accepted' in meta)) return EMPTY
            const kept = value.corrections
              .filter((c) => !meta.accepted.includes(c.id))
              .map((c) => ({ ...c, from: tr.mapping.map(c.from), to: tr.mapping.map(c.to, -1) }))
            return { corrections: kept, decorations: decorate(next.doc, kept) }
          },
        },
        props: {
          decorations: (state) => proofKey.getState(state)?.decorations,
          handleDOMEvents: {
            mousedown: (view, event) => {
              const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
                '.proof-pick',
              )
              if (!target) return false
              event.preventDefault()
              accept(view, [Number(target.dataset.proof)])
              return true
            },
          },
        },
      }),
    ]
  },
})

export const correctionsOf = (state: EditorState): readonly Correction[] =>
  proofKey.getState(state)?.corrections ?? []

/** Applies corrections — some, or all of them — the last first, so the others hold. */
export function accept(view: EditorView, ids?: readonly number[]): void {
  const all = correctionsOf(view.state)
  const chosen = all.filter((c) => ids === undefined || ids.includes(c.id))
  if (chosen.length === 0) return
  const tr = view.state.tr
  for (const c of [...chosen].sort((a, b) => b.from - a.from)) {
    if (c.insert === '') tr.delete(c.from, c.to)
    else tr.insertText(c.insert, c.from, c.to)
  }
  tr.setMeta(proofKey, { accepted: chosen.map((c) => c.id) } satisfies Meta)
  view.dispatch(tr)
}

export function forget(view: EditorView): void {
  if (correctionsOf(view.state).length === 0) return
  view.dispatch(view.state.tr.setMeta(proofKey, { clear: true } satisfies Meta))
}

// ── The draft as text, and back to the document's positions ──────────────────────────

/** The draft's text, a line per paragraph — and, for each character, its position. */
export function textOf(doc: PmNode): { readonly text: string; readonly at: readonly number[] } {
  let text = ''
  const at: number[] = []
  let first = true
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    if (!first) {
      text += '\n'
      at.push(-1)
    }
    first = false
    node.forEach((child, offset) => {
      const start = pos + 1 + offset
      if (child.isText) {
        const value = child.text ?? ''
        for (let i = 0; i < value.length; i++) {
          text += value[i]
          at.push(start + i)
        }
      } else {
        text += child.type.name === 'hardBreak' ? '\n' : '￼'
        at.push(-1)
      }
    })
    return false
  })
  return { text, at }
}

const TOKEN = /\s+|[\p{L}\p{N}\p{M}'’-]+|[^\s\p{L}\p{N}\p{M}]/gu

function tokensOf(text: string): { readonly text: string; readonly at: number }[] {
  return [...text.matchAll(TOKEN)].map((m) => ({ text: m[0], at: m.index ?? 0 }))
}

/** The words that changed, as spans of the first text and what replaces them. */
function changes(
  before: string,
  after: string,
): { readonly from: number; readonly to: number; readonly insert: string }[] {
  const a = tokensOf(before)
  const b = tokensOf(after)
  // Too long to compare word by word in a keystroke's time: not proofread.
  if (a.length * b.length > 400_000) return []
  const n = a.length
  const m = b.length
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    const row = lcs[i] as Uint16Array
    const below = lcs[i + 1] as Uint16Array
    for (let j = m - 1; j >= 0; j--) {
      row[j] =
        a[i]?.text === b[j]?.text
          ? (below[j + 1] as number) + 1
          : Math.max(below[j] as number, row[j + 1] as number)
    }
  }
  const out: { from: number; to: number; insert: string }[] = []
  let i = 0
  let j = 0
  let open: { from: number; to: number; insert: string } | null = null
  const offset = (k: number) => a[k]?.at ?? before.length
  while (i < n || j < m) {
    if (i < n && j < m && a[i]?.text === b[j]?.text) {
      if (open) out.push(open)
      open = null
      i++
      j++
    } else if (
      j < m &&
      (i >= n ||
        ((lcs[i] as Uint16Array)[j + 1] as number) >= ((lcs[i + 1] as Uint16Array)[j] as number))
    ) {
      open ??= { from: offset(i), to: offset(i), insert: '' }
      open.insert += b[j]?.text ?? ''
      j++
    } else {
      open ??= { from: offset(i), to: offset(i), insert: '' }
      open.to = offset(i) + (a[i]?.text.length ?? 0)
      i++
    }
  }
  if (open) out.push(open)
  return out
}

/**
 * The corrections a proofread text makes to the document, placed in it. `basis` is the
 * text that was sent — the document must still say it.
 */
export function correctionsFor(doc: PmNode, corrected: string): Correction[] {
  const { text, at } = textOf(doc)
  const out: Correction[] = []
  let id = 0
  for (const change of changes(text, corrected)) {
    const removed = text.slice(change.from, change.to)
    // Spaces alone — a typographic space, a double one —: not worth a mark.
    if (removed.trim() === '' && change.insert.trim() === '') continue
    // Across lines, or the structure: not offered.
    if (change.insert.includes('\n') || change.insert.includes('￼')) continue
    let from: number
    let to: number
    if (change.to > change.from) {
      const span = at.slice(change.from, change.to)
      if (span.some((p) => p < 0)) continue
      from = span[0] as number
      to = (span[span.length - 1] as number) + 1
    } else {
      const next = at[change.from]
      const previous = at[change.from - 1]
      if (next !== undefined && next >= 0) from = next
      else if (previous !== undefined && previous >= 0) from = previous + 1
      else continue
      to = from
    }
    out.push({ id: id++, from, to, removed, insert: change.insert })
  }
  return out
}

export function propose(view: EditorView, corrected: string): void {
  const set = correctionsFor(view.state.doc, corrected)
  view.dispatch(view.state.tr.setMeta(proofKey, { set } satisfies Meta))
}
