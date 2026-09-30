/**
 * A JSON object from a model's answer — which may wrap it in a code fence, or in a
 * sentence. The first balanced `{…}` is read; nothing that is not an object is accepted.
 */
export function readJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  for (let at = start; at < text.length; at++) {
    const ch = text[at]
    if (inString) {
      if (ch === '\\') at++
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          const value: unknown = JSON.parse(text.slice(start, at + 1))
          return typeof value === 'object' && value !== null && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : null
        } catch {
          return null
        }
      }
    }
  }
  return null
}
