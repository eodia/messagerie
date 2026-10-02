/**
 * A tiny syntax highlighter for the four languages the documentation shows: JSON, shell,
 * JavaScript and SQL.
 *
 * Not a parser. Each language is a list of `[kind, pattern]` rules, folded into ONE
 * alternation: the leftmost match wins, and on a tie the earlier rule does. That is enough
 * for what the generator writes — strings, numbers, keywords, comments — and it is what
 * keeps this a few dozen lines instead of a dependency. Text no rule claims is left plain,
 * so a language it does not know degrades to an unhighlighted block.
 *
 * It returns TOKENS, never markup: the renderer puts each one in a React text node.
 */

export type TokenKind =
  | 'string'
  | 'number'
  | 'keyword'
  | 'comment'
  | 'property'
  | 'function'
  | 'punct'

export interface Token {
  readonly text: string
  /** Absent for text that is left as it is. */
  readonly kind?: TokenKind
}

type Rule = readonly [TokenKind, string]

const NUMBER: Rule = ['number', String.raw`\b\d+(?:\.\d+)?\b`]

// The three JavaScript strings. In `String.raw`, an escaped backtick keeps its backslash —
// which a RegExp reads as a plain backtick.
const SINGLE_QUOTED = String.raw`'(?:\\.|[^'\\\n])*'`
const DOUBLE_QUOTED = String.raw`"(?:\\.|[^"\\\n])*"`
const TEMPLATE = String.raw`\`(?:\\[\s\S]|[^\`\\])*\``

const RULES: Readonly<Record<string, { rules: readonly Rule[]; flags: string }>> = {
  json: {
    flags: 'g',
    rules: [
      // A string followed by a colon is a KEY, and reads differently from a value.
      ['property', String.raw`"(?:\\.|[^"\\\n])*"(?=[ \t]*:)`],
      ['string', String.raw`"(?:\\.|[^"\\\n])*"`],
      ['number', String.raw`-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b`],
      ['keyword', String.raw`\b(?:true|false|null)\b`],
      ['punct', String.raw`[{}\[\],:]`],
    ],
  },
  bash: {
    flags: 'gm',
    rules: [
      ['comment', String.raw`(?<=^|\s)#[^\n]*`],
      ['string', String.raw`"(?:\\[\s\S]|[^"\\])*"|'[^']*'`],
      ['function', String.raw`\$\{[^}\n]*\}|\$[A-Za-z_]\w*`],
      ['property', String.raw`(?<=\s)--?[A-Za-z][\w-]*`],
      ['keyword', String.raw`\b(?:curl|export|echo|cd|psql|jq|sudo|if|then|else|fi|for|do|done)\b`],
      NUMBER,
      // The line continuation: present in every multi-line command, and noise to read.
      ['punct', String.raw`\\(?=[ \t]*$)`],
    ],
  },
  js: {
    flags: 'g',
    rules: [
      ['comment', String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/`],
      ['string', [SINGLE_QUOTED, DOUBLE_QUOTED, TEMPLATE].join('|')],
      NUMBER,
      [
        'keyword',
        String.raw`\b(?:const|let|var|function|return|new|await|async|if|else|for|while|of|in|import|export|from|default|class|extends|try|catch|throw|typeof|instanceof|true|false|null|undefined|this)\b`,
      ],
      ['function', String.raw`\b[A-Za-z_$][\w$]*(?=\()`],
    ],
  },
  sql: {
    flags: 'gi',
    rules: [
      ['comment', String.raw`--[^\n]*|\/\*[\s\S]*?\*\/`],
      ['string', String.raw`'(?:''|[^'])*'`],
      // A quoted identifier: the schema and table names the generator writes.
      ['property', String.raw`"(?:""|[^"])*"`],
      NUMBER,
      [
        'keyword',
        String.raw`\b(?:select|from|where|insert|into|values|update|set|delete|join|left|right|inner|outer|on|and|or|not|null|as|order|by|group|limit|offset|desc|asc|in|is|like|create|table|alter|drop|returning|distinct|count|having|union|with|case|when|then|else|end)\b`,
      ],
      ['punct', String.raw`[(),;.*=<>]`],
    ],
  },
}

const ALIASES: Readonly<Record<string, string>> = {
  json: 'json',
  jsonc: 'json',
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  curl: 'bash',
  js: 'js',
  javascript: 'js',
  jsx: 'js',
  ts: 'js',
  typescript: 'js',
  sql: 'sql',
  psql: 'sql',
}

/** How a language is named on its own, when the fence carries no title. */
const LABELS: Readonly<Record<string, string>> = {
  json: 'JSON',
  bash: 'Bash',
  js: 'JavaScript',
  sql: 'SQL',
}

/** The label of a block: its title when it has one, else its language, else a neutral word. */
export function labelFor(lang: string, title: string | undefined): string {
  if (title !== undefined && title !== '') return title
  const known = ALIASES[lang]
  if (known !== undefined) return LABELS[known] ?? known
  return lang === '' ? 'Texte' : lang.toUpperCase()
}

const compiled = new Map<string, { pattern: RegExp; kinds: readonly TokenKind[] }>()

function compile(language: string) {
  const cached = compiled.get(language)
  if (cached !== undefined) return cached
  const spec = RULES[language]
  if (spec === undefined) return undefined
  const entry = {
    pattern: new RegExp(spec.rules.map(([, source]) => `(${source})`).join('|'), spec.flags),
    kinds: spec.rules.map(([kind]) => kind),
  }
  compiled.set(language, entry)
  return entry
}

/** A `$VAR` or `${expr}` inside a string is a variable, not part of the string. */
const INTERPOLATION = /\$\{[^}\n]*\}|\$[A-Za-z_]\w*/g

/**
 * Splits a string token around its interpolations. Only where the language does interpolate:
 * a template literal in JavaScript, a double-quoted string in shell.
 */
function withInterpolation(text: string, language: string): Token[] {
  const interpolates =
    (language === 'js' && text.startsWith('`')) || (language === 'bash' && text.startsWith('"'))
  if (!interpolates) return [{ text, kind: 'string' }]

  const parts: Token[] = []
  let last = 0
  for (const match of text.matchAll(INTERPOLATION)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index), kind: 'string' })
    parts.push({ text: match[0], kind: 'function' })
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), kind: 'string' })
  return parts
}

/** Tokens for `code` in `lang`, whose concatenated text is exactly `code`. */
export function highlight(lang: string, code: string): Token[] {
  const language = ALIASES[lang] ?? ''
  const entry = compile(language)
  if (entry === undefined) return [{ text: code }]

  const tokens: Token[] = []
  let last = 0
  for (const match of code.matchAll(entry.pattern)) {
    // A rule that matched nothing would loop forever on the same spot; none can today, and
    // this keeps it that way when one is added.
    if (match[0] === '') continue
    if (match.index > last) tokens.push({ text: code.slice(last, match.index) })

    const which = match.findIndex((group, index) => index > 0 && group !== undefined) - 1
    const kind = entry.kinds[which]
    if (kind === 'string') tokens.push(...withInterpolation(match[0], language))
    else tokens.push({ text: match[0], kind })
    last = match.index + match[0].length
  }
  if (last < code.length) tokens.push({ text: code.slice(last) })
  return tokens
}
