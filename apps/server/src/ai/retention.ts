import { and, eq, lt, notExists, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { contacts, conversations } from '../db/schema.js'
import type { Settings } from '../settings/settings.js'

/**
 * The retention of each site (« Conservation (jours) », framing: « purge automatique »):
 * a conversation quiet for longer is deleted with its messages, attachments, traces and
 * the passages indexed from it (they all cascade); then the contacts left with none.
 * Returns how many conversations went.
 */
export async function purgeExpired(db: Db, settings: Settings, now = new Date()): Promise<number> {
  let purged = 0
  for (const site of await settings.sites()) {
    if (site.retentionDays === null || site.retentionDays <= 0) continue
    const before = new Date(now.getTime() - site.retentionDays * 86_400_000)
    const gone = await db
      .delete(conversations)
      .where(and(eq(conversations.siteId, site.id), lt(conversations.lastMessageAt, before)))
      .returning({ id: conversations.id })
    purged += gone.length
    await db
      .delete(contacts)
      .where(
        and(
          eq(contacts.siteId, site.id),
          lt(contacts.updatedAt, before),
          notExists(
            db
              .select({ one: sql`1` })
              .from(conversations)
              .where(eq(conversations.contactId, contacts.id)),
          ),
        ),
      )
  }
  return purged
}
