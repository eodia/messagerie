import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { contacts, conversations, messages } from '../db/schema.js'
import { signalChange } from '../realtime/signals.js'

/**
 * « Laissez-nous votre e-mail »: when nobody can answer soon — the AI handed over while the
 * agents are away, or an automation saw the visitor wait —, the widget shows a card to
 * leave an address, so that the answer reaches them later — by e-mail (D23). Asked once a
 * conversation, only of a contact without an e-mail, and only in the widget.
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
    .select({ email: contacts.email, channel: conversations.channel })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(eq(conversations.id, conversationId))
  // By SMS, the visitor's phone is how the answer reaches them: no card to show (D23).
  if (!row || row.email || row.channel !== 'web') return false
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
