import { readFileSync } from 'node:fs'
import type { Db } from '../db/client.js'
import { DatabaseSource } from './database.js'
import { type LabeledRow, SettingsFailure, type SettingsSource } from './source.js'

/**
 * Acme Assurances, the demonstration: its site, inboxes, teams, replies, articles… —
 * `demo.json`, keyed by table. In a row, `$key` names it, `@key` points at another, `$moi`
 * is the demonstration's supervisor, `-7d` a date seven days ago.
 */

type DemoRows = Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>

interface ModelTable {
  readonly key: string
  readonly label: string
}

const read = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'))

export const MODEL = read('model.json') as {
  readonly tables: readonly (ModelTable & {
    readonly fields: readonly Record<string, unknown>[]
  })[]
  readonly links: readonly Record<string, unknown>[]
}
const DEMO = read('demo.json') as DemoRows

/** The order a table's rows can be written in: what they point at first. */
const ORDER = [
  'equipes',
  'boites',
  'sites',
  'horaires',
  'fermetures',
  'conseillers',
  'reponses_types',
  'etiquettes',
  'categories',
  'articles',
  'conversations_promues',
  'garde_fous',
  'outils_ia',
  'serveurs_mcp',
]

function relativeDate(value: string): string | null {
  const relative = /^([+-]\d+)d$/.exec(value)
  if (!relative) return null
  const day = new Date()
  day.setDate(day.getDate() + Number(relative[1]))
  return day.toISOString().slice(0, 10)
}

/** A demonstration value, its references resolved through `idOf`. */
function resolve(value: unknown, idOf: (key: string) => string | null, me: string | null): unknown {
  if (Array.isArray(value)) return value.map((v) => resolve(v, idOf, me))
  if (typeof value !== 'string') return value
  if (value.startsWith('@')) return idOf(value.slice(1))
  if (value === '$moi') return me
  return relativeDate(value) ?? value
}

/**
 * Writes the demonstration into the settings tables — at a first start in development,
 * or by `pnpm seed`. The supervisor `$moi` is the demonstration's agent row, written with
 * the other agents.
 */
export async function loadDemoSettings(db: Db): Promise<void> {
  const source = new DatabaseSource(db)
  const keys = new Map<string, string>()
  let me: string | null = null
  for (const key of ORDER) {
    const table = MODEL.tables.find((t) => t.key === key)
    if (!table) continue
    for (const row of DEMO[key] ?? []) {
      const values: Record<string, unknown> = {}
      for (const [field, value] of Object.entries(row)) {
        if (field !== '$key') values[field] = resolve(value, (k) => keys.get(k) ?? null, me)
      }
      const id = await source.create(table.label, values)
      if (typeof row.$key === 'string') keys.set(row.$key, id)
      if (key === 'conseillers' && me === null) me = id
    }
  }
}

/**
 * The demonstration's rows held in memory — for the unit tests, which have no database.
 * Changes are kept until the process ends.
 */
export class MemorySource implements SettingsSource {
  readonly kind = 'memory'
  private readonly tables = new Map<string, LabeledRow[]>()

  constructor(me: string | null = 'demo-me') {
    for (const table of MODEL.tables) {
      const rows = (DEMO[table.key] ?? []).map((row, index) => {
        const values: Record<string, unknown> = {}
        for (const [field, value] of Object.entries(row)) {
          if (field !== '$key') values[field] = resolve(value, (k) => k, me)
        }
        const key = row.$key
        // The demonstration's supervisor is `me`: `$moi` points at them.
        const id =
          typeof key === 'string'
            ? key
            : table.key === 'conseillers' && index === 0 && me
              ? me
              : `${table.key}-${index + 1}`
        return { id, values }
      })
      this.tables.set(table.label, rows)
    }
  }

  private table(label: string): LabeledRow[] {
    const rows = this.tables.get(label)
    if (!rows) throw new SettingsFailure('TABLE_UNKNOWN', label)
    return rows
  }

  async rows(label: string): Promise<LabeledRow[]> {
    return this.table(label).map((row) => ({ id: row.id, values: { ...row.values } }))
  }

  async update(label: string, id: string, values: Readonly<Record<string, unknown>>) {
    const rows = this.table(label)
    const index = rows.findIndex((row) => row.id === id)
    const row = rows[index]
    if (!row) throw new SettingsFailure('ROW_NOT_FOUND')
    rows[index] = { id, values: { ...row.values, ...values } }
  }

  async create(label: string, values: Readonly<Record<string, unknown>>): Promise<string> {
    const id = `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    this.table(label).push({ id, values: { ...values } })
    return id
  }

  async remove(label: string, id: string): Promise<void> {
    const rows = this.table(label)
    const index = rows.findIndex((row) => row.id === id)
    if (index === -1) throw new SettingsFailure('ROW_NOT_FOUND')
    rows.splice(index, 1)
  }

  follow(): null {
    return null
  }
}
