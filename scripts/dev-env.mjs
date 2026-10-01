/**
 * Writes `.env` at the root of the repository, once: what docker compose needs to run the
 * chat's basedb — an encryption key and an administrator — generated here, so that no
 * secret is ever written in docker-compose.yml. An existing `.env` is left as it is; a
 * missing variable is added.
 *
 *   node scripts/dev-env.mjs
 */
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const file = fileURLToPath(new URL('../.env', import.meta.url))
const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
const has = (name) => new RegExp(`^${name}=`, 'm').test(current)

const wanted = [
  ['BASEDB_ENCRYPTION_KEY', () => randomBytes(32).toString('base64')],
  ['BASEDB_ADMIN_EMAIL', () => 'admin@messagerie.dev'],
  ['BASEDB_ADMIN_PASSWORD', () => `messagerie-${randomBytes(9).toString('base64url')}`],
]
const missing = wanted.filter(([name]) => !has(name))

if (missing.length > 0) {
  const header =
    current === ''
      ? '# Development only — read by docker compose and `pnpm basedb:setup`. Never committed.\n' +
        '# basedb, http://localhost:8890: sign in with BASEDB_ADMIN_EMAIL and BASEDB_ADMIN_PASSWORD.\n'
      : current.endsWith('\n')
        ? ''
        : '\n'
  const lines = missing.map(([name, value]) => `${name}=${value()}`).join('\n')
  writeFileSync(file, `${current}${header}${lines}\n`)
  console.log(`.env : ${missing.map(([name]) => name).join(', ')} ajouté(s).`)
}
