import { serve } from '@hono/node-server'
import { eq } from 'drizzle-orm'
import { createApp, startPings } from './app.js'
import { TicketBook } from './auth/tickets.js'
import { BasedbClient } from './basedb/client.js'
import { ConfigError, readConfig } from './config.js'
import { connect, migrateDatabase } from './db/client.js'
import { conversations } from './db/schema.js'
import { loadSummaries } from './inbox/read.js'
import { InboxHub } from './realtime/hub.js'
import { listenForChanges } from './realtime/signals.js'
import { Settings } from './settings/settings.js'
import { BasedbSource, TemplateSource } from './settings/source.js'
import { WidgetHub } from './widget/hub.js'

/**
 * Starts the chat server: the schema brought up to date, basedb followed, the change
 * listener, then the HTTP and WebSocket server. Stops cleanly on Ctrl+C and `docker stop`.
 */
let config: ReturnType<typeof readConfig>
try {
  config = readConfig()
} catch (error) {
  if (!(error instanceof ConfigError)) throw error
  console.error(`chat : ${error.message}`)
  process.exit(1)
}
const { pool, db } = connect(config.databaseUrl)
await migrateDatabase(db)

// The settings come from basedb; in development without it, from the template and the
// demonstration rows of Acme Assurances. In production without basedb, there are none.
const basedb = config.basedb ? new BasedbClient(config.basedb) : null
const source = basedb
  ? new BasedbSource(basedb)
  : config.production
    ? null
    : new TemplateSource(config.devAgent, true)
const settings = source ? new Settings(source) : null
const stopFollowing =
  settings?.follow((error) => console.error('chat : flux basedb', error)) ?? (() => {})

const hub = new InboxHub()
const widgetHub = new WidgetHub()
const stopListening = listenForChanges(
  config.databaseUrl,
  ({ conversationId, alert, notify }) => {
    for (const agentId of notify ?? []) hub.sendTo(agentId, { type: 'notifications' })
    if (conversationId === undefined) return
    const failed = (error: unknown) =>
      console.error('chat : mise à jour en direct impossible', error)
    if (hub.size > 0) {
      loadSummaries(db, [conversationId])
        .then(([summary]) => summary && hub.broadcast({ type: 'conversation', summary, alert }))
        .catch(failed)
    }
    // The visitor whose conversation it is, if their widget is open.
    if (widgetHub.size > 0) {
      db.select({ contactId: conversations.contactId })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .then(([row]) => row && widgetHub.send(row.contactId, { type: 'conversation' }))
        .catch(failed)
    }
  },
  (error) => console.error('chat : écoute des changements', error),
)
const stopPings = startPings(hub)
const widgetPings = setInterval(() => widgetHub.broadcast({ type: 'ping' }), 25_000)

const { app, injectWebSocket } = createApp({
  db,
  hub,
  config,
  basedb,
  settings,
  tickets: new TicketBook(),
  widgetHub,
})
const server = serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`chat : à l’écoute sur http://localhost:${port}`)
  if (source?.kind === 'template') {
    console.log('chat : paramétrage de démonstration (Acme Assurances), sans basedb')
  }
  if (config.basedb) {
    console.log(
      `chat : conseillers lus dans basedb ${config.basedb.url}, base ${config.basedb.base}`,
    )
  }
  if (config.devAgent) console.log(`chat : identité de développement ${config.devAgent} sans jeton`)
  if (!config.basedb && !config.devAgent) {
    console.warn('chat : ni basedb ni identité de développement — toute requête est refusée')
  }
})
injectWebSocket(server)

let stopping = false
async function stop(): Promise<void> {
  if (stopping) return
  stopping = true
  stopPings()
  clearInterval(widgetPings)
  stopFollowing()
  server.close()
  await stopListening()
  await pool.end()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
