import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Attachment, WidgetAttachment } from '@chat/contracts'
import { inArray } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { attachments } from '../db/schema.js'
import { Refusal } from '../refusal.js'
import type { FileStore } from './store.js'

/**
 * Files sent with a message — by a visitor from the widget, by an agent from the inbox.
 *
 * What is taken is decided by the bytes, not by the name or the type the browser claims:
 * images, PDF, text and office documents, 10 Mo at most, five at once. A file is read
 * through a link signed by the server, valid a day: the widget's `<img>` and the inbox's
 * carry no token, and a link copied elsewhere stops working.
 */

export const MAX_BYTES = 10 * 1024 * 1024
export const MAX_FILES = 5
const LINK_SECONDS = 24 * 60 * 60

/** A file received, checked, ready to keep. */
export interface Upload {
  readonly id: string
  readonly name: string
  readonly mime: string
  readonly bytes: Uint8Array
}

const starts = (bytes: Uint8Array, ...signature: number[]) =>
  signature.every((byte, index) => bytes[index] === byte)

const ascii = (bytes: Uint8Array, from: number, text: string) =>
  [...text].every((char, index) => bytes[from + index] === char.charCodeAt(0))

/** The file's type, from its first bytes — or null when the chat does not take it. */
export function sniff(bytes: Uint8Array, name: string): string | null {
  if (starts(bytes, 0x89, 0x50, 0x4e, 0x47)) return 'image/png'
  if (starts(bytes, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (ascii(bytes, 0, 'GIF8')) return 'image/gif'
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return 'image/webp'
  if (ascii(bytes, 0, '%PDF-')) return 'application/pdf'
  const extension = name.toLowerCase().split('.').pop() ?? ''
  // Office documents are zip archives: the extension tells which.
  if (starts(bytes, 0x50, 0x4b, 0x03, 0x04)) {
    if (extension === 'docx')
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    if (extension === 'xlsx')
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    return null
  }
  // Text: no NUL byte in its first kilobytes, and a text extension.
  const head = bytes.subarray(0, 4096)
  if (!head.includes(0)) {
    if (extension === 'csv') return 'text/csv'
    if (extension === 'txt' || extension === 'log' || extension === 'md') return 'text/plain'
  }
  return null
}

/** A name as it is shown: no path, no control character, 120 characters at most. */
export function cleanName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the control characters are what goes
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return (clean || 'fichier').slice(-120)
}

/** The files of a form, checked: the chat's own type for each, or a refusal. */
export async function readUploads(files: readonly File[]): Promise<Upload[]> {
  if (files.length === 0) return []
  if (files.length > MAX_FILES) {
    throw new Refusal('ATTACHMENT_REFUSED', 400, { reason: 'count', max: MAX_FILES })
  }
  const uploads: Upload[] = []
  for (const file of files) {
    if (file.size > MAX_BYTES) {
      throw new Refusal('ATTACHMENT_REFUSED', 413, { reason: 'size', name: file.name })
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes.length === 0) throw new Refusal('ATTACHMENT_REFUSED', 400, { reason: 'empty' })
    const name = cleanName(file.name)
    const mime = sniff(bytes, name)
    if (!mime) throw new Refusal('ATTACHMENT_REFUSED', 415, { reason: 'type', name })
    uploads.push({ id: randomUUID(), name, mime, bytes })
  }
  return uploads
}

/** The files of a multipart body: every `file` field. */
export function filesOf(form: Record<string, unknown>): File[] {
  const field = form.file ?? form['file[]']
  const all = Array.isArray(field) ? field : field === undefined ? [] : [field]
  return all.filter((f): f is File => f instanceof File)
}

const keyOf = (conversationId: string, id: string) => `${conversationId}/${id}`

/** The rows of the files kept for a message, once its id is known. */
export type AttachRows = (messageId: string) => (typeof attachments.$inferInsert)[]

/**
 * Keeps the files, then runs `write` — which inserts the message and its rows — and takes
 * the files back if it fails: no file is left without its row.
 */
export async function keeping<T>(
  store: FileStore,
  conversationId: string,
  uploads: readonly Upload[],
  write: (rows: AttachRows | undefined) => Promise<T>,
): Promise<T> {
  if (uploads.length === 0) return write(undefined)
  for (const upload of uploads) await store.put(keyOf(conversationId, upload.id), upload.bytes)
  try {
    return await write((messageId) =>
      uploads.map((upload) => ({
        id: upload.id,
        messageId,
        storageKey: keyOf(conversationId, upload.id),
        name: upload.name,
        mime: upload.mime,
        size: upload.bytes.length,
      })),
    )
  } catch (error) {
    for (const upload of uploads) await store.remove(keyOf(conversationId, upload.id))
    throw error
  }
}

// ── Links ─────────────────────────────────────────────────────────────────────────────

let linkSecret: string | null = null

/** The secret the links are signed with — the server's, set once at start. */
export function signLinksWith(secret: string): void {
  linkSecret = secret
}

function secret(): string {
  if (linkSecret === null) throw new Error('signLinksWith() was not called')
  return linkSecret
}

const signature = (secret: string, id: string, expires: number) =>
  createHmac('sha256', secret).update(`attachment:${id}:${expires}`).digest('base64url')

/** The path that reads a file until tomorrow — relative to the chat server's address. */
export function linkOf(id: string, now = Date.now()): string {
  // Rounded to the hour: the same link all hour long, which a browser caches.
  const expires = Math.ceil(now / 3_600_000) * 3600 + LINK_SECONDS
  return `/files/${id}?e=${expires}&s=${signature(secret(), id, expires)}`
}

export function linkHolds(
  id: string,
  expires: string | undefined,
  given: string | undefined,
  now = Date.now(),
): boolean {
  const at = Number(expires)
  if (!given || !Number.isInteger(at) || at * 1000 < now) return false
  const wanted = Buffer.from(signature(secret(), id, at))
  const sent = Buffer.from(given)
  return wanted.length === sent.length && timingSafeEqual(wanted, sent)
}

// ── Reading them with their messages ──────────────────────────────────────────────────

type Row = typeof attachments.$inferSelect

/** The files of these messages, by message, oldest first. */
export async function attachmentsOf(
  db: Db,
  messageIds: readonly string[],
): Promise<Map<string, Row[]>> {
  const byMessage = new Map<string, Row[]>()
  if (messageIds.length === 0) return byMessage
  const rows = await db
    .select()
    .from(attachments)
    .where(inArray(attachments.messageId, [...messageIds]))
    .orderBy(attachments.createdAt)
  for (const row of rows) {
    const list = byMessage.get(row.messageId) ?? []
    list.push(row)
    byMessage.set(row.messageId, list)
  }
  return byMessage
}

/** As the inbox shows it — with what the AI made of it. */
export function forInbox(row: Row): Attachment {
  return { ...forVisitor(row), analysis: row.analysis ?? null }
}

/** As the visitor sees it: the file, no more. */
export function forVisitor(row: Row): WidgetAttachment {
  return { id: row.id, name: row.name, mime: row.mime, size: row.size, url: linkOf(row.id) }
}
