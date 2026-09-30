/**
 * An article cut into passages the AI can cite: one per `##` heading, as the template
 * tells writers to structure them — « un titre par sujet aide l'IA à citer le bon
 * passage ». A section too long is cut again between paragraphs.
 */

export interface Passage {
  /** The article's title, and the section's when there is one. */
  readonly title: string
  readonly text: string
}

const MAX = 1200

function split(text: string): string[] {
  if (text.length <= MAX) return [text]
  const parts: string[] = []
  let current = ''
  for (const paragraph of text.split(/\n{2,}/)) {
    if (current && current.length + paragraph.length + 2 > MAX) {
      parts.push(current)
      current = ''
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph
    // A single paragraph longer than the limit is cut at a sentence.
    while (current.length > MAX) {
      const cut = current.lastIndexOf('. ', MAX)
      const at = cut > MAX / 2 ? cut + 1 : MAX
      parts.push(current.slice(0, at).trim())
      current = current.slice(at).trim()
    }
  }
  if (current) parts.push(current)
  return parts
}

export function passages(title: string, markdown: string): Passage[] {
  const sections: { heading: string | null; body: string[] }[] = [{ heading: null, body: [] }]
  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const heading = /^#{1,3}\s+(.+)$/.exec(line)
    if (heading) sections.push({ heading: heading[1]?.trim() ?? null, body: [] })
    else sections[sections.length - 1]?.body.push(line)
  }
  return sections.flatMap(({ heading, body }) => {
    const text = body.join('\n').trim()
    if (!text) return []
    const named = heading ? `${title} — ${heading}` : title
    return split(text).map((part) => ({ title: named, text: part }))
  })
}
