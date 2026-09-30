import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

/**
 * Creates the « Messagerie » base in basedb from the chat's template — in one operation,
 * the whole base or none (basedb 0.5.0, B1).
 *
 *   pnpm --filter @chat/server provision [--label "Messagerie"] [--no-rows]
 *
 * As an administrator of basedb: `BASEDB_ADMIN_TOKEN` (an access token), or
 * `BASEDB_ADMIN_EMAIL` and `BASEDB_ADMIN_PASSWORD`, with which it signs in the way the
 * interface does. `BASEDB_API_URL` and `BASEDB_TENANT` say which basedb.
 *
 * The template's rows are written by default: they are the chat's starting settings — a
 * site, a team, the guardrails — and make whoever runs this the first supervisor.
 */

const require = createRequire(import.meta.url)
const template: unknown = JSON.parse(
  readFileSync(require.resolve('@chat/basedb-template/messagerie.json'), 'utf8'),
)

const args = process.argv.slice(2)
const option = (name: string) => {
  const at = args.indexOf(name)
  return at === -1 ? undefined : args[at + 1]
}
const label = option('--label') ?? 'Messagerie'
const rows = !args.includes('--no-rows')

const url = (process.env.BASEDB_API_URL || '').replace(/\/+$/, '')
const tenant = process.env.BASEDB_TENANT || ''
if (!url || !tenant) {
  console.error('provision : BASEDB_API_URL et BASEDB_TENANT sont requis.')
  process.exit(2)
}

/** An administrator's access token: given, or obtained by signing in. */
async function adminToken(): Promise<string> {
  const given = process.env.BASEDB_ADMIN_TOKEN
  if (given) return given
  const email = process.env.BASEDB_ADMIN_EMAIL
  const password = process.env.BASEDB_ADMIN_PASSWORD
  if (!email || !password) {
    console.error(
      'provision : BASEDB_ADMIN_TOKEN, ou BASEDB_ADMIN_EMAIL et BASEDB_ADMIN_PASSWORD, sont requis.',
    )
    process.exit(2)
  }
  const login = await fetch(`${url}/auth/password/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!login.ok) fail(`connexion refusée (${login.status})`)
  // The session and its CSRF companion, as a browser would keep and echo them.
  const cookies = login.headers.getSetCookie().map((c) => c.split(';')[0] ?? '')
  const csrf = cookies.find((c) => c.startsWith('__Host-basedb_csrf='))?.split('=')[1]
  if (!csrf) fail('pas de cookie de session dans la réponse de connexion')
  const access = await fetch(`${url}/auth/session/access`, {
    method: 'POST',
    headers: { cookie: cookies.join('; '), 'x-basedb-csrf': csrf },
  })
  if (!access.ok) fail(`pas de jeton d’accès (${access.status})`)
  const { data } = (await access.json()) as { data: { token: string } }
  return data.token
}

function fail(reason: string): never {
  console.error(`provision : ${reason}`)
  process.exit(1)
}

interface Step {
  readonly kind: string
  readonly label?: string
  readonly table?: string
  readonly index?: number
  readonly count?: number
}

function describe(step: Step): string {
  switch (step.kind) {
    case 'table':
      return `table ${step.index ?? '?'}/${step.count ?? '?'} : ${step.label}`
    case 'fields':
      return `champs : ${step.table}`
    case 'rows':
      return `lignes : ${step.table}`
    case 'row_links':
      return 'relations entre les lignes'
    default:
      return `${step.kind}${step.label ? ` : ${step.label}` : ''}`
  }
}

const response = await fetch(`${url}/api/v1/${encodeURIComponent(tenant)}/admin/bases`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${await adminToken()}`,
    'content-type': 'application/json',
    accept: 'application/x-ndjson',
  },
  body: JSON.stringify({ template, label, rows }),
})
if (!response.ok || !response.body) {
  const body = await response.text()
  fail(`refusé (${response.status}) ${body}`)
}

// One JSON object a line: the steps as they start, then the base — or the refusal.
let last: unknown = null
let buffer = ''
const decoder = new TextDecoder()
for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
  buffer += decoder.decode(chunk, { stream: true })
  let end = buffer.indexOf('\n')
  while (end !== -1) {
    const line = buffer.slice(0, end).trim()
    buffer = buffer.slice(end + 1)
    if (line) {
      const value = JSON.parse(line) as { step?: Step }
      if (value.step) console.log(`  · ${describe(value.step)}`)
      else last = value
    }
    end = buffer.indexOf('\n')
  }
}
if (buffer.trim()) last = JSON.parse(buffer)

const outcome = last as {
  data?: { id: string; name: string; label: string }
  error?: { code: string; details?: unknown }
} | null
if (!outcome?.data) fail(`refusé : ${JSON.stringify(outcome?.error ?? outcome)}`)

console.log(`
provision : base « ${outcome.data.label} » créée — ${outcome.data.name}

Ensuite, dans basedb : ouvrez la base, menu ⋯ → API et agents → Jetons API et MCP…, et créez
un jeton pour la surface REST, en lecture seule. Puis, dans apps/server/.env :

  BASEDB_API_URL=${url}
  BASEDB_TENANT=${tenant}
  BASEDB_BASE=${outcome.data.name}
  BASEDB_TOKEN=bdb_…
`)
