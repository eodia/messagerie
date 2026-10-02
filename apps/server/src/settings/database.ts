import { randomUUID } from 'node:crypto'
import { and, count, eq, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { person } from '../programs.js'
import { listen } from '../realtime/signals.js'
import { JOINS, STORES, type TableStore } from './catalog.js'
import { type LabeledRow, SettingsFailure, type SettingsSource } from './source.js'

/**
 * The settings in the chat's own tables (D19), read and written by field label through
 * the catalog. A write tells every process of the chat — `NOTIFY chat_settings` with the
 * table's label, in the write's own transaction —, and each forgets that table.
 */

const CHANNEL = 'chat_settings'
const ROLES: Readonly<Record<string, string>> = { agent: 'Conseiller', supervisor: 'Superviseur' }
const ROLE_OF: Readonly<Record<string, string>> = { Conseiller: 'agent', Superviseur: 'supervisor' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function storeOf(label: string): TableStore {
  const store = STORES.find((s) => s.label === label)
  if (!store) throw new SettingsFailure('TABLE_UNKNOWN', label)
  return store
}

const ids = (value: unknown): string[] =>
  (Array.isArray(value) ? value : value == null ? [] : [value]).filter(
    (v): v is string => typeof v === 'string' && UUID.test(v),
  )

export class DatabaseSource implements SettingsSource {
  readonly kind = 'database'
  private readonly watchers = new Map<string, Set<() => void>>()
  private stopListening: (() => Promise<void>) | null = null

  /** `databaseUrl` for the change stream; none in the tests, which follow nothing. */
  constructor(
    private readonly db: Db,
    private readonly databaseUrl: string | null = null,
  ) {}

  async rows(label: string): Promise<LabeledRow[]> {
    const store = storeOf(label)
    const table = store.table
    const rows: Record<string, unknown>[] = await this.db
      .select()
      .from(table)
      .where(store.agents ? person(table.login) : undefined)
      .orderBy(table.createdAt)

    // The multiple relations and the counts, read once for the whole table.
    const joined = new Map<string, Map<string, string[]>>()
    const counted = new Map<string, Map<string, number>>()
    for (const [name, field] of Object.entries(store.fields)) {
      if (field.kind === 'join') {
        const join = JOINS[field.join as keyof typeof JOINS]
        const links: Record<string, string>[] = await this.db.select().from(join.table)
        const byOwner = new Map<string, string[]>()
        for (const link of links) {
          const owner = link[join.owner] as string
          byOwner.set(owner, [...(byOwner.get(owner) ?? []), link[join.target] as string])
        }
        joined.set(name, byOwner)
      } else if (field.kind === 'count') {
        const column = field.table[field.column]
        const counts: { key: string | null; n: number }[] = await this.db
          .select({ key: column, n: count() })
          .from(field.table)
          .groupBy(column)
        counted.set(name, new Map(counts.flatMap((c) => (c.key ? [[c.key, c.n] as const] : []))))
      }
    }

    return rows.map((row) => {
      const id = row.id as string
      const values: Record<string, unknown> = {}
      for (const [name, field] of Object.entries(store.fields)) {
        if (field.kind === 'column') {
          const raw = row[field.column] ?? null
          values[name] = field.role ? (ROLES[raw as string] ?? raw) : raw
        } else if (field.kind === 'link') values[name] = row[field.column] ?? null
        else if (field.kind === 'join') values[name] = joined.get(name)?.get(id) ?? []
        else values[name] = counted.get(name)?.get(id) ?? 0
      }
      return { id, values }
    })
  }

  follow(label: string, onChange: () => void, onError: (error: unknown) => void) {
    if (!this.databaseUrl) return null
    const set = this.watchers.get(label) ?? new Set()
    set.add(onChange)
    this.watchers.set(label, set)
    this.stopListening ??= listen(
      this.databaseUrl,
      CHANNEL,
      (changed) => {
        for (const watcher of this.watchers.get(changed) ?? []) watcher()
      },
      onError,
    )
    return () => {
      set.delete(onChange)
    }
  }

  /** Stops the change stream — at shutdown. */
  async close(): Promise<void> {
    await this.stopListening?.()
    this.stopListening = null
  }

  async create(label: string, values: Readonly<Record<string, unknown>>): Promise<string> {
    const store = storeOf(label)
    const id = randomUUID()
    await this.write(store, async (tx) => {
      const columns = this.columns(store, values)
      if (store.agents) {
        const email = typeof columns.email === 'string' ? columns.email.trim() : ''
        columns.login = email ? email.toLowerCase() : `pending:${id}`
      }
      await tx.insert(store.table).values({ id, ...columns })
      await this.joins(tx, store, id, values)
    })
    return id
  }

  async update(
    label: string,
    id: string,
    values: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const store = storeOf(label)
    if (!UUID.test(id)) throw new SettingsFailure('ROW_NOT_FOUND')
    await this.write(store, async (tx) => {
      const columns = this.columns(store, values)
      if (store.agents && 'email' in columns) {
        const email = typeof columns.email === 'string' ? columns.email.trim() : ''
        // An agent's e-mail is their login — never a token's key.
        columns.login = email ? email.toLowerCase() : sql`'pending:' || ${store.table.id}`
      }
      const changed = await tx
        .update(store.table)
        .set({ ...columns, updatedAt: new Date() })
        .where(and(eq(store.table.id, id), store.agents ? person(store.table.login) : undefined))
        .returning({ id: store.table.id })
      if (changed.length === 0) throw new SettingsFailure('ROW_NOT_FOUND')
      await this.joins(tx, store, id, values)
    })
  }

  async remove(label: string, id: string): Promise<void> {
    const store = storeOf(label)
    if (!UUID.test(id)) throw new SettingsFailure('ROW_NOT_FOUND')
    await this.write(store, async (tx) => {
      if (store.agents) {
        // An agent the messages name stays, deactivated: the thread keeps their name.
        const [row] = await tx
          .update(store.table)
          .set({ active: false, updatedAt: new Date() })
          .where(and(eq(store.table.id, id), person(store.table.login)))
          .returning({ id: store.table.id })
        if (!row) throw new SettingsFailure('ROW_NOT_FOUND')
        return
      }
      const gone = await tx
        .delete(store.table)
        .where(eq(store.table.id, id))
        .returning({ id: store.table.id })
      if (gone.length === 0) throw new SettingsFailure('ROW_NOT_FOUND')
    })
  }

  /** A write and its signal, in one transaction; a refusal of the database, by field. */
  private async write(store: TableStore, work: (tx: Db) => Promise<void>): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        await work(tx)
        await tx.execute(sql`select pg_notify(${CHANNEL}, ${store.label})`)
      })
    } catch (error) {
      if (error instanceof SettingsFailure) throw error
      const cause = (error as { cause?: { code?: string; column?: string; constraint?: string } })
        .cause
      const code = cause?.code ?? (error as { code?: string }).code
      // 23505 unique, 23503 foreign key, 23502 not null, 22xxx a value of the wrong kind.
      if (code === '23505' && store.agents) throw new SettingsFailure('INVALID', 'E-mail')
      if (code && (code.startsWith('23') || code.startsWith('22'))) {
        throw new SettingsFailure(
          'INVALID',
          this.fieldOf(store, cause?.column ?? cause?.constraint),
        )
      }
      throw error
    }
  }

  /** The field a column belongs to, for a refusal — the table's name when unknown. */
  private fieldOf(store: TableStore, hint: string | undefined): string {
    if (!hint) return store.label
    for (const [name, field] of Object.entries(store.fields)) {
      if (
        'column' in field &&
        hint.includes(field.column.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`))
      )
        return name
    }
    return store.label
  }

  /** Values by label as columns; a label the table lacks is refused. */
  private columns(
    store: TableStore,
    values: Readonly<Record<string, unknown>>,
  ): Record<string, unknown> {
    const columns: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(values)) {
      const field = store.fields[name]
      if (!field) throw new SettingsFailure('INVALID', name)
      if (field.kind === 'column') {
        columns[field.column] = field.role ? (ROLE_OF[value as string] ?? 'agent') : value
      } else if (field.kind === 'link') {
        const [one] = ids(value)
        if (value != null && value !== '' && !one) throw new SettingsFailure('INVALID', name)
        columns[field.column] = one ?? null
      }
    }
    return columns
  }

  /** The multiple relations given: replaced, each by its list. */
  private async joins(
    tx: Db,
    store: TableStore,
    id: string,
    values: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    for (const [name, value] of Object.entries(values)) {
      const field = store.fields[name]
      if (field?.kind !== 'join') continue
      const join = JOINS[field.join as keyof typeof JOINS]
      const table = join.table as unknown as Record<string, never>
      await tx.delete(join.table).where(eq(table[join.owner], id))
      const targets = [...new Set(ids(value))]
      if (targets.length > 0) {
        await tx
          .insert(join.table)
          .values(targets.map((target) => ({ [join.owner]: id, [join.target]: target })) as never)
      }
    }
  }
}

/** Whether the settings hold anything yet: a first start finds them empty. */
export async function settingsEmpty(db: Db): Promise<boolean> {
  const store = storeOf('Sites')
  const [row] = await db.select({ n: count() }).from(store.table)
  return (row?.n ?? 0) === 0
}
