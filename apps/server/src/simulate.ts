import { desc, eq } from 'drizzle-orm'
import { readConfig } from './config.js'
import { connect } from './db/client.js'
import { contacts, conversations } from './db/schema.js'
import { handOff, receiveVisitorMessage } from './inbox/incoming.js'

/**
 * Development: plays what the widget and the AI will do, against the running server's
 * database — to see the inbox ring.
 *
 *   pnpm --filter @chat/server simulate message "Emma Richard" "Je suis toujours là ?"
 *   pnpm --filter @chat/server simulate transfert "Julie Martin"
 *
 * Acts on the contact's latest conversation. The signal goes through PostgreSQL, as a
 * real message's would: the server that listens tells the inboxes.
 */
const config = readConfig()
if (config.production) {
  console.error('simulate : refusé en production.')
  process.exit(1)
}

const [what, contactName, text] = process.argv.slice(2)
if ((what !== 'message' && what !== 'transfert') || !contactName) {
  console.error('Usage : simulate message "<contact>" "<texte>" | simulate transfert "<contact>"')
  process.exit(2)
}

const { pool, db } = connect(config.databaseUrl)
const [found] = await db
  .select({ id: conversations.id })
  .from(conversations)
  .innerJoin(contacts, eq(contacts.id, conversations.contactId))
  .where(eq(contacts.name, contactName))
  .orderBy(desc(conversations.lastMessageAt))
  .limit(1)
if (!found) {
  console.error(`simulate : aucune conversation pour « ${contactName} ».`)
  await pool.end()
  process.exit(1)
}

if (what === 'message') {
  await receiveVisitorMessage(db, found.id, text || 'Vous êtes toujours là ?')
  console.log(`simulate : ${contactName} a écrit.`)
} else {
  await handOff(db, found.id, {
    reason: 'Demande hors de la base de connaissance',
    summary: `${contactName} pose une question à laquelle la base de connaissance ne répond pas : un conseiller doit la reprendre.`,
    confidence: 0.41,
    assigneeId: null,
    team: 'Support',
    model: 'simulation',
  })
  console.log(`simulate : l’IA a transféré la conversation de ${contactName}.`)
}
await pool.end()
