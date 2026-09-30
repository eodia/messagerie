import type { WidgetEditorSite, WidgetSettings, WidgetSite } from '@chat/contracts'

/**
 * The editor's draft: what the server will accept of it, what is wrong in it, and the site
 * the preview shows. The server checks again — these checks only say it sooner.
 */

export interface Problems {
  readonly name: boolean
  readonly color: boolean
  readonly customFont: boolean
  readonly logo: boolean
  readonly offsetX: boolean
  readonly offsetY: boolean
  readonly nudgeAfter: boolean
}

const blank = (value: string | null) => {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

/** The draft as the server takes it: trimmed, empty as null, no empty question. */
export function normalize(draft: WidgetSettings): WidgetSettings {
  const look = draft.appearance
  return {
    ...draft,
    name: draft.name.trim(),
    color: draft.color.trim().toUpperCase(),
    title: blank(draft.title),
    tagline: blank(draft.tagline),
    welcome: blank(draft.welcome),
    suggestions: draft.suggestions.map((q) => q.trim()).filter((q) => q !== ''),
    appearance: {
      ...look,
      launcherLabel: blank(look.launcherLabel),
      customFont: blank(look.customFont),
      logo: blank(look.logo),
    },
  }
}

const whole = (value: number, max: number) => Number.isInteger(value) && value >= 0 && value <= max

export function problemsOf(draft: WidgetSettings): Problems {
  const look = draft.appearance
  const logo = blank(look.logo)
  const font = blank(look.customFont)
  let logoOk = true
  if (logo) {
    try {
      logoOk = new URL(logo).protocol === 'https:'
    } catch {
      logoOk = false
    }
  }
  return {
    name: draft.name.trim() === '',
    color: !/^#[0-9a-f]{6}$/i.test(draft.color.trim()),
    customFont: font !== null && !/^[\p{L}\p{N} _-]+$/u.test(font),
    logo: !logoOk,
    offsetX: !whole(look.offsetX, 200),
    offsetY: !whole(look.offsetY, 200),
    nudgeAfter: look.nudgeAfter !== null && !whole(look.nudgeAfter, 600),
  }
}

export const hasProblems = (problems: Problems) => Object.values(problems).some(Boolean)

/** The site as the widget receives it, from the draft — whatever is valid of it. */
export function previewSite(site: WidgetEditorSite, draft: WidgetSettings): WidgetSite {
  const clean = normalize(draft)
  const problems = problemsOf(draft)
  const look = clean.appearance
  return {
    name: clean.name || site.settings.name,
    title: clean.title,
    tagline: clean.tagline,
    welcome: clean.welcome,
    suggestions: clean.suggestions,
    color: problems.color ? site.settings.color : clean.color,
    language: clean.language,
    ai: site.ai,
    team: look.showTeam ? site.team : [],
    appearance: {
      ...look,
      customFont: problems.customFont ? null : look.customFont,
      logo: problems.logo ? null : look.logo,
      offsetX: problems.offsetX ? 20 : look.offsetX,
      offsetY: problems.offsetY ? 20 : look.offsetY,
      nudgeAfter: problems.nudgeAfter ? null : look.nudgeAfter,
    },
  }
}

/** The contrast of the words the widget writes on this colour — white or near black. */
export function contrastOn(hex: string): number | null {
  if (!/^#[0-9a-f]{6}$/i.test(hex.trim())) return null
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.trim().slice(i, i + 2), 16) / 255)
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const luminance = 0.2126 * lin(r ?? 0) + 0.7152 * lin(g ?? 0) + 0.0722 * lin(b ?? 0)
  // The widget's rule: near-black words above 0.45, white below.
  const ink = luminance > 0.45 ? 0.0093 : 1
  const [light, dark] = luminance > ink ? [luminance, ink] : [ink, luminance]
  return (light + 0.05) / (dark + 0.05)
}
