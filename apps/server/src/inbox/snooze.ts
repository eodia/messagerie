import { and, asc, eq, lte } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { conversations } from '../db/schema.js'
import { wake } from './write.js'

/**
 * The conversations on hold come back at their time: every thirty seconds, those due are
 * woken — unread again, their assignee told. A clock of its own, not the AI's queues: it
 * works without an AI. Twice is harmless — `wake` does nothing to one already back.
 */

const PASS_MS = 30_000

export async function wakeDue(db: Db, now = new Date()): Promise<number> {
  const due = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.status, 'pending'), lte(conversations.snoozedUntil, now)))
    .orderBy(asc(conversations.snoozedUntil))
    .limit(100)
  for (const { id } of due) await wake(db, null, id)
  return due.length
}

export function startWaking(db: Db): { stop(): Promise<void> } {
  let running: Promise<unknown> | null = null
  const pass = () => {
    if (running) return
    running = wakeDue(db)
      .catch((error) => console.error('chat : réveil des conversations', error))
      .finally(() => {
        running = null
      })
  }
  const timer = setInterval(pass, PASS_MS)
  pass()
  return {
    stop: async () => {
      clearInterval(timer)
      await running
    },
  }
}
