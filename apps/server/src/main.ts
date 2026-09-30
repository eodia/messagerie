import { serve } from '@hono/node-server'
import { createApp, startPings } from './app.js'
import { TicketBook } from './auth/tickets.js'
import { BasedbClient } from './basedb/client.js'
import { MessagerieSettings } from './basedb/settings.js'
import { readConfig } from './config.js'
import { connect, migrateDatabase } from './db/client.js'
import { loadSummaries } from './inbox/read.js'
import { InboxHub } from './realtime/hub.js'
import { listenForChanges } from './realtime/signals.js'

/**
 * Starts the chat server: the schema brought up to date, basedb followed, the change
 * listener, then the HTTP and WebSocket server. Stops cleanly on Ctrl+C and `docker stop`.
 */
const config = readConfig()
const { pool, db } = connect(config.databaseUrl)
await migrateDatabase(db)

const settings = config.basedb ? new MessagerieSettings(new BasedbClient(config.basedb)) : null
const stopFollowing =
  settings?.follow((error) => console.error('chat : flux basedb', error)) ?? (() => {})

const hub = new InboxHub()
const stopListening = listenForChanges(
  config.databaseUrl,
  ({ conversationId, alert, notify }) => {
    if (hub.size === 0) return
    for (const agentId of notify ?? []) hub.sendTo(agentId, { type: 'notifications' })
    if (conversationId === undefined) return
    loadSummaries(db, [conversationId])
      .then(([summary]) => summary && hub.broadcast({ type: 'conversation', summary, alert }))
      .catch((error: unknown) => console.error('chat : mise à jour en direct impossible', error))
  },
  (error) => console.error('chat : écoute des changements', error),
)
const stopPings = startPings(hub)

const { app, injectWebSocket } = createApp({
  db,
  hub,
  config,
  settings,
  tickets: new TicketBook(),
})
const server = serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`chat : à l’écoute sur http://localhost:${port}`)
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
  stopFollowing()
  server.close()
  await stopListening()
  await pool.end()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
