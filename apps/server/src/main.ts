import { serve } from '@hono/node-server'
import { createApp, startPings } from './app.js'
import { readConfig } from './config.js'
import { connect, migrateDatabase } from './db/client.js'
import { loadSummaries } from './inbox/read.js'
import { InboxHub } from './realtime/hub.js'
import { listenForChanges } from './realtime/signals.js'

/**
 * Starts the chat server: the schema brought up to date, the change listener, then the
 * HTTP and WebSocket server. Stops cleanly on Ctrl+C and on `docker stop`.
 */
const config = readConfig()
const { pool, db } = connect(config.databaseUrl)
await migrateDatabase(db)

const hub = new InboxHub()
const stopListening = listenForChanges(
  config.databaseUrl,
  (conversationId) => {
    if (hub.size === 0) return
    loadSummaries(db, [conversationId])
      .then(([summary]) => summary && hub.broadcast({ type: 'conversation', summary }))
      .catch((error: unknown) => console.error('chat: live update failed', error))
  },
  (error) => console.error('chat: change listener', error),
)
const stopPings = startPings(hub)

const { app, injectWebSocket } = createApp({ db, hub, config })
const server = serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`chat: listening on http://localhost:${port}`)
  if (config.devAgent) console.log(`chat: development identity ${config.devAgent}`)
})
injectWebSocket(server)

let stopping = false
async function stop(): Promise<void> {
  if (stopping) return
  stopping = true
  stopPings()
  server.close()
  await stopListening()
  await pool.end()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
