import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Config } from '../config.js'
import type { Db } from '../db/client.js'
import { contacts, conversations, messages, outbound } from '../db/schema.js'
import {
  MAX_BYTES,
  MAX_FILES,
  type Upload,
  cleanName,
  keeping,
  sniff,
} from '../files/attachments.js'
import type { FileStore } from '../files/store.js'
import { createConversation, receiveVisitorMessage } from '../inbox/incoming.js'
import type { Fetch } from '../outbound/push.js'
import { signalChange } from '../realtime/signals.js'
import { Refusal } from '../refusal.js'
import type { Settings, Site, SmsNumber } from '../settings/settings.js'
import type { Credentials, ProviderCall, SmsProvider } from './provider.js'
import { PROVIDERS, ready } from './providers.js'

/**
 * Visitors who write by SMS or RCS (D23): the number's provider calls its address with each
 * message — signed, or with the key of the address —, and the chat makes it a visitor's
 * message in the conversation of that phone, on the number's site: its inbox, its team, its
 * AI. The answers go back by the postman (`outbound/dispatch.ts`), and the provider says how
 * they went.
 */

export interface SmsDeps {
  readonly db: Db
  readonly settings: Settings
  readonly config: Pick<Config, 'publicUrl' | 'secret'>
  readonly files: FileStore
  /** A model is configured: the site's AI answers first, as in the widget. */
  readonly aiAvailable: boolean
  /** Told of each message — the AI's cue to answer. */
  readonly onVisitorMessage?: (conversationId: string) => void
  readonly fetch?: Fetch
  readonly env?: NodeJS.ProcessEnv
}

/** A conversation resolved more than a day ago is over: the phone starts a new one. */
const RESUME_MS = 24 * 60 * 60 * 1000

/**
 * The number a provider calls about, its credentials, and the call checked — the route's
 * provider must be the number's.
 */
async function checked(
  deps: SmsDeps,
  providerId: string,
  numberId: string,
  call: ProviderCall,
): Promise<{ number: SmsNumber; provider: SmsProvider; credentials: Credentials }> {
  const found = ready(await deps.settings.smsNumber(numberId), deps.env ?? process.env)
  if (typeof found === 'string' || found.provider.id !== providerId) {
    throw new Refusal('NUMBER_UNAVAILABLE', 404)
  }
  if (!found.provider.authentic(call, found.credentials, found.number, deps.config.secret)) {
    throw new Refusal('SIGNATURE_INVALID', 403)
  }
  return found
}

/** The site of a number: its own, or the first active one. */
export async function siteOfNumber(settings: Settings, number: SmsNumber): Promise<Site> {
  const sites = await settings.sites()
  const site = number.siteId
    ? sites.find((s) => s.id === number.siteId)
    : sites.find((s) => s.active)
  if (!site || !site.active) throw new Refusal('NUMBER_UNAVAILABLE', 404)
  return site
}

/** The contact of a phone on a site: the one already known, or a new one named by the number. */
export async function phoneContact(
  db: Db,
  siteId: string,
  phone: string,
  name: string | null = null,
): Promise<string> {
  const [known] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.siteId, siteId), eq(contacts.phone, phone)))
    .orderBy(desc(contacts.updatedAt))
    .limit(1)
  if (known) return known.id
  const [made] = await db
    .insert(contacts)
    .values({ siteId, name: name || phone, phone, identified: false })
    .returning({ id: contacts.id })
  if (!made) throw new Refusal('INTERNAL_ERROR', 500)
  return made.id
}

/** The phone's conversation on this number: one still going, or resolved within a day. */
export async function phoneConversation(db: Db, contactId: string, numberId: string) {
  const [latest] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.contactId, contactId),
        eq(conversations.smsNumberId, numberId),
        isNull(conversations.visitorLeftAt),
      ),
    )
    .orderBy(desc(conversations.createdAt))
    .limit(1)
  if (!latest) return null
  if (latest.status === 'resolved' && Date.now() - latest.updatedAt.getTime() > RESUME_MS) {
    return null
  }
  return latest
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
}

