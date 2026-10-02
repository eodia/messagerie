import type {
  VisitorConversation,
  WidgetAvailability,
  WidgetMessage,
  WidgetSession,
  WidgetSessionBody,
} from '@chat/contracts'
import { and, asc, desc, eq } from 'drizzle-orm'
import type { Config } from '../config.js'
import type { Db } from '../db/client.js'
import { agents, contacts, conversations, messages, siteSecrets } from '../db/schema.js'
import { type Upload, attachmentsOf, forVisitor, keeping } from '../files/attachments.js'
import type { FileStore } from '../files/store.js'
import { generatedName } from '../inbox/contact-name.js'
import { createConversation, receiveVisitorMessage } from '../inbox/incoming.js'
import {
  type MetadataPatch,
  type Profile,
  patchContact,
  patchConversationData,
} from '../inbox/metadata.js'
import { isZonePoint, knownZone, placeOfZone } from '../places/place.js'
import { signalChange, signalTyping } from '../realtime/signals.js'
import { Refusal } from '../refusal.js'
import { availability } from '../settings/hours.js'
import type { Settings, Site } from '../settings/settings.js'
import { languageCode } from '../settings/widget.js'
import { type VisitorClaims, signVisitor, verifyIdentity, verifyVisitor } from './tokens.js'

/**
 * The visitor's side of a conversation: their session, their conversation as they see it,
 * and what they write.
 */

export interface WidgetDeps {
  readonly db: Db
  readonly config: Config
  readonly settings: Settings
  /** A model is configured: the sites that want it get the AI first. */
  readonly aiAvailable: boolean
  /** Where the files the visitors send are kept. */
  readonly files: FileStore
  /** Told of each visitor message — the AI's cue to answer. */
  readonly onVisitorMessage?: (conversationId: string) => void
}

/** A conversation resolved more than a day ago is over: the visitor starts a new one. */
const RESUME_MS = 24 * 60 * 60 * 1000

/** Whether a page of `origin` may show this site's widget: its host is one of the site's. */
export function originAllowed(
  site: Site,
  origin: string | undefined,
  production: boolean,
): boolean {
  // A request without an origin comes from no browser page: tolerated in development only.
  if (origin === undefined) return !production
  let host: string
  try {
    host = new URL(origin).hostname.toLowerCase()
  } catch {
    return false
  }
  return site.domains.some((domain) =>
    domain.startsWith('*.') ? host.endsWith(domain.slice(1)) : host === domain,
  )
}

export async function siteFor(
  deps: WidgetDeps,
  siteId: string,
  origin: string | undefined,
): Promise<Site> {
  const site = await deps.settings.site(siteId)
  if (!site || !site.active) throw new Refusal('SITE_NOT_FOUND', 404)
  if (!originAllowed(site, origin, deps.config.production)) {
    throw new Refusal('ORIGIN_NOT_ALLOWED', 403)
  }
  return site
}

/** The visitor behind a token — their contact still there, on a site that allows the page. */
export async function visitorFrom(
  deps: WidgetDeps,
  token: string | undefined,
  origin: string | undefined,
): Promise<VisitorClaims & { site: Site }> {
  const claims = verifyVisitor(deps.config.secret, token)
  if (!claims) throw new Refusal('VISITOR_INVALID', 401)
  const [contact] = await deps.db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, claims.contactId), eq(contacts.siteId, claims.siteId)))
  if (!contact) throw new Refusal('VISITOR_INVALID', 401)
  return { ...claims, site: await siteFor(deps, claims.siteId, origin) }
}

async function whenAvailable(settings: Settings, site: Site): Promise<WidgetAvailability> {
  const [slots, closures] = await Promise.all([
    settings.openingSlots(site.id),
    settings.closures(site.id),
  ])
  const now = availability(slots, closures, site.timezone)
  return {
    open: now.open,
    nextOpening: now.open ? null : (now.nextOpening?.toISOString() ?? null),
    closureMessage: now.closure?.message ?? null,
  }
}

/**
 * Opens — or resumes — a visitor's session. A signed identity makes the visitor that
 * customer, and brings the conversations they had as an anonymous visitor along.
 */
