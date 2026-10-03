import type {
  Conversation,
  OutreachOptions,
  SmsNumberAddresses,
  StartConversationBody,
} from '@chat/contracts'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { emailContact } from '../channels/email.js'
import { phoneOf } from '../channels/provider.js'
import { providerOf, ready } from '../channels/providers.js'
import { phoneContact, phoneConversation, siteOfNumber } from '../channels/sms.js'
import type { Db } from '../db/client.js'
import { contacts, conversations, outbound } from '../db/schema.js'
import { Refusal } from '../refusal.js'
import type { Settings, Site, SmsNumber } from '../settings/settings.js'
import { type Visible, canSee } from './access.js'
import { createConversation } from './incoming.js'
import type { AgentRow } from './read.js'
import { sendMessage } from './write.js'

/**
 * « Nouveau message » (D23): an agent — or a program, by the API — writes first to a
 * customer. By SMS, from a number ready to send: the conversation of that phone on that
 * number, as if the customer had written. By e-mail: the contact's conversation of the
 * widget, whose answer the postman sends at once — and that the widget shows when they come
 * back. Either way, the first answer of a conversation like any other: it is the sender's.
 */

export interface OutreachDeps {
  readonly db: Db
  readonly settings: Settings
  /** The server writes e-mails. */
  readonly email: boolean
  readonly env?: NodeJS.ProcessEnv
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RESUME_MS = 24 * 60 * 60 * 1000

/** The numbers ready to send: active, with their credentials. */
async function readyNumbers(deps: OutreachDeps): Promise<SmsNumber[]> {
  const env = deps.env ?? process.env
  return (await deps.settings.smsNumbers()).filter((n) => typeof ready(n, env) !== 'string')
}

/** A number that writes by RCS where the phone reads it: Twilio's messaging service, SMS Mode's RCS. */
const writesRcs = (n: SmsNumber): boolean =>
  n.provider === 'smsmode' ? n.rcs : Boolean(n.messagingServiceSid)

export async function outreachOptions(deps: OutreachDeps): Promise<OutreachOptions> {
  const sites = (await deps.settings.sites()).filter((s) => s.active)
  const mailboxes = new Set<string>()
  for (const site of sites) {
    if (await deps.settings.siteEmailAddress(site.id)) mailboxes.add(site.id)
  }
  return {
    numbers: (await readyNumbers(deps)).map((n) => ({
      id: n.id,
      name: n.name,
      phone: n.phone,
      siteId: n.siteId,
      rcs: writesRcs(n),
    })),
    email: deps.email,
    sites: sites.map((s) => ({
      id: s.id,
      name: s.name,
      emailReplies: s.emailReplies,
      mailbox: mailboxes.has(s.id),
    })),
  }
}

/** Where a number's provider calls — for the supervisor who pastes it there. */
export async function numberAddresses(
  settings: Settings,
  agent: AgentRow,
  id: string,
  publicUrl: string,
  chatSecret: string,
): Promise<SmsNumberAddresses> {
  if (agent.role !== 'supervisor') throw new Refusal('NOT_ALLOWED', 403)
  const number = await settings.smsNumber(id)
  if (!number) throw new Refusal('ROW_NOT_FOUND', 404)
  return providerOf(number).addresses(publicUrl, number, chatSecret)
}

function readBody(raw: Record<string, unknown>): StartConversationBody {
  const str = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string).trim() : '')
  const channel = raw.channel === 'email' ? 'email' : raw.channel === 'sms' ? 'sms' : null
  if (!channel) throw new Refusal('INVALID_REQUEST', 400, { field: 'channel' })
  const body = str('body')
  if (body === '') throw new Refusal('EMPTY_MESSAGE', 400)
  if (body.length > 4000) throw new Refusal('INVALID_REQUEST', 400, { field: 'body', max: 4000 })
  const optional = (key: string) => str(key) || undefined
  return {
    channel,
    body,
    contactId: optional('contactId'),
    phone: optional('phone'),
    email: optional('email'),
    name: optional('name')?.slice(0, 120),
    numberId: optional('numberId'),
    siteId: optional('siteId'),
  }
}

type ContactRow = typeof contacts.$inferSelect

async function contactOf(db: Db, id: string | undefined): Promise<ContactRow | null> {
  if (!id) return null
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Refusal('CONTACT_NOT_FOUND', 404)
  const [row] = await db.select().from(contacts).where(eq(contacts.id, id))
  if (!row) throw new Refusal('CONTACT_NOT_FOUND', 404)
  return row
}

/** A new conversation lands where the site's do: refused if the sender would not see it. */
async function route(deps: OutreachDeps, site: Site, visible: Visible) {
  const where = await deps.settings.routeOf(site)
  if (!canSee(visible, where.inboxId)) throw new Refusal('INBOX_NOT_FOUND', 403)
  return where
}

