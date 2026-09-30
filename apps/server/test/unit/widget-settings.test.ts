import type { WidgetSettings } from '@chat/contracts'
import { describe, expect, it } from 'vitest'
import type { BasedbClient, TableDescription } from '../../src/basedb/client.js'
import type { AgentRow } from '../../src/inbox/read.js'
import { saveWidget, widgetEditor } from '../../src/inbox/widget-editor.js'
import { Settings } from '../../src/settings/settings.js'
import { BasedbSource, TemplateSource } from '../../src/settings/source.js'
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
    const settings = new Settings(new TemplateSource('dev-marc', true))
    await settings.updateSite('acme', widgetValues(edited), null)
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
    const settings = new Settings(new TemplateSource('dev-marc', true))
    await expect(saveWidget(settings, agent, null, 'acme', edited, true)).rejects.toMatchObject({
      code: 'NOT_ALLOWED',
    })
    await expect(
      saveWidget(settings, supervisor, null, 'acme', { ...edited, name: '' }, true),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(
      saveWidget(settings, supervisor, null, 'nope', edited, true),
    ).rejects.toMatchObject({ code: 'SITE_NOT_FOUND' })

    const saved = await saveWidget(settings, supervisor, null, 'acme', edited, true)
    expect(saved.settings).toEqual(edited)
    const editor = await widgetEditor(settings, supervisor, true)
    expect(editor).toMatchObject({ persistent: false, canEdit: true })
    expect(editor.sites[0]?.settings.appearance.position).toBe('left')
  })
})

describe('basedb', () => {
  it('receives physical names, choices by value, and the person’s token', async () => {
    const table: TableDescription = {
      name: 'sites',
      label: 'Sites',
      fields: [
        { name: 'nom', label: 'Nom', kind: 'short_text' },
        {
          name: 'position_du_widget',
          label: 'Position du widget',
          kind: 'select',
          options: [
            { value: 'opt_right', label: 'En bas à droite' },
            { value: 'opt_left', label: 'En bas à gauche' },
          ],
        },
      ],
    }
    const calls: unknown[] = []
    const client = {
      describe: async () => ({ name: 'messagerie', tables: [table] }),
      update: async (...args: unknown[]) => {
        calls.push(args)
        return { _id: 'r1' }
      },
    } as unknown as BasedbClient
    await new BasedbSource(client).update(
      'Sites',
      'r1',
      { Nom: 'Acme', 'Position du widget': 'En bas à gauche' },
      'person-token',
    )
    expect(calls).toEqual([
      ['sites', 'r1', { nom: 'Acme', position_du_widget: 'opt_left' }, 'person-token'],
    ])
    await expect(
      new BasedbSource(client).update('Sites', 'r1', { Inconnu: 1 }, null),
    ).rejects.toMatchObject({ code: 'TEMPLATE_MISMATCH: Sites › Inconnu' })
  })
})
