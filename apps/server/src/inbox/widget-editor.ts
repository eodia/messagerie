import type { WidgetEditor, WidgetEditorSite, WidgetSettings } from '@chat/contracts'
import { Refusal } from '../refusal.js'
import type { Settings, Site } from '../settings/settings.js'
import { SettingsFailure } from '../settings/source.js'
import { languageCode, readWidgetSettings, widgetValues } from '../settings/widget.js'
import type { AgentRow } from './read.js'

/**
 * The widget editor: a site's words and looks, previewed live in the inbox and saved into
 * its row of « Sites » (D19). Saving is a supervisor's alone.
 */

function settingsOf(site: Site): WidgetSettings {
  return {
    name: site.name,
    color: site.color,
    language: languageCode(site.language),
    title: site.title,
    tagline: site.tagline,
    welcome: site.welcome,
    suggestions: site.suggestions,
    appearance: site.appearance,
  }
}

async function editorSite(
  settings: Settings,
  site: Site,
  aiAvailable: boolean,
): Promise<WidgetEditorSite> {
  return {
    id: site.id,
    domains: site.domains,
    ai: site.aiEnabled && aiAvailable,
    team: (await settings.teamFirstNames()).slice(0, 3),
    settings: settingsOf(site),
  }
}

export async function widgetEditor(
  settings: Settings,
  agent: AgentRow,
  aiAvailable: boolean,
): Promise<WidgetEditor> {
  const sites = await settings.sites()
  return {
    sites: await Promise.all(sites.map((site) => editorSite(settings, site, aiAvailable))),
    canEdit: agent.role === 'supervisor',
  }
}

export async function saveWidget(
  settings: Settings,
  agent: AgentRow,
  siteId: string,
  body: unknown,
  aiAvailable: boolean,
): Promise<WidgetEditorSite> {
  if (agent.role !== 'supervisor') throw new Refusal('NOT_ALLOWED', 403)
  if (!(await settings.site(siteId))) throw new Refusal('SITE_NOT_FOUND', 404)
  const next = readWidgetSettings(body)
  if (!next) throw new Refusal('INVALID_REQUEST', 400)
  try {
    await settings.updateSite(siteId, widgetValues(next))
  } catch (error) {
    if (!(error instanceof SettingsFailure)) throw error
    if (error.code === 'ROW_NOT_FOUND') throw new Refusal('SITE_NOT_FOUND', 404)
    throw new Refusal('INVALID_REQUEST', 400, error.field ? { field: error.field } : undefined)
  }
  const saved = await settings.site(siteId)
  if (!saved) throw new Refusal('SITE_NOT_FOUND', 404)
  return editorSite(settings, saved, aiAvailable)
}
