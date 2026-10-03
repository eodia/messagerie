import type { AlertKind } from '@chat/contracts'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { addressMailer } from '../channels/email.js'
import { SmsFailure } from '../channels/provider.js'
import { ready } from '../channels/providers.js'
import type { Config } from '../config.js'
import type { Db } from '../db/client.js'
import {
  agents,
  contacts,
  conversations,
  messages,
  notifications,
  outbound,
  pageViews,
  pushSubscriptions,
} from '../db/schema.js'
import { attachmentsOf, linkOf } from '../files/attachments.js'
import type { FileStore } from '../files/store.js'
import { PRODUCT_NAME } from '../product.js'
import { signalChange } from '../realtime/signals.js'
import type { Settings, Site } from '../settings/settings.js'
import { languageCode } from '../settings/widget.js'
import { type Mail, MailFailure, type Mailer } from './mailer.js'
import { type ReplyLine, agentAlertMail, conversationMail, visitorReplyMail } from './mails.js'
import { type Fetch, type VapidKeys, sendPush, vapidKeys } from './push.js'
import { type Language, alertTitle, conversationPath, plainText, visitorWords } from './words.js'

/**
 * The postman of what leaves the chat (D23): every two seconds, what is due in
 * `chat.outbound` is taken — under a lease, several processes together (`SKIP LOCKED`) — and
 * sent: an SMS by Twilio, an e-mail by SMTP, an alert by Web Push.
 *
 * - The messages of one SMS conversation go in their order: one waits while an earlier one
 *   is on its way, or waits to be tried again.
 * - A reply by e-mail goes only to a visitor who did not see it — no page of theirs open
 *   since —, with the answers that followed it: one e-mail, not five.
 * - An alert goes only while its line in the bell is unread.
 * - Refused for good: failed, with its code. Not reached: tried again, six times over an
 *   hour and a quarter. A lease never concluded — the process died — frees the row two
 *   minutes on: an SMS may then leave twice, never be lost.
 * - Kept ninety days.
 */

const PASS_MS = 2000
const SWEEP_MS = 60 * 60_000
const BATCH = 50
const LEASE = '2 minutes'
/** Seconds before the next try, after the 1st, 2nd… failed one. */
const BACKOFF = [10, 30, 120, 600, 3600]
/** 1 600 characters a message — Twilio's limit, ten SMS —; longer is sent in parts. */
const SMS_MAX = 1600

export interface PostmanDeps {
  readonly db: Db
  readonly settings: Settings
  readonly config: Pick<Config, 'secret' | 'publicUrl' | 'webOrigin' | 'pushSubject'>
  /** None: no SMTP server — the e-mails are skipped. */
  readonly mailer: Mailer | null
  readonly fetch?: Fetch
  /** Where the tokens the settings name are read (D5). */
  readonly env?: NodeJS.ProcessEnv
  /** Where the files are, for an e-mail that carries them (D24). */
  readonly files?: FileStore
  /** The mailer of an address of « Adresses e-mail » — its SMTP server, unless a test's. */
  readonly addressMailer?: typeof addressMailer
}

type Row = typeof outbound.$inferSelect

type Outcome =
  | { readonly kind: 'sent'; readonly providerId?: string | null }
  | { readonly kind: 'skipped'; readonly code: string }
  | { readonly kind: 'failed'; readonly code: string }
  | { readonly kind: 'retry'; readonly code: string }

const sent = (providerId: string | null = null): Outcome => ({ kind: 'sent', providerId })
const skipped = (code: string): Outcome => ({ kind: 'skipped', code })
const failed = (code: string): Outcome => ({ kind: 'failed', code })
const retry = (code: string): Outcome => ({ kind: 'retry', code })

