import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { conversations } from '../db/schema.js'

/** The copilot helps an agent: only in a conversation an agent has, or is waiting on. */
export async function copilotAvailable(db: Db, conversationId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: conversations.status })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
  return row?.status === 'open' || row?.status === 'pending'
}