/** The files of an MMS or an RCS, read from the provider and checked as any file (D14). */
async function mediaOf(
  deps: SmsDeps,
  provider: SmsProvider,
  credentials: Credentials,
  media: readonly { readonly url: string; readonly type: string }[],
): Promise<Upload[]> {
  const uploads: Upload[] = []
  for (const [index, item] of media.slice(0, MAX_FILES).entries()) {
    const bytes = await provider.fetchMedia(credentials, item.url, MAX_BYTES, deps.fetch)
    if (!bytes) continue
    const declared = item.type.split(';')[0]?.trim() ?? ''
    const name = cleanName(`fichier-${index + 1}.${EXTENSIONS[declared] ?? 'bin'}`)
    const mime = sniff(bytes, name)
    // What the chat does not take is left with the provider, as in the widget.
    if (mime) uploads.push({ id: randomUUID(), name, mime, bytes })
  }
  return uploads
}

/**
 * A message from a phone. Nothing written twice: a message the provider sends again — it
 * did not hear the answer in time — is recognized by its id. Returns what to answer it.
 */
export async function receiveSms(
  deps: SmsDeps,
  providerId: string,
  numberId: string,
  call: ProviderCall,
): Promise<{ readonly body: string; readonly type: string }> {
  const { db } = deps
  const { number, provider, credentials } = await checked(deps, providerId, numberId, call)
  const message = provider.inbound(call.payload)
  if (!message) throw new Refusal('INVALID_REQUEST', 400, { field: 'from' })
  const site = await siteOfNumber(deps.settings, number)
  const channel = message.rcs ? 'rcs' : 'sms'

  const contactId = await phoneContact(db, site.id, message.from)
  const current = await phoneConversation(db, contactId, number.id)
  if (current) {
    const [seen] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, current.id),
          sql`${messages.meta}->>'providerId' = ${message.providerId}`,
        ),
      )
      .limit(1)
    if (seen) return provider.answer
  }
  const uploads = await mediaOf(deps, provider, credentials, message.media)
  const body = message.body.slice(0, 4000)
  if (body.trim() === '' && uploads.length === 0) return provider.answer
  const id =
    current?.id ??
    (await createConversation(
      db,
      contactId,
      { ...site, aiEnabled: site.aiEnabled && deps.aiAvailable },
      await deps.settings.routeOf(site),
      { channel, smsNumberId: number.id },
    ))
  await keeping(deps.files, id, uploads, (attach) =>
    receiveVisitorMessage(db, id, body, attach, { providerId: message.providerId, channel }),
  )
  deps.onVisitorMessage?.(id)
  return provider.answer
}

/** How far a message went: a word never goes back to a lesser one. */
const RANK = { sent: 1, delivered: 2, read: 3, failed: 4 } as const

/** How a message went: sent, delivered, read (RCS) — or not delivered, and the provider's code. */
export async function smsStatus(
  deps: SmsDeps,
  providerId: string,
  numberId: string,
  call: ProviderCall,
): Promise<void> {
  const { provider } = await checked(deps, providerId, numberId, call)
  const said = provider.status(call.payload)
  if (!said) return
  await deps.db.transaction(async (tx) => {
    const lesser = Object.entries(RANK)
      .filter(([, rank]) => rank < RANK[said.status])
      .map(([name]) => name as keyof typeof RANK)
    const [row] = await tx
      .update(outbound)
      .set({ status: said.status, error: said.error, updatedAt: new Date() })
      .where(and(eq(outbound.providerId, said.providerId), inArray(outbound.status, lesser)))
      .returning({ conversationId: outbound.conversationId })
    if (row?.conversationId) await signalChange(tx, row.conversationId)
  })
}

/** Whether a provider by this id exists — the routes' first check. */
export const knownProvider = (id: string): boolean => id in PROVIDERS
