import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { type BasedbClient, BasedbFailure, type TableDescription } from '../basedb/client.js'

/**
 * Where the chat reads its settings (D1, D2): the rows of the « Messagerie » base, each
 * keyed by FIELD LABELS — the labels of `messagerie.json`, which are the contract. A choice
 * reads as its label, a relation as the id of the row it points at (a list for a multiple
 * one), a person as their basedb account.
 *
 * Two sources give the same rows: basedb, in production; the template and its demonstration
 * rows, in development without basedb — so that the chat runs, with Acme Assurances, on a
 * machine that has nothing else.
 */

export interface LabeledRow {
  readonly id: string
  readonly values: Readonly<Record<string, unknown>>
}

export interface SettingsSource {
  readonly kind: 'basedb' | 'template'
  /** The rows of a table, by its label. */
  rows(table: string): Promise<LabeledRow[]>
  /** Calls `onChange` when the table changes; null when this source cannot tell. */
  follow(
    table: string,
    onChange: () => void,
    onError: (error: unknown) => void,
  ): (() => void) | null
  /**
   * Changes a row's values, by field label — a choice by its label. With basedb, as the
   * owner of `token` (a person's access token) when given, else as the chat.
   */
  update(
    table: string,
    id: string,
    values: Readonly<Record<string, unknown>>,
    token: string | null,
  ): Promise<void>
  /** Creates a row, by field label; returns its id. */
  create(
    table: string,
    values: Readonly<Record<string, unknown>>,
    token: string | null,
  ): Promise<string>
  remove(table: string, id: string, token: string | null): Promise<void>
}

// ── basedb ────────────────────────────────────────────────────────────────────────────

/** A relation's value, as basedb gives it with `links=id`: an id, or a list of them. */
function linkIds(value: unknown): string | string[] | null {
  const one = (v: unknown): string | null =>
    typeof v === 'string'
      ? v
      : typeof v === 'object' && v !== null && typeof (v as { _id?: unknown })._id === 'string'
        ? (v as { _id: string })._id
        : typeof v === 'object' && v !== null && typeof (v as { id?: unknown }).id === 'string'
          ? (v as { id: string }).id
          : null
  if (Array.isArray(value)) return value.map(one).filter((v): v is string => v !== null)
  return one(value)
}

export class BasedbSource implements SettingsSource {
  readonly kind = 'basedb'
  private tables: Promise<Map<string, TableDescription>> | null = null

  constructor(readonly client: BasedbClient) {}

  private table(label: string): Promise<TableDescription> {
    this.tables ??= this.client
      .describe()
      .then((base) => new Map(base.tables.map((t) => [t.label, t])))
    const loading = this.tables
    loading.catch(() => {
      if (this.tables === loading) this.tables = null
    })
    return loading.then((tables) => {
      const table = tables.get(label)
      if (!table) throw new BasedbFailure(0, `TEMPLATE_MISMATCH: ${label}`)
      return table
    })
  }

  async rows(label: string): Promise<LabeledRow[]> {
    const table = await this.table(label)
    const rows = await this.client.rows(table.name)
    return rows.map((row) => {
      const values: Record<string, unknown> = {}
      for (const field of table.fields) {
        const raw = row[field.name]
        const option = (v: unknown) => field.options?.find((o) => o.value === v)?.label ?? v
        if (field.kind === 'select') values[field.label] = raw == null ? null : option(raw)
        else if (field.kind === 'multi_select')
          values[field.label] = Array.isArray(raw) ? raw.map(option) : []
        else if (field.kind === 'link' || field.kind === 'multi_link')
          values[field.label] = linkIds(raw)
        else if (field.kind === 'user') values[field.label] = linkIds(raw)
        else values[field.label] = raw ?? null
      }
      return { id: row._id, values }
    })
  }

  /** Values by label, as basedb takes them: by physical name, a choice by its value. */
  private async physical(
    label: string,
    values: Readonly<Record<string, unknown>>,
  ): Promise<{ table: string; values: Record<string, unknown> }> {
    let table = await this.table(label)
    // A field the description lacks may have been added since — `basedb:setup` brings a
    // base up to the template: the base is described again, once.
    if (Object.keys(values).some((name) => !table.fields.some((f) => f.label === name))) {
      this.tables = null
      table = await this.table(label)
    }
    const physical: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(values)) {
      const field = table.fields.find((f) => f.label === name)
      if (!field) throw new BasedbFailure(0, `TEMPLATE_MISMATCH: ${label} › ${name}`)
      const option = (v: unknown) => field.options?.find((o) => o.label === v)?.value ?? v
      physical[field.name] =
        field.kind === 'select' && value !== null
          ? option(value)
          : field.kind === 'multi_select' && Array.isArray(value)
            ? value.map(option)
            : value
    }
    return { table: table.name, values: physical }
  }

  async update(
    label: string,
    id: string,
    values: Readonly<Record<string, unknown>>,
    token: string | null,
  ): Promise<void> {
    const write = await this.physical(label, values)
    await this.client.update(write.table, id, write.values, token ?? undefined)
  }

  async create(
    label: string,
    values: Readonly<Record<string, unknown>>,
    token: string | null,
  ): Promise<string> {
    const write = await this.physical(label, values)
    return (await this.client.create(write.table, write.values, token ?? undefined))._id
  }

  async remove(label: string, id: string, token: string | null): Promise<void> {
    await this.client.remove((await this.table(label)).name, id, token ?? undefined)
  }

  follow(label: string, onChange: () => void, onError: (error: unknown) => void): () => void {
    let stop = () => {}
    let stopped = false
    this.table(label)
      .then((table) => {
        if (!stopped) stop = this.client.follow(table.name, onChange, onError)
      })
      .catch(onError)
    return () => {
      stopped = true
      stop()
    }
  }
}

