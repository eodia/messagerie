import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { AdminFailure, accessToken, createBase, signIn } from './basedb/admin.js'

/**
 * Creates the « Messagerie » base in basedb from the chat's template — in one operation,
 * the whole base or none (basedb 0.5.0, B1).
 *
 *   pnpm --filter @chat/server provision [--label "Messagerie"] [--no-rows | --demo]
 *
 * As an administrator of basedb: `BASEDB_ADMIN_TOKEN` (an access token), or
 * `BASEDB_ADMIN_EMAIL` and `BASEDB_ADMIN_PASSWORD`, with which it signs in the way the
 * interface does. `BASEDB_API_URL` and `BASEDB_TENANT` say which basedb.
 *
 * The template's rows are written by default: they are the chat's starting settings — a
 * site, a team, the guardrails — and make whoever runs this the first supervisor.
 *
 * For the development basedb of docker-compose.yml, `pnpm basedb:setup` does this and the
 * rest: the token, and the chat's `.env`.
 */

const require = createRequire(import.meta.url)
const read = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(require.resolve(`@chat/basedb-template/${name}`), 'utf8'))

const args = process.argv.slice(2)
const option = (name: string) => {
  const at = args.indexOf(name)
  return at === -1 ? undefined : args[at + 1]
}
const label = option('--label') ?? 'Messagerie'
const rows = !args.includes('--no-rows')
// `--demo`: the rows of Acme Assurances rather than the template's defaults.
const template = args.includes('--demo')
  ? { ...read('messagerie.json'), rows: read('demo-rows.json') }
  : read('messagerie.json')

const url = (process.env.BASEDB_API_URL || '').replace(/\/+$/, '')
const tenant = process.env.BASEDB_TENANT || ''
if (!url || !tenant) {
  console.error('provision : BASEDB_API_URL et BASEDB_TENANT sont requis.')
  process.exit(2)
}

/** An administrator's access token: given, or obtained by signing in. */
async function adminToken() {
  const email = process.env.BASEDB_ADMIN_EMAIL
  const password = process.env.BASEDB_ADMIN_PASSWORD
  const session = email && password ? await signIn(url, tenant, email, password) : null
  const given = process.env.BASEDB_ADMIN_TOKEN
  if (given)
    return {
      session: session ?? { url, tenant, email: '', password: '', cookies: [] },
      token: given,
    }
  if (!session) {
    console.error(
      'provision : BASEDB_ADMIN_TOKEN, ou BASEDB_ADMIN_EMAIL et BASEDB_ADMIN_PASSWORD, sont requis.',
    )
    process.exit(2)
  }
  return { session, token: await accessToken(session) }
}

try {
  const { session, token } = await adminToken()
  const base = await createBase(session, token, { template, label, rows }, (step) =>
    console.log(`  · ${step}`),
  )
  console.log(`
provision : base « ${base.label} » créée — ${base.name}

Ensuite, dans basedb : ouvrez la base, menu ⋯ → API et agents → Jetons API et MCP…, et créez
un jeton pour la surface REST, en écriture (la promotion d'une conversation et le
paramétrage depuis la messagerie écrivent dans la base). Puis, dans apps/server/.env :

  BASEDB_API_URL=${url}
  BASEDB_TENANT=${tenant}
  BASEDB_BASE=${base.name}
  BASEDB_TOKEN=bdb_…
`)
} catch (error) {
  console.error(`provision : ${error instanceof AdminFailure ? error.message : String(error)}`)
  process.exit(1)
}