/** What is due, taken under a lease. The SMS of a conversation, one after the other. */
async function claim(db: Db): Promise<Row[]> {
  await db.execute(sql`
    update chat.outbound set status = 'pending', lease_until = null, updated_at = now()
    where status = 'in_flight' and lease_until < now()`)
  const { rows } = await db.execute<{ id: string }>(sql`
    with due as (
      select o.id from chat.outbound o
      where o.status = 'pending' and o.next_attempt_at <= now()
        and not (o.channel = 'sms' and exists (
          select 1 from chat.outbound p
          where p.conversation_id = o.conversation_id and p.channel = 'sms'
            and p.status in ('pending', 'in_flight')
            and (p.created_at, p.id) < (o.created_at, o.id)))
      order by o.next_attempt_at, o.created_at
      limit ${BATCH}
      for update skip locked
    )
    update chat.outbound o
    set status = 'in_flight', lease_until = now() + ${LEASE}::interval,
      attempts = o.attempts + 1, updated_at = now()
    from due where o.id = due.id
    returning o.id`)
  if (rows.length === 0) return []
  return db
    .select()
    .from(outbound)
    .where(
      inArray(
        outbound.id,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(outbound.createdAt))
}

/** Writes what came of a row — and tells the inbox, for a message it shows the fate of. */
async function conclude(db: Db, row: Row, outcome: Outcome, also: readonly string[] = []) {
  const ids = [row.id, ...also]
  await db.transaction(async (tx) => {
    const now = new Date()
    if (outcome.kind === 'retry' && row.attempts <= BACKOFF.length) {
      const wait = BACKOFF[row.attempts - 1] ?? 3600
      await tx
        .update(outbound)
        .set({
          status: 'pending',
          leaseUntil: null,
          error: outcome.code,
          nextAttemptAt: new Date(now.getTime() + wait * 1000),
          updatedAt: now,
        })
        .where(eq(outbound.id, row.id))
      return
    }
    await tx
      .update(outbound)
      .set({
        status:
          outcome.kind === 'sent' ? 'sent' : outcome.kind === 'skipped' ? 'skipped' : 'failed',
        leaseUntil: null,
        error: outcome.kind === 'sent' ? null : outcome.code,
        ...(outcome.kind === 'sent' ? { sentAt: now, providerId: outcome.providerId ?? null } : {}),
        updatedAt: now,
      })
      .where(inArray(outbound.id, ids))
    if (row.conversationId && row.purpose !== 'agent_alert') {
      await signalChange(tx, row.conversationId)
    }
  })
}

// ── SMS and RCS ───────────────────────────────────────────────────────────────────────

const languageOf = (site: Site | null): Language => (site ? languageCode(site.language) : 'fr')

/** A body cut where the providers take it: at a line, a space, or the limit. */
export function partsOf(text: string, max = SMS_MAX): string[] {
  const parts: string[] = []
  let rest = text.trim()
  while (rest.length > max) {
    const window = rest.slice(0, max)
    const cut = Math.max(window.lastIndexOf('\n'), window.lastIndexOf(' '))
    const at = cut > max / 2 ? cut : max
    parts.push(rest.slice(0, at).trim())
    rest = rest.slice(at).trim()
  }
  if (rest) parts.push(rest)
  return parts
}

async function sendSms(deps: PostmanDeps, row: Row): Promise<Outcome> {
  const { db, settings } = deps
  if (!row.messageId || !row.conversationId) return failed('MESSAGE_MISSING')
  const [found] = await db
    .select({ message: messages, conversation: conversations, phone: contacts.phone })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(eq(messages.id, row.messageId))
  if (!found) return skipped('MESSAGE_MISSING')
  const { message, conversation, phone } = found
  if (message.deletedAt) return skipped('MESSAGE_DELETED')
  if (!phone) return failed('PHONE_MISSING')
  const sender = ready(
    conversation.smsNumberId ? await settings.smsNumber(conversation.smsNumberId) : null,
    deps.env ?? process.env,
  )
  if (typeof sender === 'string') return failed(sender)
  const { number, provider, credentials } = sender

  const files = (await attachmentsOf(db, [message.id])).get(message.id) ?? []
  const links = files.map((f) => `${deps.config.publicUrl}${linkOf(f.id)}`)
  // Files as files where the provider and the number carry them (RCS); elsewhere their
  // links, a day good, in the words.
  const media = provider.carriesFiles(number) ? links : []
  const body = [plainText(message.body), ...(media.length > 0 ? [] : links)]
    .filter(Boolean)
    .join('\n')
  const parts = partsOf(body)
  if (parts.length === 0 && media.length === 0) return skipped('EMPTY_MESSAGE')

  const addresses = provider.addresses(deps.config.publicUrl, number, deps.config.secret)
  let last: string | null = null
  try {
    for (const [index, part] of (parts.length > 0 ? parts : ['']).entries()) {
      last = await provider.send(
        credentials,
        number,
        { to: phone, body: part, mediaUrls: index === 0 ? media : [] },
        addresses,
        deps.fetch,
      )
    }
  } catch (error) {
    if (!(error instanceof SmsFailure)) throw error
    // A part already gone is not sent again: what is left fails.
    if (last) return failed(error.code)
    return error.retry ? retry(error.code) : failed(error.code)
  }
  return sent(last)
}

// ── A reply by e-mail, to a visitor who left ──────────────────────────────────────────

/** An https address the visitor may come back to: the page they last wrote from, or the site. */
async function wayBack(db: Db, conversationId: string, site: Site | null): Promise<string | null> {
  const [view] = await db
    .select({ url: pageViews.url })
    .from(pageViews)
    .where(eq(pageViews.conversationId, conversationId))
    .orderBy(desc(pageViews.createdAt))
    .limit(1)
  if (view?.url.startsWith('https://')) return view.url
  const domain = site?.domains.find((d) => !d.startsWith('*.') && d !== 'localhost')
  return domain ? `https://${domain}/` : null
}

/**
 * The mailer a site writes with (D24): its own address's, whose answers come back to the
 * conversation — else the server's.
 */
async function mailerOfSite(
  deps: PostmanDeps,
  siteId: string,
  siteName: string,
): Promise<Mailer | null> {
  const address = await deps.settings.siteEmailAddress(siteId)
  if (address) {
    const mailer = (deps.addressMailer ?? addressMailer)(address, siteName, deps.env ?? process.env)
    if (typeof mailer !== 'string') return mailer
  }
  return deps.mailer
}

async function sendVisitorReply(deps: PostmanDeps, row: Row): Promise<[Outcome, string[]]> {
  const { db, settings } = deps
  if (!row.conversationId) return [skipped('CONVERSATION_MISSING'), []]
  const conversationId = row.conversationId
  const [found] = await db
    .select({ conversation: conversations, email: contacts.email })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(eq(conversations.id, conversationId))
  if (!found?.email) return [skipped('EMAIL_MISSING'), []]
  if (found.conversation.visitorLeftAt) return [skipped('VISITOR_RESTARTED'), []]

  // The answers that followed, waiting too: in this e-mail.
  const siblings = await db.transaction(async (tx) => {
    const { rows } = await tx.execute<{ id: string }>(sql`
      select id from chat.outbound
      where conversation_id = ${conversationId} and purpose = 'visitor_reply'
        and status = 'pending' and id <> ${row.id}
      for update skip locked`)
    const ids = rows.map((r) => r.id)
    if (ids.length > 0) {
      await tx
        .update(outbound)
        .set({ status: 'in_flight', leaseUntil: sql`now() + ${LEASE}::interval` })
        .where(inArray(outbound.id, ids))
    }
    return ids
  })
  const all = await db
    .select({ messageId: outbound.messageId })
    .from(outbound)
    .where(inArray(outbound.id, [row.id, ...siblings]))
  const messageIds = all.map((r) => r.messageId).filter((id): id is string => id !== null)
  const lines = await db
    .select({ message: messages, agent: agents.name, login: agents.login })
    .from(messages)
    .leftJoin(agents, eq(agents.id, messages.agentId))
    .where(inArray(messages.id, messageIds))
    .orderBy(asc(messages.createdAt))
  // Seen: what was written while a page of theirs was open — one open now sees it all.
  const [presence] = await db
    .select({
      open: sql<boolean>`bool_or(${pageViews.leftAt} is null)`,
      lastLeft: sql<Date | null>`max(${pageViews.leftAt})`,
    })
    .from(pageViews)
    .where(eq(pageViews.conversationId, conversationId))
  if (presence?.open) return [skipped('SEEN'), siblings]
  const lastLeft = presence?.lastLeft ? new Date(presence.lastLeft) : null
  const shown = lines.filter(
    ({ message }) => !message.deletedAt && (!lastLeft || message.createdAt > lastLeft),
  )
  if (shown.length === 0) return [skipped('SEEN'), siblings]

  const site = await settings.site(found.conversation.siteId)
  if (site && !site.emailReplies) return [skipped('SITE_OFF'), siblings]
  const language = languageOf(site)
  const siteName = site?.name ?? found.conversation.siteName
  const mailer = await mailerOfSite(deps, found.conversation.siteId, siteName)
  if (!mailer) return [skipped('MAIL_UNAVAILABLE'), siblings]
  const files = await attachmentsOf(
    db,
    shown.map(({ message }) => message.id),
  )
  const replyLines: ReplyLine[] = shown.map(({ message, agent, login }) => ({
    author:
      message.author === 'ai'
        ? visitorWords(language, 'Assistant IA')
        : login?.startsWith('automation:') || login?.startsWith('token:') || !agent
          ? siteName
          : (agent.split(/\s+/)[0] ?? agent),
    body: message.body,
    files: (files.get(message.id) ?? []).map((f) => f.name),
  }))
  try {
    const id = await mailer.send(
      visitorReplyMail({
        to: found.email,
        language,
        site: siteName,
        color: site?.color ?? null,
        lines: replyLines,
        link: await wayBack(db, conversationId, site),
      }),
    )
    return [sent(id), siblings]
  } catch (error) {
    // The siblings wait again, for the next try of the first.
    if (siblings.length > 0) {
      await db
        .update(outbound)
        .set({ status: 'pending', leaseUntil: null })
        .where(inArray(outbound.id, siblings))
    }
    if (!(error instanceof MailFailure)) throw error
    return [error.retry ? retry(error.code) : failed(error.code), []]
  }
}

// ── An answer in a conversation held by e-mail (D24) ──────────────────────────────────

const authorOf = (
  author: string,
  agent: string | null,
  login: string | null,
  siteName: string,
  language: Language,
) =>
  author === 'ai'
    ? visitorWords(language, 'Assistant IA')
    : login?.startsWith('automation:') || login?.startsWith('token:') || !agent
      ? siteName
      : (agent.split(/\s+/)[0] ?? agent)

async function sendEmailMessage(deps: PostmanDeps, row: Row): Promise<Outcome> {
  const { db, settings } = deps
  if (!row.messageId || !row.conversationId) return failed('MESSAGE_MISSING')
  const [found] = await db
    .select({
      message: messages,
      conversation: conversations,
      email: contacts.email,
      agent: agents.name,
      login: agents.login,
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .leftJoin(agents, eq(agents.id, messages.agentId))
    .where(eq(messages.id, row.messageId))
  if (!found) return skipped('MESSAGE_MISSING')
  const { message, conversation } = found
  if (message.deletedAt) return skipped('MESSAGE_DELETED')
  if (!found.email) return failed('EMAIL_MISSING')
  const site = await settings.site(conversation.siteId)
  const siteName = site?.name ?? conversation.siteName
  const language = languageOf(site)

  // The address the conversation is held at — else the site's, else the server's.
  const address = conversation.emailAddressId
    ? await settings.emailAddress(conversation.emailAddressId)
    : null
  const own = address
    ? (deps.addressMailer ?? addressMailer)(address, siteName, deps.env ?? process.env)
    : null
  if (typeof own === 'string') return failed(own)
  const mailer = own ?? (await mailerOfSite(deps, conversation.siteId, siteName))
  if (!mailer) return failed('MAIL_UNAVAILABLE')

  // The thread: the customer's mails and ours, oldest first; its subject, the first said.
  const theirs = await db
    .select({ meta: messages.meta })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversation.id),
        eq(messages.author, 'contact'),
        sql`${messages.meta} ? 'email'`,
      ),
    )
    .orderBy(asc(messages.createdAt))
  const ours = await db
    .select({ id: outbound.providerId })
    .from(outbound)
    .where(
      and(
        eq(outbound.conversationId, conversation.id),
        eq(outbound.channel, 'email'),
        inArray(outbound.status, ['sent', 'delivered', 'read']),
      ),
    )
    .orderBy(asc(outbound.createdAt))
  const subject = theirs.map((t) => t.meta.email?.subject).find(Boolean) ?? null
  const lastTheirs = theirs.at(-1)?.meta.providerId
  const references = [
    ...new Set(
      [...theirs.map((t) => t.meta.providerId), ...ours.map((o) => o.id)].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  ].slice(-20)

  const files = (await attachmentsOf(db, [message.id])).get(message.id) ?? []
  const attachments: NonNullable<Mail['attachments']>[number][] = []
  for (const file of files) {
    const content = await deps.files?.read(file.storageKey).catch(() => null)
    if (content) attachments.push({ filename: file.name, content, contentType: file.mime })
  }
  try {
    const id = await mailer.send(
      conversationMail({
        to: found.email,
        subject: subject
          ? /^(re|tr|fw|aw)\s*:/i.test(subject)
            ? subject
            : `Re: ${subject}`
          : visitorWords(language, '{site} vous écrit', { site: siteName }),
        body: message.body,
        signature: `${authorOf(message.author, found.agent, found.login, siteName, language)} — ${siteName}`,
        ...(lastTheirs ? { inReplyTo: lastTheirs } : {}),
        references,
        attachments,
      }),
    )
    return sent(id)
  } catch (error) {
    if (!(error instanceof MailFailure)) throw error
    return error.retry ? retry(error.code) : failed(error.code)
  }
}

// ── An agent's alert: their phone, their mailbox ─────────────────────────────────────

async function alertOf(db: Db, row: Row) {
  if (!row.notificationId) return null
  const [found] = await db
    .select({
      notification: notifications,
      contact: contacts.name,
      site: conversations.siteName,
      agentEmail: agents.email,
      agentLogin: agents.login,
      agentActive: agents.active,
    })
    .from(notifications)
    .innerJoin(conversations, eq(conversations.id, notifications.conversationId))
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .innerJoin(agents, eq(agents.id, notifications.agentId))
    .where(eq(notifications.id, row.notificationId))
  if (!found) return null
  const by = found.notification.byAgentId
    ? ((
        await db
          .select({ name: agents.name })
          .from(agents)
          .where(eq(agents.id, found.notification.byAgentId))
      )[0]?.name ?? null)
    : null
  // The visitor's last words, for a message.
  const [last] = await db
    .select({ body: messages.body })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, found.notification.conversationId),
        eq(messages.author, 'contact'),
        sql`${messages.deletedAt} is null`,
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(1)
  const excerpt = last?.body ? last.body.replace(/\s+/g, ' ').trim().slice(0, 280) : null
  return { ...found, by, excerpt }
}