/** The SMS way: the number, the phone's contact on its site, and their conversation. */
async function bySms(
  deps: OutreachDeps,
  body: StartConversationBody,
  known: ContactRow | null,
  visible: Visible,
): Promise<string> {
  const { db } = deps
  const numbers = await readyNumbers(deps)
  const number =
    (body.numberId
      ? numbers.find((n) => n.id === body.numberId)
      : (numbers.find((n) => known && n.siteId === known.siteId) ?? numbers[0])) ?? null
  if (!number) throw new Refusal('NUMBER_UNAVAILABLE', 404)
  const phone = phoneOf(body.phone ?? known?.phone ?? '')
  if (!phone) throw new Refusal('INVALID_REQUEST', 400, { field: 'phone' })
  const site = await siteOfNumber(deps.settings, number)

  // The contact itself, on its site; elsewhere, the phone's contact on the number's site.
  let contactId: string
  if (known && known.siteId === site.id) {
    contactId = known.id
    if (known.phone !== phone.phone) {
      await db
        .update(contacts)
        .set({ phone: phone.phone, updatedAt: new Date() })
        .where(eq(contacts.id, known.id))
    }
  } else {
    contactId = await phoneContact(db, site.id, phone.phone, known?.name ?? body.name ?? null)
  }
  const current = await phoneConversation(db, contactId, number.id)
  if (current) {
    if (!canSee(visible, current.inboxId)) throw new Refusal('INBOX_NOT_FOUND', 403)
    return current.id
  }
  return createConversation(
    db,
    contactId,
    { ...site, aiEnabled: false },
    await route(deps, site, visible),
    { channel: 'sms', smsNumberId: number.id },
  )
}

/**
 * The e-mail way. A site with its own address (D24): a conversation held by e-mail, which
 * the customer answers from their mailbox. Without one: the contact's conversation of the
 * widget, by the server's e-mail, which they answer by coming back to the site.
 */
async function byEmail(
  deps: OutreachDeps,
  body: StartConversationBody,
  known: ContactRow | null,
  visible: Visible,
): Promise<string> {
  const { db, settings } = deps
  const sites = (await settings.sites()).filter((s) => s.active)
  const site = known
    ? sites.find((s) => s.id === known.siteId)
    : body.siteId
      ? sites.find((s) => s.id === body.siteId)
      : sites[0]
  if (!site) throw new Refusal('SITE_NOT_FOUND', 404)
  const mailbox = await settings.siteEmailAddress(site.id)
  if (!mailbox) {
    if (!deps.email) throw new Refusal('MAIL_UNAVAILABLE', 503)
    if (!site.emailReplies) throw new Refusal('EMAIL_REPLIES_OFF', 409)
  }
  // A signed customer keeps the address of their signature (D13).
  const email = (known?.identified ? known.email : (body.email ?? known?.email))?.toLowerCase()
  if (!email || email.length > 254 || !EMAIL.test(email)) {
    throw new Refusal('INVALID_REQUEST', 400, { field: 'email' })
  }

  let contactId: string
  if (known) {
    contactId = known.id
    if (known.email !== email) {
      await db
        .update(contacts)
        .set({ email, updatedAt: new Date() })
        .where(eq(contacts.id, known.id))
    }
  } else {
    contactId = await emailContact(db, site.id, email, body.name ?? null)
  }
  // Their conversation on that channel, still going — else a new one.
  const [latest] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.contactId, contactId),
        eq(conversations.channel, mailbox ? 'email' : 'web'),
        isNull(conversations.visitorLeftAt),
      ),
    )
    .orderBy(desc(conversations.createdAt))
    .limit(1)
  const going =
    latest && !(latest.status === 'resolved' && Date.now() - latest.updatedAt.getTime() > RESUME_MS)
  if (latest && going) {
    if (!canSee(visible, latest.inboxId)) throw new Refusal('INBOX_NOT_FOUND', 403)
    if (mailbox && !latest.emailAddressId) {
      await db
        .update(conversations)
        .set({ emailAddressId: mailbox.id })
        .where(eq(conversations.id, latest.id))
    }
    return latest.id
  }
  return createConversation(
    db,
    contactId,
    { ...site, aiEnabled: false },
    await route(deps, site, visible),
    mailbox ? { channel: 'email', emailAddressId: mailbox.id } : null,
  )
}

/** Writes first to a customer; the conversation, as the sender now sees it. */
export async function startConversation(
  deps: OutreachDeps,
  actor: AgentRow,
  visible: Visible,
  raw: Record<string, unknown>,
): Promise<Conversation> {
  const body = readBody(raw)
  const known = await contactOf(deps.db, body.contactId)
  const id =
    body.channel === 'sms'
      ? await bySms(deps, body, known, visible)
      : await byEmail(deps, body, known, visible)
  const conversation = await sendMessage(deps.db, actor, id, { body: body.body, kind: 'reply' })
  // An e-mail to a visitor of the widget the sender chose leaves now, not in two minutes.
  if (body.channel === 'email') {
    const mine = [...conversation.messages].reverse().find((m) => m.kind === 'agent')
    if (mine) {
      await deps.db
        .update(outbound)
        .set({ nextAttemptAt: new Date() })
        .where(and(eq(outbound.messageId, mine.id), eq(outbound.status, 'pending')))
    }
  }
  return conversation
}
