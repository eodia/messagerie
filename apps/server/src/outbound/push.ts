import {
  type ECDH,
  type KeyObject,
  createCipheriv,
  createECDH,
  createHash,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign,
} from 'node:crypto'

/**
 * Web Push (D23), without a library: the agents' phones get their alerts from the push
 * service of their browser — Apple's, Google's, Mozilla's —, which the chat calls signed
 * with its VAPID key (RFC 8292), the alert encrypted for the device alone (RFC 8291): the
 * push service carries it, and cannot read it.
 *
 * The VAPID key is drawn from `CHAT_SECRET`, for this use alone: nothing to set up, the
 * same in every process. Changing `CHAT_SECRET` changes it: the devices subscribe again
 * the next time the inbox opens there.
 */

export interface VapidKeys {
  /** The public key, uncompressed (65 bytes), in base64url — what the browser subscribes with. */
  readonly publicKey: string
  readonly privateKey: KeyObject
}

const b64url = (bytes: Buffer | Uint8Array) => Buffer.from(bytes).toString('base64url')

export function vapidKeys(secret: string): VapidKeys {
  // A P-256 scalar out of the secret; the rare one out of range draws the next.
  for (let round = 0; ; round++) {
    const d = Buffer.from(hkdfSync('sha256', secret, 'messagerie', `vapid ${round}`, 32))
    const ecdh = createECDH('prime256v1')
    try {
      ecdh.setPrivateKey(d)
    } catch {
      continue
    }
    const pub = ecdh.getPublicKey()
    const privateKey = createPrivateKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        d: b64url(d),
        x: b64url(pub.subarray(1, 33)),
        y: b64url(pub.subarray(33, 65)),
      },
      format: 'jwk',
    })
    return { publicKey: b64url(pub), privateKey }
  }
}

/** `Authorization` for a push service: a JWT for its origin, twelve hours good. */
export function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  subject: string,
  now = Date.now(),
): string {
  const header = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64url(
    Buffer.from(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now / 1000) + 12 * 3600,
        sub: subject,
      }),
    ),
  )
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), {
    key: keys.privateKey,
    dsaEncoding: 'ieee-p1363',
  })
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${keys.publicKey}`
}

export interface PushTarget {
  readonly endpoint: string
  /** The device's public key, base64url. */
  readonly p256dh: string
  /** Its authentication secret, base64url. */
  readonly auth: string
}

/** RFC 8291: the payload, encrypted for the device — one record, `aes128gcm`. */
export function encryptPayload(
  target: PushTarget,
  payload: Buffer,
  salt: Buffer = randomBytes(16),
  /** The sender's one-time key pair — a fresh one unless a test gives its own. */
  ephemeral?: ECDH,
): Buffer {
  const deviceKey = Buffer.from(target.p256dh, 'base64url')
  const authSecret = Buffer.from(target.auth, 'base64url')
  const sender = ephemeral ?? createECDH('prime256v1')
  if (!ephemeral) sender.generateKeys()
  const serverKey = sender.getPublicKey()
  const shared = sender.computeSecret(deviceKey)
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), deviceKey, serverKey])
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32))
  const cek = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
  )
  const nonce = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12),
  )
  const cipher = createCipheriv('aes-128-gcm', cek, nonce)
  // The last (and only) record ends with its delimiter, 0x02, and no padding.
  const sealed = Buffer.concat([
    cipher.update(Buffer.concat([payload, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ])
  const header = Buffer.alloc(21)
  salt.copy(header, 0)
  header.writeUInt32BE(4096, 16)
  header.writeUInt8(serverKey.length, 20)
  return Buffer.concat([header, serverKey, sealed])
}

/** What a push service said: taken, the device gone for good, try later, or refused. */
export type PushOutcome = 'sent' | 'gone' | 'retry' | 'failed'

export type Fetch = typeof fetch

/**
 * Sends one alert to one device. `topic` folds the alerts of one conversation into one
 * while the device is off: a phone that comes back gets the latest, not twenty.
 */
export async function sendPush(
  target: PushTarget,
  payload: object,
  keys: VapidKeys,
  subject: string,
  options: { readonly topic?: string; readonly fetch?: Fetch } = {},
): Promise<{ outcome: PushOutcome; status: number }> {
  const body = encryptPayload(target, Buffer.from(JSON.stringify(payload)))
  const headers: Record<string, string> = {
    Authorization: vapidAuthorization(target.endpoint, keys, subject),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: '3600',
    Urgency: 'high',
  }
  if (options.topic) {
    headers.Topic = createHash('sha256').update(options.topic).digest('base64url').slice(0, 32)
  }
  let status = 0
  try {
    const response = await (options.fetch ?? fetch)(target.endpoint, {
      method: 'POST',
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    })
    status = response.status
  } catch {
    return { outcome: 'retry', status }
  }
  if (status >= 200 && status < 300) return { outcome: 'sent', status }
  if (status === 404 || status === 410) return { outcome: 'gone', status }
  if (status === 429 || status >= 500) return { outcome: 'retry', status }
  return { outcome: 'failed', status }
}

/**
 * The push services of the browsers — Chrome and Android, Firefox, Safari and iOS, Edge.
 * The chat calls no other address a browser says it was given.
 */
const PUSH_SERVICES = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)*push\.apple\.com$/,
  /^([a-z0-9-]+\.)*notify\.windows\.com$/,
]

export function knownPushService(endpoint: string): boolean {
  try {
    const url = new URL(endpoint)
    return (
      url.protocol === 'https:' &&
      url.port === '' &&
      endpoint.length <= 1000 &&
      PUSH_SERVICES.some((host) => host.test(url.hostname))
    )
  } catch {
    return false
  }
}
