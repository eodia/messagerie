import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { ContactAttribute } from '@chat/contracts'

/**
 * The visitor's two proofs.
 *
 * The VISITOR TOKEN is the chat's: signed with `CHAT_SECRET`, kept by the widget, it brings
 * a visitor back to their conversation from one visit to the next. It says which contact on
 * which site — nothing a visitor could change without the secret.
 *
 * The IDENTITY is the site's: a JWT (HS256) its server signs with the site's secret for the
 * customer signed in to it (D5). The widget never accepts an identifier that is not signed.
 */

const b64 = (data: Buffer | string) => Buffer.from(data).toString('base64url')
const mac = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest()

function sameMac(expected: Buffer, given: string): boolean {
  const actual = Buffer.from(given, 'base64url')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

// ── The visitor token ─────────────────────────────────────────────────────────────────

export interface VisitorClaims {
  readonly contactId: string
  readonly siteId: string
}

export function signVisitor(secret: string, claims: VisitorClaims): string {
  const payload = b64(JSON.stringify({ c: claims.contactId, s: claims.siteId }))
  return `v1.${payload}.${b64(mac(secret, `v1.${payload}`))}`
}

export function verifyVisitor(secret: string, token: string | undefined): VisitorClaims | null {
  const [version, payload, signature] = token?.split('.') ?? []
  if (version !== 'v1' || !payload || !signature) return null
  if (!sameMac(mac(secret, `v1.${payload}`), signature)) return null
  try {
    const { c, s } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return typeof c === 'string' && typeof s === 'string' ? { contactId: c, siteId: s } : null
  } catch {
    return null
  }
}

// ── The identity signed by the site ───────────────────────────────────────────────────

export interface Identity {
  /** The site's own identifier of its customer. */
  readonly externalId: string
  readonly name: string | null
  readonly email: string | null
  readonly attributes: ContactAttribute[]
}

const KINDS = new Set(['text', 'code', 'status', 'date'])

/** Attributes as a site may send them: `{ "Contrat": "A123" }`, or a list with kinds. */
function attributesOf(value: unknown): ContactAttribute[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item !== 'object' || item === null) return []
      const { label, value: v, kind } = item as Record<string, unknown>
      if (typeof label !== 'string' || typeof v !== 'string') return []
      return [
        {
          label,
          value: v,
          ...(typeof kind === 'string' && KINDS.has(kind)
            ? { kind: kind as ContactAttribute['kind'] }
            : {}),
        },
      ]
    })
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([label, v]) =>
      typeof v === 'string' || typeof v === 'number' ? [{ label, value: String(v) }] : [],
    )
  }
  return []
}

/**
 * The customer a site vouches for, or null. HS256 only — a token that names another
 * algorithm is refused, `none` above all — and it must expire: a signed identity that
 * never does is a password left lying around.
 */
export function verifyIdentity(secret: string, jwt: string, now = Date.now()): Identity | null {
  const [header, payload, signature] = jwt.split('.')
  if (!header || !payload || !signature) return null
  try {
    const head = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'))
    if (head.alg !== 'HS256') return null
    if (!sameMac(mac(secret, `${header}.${payload}`), signature)) return null
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (typeof claims.sub !== 'string' || claims.sub === '') return null
    if (typeof claims.exp !== 'number' || claims.exp * 1000 < now) return null
    return {
      externalId: claims.sub,
      name: typeof claims.name === 'string' ? claims.name : null,
      email: typeof claims.email === 'string' ? claims.email : null,
      attributes: attributesOf(claims.attributes),
    }
  } catch {
    return null
  }
}

/** What a site signs with — for the demonstration, and for its own server's code. */
export function signIdentity(
  secret: string,
  claims: Record<string, unknown> & { sub: string; exp: number },
): string {
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64(JSON.stringify(claims))
  return `${header}.${payload}.${b64(mac(secret, `${header}.${payload}`))}`
}

export const newSecret = (): string => randomBytes(32).toString('base64url')