export async function openSession(
  deps: WidgetDeps,
  body: WidgetSessionBody,
  origin: string | undefined,
): Promise<WidgetSession> {
  const { db, config, settings } = deps
  const site = await siteFor(deps, body.site, origin)
  const known = verifyVisitor(config.secret, body.visitor)
  let [contact] =
    known && known.siteId === site.id
      ? await db.select().from(contacts).where(eq(contacts.id, known.contactId))
      : []

  if (body.identity) {
    const [secret] = await db.select().from(siteSecrets).where(eq(siteSecrets.siteId, site.id))
    const identity = secret ? verifyIdentity(secret.identitySecret, body.identity) : null
    if (!identity) throw new Refusal('IDENTITY_INVALID', 401)
    const values = {
      name: identity.name ?? identity.email ?? identity.externalId,
      email: identity.email,
      attributes: identity.attributes,
      identified: true,
      updatedAt: new Date(),
    }
    const [customer] = await db
      .insert(contacts)
      .values({ siteId: site.id, externalId: identity.externalId, ...values })
      .onConflictDoUpdate({ target: [contacts.siteId, contacts.externalId], set: values })
      .returning()
    // What they wrote before signing in is theirs too.
    if (contact && !contact.identified && customer && contact.id !== customer.id) {
      await db
        .update(conversations)
        .set({ contactId: customer.id })
        .where(eq(conversations.contactId, contact.id))
      await db.delete(contacts).where(eq(contacts.id, contact.id))
    }
    contact = customer
  }

  if (!contact) {
    const code = Math.random().toString(16).slice(2, 6).toUpperCase()
    ;[contact] = await db
      .insert(contacts)
      .values({ siteId: site.id, name: generatedName(code), identified: false })
      .returning()
  }
  if (!contact) throw new Refusal('INTERNAL_ERROR', 500)
  contact = await locate(db, contact, body.timeZone)

  return {
    visitor: signVisitor(config.secret, { contactId: contact.id, siteId: site.id }),
    contact: { name: contact.identified ? contact.name : null, identified: contact.identified },
    site: {
      name: site.name,
      title: site.title,
      tagline: site.tagline,
      welcome: site.welcome,
      suggestions: site.suggestions,
      color: site.color,
      language: languageCode(site.language),
      ai: site.aiEnabled && deps.aiAvailable,
      team: site.appearance.showTeam ? (await settings.teamFirstNames()).slice(0, 3) : [],
      appearance: site.appearance,
    },
    availability: await whenAvailable(settings, site),
    conversation: await visitorConversation(db, contact.id),
  }
}

/**
 * Where the visitor is, from their browser's time zone (D18): the zone kept, and the
 * country and the point it says — unless a better point was given (a site's, the seed's),
 * which a zone never overwrites. A visitor who travelled moves with their zone.
 */
async function locate(
  db: Db,
  contact: typeof contacts.$inferSelect,
  raw: string | undefined,
): Promise<typeof contacts.$inferSelect> {
  const zone = knownZone(raw)
  if (zone === null || zone === contact.timeZone) return contact
  const zoned =
    contact.latitude === null || isZonePoint(contact.timeZone, contact.latitude, contact.longitude)
  const place = placeOfZone(zone)
  const [moved] = await db
    .update(contacts)
    .set({
      timeZone: zone,
      ...(zoned && place
        ? { country: place.country, latitude: place.latitude, longitude: place.longitude }
        : {}),
    })
    .where(eq(contacts.id, contact.id))
    .returning()
  return moved ?? contact
}

/** The contact's current conversation: one still going, or one resolved within a day. */
async function currentConversation(db: Db, contactId: string) {
  const [latest] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.contactId, contactId))
    .orderBy(desc(conversations.createdAt))
    .limit(1)
  if (!latest || latest.visitorLeftAt !== null) return null
  if (latest.status === 'resolved' && Date.now() - latest.updatedAt.getTime() > RESUME_MS) {
    return null
  }
  return latest
}

const firstName = (name: string | null) => (name ?? '').split(/\s+/)[0] || null

/** The visitor is writing: the agents of their current conversation see it — none, nothing. */
export async function visitorTyping(db: Db, contactId: string): Promise<void> {
  const conversation = await currentConversation(db, contactId)
  if (conversation) await signalTyping(db, conversation.id, 'visitor')
}

export async function visitorConversation(
  db: Db,
  contactId: string,
): Promise<VisitorConversation | null> {
  const conversation = await currentConversation(db, contactId)
  if (!conversation) return null
  const rows = await db
    .select({ message: messages, agent: agents.name, login: agents.login })
    .from(messages)
    .leftJoin(agents, eq(agents.id, messages.agentId))
    .where(eq(messages.conversationId, conversation.id))
    .orderBy(asc(messages.createdAt))
  const [contact] = await db
    .select({ email: contacts.email })
    .from(contacts)
    .where(eq(contacts.id, contactId))

  const files = await attachmentsOf(
    db,
    rows.map(({ message }) => message.id),
  )
  const shown: WidgetMessage[] = []
  for (const { message, agent, login } of rows) {
    const base = {
      id: message.id,
      at: message.createdAt.toISOString(),
      // Deleted for everyone: the visitor sees that it was, and nothing of it.
      ...(message.deletedAt ? { deleted: true as const } : {}),
    }
    const attached = (files.get(message.id) ?? []).map(forVisitor)
    const withFiles = attached.length > 0 ? { attachments: attached } : {}
    if (message.kind === 'text') {
      if (message.author === 'contact') {
        shown.push({ ...base, from: 'visitor', body: message.body, ...withFiles })
      } else if (message.author === 'ai') shown.push({ ...base, from: 'ai', body: message.body })
      // An automation speaks for the site (D20).
      else if (message.author === 'agent' && login?.startsWith('automation:')) {
        shown.push({ ...base, from: 'site', body: message.body })
      } else if (message.author === 'agent') {
        shown.push({
          ...base,
          from: 'agent',
          body: message.body,
          author: firstName(agent) ?? '',
          ...withFiles,
        })
      }
    } else if (message.kind === 'handoff') {
      shown.push({ ...base, from: 'event', event: 'handoff', author: null })
    } else if (message.kind === 'event') {
      // Of the team's events, the visitor sees an agent arriving and the end — no more.
      const event = message.meta.event
      if (event?.type === 'takeover') {
        shown.push({ ...base, from: 'event', event: 'joined', author: firstName(event.agent) })
      } else if (event?.type === 'resolved') {
        shown.push({ ...base, from: 'event', event: 'resolved', author: null })
      } else if (event?.type === 'email_requested') {
        shown.push({ ...base, from: 'email', text: event.text, email: contact?.email ?? null })
      }
    }
  }
  return {
    id: conversation.id,
    answeredBy:
      conversation.status === 'ai' ? 'ai' : conversation.status === 'resolved' ? 'closed' : 'team',
    messages: shown,
  }
}

