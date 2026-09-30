/**
 * The interface in the reader's language — the contract of basedb's `lib/i18n.ts`.
 *
 * Every text is written in French, in place, and handed to `$t`: the French sentence IS
 * the key. The catalogs of the other languages come later, with basedb's extraction
 * tooling; until then every sentence reads in French — which is what an untranslated
 * sentence does anyway, so no call site will change when they arrive.
 */

const SOURCE_LOCALE = 'fr'

/** The tag `Intl` formats numbers and dates with. */
export const intlLocale = (): string => SOURCE_LOCALE

/** Values given to a message: `{name}` in its text is replaced by `values.name`. */
export type Values = Readonly<Record<string, string | number | boolean | null | undefined>>

/** A value as a sentence shows it: nothing for `false`, as JSX shows `{cond && 'text'}`. */
function valueText(value: Values[string]): string {
  return value === null || value === undefined || value === false ? '' : String(value)
}

function interpolate(text: string, values: Values | undefined): string {
  if (values === undefined) return text
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(values, name) ? valueText(values[name]) : whole,
  )
}

/** One French word, two meanings: the key carries its meaning after `||`, French hides it. */
const CONTEXT = '||'

function shown(french: string): string {
  const at = french.indexOf(CONTEXT)
  return at === -1 ? french : french.slice(0, at)
}

/**
 * A French sentence in the reader's language. `{name}` in the sentence is replaced by
 * `values.name`: `$t('Assignée à {name}', { name })`.
 */
export function $t(french: string, values?: Values): string {
  return interpolate(shown(french), values)
}

/**
 * A French text translated where it is SHOWN, not where it is written — a label in a
 * table of constants. `msg` only marks it for the catalog; the display calls `$t`.
 */
export const msg = <T extends string>(french: T): T => french

const rules = new Map<string, Intl.PluralRules>()
function pluralRule(tag: string, count: number): Intl.LDMLPluralRule {
  let rule = rules.get(tag)
  if (rule === undefined) {
    rule = new Intl.PluralRules(tag)
    rules.set(tag, rule)
  }
  return rule.select(count)
}

/**
 * A French sentence that depends on a number: its singular and its plural, `{count}` in
 * either replaced by the number as the language writes it.
 * `$tp(n, '{count} conversation', '{count} conversations')`.
 */
export function $tp(count: number, one: string, other: string, values?: Values): string {
  // French: 0 and 1 are singular.
  const text = pluralRule(SOURCE_LOCALE, count) === 'one' ? one : other
  return interpolate(text, { count: formatCount(count), ...values })
}

/** A count as the language writes it — `12 345` in French, `12,345` in English. */
export function formatCount(count: number): string {
  return count.toLocaleString(intlLocale())
}
