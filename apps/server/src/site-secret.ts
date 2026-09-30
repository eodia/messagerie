import { eq } from 'drizzle-orm'
import { ConfigError, readConfig } from './config.js'
import { connect, migrateDatabase } from './db/client.js'
import { siteSecrets } from './db/schema.js'
import { newSecret } from './widget/tokens.js'

/**
 * The secret a site signs its customers' identity with (D5) — kept by the chat, never in
 * basedb. Shows it, creating it if the site has none; `--rotate` replaces it, and the
 * identities signed with the old one stop being accepted at once.
 *
 *   pnpm --filter @chat/server site-secret <site id> [--rotate]
 *
 * The site id is the `_id` of the site's row in basedb's « Sites ».
 */
let config: ReturnType<typeof readConfig>
try {
  config = readConfig()
} catch (error) {
  if (!(error instanceof ConfigError)) throw error
  console.error(`site-secret : ${error.message}`)
  process.exit(1)
}

const [siteId] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
const rotate = process.argv.includes('--rotate')
if (!siteId) {
  console.error('Usage : site-secret <identifiant du site> [--rotate]')
  process.exit(2)
}

const { pool, db } = connect(config.databaseUrl)
await migrateDatabase(db)
const [existing] = await db.select().from(siteSecrets).where(eq(siteSecrets.siteId, siteId))
let secret = existing?.identitySecret
if (!secret || rotate) {
  secret = newSecret()
  await db
    .insert(siteSecrets)
    .values({ siteId, identitySecret: secret })
    .onConflictDoUpdate({
      target: siteSecrets.siteId,
      set: { identitySecret: secret, createdAt: new Date() },
    })
}
await pool.end()

console.log(`Secret du site ${siteId}${rotate ? ' (renouvelé)' : ''} :

  ${secret}

Le serveur du site signe l'identité du client connecté (JWT, HS256) et la donne au widget :

  <script src="…/widget.js" data-site="${siteId}" data-identity="<jeton>" async></script>

Charge utile : { "sub": "<identifiant client>", "name": "…", "email": "…",
                 "attributes": { "Numéro de contrat": "…" }, "exp": <échéance, en secondes> }`)
