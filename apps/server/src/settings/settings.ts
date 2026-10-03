import type { WidgetAppearance } from '@chat/contracts'
import type { LabeledRow, SettingsSource } from './source.js'
import { appearanceOf, colorOf, suggestionsOf, taglineOf, titleOf } from './widget.js'

/**
 * The chat's settings, typed — read from its own tables through a source (D19).
 *
 * A table read is kept until it changes: every write tells every process of the chat
 * (`NOTIFY`), which forgets that table. A failed read is not kept: the next request tries
 * again.
 */

export const TABLES = {
  sites: 'Sites',
  inboxes: 'Boîtes de réception',
  hours: "Horaires d'ouverture",
  closures: 'Fermetures exceptionnelles',
  teams: 'Équipes',
  agents: 'Conseillers',
  canned: 'Réponses types',
  tags: 'Étiquettes',
  articles: 'Articles',
  promoted: 'Conversations promues',
  guardrails: 'Garde-fous',
  tools: 'Outils IA',
  mcp: 'Serveurs MCP',
  sms: 'Numéros SMS',
} as const

type TableLabel = (typeof TABLES)[keyof typeof TABLES]

// ── The shapes ────────────────────────────────────────────────────────────────────────

export interface AgentEntry {
  /** The agent's row — `chat.agent`. */
  readonly id: string
  readonly name: string
  readonly role: 'agent' | 'supervisor'
  readonly active: boolean
  /** « Équipes » — which inboxes they see. */
  readonly teamIds: readonly string[]
}

/** Where conversations arrive, and the teams that answer there. */
export interface Inbox {
  readonly id: string
  readonly name: string
  readonly description: string | null
  /** `#RRGGBB`, or null. */
  readonly color: string | null
  /** A pictogram of the interface's library, by its name (`shield-alert`), or null. */
  readonly icon: string | null
  /** A small picture — https or data URL — in place of the pictogram, or null. */
  readonly image: string | null
  readonly teamIds: readonly string[]
  /** The team a new conversation is given to; null: the site's. */
  readonly defaultTeamId: string | null
  readonly active: boolean
}

/** Who carries a number's messages (« Fournisseur »). */
export type SmsProviderId = 'twilio' | 'smsmode'

const PROVIDERS: Readonly<Record<string, SmsProviderId>> = {
  Twilio: 'twilio',
  'SMS Mode': 'smsmode',
}

/**
 * A number visitors write to by SMS or RCS (D23). `tokenEnv` names the variable of the
 * server's environment that holds the provider's secret (D5).
 */
export interface SmsNumber {
  readonly id: string
  readonly name: string
  readonly provider: SmsProviderId
  /** `+33612345678`, or null when the row does not say a number that reads. */
  readonly phone: string | null
  readonly accountSid: string | null
  readonly tokenEnv: string | null
  readonly messagingServiceSid: string | null
  /** The name its messages come from, where the provider allows one. */
  readonly sender: string | null
  /** The site its conversations are held for; null: the first active one. */
  readonly siteId: string | null
  readonly active: boolean
}

export interface Site {
  readonly id: string
  readonly name: string
  /** Host names, lower case: `exemple.fr`, `www.exemple.fr`. */
  readonly domains: readonly string[]
  readonly title: string | null
  readonly tagline: string | null
  readonly welcome: string | null
  /** Questions offered in the widget before the visitor writes. */
  readonly suggestions: readonly string[]
  readonly color: string
  readonly appearance: WidgetAppearance
  readonly language: string
  readonly timezone: string
  readonly aiEnabled: boolean
  /** 0 to 1. */
  readonly threshold: number
  readonly instructions: string | null
  readonly retentionDays: number | null
  /** « Répondre par e-mail »: what a visitor who left did not see reaches them (D23). */
  readonly emailReplies: boolean
  readonly active: boolean
  readonly defaultTeamId: string | null
  /** The inbox its conversations reach; null: the first active one. */
  readonly inboxId: string | null
}

export interface OpeningSlot {
  /** Null: every site. */
  readonly siteId: string | null
  readonly name: string
  /** ISO weekdays: 1 is Monday, 7 Sunday. */
  readonly days: readonly number[]
  /** Minutes since midnight. */
  readonly opens: number
  readonly closes: number
}

