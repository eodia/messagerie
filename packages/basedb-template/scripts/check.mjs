/**
 * Checks `messagerie.json` with basedb's own template validator, so that the template
 * the chat ships is one basedb accepts — the same `checkTemplate` its server runs before
 * applying one.
 *
 * basedb is read from a checkout next to this repository (`../basedb`), or from
 * `BASEDB_DIR`. Its `@basedb/contracts` package must be built (`dist/templates.js`).
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const basedb = resolve(process.env.BASEDB_DIR ?? join(here, '..', '..', '..', '..', 'basedb'))
const validator = join(basedb, 'packages', 'contracts', 'dist', 'templates.js')

if (!existsSync(validator)) {
  console.error(`basedb validator not found: ${validator}`)
  console.error('Set BASEDB_DIR to a basedb checkout whose @basedb/contracts is built.')
  process.exit(2)
}

const { checkTemplate } = await import(pathToFileURL(validator).href)
const template = JSON.parse(readFileSync(join(here, '..', 'messagerie.json'), 'utf8'))
const result = checkTemplate(template)

if (!result.ok) {
  for (const issue of result.issues)
    console.error(`✗ ${issue.path || '(racine)'} — ${issue.message}`)
  process.exit(1)
}

const tables = result.template.tables
const rows = Object.values(result.template.rows).reduce((sum, list) => sum + list.length, 0)
console.log(
  `✓ messagerie.json — ${tables.length} tables, ${result.template.links.length} relations, ${rows} lignes`,
)