// ── The template ──────────────────────────────────────────────────────────────────────

interface Template {
  readonly tables: readonly { readonly key: string; readonly label: string }[]
  readonly rows: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>
}

const require = createRequire(import.meta.url)
const readJson = (name: string): unknown =>
  JSON.parse(readFileSync(require.resolve(`@chat/basedb-template/${name}`), 'utf8'))

/**
 * The template's own rows — the defaults the base is created with — or, with `demo`, those
 * of Acme Assurances. `@key` is a row's id, `$moi` the development agent's account, `-7d` a
 * date seven days ago.
 */
export class TemplateSource implements SettingsSource {
  readonly kind = 'template'
  private readonly template: Template
  /** What was changed since start, by table and row: kept in memory, never written. */
  private readonly edits = new Map<string, Map<string, Record<string, unknown>>>()
  /** The rows created and deleted since start, by table. */
  private readonly added = new Map<string, LabeledRow[]>()
  private readonly removed = new Set<string>()

  constructor(
    private readonly me: string | null,
    demo: boolean,
  ) {
    const template = readJson('messagerie.json') as Template
    this.template = demo
      ? { ...template, rows: readJson('demo-rows.json') as Template['rows'] }
      : template
  }

  private value(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((v) => this.value(v))
    if (typeof value !== 'string') return value
    if (value.startsWith('@')) return value.slice(1)
    if (value === '$moi') return this.me
    const relative = /^([+-]\d+)d$/.exec(value)
    if (relative) {
      const day = new Date()
      day.setDate(day.getDate() + Number(relative[1]))
      return day.toISOString().slice(0, 10)
    }
    return value
  }

  async rows(label: string): Promise<LabeledRow[]> {
    const table = this.template.tables.find((t) => t.label === label)
    if (!table) throw new BasedbFailure(0, `TEMPLATE_MISMATCH: ${label}`)
    const own = (this.template.rows[table.key] ?? []).map((row, index) => {
      const values: Record<string, unknown> = {}
      for (const [field, value] of Object.entries(row)) {
        if (field !== '$key') values[field] = this.value(value)
      }
      const key = row.$key
      const id = typeof key === 'string' ? key : `${table.key}-${index + 1}`
      return { id, values }
    })
    return [...own, ...(this.added.get(label) ?? [])]
      .filter((row) => !this.removed.has(row.id))
      .map((row) => ({
        id: row.id,
        values: { ...row.values, ...this.edits.get(label)?.get(row.id) },
      }))
  }

  async update(label: string, id: string, values: Readonly<Record<string, unknown>>) {
    const rows = await this.rows(label)
    if (!rows.some((row) => row.id === id)) throw new BasedbFailure(404, 'RECORD_NOT_FOUND')
    const table = this.edits.get(label) ?? new Map<string, Record<string, unknown>>()
    table.set(id, { ...table.get(id), ...values })
    this.edits.set(label, table)
  }

  async create(label: string, values: Readonly<Record<string, unknown>>): Promise<string> {
    await this.rows(label)
    const id = `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    this.added.set(label, [...(this.added.get(label) ?? []), { id, values: { ...values } }])
    return id
  }

  async remove(label: string, id: string): Promise<void> {
    if (!(await this.rows(label)).some((row) => row.id === id)) {
      throw new BasedbFailure(404, 'RECORD_NOT_FOUND')
    }
    this.removed.add(id)
  }

  follow(): null {
    return null
  }
}

/**
 * The settings the configuration gives: basedb's when it names one; otherwise, in
 * development only, the template's demonstration rows; in production without basedb,
 * none.
 */
export function sourceFor(
  basedb: BasedbClient | null,
  production: boolean,
  devAgent: string | null,
): SettingsSource | null {
  if (basedb) return new BasedbSource(basedb)
  return production ? null : new TemplateSource(devAgent, true)
}
