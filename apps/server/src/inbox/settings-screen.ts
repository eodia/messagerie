import type { SettingsField, SettingsOverview, SettingsRow, SettingsTable } from '@chat/contracts'
import type { Db } from '../db/client.js'
import { agents } from '../db/schema.js'
import { person } from '../programs.js'
import { Refusal } from '../refusal.js'
import { MODEL } from '../settings/demo.js'
import type { Settings } from '../settings/settings.js'
import { SettingsFailure } from '../settings/source.js'
import type { AgentRow } from './read.js'

/**
 * The settings screens of the inbox: the tables a supervisor sets up — inboxes, teams,
 * agents, sites, hours, canned replies, guardrails, tools… —, in the chat's own tables
 * (D19). The fields are the model's: what `settings/model.json` declares is what the
 * screens show.
 */

/** The tables the inbox sets up, in the order its menu shows them. */
const EDITABLE = [
  'boites',
  'equipes',
  'conseillers',
  'sites',
  'horaires',
  'fermetures',
  'reponses_types',
  'etiquettes',
  'garde_fous',
  'outils_ia',
  'serveurs_mcp',
  'numeros_sms',
  'adresses_email',
  'categories',
  'articles',
  'conversations_promues',
] as const

interface TemplateField {
  readonly label: string
  readonly kind: string
  readonly description?: string
  readonly required?: boolean
  readonly options?: readonly { readonly label: string }[]
}

interface Template {
  readonly tables: readonly {
    readonly key: string
    readonly label: string
    readonly description?: string
    readonly fields: readonly TemplateField[]
  }[]
  readonly links: readonly {
    readonly from: string
    readonly to: string
    readonly label: string
    readonly multiple: boolean
    readonly description?: string
  }[]
}

const KINDS = new Set<string>([
  'short_text',
  'long_text',
  'url',
  'number',
  'boolean',
  'date',
  'select',
  'multi_select',
  'user',
])

let schema: SettingsTable[] | null = null

/** The editable tables and their fields — computed fields (counts) left out. */
export function settingsSchema(): SettingsTable[] {
  if (schema) return schema
  const template = MODEL as unknown as Template
  schema = EDITABLE.flatMap((key) => {
    const table = template.tables.find((t) => t.key === key)
    if (!table) return []
    const fields: SettingsField[] = table.fields
      .filter((f) => KINDS.has(f.kind))
      .map((f) => ({
        label: f.label,
        kind: f.kind as SettingsField['kind'],
        description: f.description ?? null,
        required: f.required === true,
        options: (f.options ?? []).map((o) => o.label),
        target: null,
      }))
    for (const link of template.links.filter((l) => l.from === key)) {
      fields.push({
        label: link.label,
        kind: link.multiple ? 'multi_link' : 'link',
        description: link.description ?? null,
        required: false,
        options: [],
        target: link.to,
      })
    }
    return [{ key, label: table.label, description: table.description ?? null, fields }]
  })
  return schema
}

function tableOf(key: string): SettingsTable {
  const table = settingsSchema().find((t) => t.key === key)
  if (!table) throw new Refusal('INVALID_REQUEST', 400, { table: key })
  return table
}

/** The people a « Personne » field may name: the agents — the API's tokens left out. */
export async function settingsOverview(db: Db, agent: AgentRow): Promise<SettingsOverview> {
  const users = await db
    .select({ id: agents.id, name: agents.name, email: agents.email })
    .from(agents)
    .where(person(agents.login))
    .orderBy(agents.name)
  return {
    tables: settingsSchema(),
    users,
    canEdit: agent.role === 'supervisor',
  }
}

/**
 * What an agent may read of the settings: the knowledge base and the sites it is written
 * for. The rest — inboxes, teams, accounts, hours, guardrails, tools… — is the
 * administration's, read and written by supervisors alone.
 */
const READ_BY_AGENTS: ReadonlySet<string> = new Set([
  'articles',
  'categories',
  'sites',
  'conversations_promues',
])

export async function settingsRows(
  settings: Settings,
  agent: AgentRow,
  key: string,
): Promise<SettingsRow[]> {
  if (!READ_BY_AGENTS.has(key)) supervisorOnly(agent)
  const table = tableOf(key)
  const rows = await settings.rowsOf(table.label)
  const known = new Set(table.fields.map((f) => f.label))
  return rows.map((row) => ({
    id: row.id,
    values: Object.fromEntries(Object.entries(row.values).filter(([label]) => known.has(label))),
  }))
}

