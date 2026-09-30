import { serve } from '@hono/node-server'
import { eq } from 'drizzle-orm'
import { createApp, startPings } from './app.js'
import { TicketBook } from './auth/tickets.js'
import { boot } from './boot.js'
import { conversations } from './db/schema.js'
import { loadSummaries } from './inbox/read.js'
import { InboxHub } from './realtime/hub.js'
import { listenForChanges } from './realtime/signals.js'
import { WidgetHub } from './widget/hub.js'

/**
 * Starts the chat server: what `boot` starts, the change listener, then the HTTP and
 * WebSocket server. Stops cleanly on Ctrl+C and `docker stop`.
 */
const { config, db, basedb, settings, settingsKind, ai, stop: stopBoot } = await boot('server')

const hub = new InboxHub()
const widgetHub = new WidgetHub()

/** The visitor whose conversation it is — told only if their widget is open. */
async function contactOf(conversationId: string): Promise<string | null> {
  const [row] = await db
    .select({ contactId: conversations.contactId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
  return row?.contactId ?? null
}

const stopListening = listenForChanges(
  config.databaseUrl,
  ({ conversationId, alert, notify, typing }) => {
    for (const agentId of notify ?? []) hub.sendTo(agentId, { type: 'notifications' })
    if (conversationId === undefined) return
    const failed = (error: unknown) =>
      console.error('chat : mise à jour en direct impossible', error)
    if (widgetHub.size > 0) {
      contactOf(conversationId)
        .then((contactId) => {
          if (contactId === null) return
          widgetHub.send(
            contactId,
            typing ? { type: 'typing', who: typing } : { type: 'conversation' },
          )
        })
        .catch(failed)
    }
    // Typing changes nothing the inbox shows.
    if (typing || hub.size === 0) return
    loadSummaries(db, [conversationId])
      .then(([summary]) => summary && hub.broadcast({ type: 'conversation', summary, alert }))
      .catch(failed)
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
  ai,
})
const server = serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`chat : à l’écoute sur http://localhost:${port}`)
  if (settingsKind === 'template') {
    console.log('chat : paramétrage de démonstration (Acme Assurances), sans basedb')
  }
  if (config.basedb) {
    console.log(
      `chat : paramétrage lu dans basedb ${config.basedb.url}, base ${config.basedb.base}`,
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
  server.close()
  await stopListening()
  await stopBoot()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
