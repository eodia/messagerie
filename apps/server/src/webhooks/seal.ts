import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'

/**
 * A webhook's signing secret, sealed — basedb's way (D17): it signs every call, so it is
 * kept, encrypted rather than hashed, with AES-256-GCM and a key drawn from `CHAT_SECRET`
 * for this use alone. `v1.<iv>.<tag>.<ciphertext>`, in base64url.
 */

const PURPOSE = 'messagerie/seal/webhook/signing/v1'

const keyOf = (secret: string) => createHmac('sha256', secret).update(PURPOSE).digest()

export function seal(plain: string, secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyOf(secret), iv)
  const sealed = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv, cipher.getAuthTag(), sealed]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.')
}

export function unseal(sealed: string, secret: string): string {
  const [version, iv, tag, data] = sealed.split('.')
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('sealed secret unreadable')
  const decipher = createDecipheriv('aes-256-gcm', keyOf(secret), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

/** A new signing secret: `whsec_` and 32 random bytes. */
export const newSigningSecret = () => `whsec_${randomBytes(32).toString('base64url')}`

/** The signature header of a body: `t=<unix>,v1=<hex HMAC-SHA256 of "t.body">`. */
export function signature(
  secret: string,
  body: string,
  at = Math.floor(Date.now() / 1000),
): string {
  const mac = createHmac('sha256', secret).update(`${at}.${body}`).digest('hex')
  return `t=${at},v1=${mac}`
}
