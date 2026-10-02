import type { WidgetAppearance, WidgetSettings } from '@chat/contracts'

/**
 * The widget's words and looks, as the row of a site holds them (« Sites ») and
 * as the widget editor sends them back. The same checks apply both ways: a value typed in
 * the settings that the widget could not use safely — a font name with CSS in it, an image that
 * is not https — is read as if empty.
 */

export const DEFAULT_APPEARANCE: WidgetAppearance = {
  position: 'right',
  offsetX: 20,
  offsetY: 20,
  launcher: 'round',
  launcherLabel: null,
  font: 'site',
  customFont: null,
  theme: 'auto',
  corners: 'round',
  logo: null,
  showTeam: true,
  nudgeAfter: null,
  hideOnMobile: false,
  hideWhenAway: false,
  branding: true,
}

/** The choices of the template, by label, and what they mean. */
const LANGUAGES = { Français: 'fr', English: 'en', Deutsch: 'de', Español: 'es' } as const
const POSITIONS = { 'En bas à droite': 'right', 'En bas à gauche': 'left' } as const
const LAUNCHERS = { Rond: 'round', 'Avec libellé': 'label' } as const
const FONTS = {
  'Police du site': 'site',
  Système: 'system',
  Arrondie: 'rounded',
  Serif: 'serif',
  Personnalisée: 'custom',
} as const
const THEMES = { Automatique: 'auto', Clair: 'light', Sombre: 'dark' } as const
const CORNERS = { Arrondis: 'round', Adoucis: 'soft', Droits: 'square' } as const

type Codes<T extends Record<string, string>> = T[keyof T]

function code<T extends Record<string, string>>(
  map: T,
  value: unknown,
  fallback: Codes<T>,
): Codes<T> {
  return typeof value === 'string' && value in map ? (map[value] as Codes<T>) : fallback
}

function labelOf<T extends Record<string, string>>(map: T, value: Codes<T>): string {
  return Object.entries(map).find(([, v]) => v === value)?.[0] ?? ''
}

function isCode<T extends Record<string, string>>(map: T, value: unknown): value is Codes<T> {
  return typeof value === 'string' && Object.values(map).includes(value)
}

export const languageCode = (label: string): WidgetSettings['language'] =>
  code(LANGUAGES, label, 'fr')

// ── Checks, the same for the row's values and the editor's ─────────────────────────────

const LIMITS = {
  name: 80,
  title: 120,
  tagline: 300,
  welcome: 1000,
  suggestion: 120,
  suggestions: 6,
  launcherLabel: 40,
  customFont: 60,
  logo: 500,
  offset: 200,
  nudge: 600,
} as const

const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() !== '' && value.trim().length <= max
    ? value.trim()
    : null

/** A font's name, and nothing that could reach beyond `font-family`. */
const fontName = (value: unknown): string | null => {
  const name = text(value, LIMITS.customFont)
  return name && /^[\p{L}\p{N} _-]+$/u.test(name) ? name : null
}