async function sendAgentAlert(deps: PostmanDeps, row: Row, keys: VapidKeys): Promise<Outcome> {
  const { db } = deps
  const alert = await alertOf(db, row)
  if (!alert) return skipped('NOTIFICATION_MISSING')
  if (alert.notification.readAt) return skipped('READ')
  if (!alert.agentActive) return skipped('AGENT_INACTIVE')
  const kind = alert.notification.kind as AlertKind
  const title = alertTitle(kind, alert.contact, alert.by, alert.notification.text)
  const path = conversationPath(alert.notification.conversationId, alert.contact)

  if (row.channel === 'email') {
    if (!deps.mailer) return skipped('MAIL_UNAVAILABLE')
    const to = alert.agentEmail ?? (alert.agentLogin.includes('@') ? alert.agentLogin : null)
    if (!to) return skipped('EMAIL_MISSING')
    try {
      const id = await deps.mailer.send(
        agentAlertMail({
          to,
          title,
          site: alert.site,
          excerpt: kind === 'visitor_message' || kind === 'handoff' ? alert.excerpt : null,
          link: `${deps.config.webOrigin}${path}`,
          product: PRODUCT_NAME,
        }),
      )
      return sent(id)
    } catch (error) {
      if (!(error instanceof MailFailure)) throw error
      return error.retry ? retry(error.code) : failed(error.code)
    }
  }

  const devices = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.agentId, alert.notification.agentId))
  if (devices.length === 0) return skipped('NO_DEVICE')
  const payload = {
    title,
    body: [alert.site, kind === 'visitor_message' ? alert.excerpt : null]
      .filter(Boolean)
      .join(' — '),
    conversationId: alert.notification.conversationId,
    url: path,
    kind,
  }
  const outcomes = await Promise.all(
    devices.map(async (device) => {
      const { outcome } = await sendPush(device, payload, keys, deps.config.pushSubject, {
        topic: alert.notification.conversationId,
        fetch: deps.fetch,
      })
      if (outcome === 'gone') {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, device.id))
      } else if (outcome === 'sent') {
        await db
          .update(pushSubscriptions)
          .set({ lastUsedAt: new Date() })
          .where(eq(pushSubscriptions.id, device.id))
      }
      return outcome
    }),
  )
  if (outcomes.includes('sent')) return sent()
  if (outcomes.includes('retry')) return retry('PUSH_UNAVAILABLE')
  return failed(outcomes.every((o) => o === 'gone') ? 'NO_DEVICE' : 'PUSH_REFUSED')
}

