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
const read = (name) => JSON.parse(readFileSync(join(here, '..', name), 'utf8'))
const template = read('messagerie.json')
// The demonstration: the same tables, Acme Assurances' rows (`provision --demo`).
const demo = { ...template, rows: read('demo-rows.json') }

let failed = false
for (const [name, candidate] of [
  ['messagerie.json', template],
  ['messagerie.json + demo-rows.json', demo],
]) {
  const result = checkTemplate(candidate)
  if (!result.ok || result.issues.length > 0) {
    failed = true
    for (const issue of result.issues)
      console.error(`✗ ${name} ${issue.path || '(racine)'} — ${issue.message}`)
    continue
  }
  const rows = Object.values(result.template.rows).reduce((sum, list) => sum + list.length, 0)
  console.log(
    `✓ ${name} — ${result.template.tables.length} tables, ${result.template.links.length} relations, ${rows} lignes`,
  )
}
if (failed) process.exit(1)