export interface Closure {
  readonly siteId: string | null
  readonly reason: string
  /** `YYYY-MM-DD`, both included. */
  readonly from: string
  readonly to: string
  readonly message: string | null
}

export interface Team {
  readonly id: string
  readonly name: string
}

export interface CannedReply {
  readonly id: string
  readonly title: string
  readonly shortcut: string | null
  readonly body: string
  /** Empty: offered to every agent. */
  readonly teamIds: readonly string[]
}

export interface TagDefinition {
  readonly name: string
  readonly color: string
  readonly when: string | null
  readonly byAi: boolean
}

export interface Article {
  readonly id: string
  readonly title: string
  readonly content: string
  /** Empty: every site. */
  readonly siteIds: readonly string[]
}

export interface PromotedConversation {
  readonly id: string
  readonly question: string
  readonly answer: string
}

export interface Guardrail {
  readonly id: string
  readonly name: string
  readonly topic: string
  readonly action: 'handoff' | 'decline'
  readonly teamId: string | null
  readonly message: string | null
}

export interface ToolDefinition {
  readonly id: string
  readonly name: string
  readonly description: string
  /** `contact`: the visitor's record, as their site signed it. */
  readonly type: 'contact' | 'http' | 'callback'
  readonly target: string | null
  /** For an HTTP call: POST sends the parameters as JSON, GET puts them in the address. */
  readonly method: 'GET' | 'POST'
  /** The NAME of the environment variable that holds the token — never the token (D5). */
  readonly tokenEnv: string | null
  /** Headers as written, `${NAME}` not yet replaced: see `resolveHeaders`. */
  readonly headers: Readonly<Record<string, string>>
  readonly parameters: Readonly<Record<string, unknown>>
  readonly agent: boolean
  readonly copilot: boolean
}

export interface McpServerDefinition {
  readonly id: string
  readonly name: string
  readonly url: string
  readonly description: string | null
  readonly tokenEnv: string | null
  /** Headers as written, `${NAME}` not yet replaced: see `resolveHeaders`. */
  readonly headers: Readonly<Record<string, string>>
  /** Empty: every tool of the server. */
  readonly allowed: readonly string[]
  readonly agent: boolean
  readonly copilot: boolean
}

// ── Reading values ────────────────────────────────────────────────────────────────────

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null
const bool = (value: unknown): boolean => value === true
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null
const one = (value: unknown): string | null =>
  typeof value === 'string'
    ? value
    : Array.isArray(value) && typeof value[0] === 'string'
      ? value[0]
      : null
const many = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : typeof value === 'string'
      ? [value]
      : []

/** A pictogram's name, as the interface's library writes them: `shield-alert`. */
const iconOf = (value: unknown): string | null => {
  const name = text(value)
  return name !== null && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) ? name : null
}

/**
 * A picture the inbox may draw: an https address, or a raster data URL — never a script,
 * whatever the row says.
 */
const imageOf = (value: unknown): string | null => {
  const url = text(value)
  if (url === null || url.length > 16_384) return null
  return /^https:\/\/\S+$/i.test(url) ||
    /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(url)
    ? url
    : null
}

const WEEKDAYS: Readonly<Record<string, number>> = {
  Lundi: 1,
  Mardi: 2,
  Mercredi: 3,
  Jeudi: 4,
  Vendredi: 5,
  Samedi: 6,
  Dimanche: 7,
}

/** `09:00`, `9h`, `9h30` → minutes since midnight; null for anything else. */
export function minutesOf(value: unknown): number | null {
  const match =
    typeof value === 'string' ? /^\s*(\d{1,2})\s*[:hH]\s*(\d{2})?\s*$/.exec(value) : null
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2] ?? 0)
  return hours <= 24 && minutes < 60 ? hours * 60 + minutes : null
}

function hostOf(entry: string): string | null {
  const trimmed = entry.trim().toLowerCase()
  if (trimmed === '') return null
  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname
  } catch {
    return null
  }
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return { type: 'object', properties: {} }
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { type: 'object', properties: {} }
  } catch {
    return { type: 'object', properties: {} }
  }
}

