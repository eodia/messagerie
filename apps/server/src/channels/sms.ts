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
import { accountOf } from '../outbound/dispatch.js'
import type { Fetch } from '../outbound/push.js'
import { signalChange } from '../realtime/signals.js'
import { Refusal } from '../refusal.js'
import type { Settings, Site, SmsNumber } from '../settings/settings.js'
import { type TwilioAccount, fetchTwilioMedia, phoneOf, validTwilioSignature } from './twilio.js'

/**
 * Visitors who write by SMS or RCS (D23): Twilio calls the number's address with each
 * message — signed by the account's token —, and the chat makes it a visitor's message in
 * the conversation of that phone, on the number's site: its inbox, its team, its AI. The
 * answers go back by the postman (`outbound/dispatch.ts`), and Twilio says how they went.
 */

export interface SmsDeps {
  readonly db: Db
  readonly settings: Settings
  readonly config: Pick<Config, 'publicUrl'>
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

/** The address Twilio calls for a number — what the settings screen tells to paste. */
export const smsAddress = (publicUrl: string, numberId: string) =>
  `${publicUrl}/channels/twilio/${numberId}`

/** The number, its account, and the call checked against the account's token. */
async function checked(
  deps: SmsDeps,
  numberId: string,
  url: string,
  params: Readonly<Record<string, string>>,
  signature: string | undefined,
): Promise<{ number: SmsNumber; account: TwilioAccount }> {
  const number = await deps.settings.smsNumber(numberId)
  const account = accountOf(number, deps.env ?? process.env)
  if (!number || typeof account === 'string') throw new Refusal('NUMBER_UNAVAILABLE', 404)
  if (!validTwilioSignature(account.authToken, url, params, signature)) {
    throw new Refusal('SIGNATURE_INVALID', 403)
  }
  // Another account's message, signed with this token, is still not this number's.
  if (params.AccountSid && params.AccountSid !== account.accountSid) {
    throw new Refusal('SIGNATURE_INVALID', 403)
  }
  return { number, account }
}

async function siteOf(settings: Settings, number: SmsNumber): Promise<Site> {
  const sites = await settings.sites()
  const site = number.siteId
    ? sites.find((s) => s.id === number.siteId)
    : sites.find((s) => s.active)
  if (!site || !site.active) throw new Refusal('NUMBER_UNAVAILABLE', 404)
  return site
}

/** The contact of a phone on a site: the one already known, or a new one named by the number. */
async function contactOf(db: Db, siteId: string, phone: string): Promise<string> {
  const [known] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.siteId, siteId), eq(contacts.phone, phone)))
    .orderBy(desc(contacts.updatedAt))
    .limit(1)
  if (known) return known.id
  const [made] = await db
    .insert(contacts)
    .values({ siteId, name: phone, phone, identified: false })
    .returning({ id: contacts.id })
  if (!made) throw new Refusal('INTERNAL_ERROR', 500)
  return made.id
}

/** The phone's conversation on this number: one still going, or resolved within a day. */
async function currentOf(db: Db, contactId: string, numberId: string) {
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

/** The files of an MMS or an RCS, read from Twilio and checked as any file (D14). */
async function mediaOf(
  deps: SmsDeps,
  account: TwilioAccount,
  params: Readonly<Record<string, string>>,
): Promise<Upload[]> {
  const count = Math.min(Number(params.NumMedia ?? 0) || 0, MAX_FILES)
  const uploads: Upload[] = []
  for (let index = 0; index < count; index++) {
    const url = params[`MediaUrl${index}`]
    if (!url) continue
    const bytes = await fetchTwilioMedia(account, url, MAX_BYTES, deps.fetch)
    if (!bytes) continue
    const declared = (params[`MediaContentType${index}`] ?? '').split(';')[0]?.trim() ?? ''
    const name = cleanName(`fichier-${index + 1}.${EXTENSIONS[declared] ?? 'bin'}`)
    const mime = sniff(bytes, name)
    // What the chat does not take is left with the provider, as in the widget.
    if (mime) uploads.push({ id: randomUUID(), name, mime, bytes })
  }
  return uploads
}

/**
 * A message from a phone. Nothing written twice: a message Twilio sends again — it did not
 * hear the answer in time — is recognized by its id.
 */
export async function receiveSms(
  deps: SmsDeps,
  numberId: string,
  url: string,
  params: Readonly<Record<string, string>>,
  signature: string | undefined,
): Promise<void> {
  const { db } = deps
  const { number, account } = await checked(deps, numberId, url, params, signature)
  const from = phoneOf(params.From ?? '')
  const providerId = params.MessageSid ?? params.SmsSid ?? ''
  if (!from || !providerId) throw new Refusal('INVALID_REQUEST', 400, { field: 'From' })
  const site = await siteOf(deps.settings, number)
  const channel = from.rcs ? 'rcs' : 'sms'

  const contactId = await contactOf(db, site.id, from.phone)
  const current = await currentOf(db, contactId, number.id)
  if (current) {
    const [seen] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, current.id),
          sql`${messages.meta}->>'providerId' = ${providerId}`,
        ),
      )
      .limit(1)
    if (seen) return
  }
  const uploads = await mediaOf(deps, account, params)
  const body = (params.Body ?? '').slice(0, 4000)
  if (body.trim() === '' && uploads.length === 0) return
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
    receiveVisitorMessage(db, id, body, attach, { providerId, channel }),
  )
  deps.onVisitorMessage?.(id)
}

/** Twilio's word on a message, as the chat keeps it — never back to a lesser one. */
const STATUSES: Readonly<Record<string, 'sent' | 'delivered' | 'read' | 'failed'>> = {
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
  undelivered: 'failed',
}
const RANK = { sent: 1, delivered: 2, read: 3, failed: 4 } as const

/** How a message went: sent, delivered, read (RCS) — or not delivered, and Twilio's code. */
export async function smsStatus(
  deps: SmsDeps,
  numberId: string,
  url: string,
  params: Readonly<Record<string, string>>,
  signature: string | undefined,
): Promise<void> {
  await checked(deps, numberId, url, params, signature)
  const status = STATUSES[params.MessageStatus ?? '']
  const sid = params.MessageSid ?? params.SmsSid
  if (!status || !sid) return
  await deps.db.transaction(async (tx) => {
    const lesser = Object.entries(RANK)
      .filter(([, rank]) => rank < RANK[status])
      .map(([name]) => name as keyof typeof RANK)
    const [row] = await tx
      .update(outbound)
      .set({
        status,
        error: status === 'failed' ? `TWILIO_${params.ErrorCode || 'UNDELIVERED'}` : null,
        updatedAt: new Date(),
      })
      .where(and(eq(outbound.providerId, sid), inArray(outbound.status, lesser)))
      .returning({ conversationId: outbound.conversationId })
    if (row?.conversationId) await signalChange(tx, row.conversationId)
  })
}
