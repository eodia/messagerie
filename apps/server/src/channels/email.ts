import { createHash, randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { ImapFlow } from 'imapflow'
import { type ParsedMail, simpleParser } from 'mailparser'
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
import { type Mailer, smtpMailer, verifyMailer } from '../outbound/mailer.js'
import { Refusal } from '../refusal.js'
import type { EmailAddress, Settings, Site } from '../settings/settings.js'

/**
 * The e-mail channel (D24): an address of « Adresses e-mail » is a mailbox the chat reads —
 * IMAP, every minute — and a server it answers by — SMTP. What arrives becomes a visitor's
 * message: in the conversation it answers, found by its thread (`In-Reply-To`,
 * `References`), else in a new one of the address's site. An answer by e-mail to a visitor
 * of the widget (D23) leaves from the site's address too: their reply comes back to that
 * conversation, which goes on by e-mail.
 */

export interface MailboxDeps {
  readonly db: Db
  readonly settings: Settings
  readonly files: FileStore
  /** A model is configured: the site's AI answers first, as in the widget. */
  readonly aiAvailable: boolean
  readonly onVisitorMessage?: (conversationId: string) => void
  readonly env?: NodeJS.ProcessEnv
}

/** The account of an address: its login and its password, read from the environment (D5). */
export function accountOfAddress(
  address: EmailAddress,
  env: NodeJS.ProcessEnv,
): { readonly login: string; readonly password: string } | string {
  if (!address.active || !address.address) return 'ADDRESS_UNAVAILABLE'
  const name = address.passwordEnv?.replace(/^\$\{(.+)\}$/, '$1')
  const password = (name && env[name]) || null
  if (!password || !address.login) return 'PASSWORD_MISSING'
  return { login: address.login, password }
}

/** The SMTP address of an address's server, its account in it — what nodemailer takes. */
function smtpUrl(address: EmailAddress, login: string, password: string): string | null {
  if (!address.smtp) return null
  // 465: TLS at once; any other port: STARTTLS.
  const scheme = address.smtp.port === 465 ? 'smtps' : 'smtp'
  return `${scheme}://${encodeURIComponent(login)}:${encodeURIComponent(password)}@${address.smtp.host}:${address.smtp.port}`
}

const mailers = new Map<string, Mailer>()

/** The mailer of an address — its site's name as the sender's —, or the code of what it lacks. */
export function addressMailer(
  address: EmailAddress,
  siteName: string,
  env: NodeJS.ProcessEnv,
): Mailer | string {
  const account = accountOfAddress(address, env)
  if (typeof account === 'string') return account
  const url = smtpUrl(address, account.login, account.password)
  if (!url || !address.address) return 'SMTP_MISSING'
  const from = `${siteName.replace(/["<>]/g, '')} <${address.address}>`
  const key = createHash('sha256').update(`${url}\n${from}`).digest('hex')
  let mailer = mailers.get(key)
  if (!mailer) {
    mailer = smtpMailer({ url, from })
    mailers.set(key, mailer)
  }
  return mailer
}

// ── What arrives ──────────────────────────────────────────────────────────────────────

/** Mail no person wrote: an auto-reply, a bounce, a list — never a customer's message. */
function automatic(mail: ParsedMail, from: string): boolean {
  const header = (name: string) => {
    const value = mail.headers.get(name)
    return typeof value === 'string'
      ? value.toLowerCase()
      : value
        ? String(value).toLowerCase()
        : ''
  }
  const submitted = header('auto-submitted')
  if (submitted && submitted !== 'no') return true
  if (['bulk', 'junk', 'list', 'auto_reply'].includes(header('precedence'))) return true
  if (mail.headers.has('x-autoreply') || mail.headers.has('x-autorespond')) return true
  if (mail.headers.has('list-id')) return true
  if (/^(mailer-daemon|postmaster|no-?reply)@/i.test(from)) return true
  const type = header('content-type')
  return type.includes('multipart/report')
}

/** A quote begins: « Le … a écrit : », « On … wrote: », an original message, a forward. */
const QUOTE_START = [
  /^(le|on|am|el)\s.{0,200}(a écrit|wrote|schrieb|escribió)\s*:\s*$/i,
  /^-{2,}\s*(original message|message d'origine|message d’origine|ursprüngliche nachricht)/i,
  /^_{5,}$/,
  /^(de|from|von)\s*:\s.+@/i,
]

/**
 * What the customer wrote, without what they quoted: the history their mail program put
 * under their words, and their signature after « -- ». All of it when nothing is left.
 */
export function replyText(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const kept: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (QUOTE_START.some((start) => start.test(trimmed)) || trimmed === '--') break
    if (trimmed.startsWith('>')) continue
    kept.push(line)
  }
  const said = kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return said || text.trim()
}

/** Message ids as the headers give them — `<id@host>` —, at most twenty, the latest last. */
function threadOf(mail: ParsedMail): string[] {
  const references = Array.isArray(mail.references)
    ? mail.references
    : mail.references
      ? [mail.references]
      : []
  const ids = [...references, ...(mail.inReplyTo ? [mail.inReplyTo] : [])]
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))].slice(-20)
}

