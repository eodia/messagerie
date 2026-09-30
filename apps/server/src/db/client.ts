import { fileURLToPath } from 'node:url'
import { type NodePgQueryResultHKT, drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import pg from 'pg'
import * as schema from './schema.js'

/** The database or a transaction in it: every operation accepts either. */
export type Db = PgDatabase<NodePgQueryResultHKT, typeof schema>

export function connect(databaseUrl: string): { pool: pg.Pool; db: Db } {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 })
  return { pool, db: drizzle({ client: pool, schema }) }
}

/** From `src/db` and from `dist/db` alike, the migrations sit two levels up. */
const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url))

/**
 * Brings the `chat` schema up to date. Run at every start: a server a version ahead
 * migrates its database before answering, and one already up to date does nothing.
 */
export async function migrateDatabase(db: Db): Promise<void> {
  await migrate(db, {
    migrationsFolder: MIGRATIONS,
    migrationsSchema: 'chat',
    migrationsTable: 'migration',
  })
}