// ── The rounds ────────────────────────────────────────────────────────────────────────

/** One round: what is due, sent. Returns how many rows it concluded. */
export async function deliverDue(deps: PostmanDeps, keys = vapidKeys(deps.config.secret)) {
  const rows = await claim(deps.db)
  let done = 0
  for (const row of rows) {
    let outcome: Outcome
    let also: string[] = []
    try {
      if (row.channel === 'sms') outcome = await sendSms(deps, row)
      else if (row.purpose === 'visitor_reply') [outcome, also] = await sendVisitorReply(deps, row)
      else if (row.purpose === 'message') outcome = await sendEmailMessage(deps, row)
      else outcome = await sendAgentAlert(deps, row, keys)
    } catch (error) {
      console.error('chat : envoi', error)
      outcome = retry('INTERNAL_ERROR')
    }
    await conclude(deps.db, row, outcome, also)
    done += 1 + also.length
  }
  return done
}

/** What is older than ninety days goes. */
async function sweep(db: Db): Promise<void> {
  await db.execute(sql`delete from chat.outbound where created_at < now() - interval '90 days'`)
}

export function startOutbound(deps: PostmanDeps): { stop(): Promise<void> } {
  const keys = vapidKeys(deps.config.secret)
  let running: Promise<unknown> | null = null
  let stopped = false
  const pass = () => {
    if (running || stopped) return
    running = deliverDue(deps, keys)
      .catch((error) => console.error('chat : envois', error))
      .finally(() => {
        running = null
      })
  }
  const timer = setInterval(pass, PASS_MS)
  const sweeper = setInterval(
    () => void sweep(deps.db).catch((e) => console.error('chat : envois', e)),
    SWEEP_MS,
  )
  return {
    async stop() {
      stopped = true
      clearInterval(timer)
      clearInterval(sweeper)
      await running
    },
  }
}
