import type { PageVisit } from '@chat/contracts'
import { and, desc, eq, isNull, notInArray, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { conversations, pageViews } from '../db/schema.js'
import { signalPage } from '../realtime/signals.js'

/**
 * Where the visitor is, as their widget says it (D21): each page they open while their
 * conversation lives, from when until when. The widget speaks only once there is a
 * conversation — a visitor who never wrote leaves no trail. What a page says is data,
 * never checked: an address shown to the agents, nothing more.
 */

/** The newest views kept per conversation. */
const KEPT = 100
/** The views the inbox reads. */
const SHOWN = 20

/** Query parameters that may carry a secret or a person: never kept. */
const PRIVATE = /token|secret|pass|pwd|key|code|session|auth|sig|e-?mail|phone|tel/i

/**
 * The address as kept: http or https, without its fragment nor any parameter that looks
 * private, a thousand characters at most; `null` for anything else.
 */
export function cleanPageUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 4000) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  url.hash = ''
  url.username = ''
  url.password = ''
  for (const name of [...url.searchParams.keys()]) {
    if (PRIVATE.test(name)) url.searchParams.delete(name)
  }
  return url.toString().slice(0, 1000)
}

export const cleanPageTitle = (raw: unknown): string =>
  typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, 200) : ''

/**
 * A page opened in one of the visitor's tabs: the one this tab showed before is left, and
 * the new one begins — unless it is the same page, said again. Returns the view the tab
 * now shows.
 */
export async function viewPage(
  db: Db,
  conversationId: string,
  previous: string | null,
  url: string,
  title: string,
): Promise<string> {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .for('update')
    if (previous !== null) {
      const [before] = await tx
        .select()
        .from(pageViews)
        .where(and(eq(pageViews.id, previous), isNull(pageViews.leftAt)))
      if (before && before.url === url && before.title === title) return before.id
      if (before && before.url === url) {
        // The same page, renamed: no new step in the trail.
        await tx.update(pageViews).set({ title }).where(eq(pageViews.id, before.id))
        await signalPage(tx, conversationId)
        return before.id
      }
      await tx
        .update(pageViews)
        .set({ leftAt: sql`now()` })
        .where(and(eq(pageViews.id, previous), isNull(pageViews.leftAt)))
    }
    const [view] = await tx.insert(pageViews).values({ conversationId, url, title }).returning()
    const kept = tx
      .select({ id: pageViews.id })
      .from(pageViews)
      .where(eq(pageViews.conversationId, conversationId))
      .orderBy(desc(pageViews.createdAt))
      .limit(KEPT)
    await tx
      .delete(pageViews)
      .where(and(eq(pageViews.conversationId, conversationId), notInArray(pageViews.id, kept)))
    await signalPage(tx, conversationId)
    return view?.id as string
  })
}

/** The tab closed, or went elsewhere: its page is left. */
export async function leavePage(db: Db, viewId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [left] = await tx
      .update(pageViews)
      .set({ leftAt: sql`now()` })
      .where(and(eq(pageViews.id, viewId), isNull(pageViews.leftAt)))
      .returning({ conversationId: pageViews.conversationId })
    if (left) await signalPage(tx, left.conversationId)
  })
}

/**
 * At the server's start, no widget is connected to it: whatever a stop left open is left.
 */
export async function leaveAllPages(db: Db): Promise<void> {
  await db.update(pageViews).set({ leftAt: sql`now()` }).where(isNull(pageViews.leftAt))
}

/** The newest views of a conversation, for the inbox. */
export async function pagesOf(db: Db, conversationId: string): Promise<PageVisit[]> {
  const rows = await db
    .select()
    .from(pageViews)
    .where(eq(pageViews.conversationId, conversationId))
    .orderBy(desc(pageViews.createdAt))
    .limit(SHOWN)
  return rows.map((r) => ({
    url: r.url,
    title: r.title,
    at: r.createdAt.toISOString(),
    leftAt: r.leftAt?.toISOString() ?? null,
  }))
}
