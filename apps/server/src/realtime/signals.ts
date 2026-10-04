import type { AlertKind } from '@chat/contracts'
import { sql } from 'drizzle-orm'
import pg from 'pg'
import type { Db } from '../db/client.js'

/**
 * Changes travel through PostgreSQL itself (D6): a write sends `NOTIFY` in its own
 * transaction, so the signal leaves only if the write commits; every server process
 * `LISTEN`s and tells its own sockets. No Redis until several instances outgrow this.
 */
const CHANNEL = 'chat_events'

export interface Signal {
  /** The conversation that changed — none when only notifications did. */
  readonly conversationId?: string
  /** Why the change calls for attention, if it does. */
  readonly alert?: AlertKind
  /** The agents whose notifications changed: their sockets are told to read them again. */
  readonly notify?: readonly string[]
  /** Nothing changed yet: someone is writing — the AI or an agent (for the visitor), the
   * visitor (for the inbox). */
  readonly typing?: 'ai' | 'agent' | 'visitor'
  /** Who is typing, when it is an agent: their first name, as the visitor knows them. */
  readonly by?: string
  /**
   * Only the pages the visitor went through changed: the agents who see the conversation
   * read them again — no list to redraw, no thread, nothing for the visitor.
   */
  readonly page?: true
}

/** Call inside the transaction that made the change. */
export async function signalChange(
  db: Db,
  conversationId: string,
  extra: Omit<Signal, 'conversationId'> = {},
): Promise<void> {
  await send(db, { conversationId, ...extra })
}

/**
 * Someone is writing in a conversation: the AI or an agent — the visitor's three dots —, or
 * the visitor — the inbox's « est en train d'écrire ». Nothing is written: no transaction.
 */
export async function signalTyping(
  db: Db,
  conversationId: string,
  who: 'ai' | 'agent' | 'visitor' = 'ai',
  by?: string,
): Promise<void> {
  await send(db, { conversationId, typing: who, ...(by ? { by } : {}) })
}

/** The visitor opened or left a page: call inside the transaction that wrote it. */
export async function signalPage(db: Db, conversationId: string): Promise<void> {
  await send(db, { conversationId, page: true })
}

/** Tells agents that their notifications changed, and nothing else did. */
export async function signalNotifications(db: Db, agentIds: readonly string[]): Promise<void> {
  if (agentIds.length > 0) await send(db, { notify: agentIds })
}

async function send(db: Db, payload: Signal): Promise<void> {
  await db.execute(sql`select pg_notify(${CHANNEL}, ${JSON.stringify(payload)})`)
}

/**
 * Listens on a connection of its own — a pooled one would be handed to someone else —
 * and comes back after a lost connection, with a pause that grows up to ten seconds.
 * Returns what stops it.
 */
export function listenForChanges(
  databaseUrl: string,
  onChange: (signal: Signal) => void,
  onError: (error: unknown) => void = () => {},
): () => Promise<void> {
  return listen(databaseUrl, CHANNEL, (payload) => onChange(JSON.parse(payload) as Signal), onError)
}

/** `LISTEN`s on `channel`: each payload to `onMessage`. The same, for any channel. */
export function listen(
  databaseUrl: string,
  channel: string,
  onMessage: (payload: string) => void,
  onError: (error: unknown) => void = () => {},
): () => Promise<void> {
  let client: pg.Client | null = null
  let stopped = false
  let delay = 500

  async function open(): Promise<void> {
    if (stopped) return
    const next = new pg.Client({ connectionString: databaseUrl })
    next.on('notification', (message) => {
      if (message.channel !== channel || !message.payload) return
      try {
        onMessage(message.payload)
      } catch (error) {
        onError(error)
      }
    })
    next.on('error', (error) => {
      onError(error)
      retry(next)
    })
    next.on('end', () => retry(next))
    try {
      await next.connect()
      await next.query(`LISTEN ${channel}`)
      client = next
      delay = 500
    } catch (error) {
      onError(error)
      retry(next)
    }
  }

  function retry(failed: pg.Client): void {
    if (stopped || (client !== null && client !== failed)) return
    client = null
    failed.removeAllListeners()
    failed.end().catch(() => {})
    setTimeout(open, delay)
    delay = Math.min(delay * 2, 10_000)
  }

  void open()
  return async () => {
    stopped = true
    await client?.end().catch(() => {})
  }
}