/** « Nom: valeur », a line each. A name that is not a header's is left out. */
function headersOf(value: unknown): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const line of (text(value) ?? '').split('\n')) {
    const at = line.indexOf(':')
    if (at <= 0) continue
    const name = line.slice(0, at).trim()
    if (!/^[A-Za-z0-9-]+$/.test(name) || /^(host|content-length|connection)$/i.test(name)) continue
    headers[name] = line.slice(at + 1).trim()
  }
  return headers
}

/**
 * The headers to send: `${NAME}` replaced by the server's environment variable NAME. A
 * header whose variable is not set is left out rather than sent empty.
 */
export function resolveHeaders(
  headers: Readonly<Record<string, string>>,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const resolved: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    let missing = false
    const filled = value.replace(/\$\{(\w+)\}/g, (_all, variable: string) => {
      const found = env[variable]
      if (found === undefined) missing = true
      return found ?? ''
    })
    if (!missing) resolved[name] = filled
  }
  return resolved
}

// ── The settings ──────────────────────────────────────────────────────────────────────

export class Settings {
  private readonly cache = new Map<string, { rows: Promise<LabeledRow[]> }>()
  private readonly listeners = new Set<(table: string) => void>()

  constructor(readonly source: SettingsSource) {}

  private table(label: TableLabel): Promise<LabeledRow[]> {
    const hit = this.cache.get(label)
    if (hit) return hit.rows
    const rows = this.source.rows(label)
    this.cache.set(label, { rows })
    rows.catch(() => {
      if (this.cache.get(label)?.rows === rows) this.cache.delete(label)
    })
    return rows
  }

  /** A table's rows by its label, as the source gives them — for the settings screens. */
  rowsOf(label: string): Promise<LabeledRow[]> {
    return this.table(label as TableLabel)
  }

  /** Forgets a table — or all of them — and tells whoever listens. */
  invalidate(table?: string): void {
    if (table === undefined) this.cache.clear()
    else this.cache.delete(table)
    for (const listener of this.listeners) listener(table ?? '*')
  }

