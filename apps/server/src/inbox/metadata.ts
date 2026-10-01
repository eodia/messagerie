import type { Metadata, MetadataValue } from '@chat/contracts'
import { desc, eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { contacts, conversations } from '../db/schema.js'
import { signalChange } from '../realtime/signals.js'
import { Refusal } from '../refusal.js'

/**
 * Metadata: what a page (`MessagerieChat.setContactData`, `setConversationData`) or an
 * agent attaches to a contact or a conversation — an order number, a cart, the page read.
 * Free keys, small values, never checked: the inbox shows them as declared, and the AI
 * reads them as such. A key set to `null` is removed.
 */

const MAX_KEYS = 40
const MAX_KEY = 60
const MAX_TEXT = 500

export type MetadataPatch = Readonly<Record<string, MetadataValue | null>>

/** A patch as received; refused whole when one entry does not fit. */
export function readPatch(value: unknown): MetadataPatch {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Refusal('INVALID_REQUEST', 400, { expected: '{ data: { clé: valeur } }' })
  }
  const patch: Record<string, MetadataValue | null> = {}
  for (const [rawKey, entry] of Object.entries(value)) {
    const key = rawKey.trim()
    const fits =
      key !== '' &&
      key.length <= MAX_KEY &&
      (entry === null ||
        typeof entry === 'boolean' ||
        (typeof entry === 'number' && Number.isFinite(entry)) ||
        (typeof entry === 'string' && entry.length <= MAX_TEXT))
    if (!fits) throw new Refusal('INVALID_REQUEST', 400, { key: rawKey })
    patch[key] = typeof entry === 'string' ? entry.trim() : entry
  }
  return patch
}

export function merge(current: Metadata, patch: MetadataPatch): Metadata {
  const next: Record<string, MetadataValue> = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '') delete next[key]
    else next[key] = value
  }
  if (Object.keys(next).length > MAX_KEYS) {
    throw new Refusal('INVALID_REQUEST', 400, { max: MAX_KEYS })
  }
  return next
}

/** The conversation's metadata, changed; its thread's watchers are told. */
export async function patchConversationData(
  db: Db,
  id: string,
  patch: MetadataPatch,
): Promise<Metadata> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ data: conversations.data })
      .from(conversations)
      .where(eq(conversations.id, id))
      .for('update')
    if (!row) throw new Refusal('CONVERSATION_NOT_FOUND', 404)
    const data = merge(row.data, patch)
    await tx.update(conversations).set({ data }).where(eq(conversations.id, id))
    await signalChange(tx, id)
    return data
  })
}

export interface Profile {
  readonly name?: string
  readonly email?: string
  readonly phone?: string
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The name, e-mail and phone a page gave — each checked, each optional. */
export function readProfile(body: Record<string, unknown>): Profile {
  const field = (name: string, max: number, valid: (v: string) => boolean = () => true) => {
    const value = body[name]
    if (value === undefined) return {}
    if (typeof value !== 'string' || value.trim().length > max || !valid(value.trim())) {
      throw new Refusal('INVALID_REQUEST', 400, { field: name })
    }
    return value.trim() === '' ? {} : { [name]: value.trim() }
  }
  return {
    ...field('name', 120),
    ...field('email', 200, (v) => v === '' || EMAIL.test(v)),
    ...field('phone', 40, (v) => v === '' || /^[+()\d\s.-]{4,}$/.test(v)),
  }
}

/**
 * The contact's profile and metadata, changed. A contact the site signed keeps the name
 * and e-mail of its signature: a page's script cannot rename a customer. The inbox hears
 * of it through the contact's latest conversation.
 */
export async function patchContact(
  db: Db,
  contactId: string,
  change: { readonly profile?: Profile; readonly data?: MetadataPatch },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(contacts).where(eq(contacts.id, contactId)).for('update')
    if (!row) throw new Refusal('CONTACT_NOT_FOUND', 404)
    const profile = change.profile ?? {}
    await tx
      .update(contacts)
      .set({
        ...(profile.name && !row.identified ? { name: profile.name } : {}),
        ...(profile.email && !row.identified ? { email: profile.email } : {}),
        ...(profile.phone ? { phone: profile.phone } : {}),
        ...(change.data ? { data: merge(row.data, change.data) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(contacts.id, contactId))
    const [latest] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.contactId, contactId))
      .orderBy(desc(conversations.createdAt))
      .limit(1)
    if (latest) await signalChange(tx, latest.id)
  })
}