/** The conversation a mail answers: one whose message ids — ours or theirs — it names. */
async function threaded(db: Db, ids: readonly string[]): Promise<string | null> {
  if (ids.length === 0) return null
  const [ours] = await db
    .select({ id: outbound.conversationId })
    .from(outbound)
    .where(and(inArray(outbound.providerId, [...ids]), eq(outbound.channel, 'email')))
    .orderBy(desc(outbound.createdAt))
    .limit(1)
  if (ours?.id) return ours.id
  const [theirs] = await db
    .select({ id: messages.conversationId })
    .from(messages)
    .where(
      sql`${messages.meta}->>'providerId' in (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    )
    .orderBy(desc(messages.createdAt))
    .limit(1)
  return theirs?.id ?? null
}

async function siteOfAddress(settings: Settings, address: EmailAddress): Promise<Site> {
  const sites = await settings.sites()
  const site = address.siteId
    ? sites.find((s) => s.id === address.siteId)
    : sites.find((s) => s.active)
  if (!site || !site.active) throw new Refusal('SITE_NOT_FOUND', 404)
  return site
}

/** The contact of an address on a site: the one already known, or a new one. */
export async function emailContact(
  db: Db,
  siteId: string,
  email: string,
  name: string | null,
): Promise<string> {
  const [known] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.siteId, siteId), sql`lower(${contacts.email}) = ${email}`))
    .orderBy(desc(contacts.updatedAt))
    .limit(1)
  if (known) return known.id
  const [made] = await db
    .insert(contacts)
    .values({ siteId, name: name || email, email, identified: false })
    .returning({ id: contacts.id })
  if (!made) throw new Refusal('INTERNAL_ERROR', 500)
  return made.id
}

/** The files a customer attached, checked as any file (D14); a signature's pictures left out. */
function filesOf(mail: ParsedMail): Upload[] {
  const uploads: Upload[] = []
  for (const attachment of mail.attachments) {
    if (uploads.length >= MAX_FILES) break
    if (attachment.related || (attachment.contentDisposition === 'inline' && attachment.cid))
      continue
    const bytes = new Uint8Array(attachment.content)
    if (bytes.length === 0 || bytes.length > MAX_BYTES) continue
    const name = cleanName(attachment.filename ?? 'fichier')
    const mime = sniff(bytes, name)
    if (mime) uploads.push({ id: randomUUID(), name, mime, bytes })
  }
  return uploads
}

export type Received = 'written' | 'duplicate' | 'ignored'

/**
 * A mail that arrived at an address. Written once: a mail read twice — two processes, a
 * mailbox read again — is known by its `Message-ID`.
 */
export async function receiveEmail(
  deps: MailboxDeps,
  address: EmailAddress,
  raw: Buffer | string,
): Promise<Received> {
  const { db } = deps
  const mail = await simpleParser(raw)
  const sender = mail.from?.value[0]
  const from = sender?.address?.trim().toLowerCase() ?? ''
  if (!from || from === address.address || automatic(mail, from)) return 'ignored'
  const providerId =
    mail.messageId?.trim() || `<${createHash('sha256').update(raw).digest('hex')}@messagerie>`
  const [seen] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(sql`${messages.meta}->>'providerId' = ${providerId}`)
    .limit(1)
  if (seen) return 'duplicate'

  const site = await siteOfAddress(deps.settings, address)
  const uploads = filesOf(mail)
  const html = typeof mail.html === 'string' ? mail.html : ''
  const words = mail.text ?? html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ')
  const body = replyText(words).slice(0, 4000)
  if (body === '' && uploads.length === 0) return 'ignored'

  // The thread it answers — still the team's —, else a new conversation.
  let id = await threaded(db, threadOf(mail))
  if (id) {
    const [row] = await db
      .select({ left: conversations.visitorLeftAt })
      .from(conversations)
      .where(eq(conversations.id, id))
    if (!row || row.left) id = null
  }
  if (id) {
    await db
      .update(conversations)
      .set({ emailAddressId: address.id })
      .where(and(eq(conversations.id, id), isNull(conversations.emailAddressId)))
  } else {
    const contactId = await emailContact(db, site.id, from, sender?.name?.trim() || null)
    id = await createConversation(
      db,
      contactId,
      { ...site, aiEnabled: site.aiEnabled && deps.aiAvailable },
      await deps.settings.routeOf(site),
      { channel: 'email', emailAddressId: address.id },
    )
  }
  const conversationId = id
  await keeping(deps.files, conversationId, uploads, (attach) =>
    receiveVisitorMessage(db, conversationId, body, attach, {
      providerId,
      channel: 'email',
      subject: mail.subject?.trim() || null,
    }),
  )
  deps.onVisitorMessage?.(conversationId)
  return 'written'
}

// ── The mailboxes ─────────────────────────────────────────────────────────────────────

/** What the chat needs of a mailbox — IMAP, or a test's. */
export interface Mailbox {
  /** The unread mails' ids, oldest first — fifty at most. */
  unread(): Promise<number[]>
  source(uid: number): Promise<Buffer | null>
  markRead(uid: number): Promise<void>
  close(): Promise<void>
}

export type OpenMailbox = (
  address: EmailAddress,
  account: { readonly login: string; readonly password: string },
) => Promise<Mailbox>

/** An IMAP mailbox, its INBOX locked while the chat reads it. */
export const openImap: OpenMailbox = async (address, account) => {
  if (!address.imap) throw new Error('IMAP_MISSING')
  const client = new ImapFlow({
    host: address.imap.host,
    port: address.imap.port,
    // 143: STARTTLS; any other port: TLS at once.
    secure: address.imap.port !== 143,
    auth: { user: account.login, pass: account.password },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  })
  await client.connect()
  const lock = await client.getMailboxLock('INBOX')
  return {
    async unread() {
      const found = await client.search({ seen: false }, { uid: true })
      return (found || []).sort((a, b) => a - b).slice(0, 50)
    },
    async source(uid) {
      const message = await client.fetchOne(String(uid), { source: true }, { uid: true })
      return message ? (message.source ?? null) : null
    },
    async markRead(uid) {
      await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true })
    },
    async close() {
      lock.release()
      await client.logout().catch(() => undefined)
    },
  }
}

/** One reading of an address: what is unread becomes messages, and is marked read. */
export async function readMailbox(
  deps: MailboxDeps,
  address: EmailAddress,
  open: OpenMailbox = openImap,
): Promise<number> {
  const account = accountOfAddress(address, deps.env ?? process.env)
  if (typeof account === 'string' || !address.imap || !address.receive) return 0
  const box = await open(address, account)
  let written = 0
  try {
    for (const uid of await box.unread()) {
      const source = await box.source(uid)
      // A mail that fails to be written stays unread: the next reading tries again.
      if (source && (await receiveEmail(deps, address, source)) === 'written') written++
      await box.markRead(uid)
    }
  } finally {
    await box.close()
  }
  return written
}

const READ_MS = 60_000

/** Reads the addresses that receive, every minute — one at a time. */
export function startMailboxes(
  deps: MailboxDeps,
  open: OpenMailbox = openImap,
): { stop(): Promise<void> } {
  let running: Promise<unknown> | null = null
  let stopped = false
  const failing = new Set<string>()
  const pass = () => {
    if (running || stopped) return
    running = (async () => {
      const addresses = (await deps.settings.emailAddresses()).filter(
        (a) => a.active && a.receive && a.imap,
      )
      for (const address of addresses) {
        try {
          const written = await readMailbox(deps, address, open)
          if (written > 0) console.log(`chat : ${address.address} — ${written} e-mail(s) reçu(s)`)
          failing.delete(address.id)
        } catch (error) {
          // Said once until it works again: a mailbox down is not a log a minute.
          if (!failing.has(address.id)) console.error(`chat : boîte ${address.address}`, error)
          failing.add(address.id)
        }
      }
    })()
      .catch((error) => console.error('chat : boîtes e-mail', error))
      .finally(() => {
        running = null
      })
  }
  const timer = setInterval(pass, READ_MS)
  setTimeout(pass, 5000)
  return {
    async stop() {
      stopped = true
      clearInterval(timer)
      await running
    },
  }
}

/** Tries an address's two servers, sending and reading nothing. */
export async function testAddress(
  address: EmailAddress,
  env: NodeJS.ProcessEnv,
  open: OpenMailbox = openImap,
): Promise<{ readonly imap: string; readonly smtp: string }> {
  const account = accountOfAddress({ ...address, active: true }, env)
  if (typeof account === 'string') return { imap: account, smtp: account }
  let imap = 'ok'
  if (!address.imap) imap = 'IMAP_MISSING'
  else {
    try {
      const box = await open(address, account)
      await box.close()
    } catch (error) {
      const said = error as { authenticationFailed?: boolean; code?: string }
      imap = said.authenticationFailed ? 'IMAP_AUTH' : `IMAP_${said.code ?? 'UNAVAILABLE'}`
    }
  }
  const url = smtpUrl(address, account.login, account.password)
  const smtp = url ? await verifyMailer({ url, from: address.address ?? '' }) : 'SMTP_MISSING'
  return { imap, smtp: smtp === true ? 'ok' : smtp }
}
