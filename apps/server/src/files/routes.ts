import type { ApiError } from '@chat/contracts'
import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { Db } from '../db/client.js'
import { attachments } from '../db/schema.js'
import { MAX_BYTES, MAX_FILES, linkHolds } from './attachments.js'
import type { FileStore } from './store.js'

/** A form of files: as many as allowed, each at its largest, and room for the rest. */
export const uploadLimit = bodyLimit({
  maxSize: MAX_FILES * MAX_BYTES + 64 * 1024,
  onError: (c) =>
    c.json({ code: 'ATTACHMENT_REFUSED', details: { reason: 'size' } } satisfies ApiError, 413),
})

/**
 * `GET /files/:id?e=…&s=…` — a file, to whoever holds its signed link: the widget's
 * visitor, the inbox's agent. Images and PDF open in the page; the rest downloads. Nothing
 * the file says runs: no script, no sniffing of its type.
 */
export function serveFile(db: Db, store: FileStore) {
  return async (c: Context) => {
    const id = c.req.param('id') ?? ''
    const notFound = () =>
      c.json({ code: 'ATTACHMENT_NOT_FOUND' } satisfies ApiError, 404, {
        'cache-control': 'no-store',
      })
    if (!/^[0-9a-f-]{36}$/.test(id) || !linkHolds(id, c.req.query('e'), c.req.query('s'))) {
      return notFound()
    }
    const [row] = await db.select().from(attachments).where(eq(attachments.id, id))
    if (!row) return notFound()
    let bytes: Buffer
    try {
      bytes = await store.read(row.storageKey)
    } catch {
      return notFound()
    }
    const inline = row.mime.startsWith('image/') || row.mime === 'application/pdf'
    const name = encodeURIComponent(row.name)
    return c.body(new Uint8Array(bytes), 200, {
      'content-type': row.mime,
      'content-length': String(bytes.length),
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${name}`,
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
      // The widget shows a visitor's image on the client's site.
      'cross-origin-resource-policy': 'cross-origin',
      'content-security-policy':
        row.mime === 'application/pdf'
          ? "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'"
          : "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    })
  }
}
