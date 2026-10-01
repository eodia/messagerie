import { describe, expect, it } from 'vitest'
import { whenLabel } from '../../src/ai/context.js'
import type { Site } from '../../src/settings/settings.js'

/** When the advisors are back, as a visitor says it — in the site's language and time zone. */

const site = (language: string) => ({ language, timezone: 'Europe/Paris' }) as Site
// Thursday 1 October 2026, 23:45 in Paris.
const now = new Date('2026-10-01T21:45:00Z')

describe('the next opening', () => {
  it('is « demain » the next day, « aujourd’hui » the same day', () => {
    expect(whenLabel(new Date('2026-10-02T07:00:00Z'), site('Français'), now)).toBe('demain à 9 h')
    const morning = new Date('2026-10-01T06:00:00Z')
    expect(whenLabel(new Date('2026-10-01T12:30:00Z'), site('Français'), morning)).toBe(
      'aujourd’hui à 14 h 30',
    )
  })

  it('is the weekday within the week, the full date beyond', () => {
    expect(whenLabel(new Date('2026-10-05T07:00:00Z'), site('Français'), now)).toBe('lundi à 9 h')
    expect(whenLabel(new Date('2026-10-12T07:00:00Z'), site('Français'), now)).toBe(
      'lundi 12 octobre à 9 h',
    )
  })

  it('speaks the site’s language', () => {
    // en-GB: the time on 24 hours.
    expect(whenLabel(new Date('2026-10-02T07:00:00Z'), site('English'), now)).toBe(
      'tomorrow at 9:00',
    )
  })
})