  /** Called with a table's label when it changed (`*`: all may have). */
  onChange(listener: (table: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Follows every table's changes, from every process. Returns what stops it. */
  follow(onError: (error: unknown) => void): () => void {
    const stops = Object.values(TABLES).map((label) =>
      this.source.follow(label, () => this.invalidate(label), onError),
    )
    return () => {
      for (const stop of stops) stop?.()
    }
  }

  async agent(id: string): Promise<AgentEntry | null> {
    for (const { id: rowId, values } of await this.table(TABLES.agents)) {
      if (rowId !== id) continue
      return {
        id,
        name: text(values.Nom) ?? '',
        role: values.Rôle === 'Superviseur' ? 'supervisor' : 'agent',
        active: bool(values.Actif),
        teamIds: many(values.Équipes),
      }
    }
    return null
  }

  /** Every agent of « Conseillers ». */
  async agents(): Promise<AgentEntry[]> {
    return (await this.table(TABLES.agents)).map(({ id, values }) => ({
      id,
      name: text(values.Nom) ?? '',
      role: values.Rôle === 'Superviseur' ? ('supervisor' as const) : ('agent' as const),
      active: bool(values.Actif),
      teamIds: many(values.Équipes),
    }))
  }

  /** The first names of the active agents — the team the widget shows behind the AI. */
  async teamFirstNames(): Promise<string[]> {
    return (await this.table(TABLES.agents)).flatMap(({ values }) => {
      const name = text(values.Nom)
      return bool(values.Actif) && name ? [name.split(/\s+/)[0] ?? name] : []
    })
  }

  async sites(): Promise<Site[]> {
    return (await this.table(TABLES.sites)).map(({ id, values }) => ({
      id,
      name: text(values.Nom) ?? id,
      domains: (text(values['Domaines autorisés']) ?? '')
        .split(/[\s,;]+/)
        .map(hostOf)
        .filter((h): h is string => h !== null),
      title: titleOf(values["Titre d'accueil"]),
      tagline: taglineOf(values["Sous-titre d'accueil"]),
      welcome: text(values["Message d'accueil"]),
      suggestions: suggestionsOf(values['Questions suggérées']),
      color: colorOf(values['Couleur du widget']) ?? '#2DA31E',
      appearance: appearanceOf(values),
      language: text(values.Langue) ?? 'Français',
      timezone: text(values['Fuseau horaire']) ?? 'Europe/Paris',
      aiEnabled: bool(values['Agent IA actif']),
      threshold: Math.min(Math.max((num(values['Seuil de confiance (%)']) ?? 75) / 100, 0), 1),
      instructions: text(values["Consignes de l'agent IA"]),
      retentionDays: num(values['Conservation (jours)']),
      // A row of the database says it; one of memory without the field, as the column's default.
      emailReplies: values['Répondre par e-mail'] !== false,
      active: bool(values.Actif),
      defaultTeamId: one(values['Équipe par défaut']),
      inboxId: one(values['Boîte de réception']),
    }))
  }

  async inboxes(): Promise<Inbox[]> {
    return (await this.table(TABLES.inboxes)).map(({ id, values }) => ({
      id,
      name: text(values.Nom) ?? id,
      description: text(values.Description),
      color: colorOf(values.Couleur),
      icon: iconOf(values.Pictogramme),
      image: imageOf(values.Image),
      teamIds: many(values.Équipes),
      defaultTeamId: one(values['Équipe par défaut']),
      active: bool(values.Actif),
    }))
  }

  /**
   * Where a new conversation of `site` goes: its inbox — or the first active one — and the
   * team that inbox gives it to, or the site's.
   */
  async routeOf(site: Site): Promise<{ inboxId: string | null; teamId: string | null }> {
    const inboxes = (await this.inboxes()).filter((i) => i.active)
    const inbox = inboxes.find((i) => i.id === site.inboxId) ?? inboxes[0] ?? null
    return { inboxId: inbox?.id ?? null, teamId: inbox?.defaultTeamId ?? site.defaultTeamId }
  }

  async site(id: string): Promise<Site | null> {
    return (await this.sites()).find((s) => s.id === id) ?? null
  }

  /** Changes a site's row — values by field label — and reads the sites again. */
  async updateSite(id: string, values: Readonly<Record<string, unknown>>): Promise<void> {
    await this.source.update(TABLES.sites, id, values)
    this.invalidate(TABLES.sites)
  }

  /** A site's slots — its own and those of every site. A slot that does not read is left out. */
  async openingSlots(siteId: string): Promise<OpeningSlot[]> {
    return (await this.table(TABLES.hours)).flatMap(({ values }) => {
      const site = one(values.Site)
      const opens = minutesOf(values.Ouverture)
      const closes = minutesOf(values.Fermeture)
      if ((site !== null && site !== siteId) || opens === null || closes === null) return []
      return [
        {
          siteId: site,
          name: text(values.Créneau) ?? '',
          days: many(values.Jours)
            .map((day) => WEEKDAYS[day])
            .filter((d): d is number => d !== undefined),
          opens,
          closes,
        },
      ]
    })
  }

  async closures(siteId: string): Promise<Closure[]> {
    return (await this.table(TABLES.closures)).flatMap(({ values }) => {
      const site = one(values.Site)
      const from = text(values.Du)?.slice(0, 10)
      if ((site !== null && site !== siteId) || !from) return []
      return [
        {
          siteId: site,
          reason: text(values.Motif) ?? '',
          from,
          to: text(values.Au)?.slice(0, 10) ?? from,
          message: text(values['Message aux visiteurs']),
        },
      ]
    })
  }

  async teams(): Promise<Team[]> {
    return (await this.table(TABLES.teams)).map(({ id, values }) => ({
      id,
      name: text(values.Nom) ?? id,
    }))
  }

  async cannedReplies(): Promise<CannedReply[]> {
    return (await this.table(TABLES.canned)).flatMap(({ id, values }) => {
      const body = text(values.Contenu)
      if (!body) return []
      return [
        {
          id,
          title: text(values.Titre) ?? '',
          shortcut: text(values.Raccourci)?.replace(/^\//, '') ?? null,
          body,
          teamIds: many(values.Équipes),
        },
      ]
    })
  }

  async tags(): Promise<TagDefinition[]> {
    return (await this.table(TABLES.tags)).flatMap(({ values }) => {
      const name = text(values.Nom)
      if (!name) return []
      return [
        {
          name,
          color: /^#[0-9a-f]{6}$/i.test(text(values.Couleur) ?? '')
            ? (text(values.Couleur) as string)
            : '#64748b',
          when: text(values["Quand l'appliquer"]),
          byAi: bool(values["Posée par l'IA"]),
        },
      ]
    })
  }

  /** The published articles — the only ones the AI answers from. */
  async articles(): Promise<Article[]> {
    return (await this.table(TABLES.articles)).flatMap(({ id, values }) => {
      const content = text(values.Contenu)
      if (values.Statut !== 'Publié' || !content) return []
      return [{ id, title: text(values.Titre) ?? '', content, siteIds: many(values.Sites) }]
    })
  }

  async promotedConversations(): Promise<PromotedConversation[]> {
    return (await this.table(TABLES.promoted)).flatMap(({ id, values }) => {
      const question = text(values.Question)
      const answer = text(values.Réponse)
      if (values.Statut !== 'Publiée' || !question || !answer) return []
      return [{ id, question, answer }]
    })
  }

  async guardrails(): Promise<Guardrail[]> {
    return (await this.table(TABLES.guardrails)).flatMap(({ id, values }) => {
      const topic = text(values.Sujet)
      if (!bool(values.Actif) || !topic) return []
      return [
        {
          id,
          name: text(values.Nom) ?? '',
          topic,
          action: values.Action === 'Répondre sans traiter' ? 'decline' : 'handoff',
          teamId: one(values.Équipe),
          message: text(values['Message au visiteur']),
        },
      ]
    })
  }

  async tools(): Promise<ToolDefinition[]> {
    return (await this.table(TABLES.tools)).flatMap(({ id, values }) => {
      const name = text(values.Nom)
      const description = text(values["Description pour l'IA"])
      if (!bool(values.Actif) || !name || !description) return []
      return [
        {
          id,
          name,
          description,
          type:
            values.Type === 'Appel HTTP'
              ? 'http'
              : values.Type === 'Rappel'
                ? 'callback'
                : 'contact',
          target: text(values.Cible),
          method: values.Méthode === 'GET' ? 'GET' : 'POST',
          tokenEnv: text(values["Jeton (variable d'environnement)"]),
          headers: headersOf(values['En-têtes']),
          parameters: jsonObject(values.Paramètres),
          agent: bool(values['Agent IA']),
          copilot: bool(values.Copilote),
        },
      ]
    })
  }

  /** The active MCP servers, with an address that reads. */
  async mcpServers(): Promise<McpServerDefinition[]> {
    return (await this.table(TABLES.mcp)).flatMap(({ id, values }) => {
      const url = text(values.Adresse)
      if (!bool(values.Actif) || !url || !/^https?:\/\//.test(url)) return []
      return [
        {
          id,
          name: text(values.Nom) ?? id,
          url,
          description: text(values.Description),
          tokenEnv: text(values["Jeton (variable d'environnement)"]),
          headers: headersOf(values['En-têtes']),
          allowed: (text(values['Outils autorisés']) ?? '')
            .split(/[\n,]+/)
            .map((t) => t.trim())
            .filter(Boolean),
          agent: bool(values['Agent IA']),
          copilot: bool(values.Copilote),
        },
      ]
    })
  }

  /** « Numéros SMS », every row — the inactive ones too: the inbox says they are off. */
  async smsNumbers(): Promise<SmsNumber[]> {
    return (await this.table(TABLES.sms)).map(({ id, values }) => {
      const phone = (text(values.Numéro) ?? '').replace(/[\s.()-]/g, '')
      return {
        id,
        name: text(values.Nom) ?? id,
        provider: PROVIDERS[text(values.Fournisseur) ?? ''] ?? 'twilio',
        phone: /^\+[1-9]\d{6,14}$/.test(phone) ? phone : null,
        accountSid: text(values['Identifiant du compte']),
        tokenEnv: text(values["Jeton (variable d'environnement)"]),
        messagingServiceSid: text(values['Service de messagerie']),
        sender: text(values.Expéditeur),
        siteId: one(values.Site),
        active: bool(values.Actif),
      }
    })
  }

  async smsNumber(id: string): Promise<SmsNumber | null> {
    return (await this.smsNumbers()).find((n) => n.id === id) ?? null
  }
}