const httpsUrl = (value: unknown): string | null => {
  const url = text(value, LIMITS.logo)
  if (!url) return null
  try {
    return new URL(url).protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

const whole = (value: unknown, max: number): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max ? value : null

export const colorOf = (value: unknown): string | null =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : null

export const suggestionsOf = (value: unknown): string[] =>
  (typeof value === 'string' ? value.split('\n') : [])
    .map((q) => q.trim())
    .filter((q) => q !== '' && q.length <= LIMITS.suggestion)
    .slice(0, LIMITS.suggestions)

// ── The site's row → the widget ─────────────────────────────────────────────────────────

/** A site's looks from its row, by field label. */
export function appearanceOf(values: Readonly<Record<string, unknown>>): WidgetAppearance {
  const d = DEFAULT_APPEARANCE
  return {
    position: code(POSITIONS, values['Position du widget'], d.position),
    offsetX: whole(values['Marge horizontale (px)'], LIMITS.offset) ?? d.offsetX,
    offsetY: whole(values['Marge verticale (px)'], LIMITS.offset) ?? d.offsetY,
    launcher: code(LAUNCHERS, values.Bouton, d.launcher),
    launcherLabel: text(values['Libellé du bouton'], LIMITS.launcherLabel),
    font: code(FONTS, values.Police, d.font),
    customFont: fontName(values['Police personnalisée']),
    theme: code(THEMES, values.Thème, d.theme),
    corners: code(CORNERS, values.Coins, d.corners),
    logo: httpsUrl(values.Logo),
    showTeam: values["Masquer l'équipe"] !== true,
    nudgeAfter: whole(values["Bulle d'accueil après (secondes)"], LIMITS.nudge),
    hideOnMobile: values['Masquer sur mobile'] === true,
    hideWhenAway: values['Masquer hors horaires'] === true,
    branding: values['Masquer la mention du logiciel'] !== true,
  }
}

export const titleOf = (value: unknown) => text(value, LIMITS.title)
export const taglineOf = (value: unknown) => text(value, LIMITS.tagline)

// ── The editor's settings → the site's row ──────────────────────────────────────────────

const optional = (value: unknown, check: (v: unknown) => unknown): boolean =>
  value === null || check(value) !== null

/**
 * The editor's body, checked field by field; null when a field is missing or wrong — the
 * editor never sends one, so there is nothing to explain beyond « invalid ».
 */
export function readWidgetSettings(body: unknown): WidgetSettings | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  const a = (b.appearance ?? null) as Record<string, unknown> | null
  if (typeof a !== 'object' || a === null) return null
  const suggestions = Array.isArray(b.suggestions) ? b.suggestions : null
  const valid =
    text(b.name, LIMITS.name) !== null &&
    colorOf(b.color) !== null &&
    isCode(LANGUAGES, b.language) &&
    optional(b.title, (v) => text(v, LIMITS.title)) &&
    optional(b.tagline, (v) => text(v, LIMITS.tagline)) &&
    optional(b.welcome, (v) => text(v, LIMITS.welcome)) &&
    suggestions !== null &&
    suggestions.length <= LIMITS.suggestions &&
    suggestions.every((q) => text(q, LIMITS.suggestion) !== null && !String(q).includes('\n')) &&
    isCode(POSITIONS, a.position) &&
    whole(a.offsetX, LIMITS.offset) !== null &&
    whole(a.offsetY, LIMITS.offset) !== null &&
    isCode(LAUNCHERS, a.launcher) &&
    optional(a.launcherLabel, (v) => text(v, LIMITS.launcherLabel)) &&
    isCode(FONTS, a.font) &&
    optional(a.customFont, fontName) &&
    isCode(THEMES, a.theme) &&
    isCode(CORNERS, a.corners) &&
    optional(a.logo, httpsUrl) &&
    typeof a.showTeam === 'boolean' &&
    (a.nudgeAfter === null || whole(a.nudgeAfter, LIMITS.nudge) !== null) &&
    typeof a.hideOnMobile === 'boolean' &&
    typeof a.hideWhenAway === 'boolean' &&
    typeof a.branding === 'boolean'
  if (!valid) return null
  const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : null)
  return {
    name: String(b.name).trim(),
    color: String(b.color).trim(),
    language: b.language as WidgetSettings['language'],
    title: clean(b.title),
    tagline: clean(b.tagline),
    welcome: clean(b.welcome),
    suggestions: (suggestions as string[]).map((q) => q.trim()),
    appearance: {
      position: a.position as WidgetAppearance['position'],
      offsetX: a.offsetX as number,
      offsetY: a.offsetY as number,
      launcher: a.launcher as WidgetAppearance['launcher'],
      launcherLabel: clean(a.launcherLabel),
      font: a.font as WidgetAppearance['font'],
      customFont: clean(a.customFont),
      theme: a.theme as WidgetAppearance['theme'],
      corners: a.corners as WidgetAppearance['corners'],
      logo: clean(a.logo),
      showTeam: a.showTeam as boolean,
      nudgeAfter: a.nudgeAfter as number | null,
      hideOnMobile: a.hideOnMobile as boolean,
      hideWhenAway: a.hideWhenAway as boolean,
      branding: a.branding as boolean,
    },
  }
}

/** The row's values for these settings, by field label. */
export function widgetValues(settings: WidgetSettings): Record<string, unknown> {
  const a = settings.appearance
  return {
    Nom: settings.name,
    'Couleur du widget': settings.color,
    Langue: labelOf(LANGUAGES, settings.language),
    "Titre d'accueil": settings.title,
    "Sous-titre d'accueil": settings.tagline,
    "Message d'accueil": settings.welcome,
    'Questions suggérées': settings.suggestions.length > 0 ? settings.suggestions.join('\n') : null,
    'Position du widget': labelOf(POSITIONS, a.position),
    'Marge horizontale (px)': a.offsetX,
    'Marge verticale (px)': a.offsetY,
    Bouton: labelOf(LAUNCHERS, a.launcher),
    'Libellé du bouton': a.launcherLabel,
    Police: labelOf(FONTS, a.font),
    'Police personnalisée': a.customFont,
    Thème: labelOf(THEMES, a.theme),
    Coins: labelOf(CORNERS, a.corners),
    Logo: a.logo,
    "Masquer l'équipe": !a.showTeam,
    "Bulle d'accueil après (secondes)": a.nudgeAfter,
    'Masquer sur mobile': a.hideOnMobile,
    'Masquer hors horaires': a.hideWhenAway,
    'Masquer la mention du logiciel': !a.branding,
  }
}
