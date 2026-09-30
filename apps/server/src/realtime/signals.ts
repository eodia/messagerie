import { sql } from 'drizzle-orm'
import pg from 'pg'
import type { Db } from '../db/client.js'

/**
 * Changes travel through PostgreSQL itself (D6): a write sends `NOTIFY` in its own
 * transaction, so the signal leaves only if the write commits; every server process
 * `LISTEN`s and tells its own sockets. No Redis until several instances outgrow this.
 */
const CHANNEL = 'chat_events'

interface Signal {
  readonly conversationId: string
}

/** Call inside the transaction that made the change. */
export async function signalChange(db: Db, conversationId: string): Promise<void> {
  const payload: Signal = { conversationId }
  await db.execute(sql`select pg_notify(${CHANNEL}, ${JSON.stringify(payload)})`)
}

/**
 * Listens on a connection of its own — a pooled one would be handed to someone else —
 * and comes back after a lost connection, with a pause that grows up to ten seconds.
 * Returns what stops it.
 */
export function listenForChanges(
  databaseUrl: string,
  onChange: (conversationId: string) => void,
  onError: (error: unknown) => void = () => {},
): () => Promise<void> {
  let client: pg.Client | null = null
  let stopped = false
  let delay = 500

  async function open(): Promise<void> {
    if (stopped) return
    const next = new pg.Client({ connectionString: databaseUrl })
    next.on('notification', (message) => {
      if (message.channel !== CHANNEL || !message.payload) return
      try {
        const signal = JSON.parse(message.payload) as Signal
        onChange(signal.conversationId)
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
      await next.query(`LISTEN ${CHANNEL}`)
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
