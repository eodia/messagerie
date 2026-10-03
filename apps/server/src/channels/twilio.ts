import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Fetch } from '../outbound/push.js'

/**
 * Twilio, the SMS and RCS provider (D23): its Messages API to send, its webhooks to
 * receive — signed with the account's auth token (`X-Twilio-Signature`) —, and the media
 * of a message, read with the same account.
 *
 * RCS rides on SMS: a number whose messaging service (`MG…`) has an RCS sender writes by
 * RCS to a phone that reads it, by SMS to the others. A visitor who writes by RCS comes
 * from `rcs:+33…`.
 */

export interface TwilioAccount {
  readonly accountSid: string
  readonly authToken: string
}

const API = 'https://api.twilio.com/2010-04-01'

/**
 * Twilio's signature of a webhook: HMAC-SHA1, by the auth token, of the address it called
 * followed by every field of the form, sorted by name, each name then its value.
 */
export function twilioSignature(
  authToken: string,
  url: string,
  params: Readonly<Record<string, string>>,
): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url)
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64')
}

export function validTwilioSignature(
  authToken: string,
  url: string,
  params: Readonly<Record<string, string>>,
  given: string | undefined,
): boolean {
  if (!given) return false
  const wanted = Buffer.from(twilioSignature(authToken, url, params))
  const sent = Buffer.from(given)
  return wanted.length === sent.length && timingSafeEqual(wanted, sent)
}

/** A number as the chat keeps it — `+33612345678` — from Twilio's `From`, RCS or not. */
export function phoneOf(raw: string): { phone: string; rcs: boolean } | null {
  const rcs = /^rcs:/i.test(raw)
  const phone = raw.replace(/^(rcs|sms):/i, '').replace(/[\s.()-]/g, '')
  return /^\+[1-9]\d{6,14}$/.test(phone) ? { phone, rcs } : null
}

export interface OutgoingText {
  readonly to: string
  /** The number it leaves from — unless a messaging service chooses (and may use RCS). */
  readonly from: string | null
  readonly messagingServiceSid: string | null
  readonly body: string
  /** Public addresses Twilio fetches: a picture, a PDF. */
  readonly mediaUrls: readonly string[]
  readonly statusCallback: string | null
}

/** Why Twilio did not take a message — its code —, and whether to try again later. */
export class TwilioFailure extends Error {
  constructor(
    readonly code: string,
    readonly retry: boolean,
  ) {
    super(code)
  }
}

const basic = (account: TwilioAccount) =>
  `Basic ${Buffer.from(`${account.accountSid}:${account.authToken}`).toString('base64')}`

/** Sends one message; Twilio's id of it (`SM…`), for its status callbacks. */
export async function sendTwilioMessage(
  account: TwilioAccount,
  message: OutgoingText,
  doFetch: Fetch = fetch,
): Promise<string> {
  const form = new URLSearchParams({ To: message.to, Body: message.body })
  if (message.messagingServiceSid) form.set('MessagingServiceSid', message.messagingServiceSid)
  else if (message.from) form.set('From', message.from)
  for (const url of message.mediaUrls) form.append('MediaUrl', url)
  if (message.statusCallback) form.set('StatusCallback', message.statusCallback)
  let response: Response
  try {
    response = await doFetch(
      `${API}/Accounts/${encodeURIComponent(account.accountSid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: basic(account),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
        signal: AbortSignal.timeout(15_000),
      },
    )
  } catch {
    throw new TwilioFailure('TWILIO_UNREACHABLE', true)
  }
  const answer = (await response.json().catch(() => ({}))) as { sid?: string; code?: number }
  if (response.ok && answer.sid) return answer.sid
  const retry = response.status === 429 || response.status >= 500
  throw new TwilioFailure(answer.code ? `TWILIO_${answer.code}` : `HTTP_${response.status}`, retry)
}

/**
 * A file a visitor sent by MMS or RCS, read from Twilio with the account — `maxBytes` at
 * most. Null when it cannot be read, or is too big.
 */
export async function fetchTwilioMedia(
  account: TwilioAccount,
  url: string,
  maxBytes: number,
  doFetch: Fetch = fetch,
): Promise<Uint8Array | null> {
  // Twilio's own addresses only: the account's credentials go nowhere else.
  let host: string
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return null
    host = parsed.hostname
  } catch {
    return null
  }
  if (host !== 'api.twilio.com') return null
  try {
    // The media redirects to a signed address of Twilio's storage: followed, without the
    // credentials, which `fetch` drops across origins.
    const response = await doFetch(url, {
      headers: { Authorization: basic(account) },
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) return null
    const length = Number(response.headers.get('content-length') ?? 0)
    if (length > maxBytes) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    return bytes.length > 0 && bytes.length <= maxBytes ? bytes : null
  } catch {
    return null
  }
}
