import type { WidgetSettings } from '@chat/contracts'
import { describe, expect, it } from 'vitest'
import type { AgentRow } from '../../src/inbox/read.js'
import { saveWidget, widgetEditor } from '../../src/inbox/widget-editor.js'
import { MemorySource } from '../../src/settings/demo.js'
import { Settings } from '../../src/settings/settings.js'
import {
  DEFAULT_APPEARANCE,
  appearanceOf,
  readWidgetSettings,
  widgetValues,
} from '../../src/settings/widget.js'

/** The widget's settings: read from a site's row, checked, and written back. */

const supervisor = { id: 'a1', role: 'supervisor' } as AgentRow
const agent = { id: 'a2', role: 'agent' } as AgentRow

const edited: WidgetSettings = {
  name: 'Acme',
  color: '#0F766E',
  language: 'en',
  title: 'Hello {prénom}!',
  tagline: 'We answer within minutes.',
  welcome: 'Hi! How can we help?',
  suggestions: ['Where is my refund?', 'How do I file a claim?'],
  appearance: {
    ...DEFAULT_APPEARANCE,
    position: 'left',
    offsetX: 32,
    launcher: 'label',
    launcherLabel: 'Une question ?',
    font: 'custom',
    customFont: 'Inter',
    theme: 'dark',
    corners: 'soft',
    logo: 'https://acme.example/logo.png',
    showTeam: false,
    nudgeAfter: 8,
    branding: false,
  },
}

describe('a site row', () => {
  it('reads as the defaults when its fields are empty', () => {
    expect(appearanceOf({})).toEqual(DEFAULT_APPEARANCE)
  })

  it('drops what the widget could not use safely', () => {
    const look = appearanceOf({
      Police: 'Personnalisée',
      'Police personnalisée': 'Inter; } .root { display: none',
      Logo: 'javascript:alert(1)',
      'Marge horizontale (px)': 5000,
      "Bulle d'accueil après (secondes)": -3,
      Thème: 'Fluo',
    })
    expect(look).toMatchObject({
      font: 'custom',
      customFont: null,
      logo: null,
      offsetX: 20,
      nudgeAfter: null,
      theme: 'auto',
    })
  })
})

describe("the editor's settings", () => {
  it('are checked field by field', () => {
    expect(readWidgetSettings(edited)).toEqual(edited)
    expect(readWidgetSettings({ ...edited, color: 'red' })).toBeNull()
    expect(readWidgetSettings({ ...edited, suggestions: ['a\nb'] })).toBeNull()
    expect(
      readWidgetSettings({
        ...edited,
        appearance: { ...edited.appearance, logo: 'http://x.fr/a' },
      }),
    ).toBeNull()
    expect(
      readWidgetSettings({ ...edited, appearance: { ...edited.appearance, customFont: 'a{b}' } }),
    ).toBeNull()
  })

  it('read back as they were written', async () => {
    const settings = new Settings(new MemorySource('dev-marc'))
    await settings.updateSite('acme', widgetValues(edited))
    const site = await settings.site('acme')
    expect(site).toMatchObject({
      name: 'Acme',
      color: '#0F766E',
      language: 'English',
      title: 'Hello {prénom}!',
      suggestions: edited.suggestions,
      appearance: edited.appearance,
    })
  })

  it('are saved by a supervisor only, and only when valid', async () => {
    const settings = new Settings(new MemorySource('dev-marc'))
    await expect(saveWidget(settings, agent, 'acme', edited, true)).rejects.toMatchObject({
      code: 'NOT_ALLOWED',
    })
    await expect(
      saveWidget(settings, supervisor, 'acme', { ...edited, name: '' }, true),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(saveWidget(settings, supervisor, 'nope', edited, true)).rejects.toMatchObject({
      code: 'SITE_NOT_FOUND',
    })

    const saved = await saveWidget(settings, supervisor, 'acme', edited, true)
    expect(saved.settings).toEqual(edited)
    const editor = await widgetEditor(settings, supervisor, true)
    expect(editor).toMatchObject({ canEdit: true })
    expect(editor.sites[0]?.settings.appearance.position).toBe('left')
  })
})
