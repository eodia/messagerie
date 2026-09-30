import type { WidgetEditor, WidgetEditorSite, WidgetSettings } from '@chat/contracts'
import { BasedbFailure } from '../basedb/client.js'
import { Refusal } from '../refusal.js'
import type { Settings, Site } from '../settings/settings.js'
import { languageCode, readWidgetSettings, widgetValues } from '../settings/widget.js'
import type { AgentRow } from './read.js'

/**
 * The widget editor: a site's words and looks, previewed live in the inbox and saved into
 * its row of « Sites » in basedb — which stays where the settings live (D10). Saving is a
 * supervisor's, and happens with their own basedb token: basedb applies their rights, and
 * its history keeps their name.
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
    persistent: settings.source.kind === 'basedb',
    canEdit: agent.role === 'supervisor',
  }
}

export async function saveWidget(
  settings: Settings,
  agent: AgentRow,
  token: string | null,
  siteId: string,
  body: unknown,
  aiAvailable: boolean,
): Promise<WidgetEditorSite> {
  if (agent.role !== 'supervisor') throw new Refusal('NOT_ALLOWED', 403)
  if (!(await settings.site(siteId))) throw new Refusal('SITE_NOT_FOUND', 404)
  const next = readWidgetSettings(body)
  if (!next) throw new Refusal('INVALID_REQUEST', 400)
  try {
    await settings.updateSite(siteId, widgetValues(next), token)
  } catch (error) {
    if (error instanceof BasedbFailure) {
      if (error.status === 401 || error.status === 403)
        throw new Refusal('SETTINGS_WRITE_REFUSED', 403)
      if (error.code.startsWith('TEMPLATE_MISMATCH'))
        throw new Refusal('SETTINGS_MISMATCH', 409, { missing: error.code.slice(19) })
      if (error.status === 404) throw new Refusal('SITE_NOT_FOUND', 404)
      throw new Refusal('BASEDB_UNREACHABLE', 502)
    }
    throw error
  }
  const saved = await settings.site(siteId)
  if (!saved) throw new Refusal('SITE_NOT_FOUND', 404)
  return editorSite(settings, saved, aiAvailable)
}
