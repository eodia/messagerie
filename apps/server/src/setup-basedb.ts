import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import {
  AdminFailure,
  type BaseSummary,
  accessToken,
  createBase,
  elevate,
  groupEditing,
  issueToken,
  listBases,
  signIn,
  whoAmI,
} from './basedb/admin.js'

/**
 * Links the chat to the basedb of docker-compose.yml, in development:
 *
 *   corepack pnpm db:up && corepack pnpm basedb:setup
 *
 * Waits for basedb; signs in as the administrator `.env` names; creates the « Messagerie »
 * base with the rows of Acme Assurances, unless it exists; issues the chat's integration
 * token (REST, write) unless the chat already holds a good one; gives the group of the
 * supervisors the right to edit the base; and writes what the server
 * and the inbox need into `apps/server/.env` and `apps/web/.env.local`. Run again, it
 * changes nothing that works.
 */

const LABEL = 'Messagerie'
const SUPERVISORS = 'Superviseurs de la messagerie'
const port = process.env.BASEDB_PORT || '8890'
const url = `http://localhost:${port}`
const tenant = process.env.BASEDB_TENANT || 't4z56fq'
const email = process.env.BASEDB_ADMIN_EMAIL
const password = process.env.BASEDB_ADMIN_PASSWORD

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))
const serverEnv = here('../.env')
const webEnv = here('../../web/.env.local')

const require = createRequire(import.meta.url)
const read = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(require.resolve(`@chat/basedb-template/${name}`), 'utf8'))

/** Sets variables in an env file, keeping every other line as it is. */
function setEnv(file: string, values: Readonly<Record<string, string>>): void {
  let text = existsSync(file) ? readFileSync(file, 'utf8') : ''
  for (const [name, value] of Object.entries(values)) {
    const line = `${name}=${value}`
    const pattern = new RegExp(`^#?\\s*${name}=.*$`, 'm')
    text = pattern.test(text)
      ? text.replace(pattern, line)
      : `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${line}\n`
  }
  writeFileSync(file, text)
}

function envValue(file: string, name: string): string | null {
  if (!existsSync(file)) return null
  return new RegExp(`^${name}=(.*)$`, 'm').exec(readFileSync(file, 'utf8'))?.[1]?.trim() || null
}

async function waitForBasedb(): Promise<void> {
  for (let attempt = 0; attempt < 90; attempt++) {
    const ok = await fetch(`${url}/healthz`)
      .then((r) => r.ok)
      .catch(() => false)
    if (ok) return
    if (attempt === 0) console.log(`basedb : en attente de ${url}…`)
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new AdminFailure(`basedb ne répond pas à ${url} — corepack pnpm db:up ?`)
}

/** Whether the token the chat holds still reads this base. */
async function tokenWorks(token: string, base: string): Promise<boolean> {
  const response = await fetch(
    `${url}/api/v1/${encodeURIComponent(tenant)}/meta/bases/${encodeURIComponent(base)}`,
    { headers: { authorization: `Bearer ${token}` } },
  ).catch(() => null)
  return response?.ok ?? false
}

try {
  if (!email || !password) {
    throw new AdminFailure(
      'BASEDB_ADMIN_EMAIL et BASEDB_ADMIN_PASSWORD manquent dans .env — corepack pnpm db:up les écrit.',
    )
  }
  await waitForBasedb()
  const session = await signIn(url, tenant, email, password)
  const token = await accessToken(session)

  let base: BaseSummary | undefined = (await listBases(session, token)).find(
    (b) => b.label === LABEL,
  )
  if (base) {
    console.log(`basedb : la base « ${LABEL} » existe déjà (${base.name}).`)
  } else {
    console.log(`basedb : création de la base « ${LABEL} », avec Acme Assurances…`)
    const template = { ...read('messagerie.json'), rows: read('demo-rows.json') }
    base = await createBase(session, token, { template, label: LABEL, rows: true }, (step) =>
      console.log(`  · ${step}`),
    )
  }

  const held = envValue(serverEnv, 'BASEDB_TOKEN')
  const heldBase = envValue(serverEnv, 'BASEDB_BASE')
  let chatToken = held
  if (!held || heldBase !== base.name || !(await tokenWorks(held, base.name))) {
    chatToken = await issueToken(session, base.name, 'Messagerie (serveur)', 'write')
    console.log('basedb : jeton d’intégration du chat émis (REST, écriture).')
  }

  // The supervisors named in the inbox join this group, which may edit the base: they
  // change the settings without anyone opening basedb.
  await elevate(session)
  const baseId = (await listBases(session, await accessToken(session))).find(
    (b) => b.name === base.name,
  )?.id
  if (!baseId) throw new AdminFailure(`la base ${base.name} n’apparaît pas dans la liste`)
  const supervisors = await groupEditing(session, SUPERVISORS, baseId)
  console.log(`basedb : le groupe « ${SUPERVISORS} » peut modifier la base.`)

  // Requests without a token — scripts, curl — are made as this administrator, who is the
  // supervisor « $moi » of the demonstration rows: the same person as in the browser.
  const admin = await whoAmI(session)
  setEnv(serverEnv, {
    BASEDB_API_URL: url,
    BASEDB_TENANT: tenant,
    BASEDB_BASE: base.name,
    BASEDB_TOKEN: chatToken ?? '',
    CHAT_DEV_AGENT: admin.id,
    BASEDB_SUPERVISORS_GROUP: supervisors,
  })
  setEnv(webEnv, { BASEDB_URL: url, BASEDB_API_URL: url })

  console.log(`
La messagerie est reliée à basedb.

  basedb      ${url}  — ${email}, mot de passe : BASEDB_ADMIN_PASSWORD dans .env
  serveur     apps/server/.env  (BASEDB_*, et CHAT_DEV_AGENT : l'administrateur)
  inbox       apps/web/.env.local  (BASEDB_URL, BASEDB_API_URL)

Relancez le serveur et l'inbox, puis corepack pnpm seed pour les conversations de démo.
Connectez-vous à basedb, puis ouvrez http://localhost:3210.
`)
} catch (error) {
  console.error(`basedb:setup : ${error instanceof AdminFailure ? error.message : String(error)}`)
  process.exit(1)
}