const isText = (v: unknown): v is string => typeof v === 'string'

/** One value, as its field takes it; refused with the field's label when it does not fit. */
function cleanValue(field: SettingsField, value: unknown): unknown {
  const wrong = () => new Refusal('INVALID_REQUEST', 400, { field: field.label })
  if (value === null) {
    if (field.kind === 'boolean') throw wrong()
    return field.kind === 'multi_select' || field.kind === 'multi_link' ? [] : null
  }
  switch (field.kind) {
    case 'short_text':
    case 'long_text':
    case 'url': {
      if (!isText(value) || value.length > 20_000) throw wrong()
      const text = field.kind === 'long_text' ? value.replace(/\s+$/, '') : value.trim()
      return text === '' ? null : text
    }
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) throw wrong()
      return value
    case 'boolean':
      if (typeof value !== 'boolean') throw wrong()
      return value
    case 'date':
      if (!isText(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw wrong()
      return value
    case 'select':
      if (!isText(value) || !field.options.includes(value)) throw wrong()
      return value
    case 'multi_select':
      if (!Array.isArray(value) || !value.every((v) => isText(v) && field.options.includes(v)))
        throw wrong()
      return [...new Set(value)]
    case 'link':
    case 'user':
      if (!isText(value) || value === '') throw wrong()
      return value
    case 'multi_link':
      if (!Array.isArray(value) || !value.every((v) => isText(v) && v !== '')) throw wrong()
      return [...new Set(value)]
  }
}

function cleanValues(
  table: SettingsTable,
  raw: unknown,
  creating: boolean,
): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Refusal('INVALID_REQUEST', 400, { expected: '{ values: { libellé: valeur } }' })
  }
  const values: Record<string, unknown> = {}
  for (const [label, value] of Object.entries(raw)) {
    const field = table.fields.find((f) => f.label === label)
    if (!field) throw new Refusal('INVALID_REQUEST', 400, { field: label })
    values[label] = cleanValue(field, value)
  }
  if (creating) {
    for (const field of table.fields.filter((f) => f.required)) {
      const value = values[field.label]
      if (value === undefined || value === null || value === '') {
        throw new Refusal('INVALID_REQUEST', 400, { field: field.label, reason: 'required' })
      }
    }
  }
  return values
}

/** The settings' refusals, in the chat's codes. */
async function written<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write()
  } catch (error) {
    if (!(error instanceof SettingsFailure)) throw error
    if (error.code === 'ROW_NOT_FOUND') throw new Refusal('ROW_NOT_FOUND', 404)
    throw new Refusal('INVALID_REQUEST', 400, error.field ? { field: error.field } : undefined)
  }
}

function supervisorOnly(agent: AgentRow): void {
  if (agent.role !== 'supervisor') throw new Refusal('NOT_ALLOWED', 403)
}

/** What a new row of some tables starts with, unless given: an article is its writer's draft. */
const ON_CREATE: Readonly<Record<string, (agent: AgentRow) => Record<string, unknown>>> = {
  articles: (agent) => ({ Statut: 'Brouillon', Auteur: agent.id }),
}

export async function createRow(
  settings: Settings,
  agent: AgentRow,
  key: string,
  raw: unknown,
): Promise<SettingsRow> {
  supervisorOnly(agent)
  const table = tableOf(key)
  const values = { ...ON_CREATE[key]?.(agent), ...cleanValues(table, raw, true) }
  const id = await written(() => settings.source.create(table.label, values))
  settings.invalidate(table.label)
  return { id, values }
}

export async function updateRow(
  settings: Settings,
  agent: AgentRow,
  key: string,
  id: string,
  raw: unknown,
): Promise<void> {
  supervisorOnly(agent)
  const table = tableOf(key)
  const values = cleanValues(table, raw, false)
  if (Object.keys(values).length === 0) return
  await written(() => settings.source.update(table.label, id, values))
  settings.invalidate(table.label)
}

export async function deleteRow(
  settings: Settings,
  agent: AgentRow,
  key: string,
  id: string,
): Promise<void> {
  supervisorOnly(agent)
  const table = tableOf(key)
  await written(() => settings.source.remove(table.label, id))
  // Other tables may have pointed at it.
  settings.invalidate()
}
