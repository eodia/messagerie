import { defineConfig } from 'drizzle-kit'

/**
 * `drizzle-kit generate` writes the SQL of a schema change into `drizzle/`; the server
 * applies it at start. Never edit a migration once released: add another one.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  schemaFilter: ['chat'],
  migrations: { schema: 'chat', table: 'migration' },
})