/**
 * The visitor writes: in their current conversation, or a new one — with the metadata the
 * page set for it, attached before the message, so that the AI reads them with it.
 */
export async function postVisitorMessage(
  deps: WidgetDeps,
  visitor: VisitorClaims & { site: Site },
  body: string,
  data: MetadataPatch | null = null,
  uploads: readonly Upload[] = [],
): Promise<VisitorConversation> {
  const text = body.trim()
  if (text === '' && uploads.length === 0) throw new Refusal('EMPTY_MESSAGE', 400)
  if (text.length > 4000) throw new Refusal('INVALID_REQUEST', 400, { max: 4000 })
  const current = await currentConversation(deps.db, visitor.contactId)
  const id =
    current?.id ??
    (await createConversation(
      deps.db,
      visitor.contactId,
      { ...visitor.site, aiEnabled: visitor.site.aiEnabled && deps.aiAvailable },
      await deps.settings.routeOf(visitor.site),
    ))
  if (data && Object.keys(data).length > 0) await patchConversationData(deps.db, id, data)
  await keeping(deps.files, id, uploads, (attach) =>
    receiveVisitorMessage(deps.db, id, text, attach),
  )
  deps.onVisitorMessage?.(id)
  const conversation = await visitorConversation(deps.db, visitor.contactId)
  if (!conversation) throw new Refusal('INTERNAL_ERROR', 500)
  return conversation
}

/**
 * `MessagerieChat.reset()`: the visitor begins anew. Their current conversation stays the
 * team's, marked as left — the next message opens another. One the AI alone held is
 * resolved: nobody waits on it; one an agent has stays theirs, told by its event.
 */
export async function resetVisitorConversation(db: Db, visitor: VisitorClaims): Promise<void> {
  const current = await currentConversation(db, visitor.contactId)
  if (!current) return
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, current.id))
      .for('update')
    if (!row || row.visitorLeftAt !== null) return
    const at = new Date()
    await tx.insert(messages).values({
      conversationId: row.id,
      author: 'system',
      kind: 'event',
      meta: { event: { type: 'restarted' } },
      createdAt: at,
    })
    await tx
      .update(conversations)
      .set({
        visitorLeftAt: at,
        ...(row.status === 'ai' ? { status: 'resolved' as const, agentUnread: false } : {}),
        updatedAt: at,
      })
      .where(eq(conversations.id, row.id))
    await signalChange(tx, row.id)
  })
}

/** What the page says of its visitor: their profile, their metadata. */
export async function updateVisitorContact(
  deps: WidgetDeps,
  visitor: VisitorClaims,
  change: { readonly profile: Profile; readonly data: MetadataPatch | null },
): Promise<void> {
  await patchContact(deps.db, visitor.contactId, {
    profile: change.profile,
    ...(change.data ? { data: change.data } : {}),
  })
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * The visitor leaves their address in the e-mail card: it goes on their record — unless the
 * site signed another —, and the thread says so to the agents.
 */
export async function leaveEmail(
  deps: WidgetDeps,
  visitor: VisitorClaims,
  raw: unknown,
): Promise<void> {
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (email.length > 254 || !EMAIL.test(email)) {
    throw new Refusal('INVALID_REQUEST', 400, { field: 'email' })
  }
  const current = await currentConversation(deps.db, visitor.contactId)
  if (!current) throw new Refusal('CONVERSATION_NOT_FOUND', 404)
  await deps.db.transaction(async (tx) => {
    await tx
      .update(contacts)
      .set({ email, updatedAt: new Date() })
      .where(and(eq(contacts.id, visitor.contactId), eq(contacts.identified, false)))
    await tx.insert(messages).values({
      conversationId: current.id,
      author: 'system',
      kind: 'event',
      meta: { event: { type: 'email_given', email } },
    })
    await signalChange(tx, current.id)
  })
}

/** The metadata of the visitor's current conversation; none yet, nothing to attach to. */
export async function updateVisitorConversation(
  deps: WidgetDeps,
  visitor: VisitorClaims,
  data: MetadataPatch,
): Promise<void> {
  const current = await currentConversation(deps.db, visitor.contactId)
  if (!current) throw new Refusal('CONVERSATION_NOT_FOUND', 404)
  await patchConversationData(deps.db, current.id, data)
}
