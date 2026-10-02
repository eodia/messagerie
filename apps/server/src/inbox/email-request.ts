import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { contacts, conversations, messages } from '../db/schema.js'
import { signalChange } from '../realtime/signals.js'

/**
 * « Laissez-nous votre e-mail »: when nobody can answer soon — the AI handed over while the
 * agents are away, or an automation saw the visitor wait —, the widget shows a card to
 * leave an address, so that the answer reaches them later. Asked once a conversation, and
 * only of a contact without an e-mail.
 */

/** Asks, inside the caller's transaction; whether it did. */
export async function requestEmail(
  tx: Db,
  conversationId: string,
  by: string | null,
  text: string | null,
  at: Date = new Date(),
): Promise<boolean> {
  const [row] = await tx
    .select({ email: contacts.email })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(eq(conversations.id, conversationId))
  if (!row || row.email) return false
  const [asked] = await tx
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.kind, 'event'),
        sql`${messages.meta}->'event'->>'type' = 'email_requested'`,
      ),
    )
    .limit(1)
  if (asked) return false
  await tx.insert(messages).values({
    conversationId,
    author: 'system',
    kind: 'event',
    meta: { event: { type: 'email_requested', by, text: text || null } },
    createdAt: at,
  })
  await signalChange(tx, conversationId)
  return true
}
