/**
 * Personal data masked before it leaves for a model hosted elsewhere (framing: « masquage
 * des données personnelles avant envoi au LLM si le modèle est externe »).
 *
 * Each value becomes a placeholder — `[EMAIL_1]`, `[TÉLÉPHONE_2]` — the same one for the
 * same value, so the model still reasons about « the address the customer gave »; the
 * answer gets the real values back before anyone reads it.
 */

const PATTERNS: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: 'EMAIL', pattern: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu },
  { label: 'IBAN', pattern: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g },
  { label: 'CARTE', pattern: /\b(?:\d[ -]?){13,19}\b/g },
  {
    label: 'SÉCU',
    pattern: /\b[12][ ]?\d{2}[ ]?\d{2}[ ]?(?:\d{2}|2[AB])[ ]?\d{3}[ ]?\d{3}(?:[ ]?\d{2})?\b/g,
  },
  {
    label: 'TÉLÉPHONE',
    pattern: /(?:\+\d{2,3}[ .-]?|\b0)[1-9](?:[ .-]?\d{2}){4}\b/g,
  },
]

export class Redactor {
  private readonly toPlaceholder = new Map<string, string>()
  private readonly toValue = new Map<string, string>()
  private readonly counts = new Map<string, number>()

  constructor(readonly enabled: boolean) {}

  mask(text: string): string {
    if (!this.enabled) return text
    let masked = text
    for (const { label, pattern } of PATTERNS) {
      masked = masked.replace(pattern, (value) => {
        const known = this.toPlaceholder.get(value)
        if (known) return known
        const count = (this.counts.get(label) ?? 0) + 1
        this.counts.set(label, count)
        const placeholder = `[${label}_${count}]`
        this.toPlaceholder.set(value, placeholder)
        this.toValue.set(placeholder, value)
        return placeholder
      })
    }
    return masked
  }

  /** The model's words, with the real values back in place of the placeholders. */
  unmask(text: string): string {
    if (!this.enabled || this.toValue.size === 0) return text
    return text.replace(
      /\[[A-ZÉ]+_\d+\]/g,
      (placeholder) => this.toValue.get(placeholder) ?? placeholder,
    )
  }
}
