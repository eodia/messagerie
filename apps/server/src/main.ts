import { serve } from '@hono/node-server'
import { eq } from 'drizzle-orm'
import { createApp, startPings } from './app.js'
import { devAgent } from './auth/agent.js'
import { TicketBook } from './auth/tickets.js'
import { boot } from './boot.js'
import { conversations } from './db/schema.js'
import { Access } from './inbox/access.js'
import { loadSummaries } from './inbox/read.js'
import { leaveAllPages } from './page/views.js'
import { InboxHub } from './realtime/hub.js'
import { listenForChanges } from './realtime/signals.js'
import { WidgetHub } from './widget/hub.js'

/**
 * Starts the chat server: what `boot` starts, the change listener, then the HTTP and
 * WebSocket server. Stops cleanly on Ctrl+C and `docker stop`.
 */
const {
  config,
  db,
  pool,
  settings,
  ai,
  mcp,
  automations,
  mailer,
  stop: stopBoot,
} = await boot('server')

// No widget is connected to a server that starts: the pages a stop left open are left.
await leaveAllPages(db)

const hub = new InboxHub()
const widgetHub = new WidgetHub()
const access = new Access(settings)

/** The inbox of a conversation — `undefined` when there is no such conversation. */
async function inboxOf(conversationId: string): Promise<string | null | undefined> {
  const [row] = await db
    .select({ inboxId: conversations.inboxId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
  return row ? row.inboxId : undefined
}

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
  ({ conversationId, alert, notify, typing, by }) => {
    for (const agentId of notify ?? []) hub.sendTo(agentId, { type: 'notifications' })
    if (conversationId === undefined) return
    const failed = (error: unknown) =>
      console.error('chat : mise à jour en direct impossible', error)
    // The visitor writing: to the agents who see the conversation's inbox, and no one else.
    if (typing === 'visitor') {
      if (hub.size === 0) return
      inboxOf(conversationId)
        .then(async (inboxId) => {
          if (inboxId === undefined) return
          const audience = new Set(await access.audience(db, inboxId))
          hub.sendWhere({ type: 'typing', conversationId, who: 'visitor' }, (agent) =>
            audience.has(agent),
          )
        })
        .catch(failed)
      return
    }
    if (widgetHub.size > 0) {
      contactOf(conversationId)
        .then((contactId) => {
          if (contactId === null) return
          widgetHub.send(
            contactId,
            typing
              ? { type: 'typing', who: typing, ...(by ? { name: by } : {}) }
              : { type: 'conversation' },
          )
        })
        .catch(failed)
    }
    // Typing changes nothing the inbox shows.
    if (typing || hub.size === 0) return
    // Only to those who see its inbox.
    loadSummaries(db, [conversationId])
      .then(async ([summary]) => {
        if (!summary) return
        const audience = new Set(await access.audience(db, summary.inboxId))
        // An automation's alert is for those it told (D20); the others see the change.
        const told = new Set(alert === 'automation' ? (notify ?? []) : audience)
        hub.sendWhere({ type: 'conversation', summary, alert }, (agent) => told.has(agent))
        hub.sendWhere(
          { type: 'conversation', summary },
          (agent) => audience.has(agent) && !told.has(agent),
        )
      })
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
  settings,
  tickets: new TicketBook(),
  widgetHub,
  ai,
  mcp,
  automations,
  pool,
  mailer,
})
const server = serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`chat : à l’écoute sur http://localhost:${port}`)
  if (config.devAgent) {
    const login = config.devAgent
    void devAgent(db, login).then((agent) =>
      console.log(
        agent
          ? `chat : sans session, l’inbox agit comme ${login} (développement)`
          : `chat : CHAT_DEV_AGENT=${login} ne désigne aucun conseiller actif (une adresse est attendue) — l’inbox demande de se connecter`,
      ),
    )
  }
  if (config.oidc) console.log(`chat : connexion par ${config.oidc.name} (${config.oidc.issuer})`)
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
