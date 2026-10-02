import type { ColumnType, QueryResult, ResultColumn } from '@chat/contracts'
import type pg from 'pg'
import { Refusal } from '../refusal.js'
import { type Compiled, ROW_LIMIT } from './query.js'

/**
 * Where every question runs (D22): a transaction that cannot write, fifteen seconds at
 * most, as `chat_analytics` — which reads the `analytics` views and nothing else —, by the
 * extended protocol, which takes one statement and no more: a `; RESET ROLE` in a question
 * is refused before anything runs. The transaction is rolled back, always.
 */

const TIMEOUT = '15s'

/** Postgres types, as a chart reads them. */
function typeOf(oid: number): ColumnType {
  if (oid === 16) return 'boolean'
  if ([20, 21, 23, 26, 700, 701, 1700].includes(oid)) return 'number'
  if ([1082, 1083, 1114, 1184].includes(oid)) return 'date'
  return 'text'
}

const NUMERIC = new Set([20, 1700])

function cell(value: unknown, oid: number): unknown {
  if (value === null || value === undefined) return null
  // Bigint and numeric come as text: a chart wants a number.
  if (NUMERIC.has(oid) && typeof value === 'string') return Number(value)
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') return JSON.stringify(value)
  return value
}

/** Whether the reading role exists — without it, SQL questions are off. */
let roleKnown: boolean | null = null

async function roleExists(client: pg.PoolClient): Promise<boolean> {
  if (roleKnown !== null) return roleKnown
  const { rows } = await client.query<{ ok: boolean }>(
    `select exists (select 1 from pg_roles where rolname = 'chat_analytics') as ok`,
  )
  roleKnown = rows[0]?.ok === true
  return roleKnown
}

export interface RunOptions {
  /** The author's own SQL: the reading role is required. The builder's: preferred. */
  readonly authored: boolean
}

export async function runRead(
  pool: pg.Pool,
  query: Compiled,
  options: RunOptions,
): Promise<QueryResult> {
  const statement = query.text.trim().replace(/;+\s*$/, '')
  // One more row than shown: to know there were more.
  const text = options.authored
    ? `select * from (\n${statement}\n) as question limit ${ROW_LIMIT + 1}`
    : statement
  const client = await pool.connect()
  const started = Date.now()
  try {
    await client.query('begin read only')
    await client.query(`set local statement_timeout = '${TIMEOUT}'`)
    if (await roleExists(client)) {
      await client.query('set local role chat_analytics')
    } else if (options.authored) {
      throw new Refusal('SQL_UNAVAILABLE', 503)
    }
    await client.query('set local search_path = analytics, pg_catalog')
    const result = await client.query({
      text,
      values: [...query.values],
      rowMode: 'array',
      queryMode: 'extended',
    } as pg.QueryConfig & { queryMode: 'extended' })
    const columns: ResultColumn[] = result.fields.map((f) => ({
      name: f.name,
      type: typeOf(f.dataTypeID),
    }))
    const rows = (result.rows as unknown[][]).map((row) =>
      row.map((value, i) => cell(value, result.fields[i]?.dataTypeID ?? 25)),
    )
    return {
      columns,
      rows: rows.slice(0, ROW_LIMIT),
      truncated: rows.length > ROW_LIMIT,
      ms: Date.now() - started,
      sql: statement,
    }
  } catch (error) {
    if (error instanceof Refusal) throw error
    const pgError = error as { code?: string; message?: string }
    if (pgError.code === '57014') throw new Refusal('QUERY_TIMEOUT', 408)
    throw new Refusal('QUERY_INVALID', 400, {
      reason: String(pgError.message ?? error).slice(0, 300),
    })
  } finally {
    await client.query('rollback').catch(() => undefined)
    client.release()
  }
}
