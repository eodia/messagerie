import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Fetch } from '../outbound/push.js'
import {
  type Credentials,
  type InboundSms,
  SmsFailure,
  type SmsProvider,
  type SmsStatus,
  phoneOf,
  secretOf,
} from './provider.js'

/**
 * Twilio (D23): its Messages API to send, its webhooks to receive — signed with the
 * account's auth token (`X-Twilio-Signature`) —, and the media of a message, read with the
 * same account.
 *
 * RCS rides on SMS: a number whose messaging service (`MG…`) has an RCS sender writes by
 * RCS to a phone that reads it, by SMS to the others. A visitor who writes by RCS comes
 * from `rcs:+33…`.
 */

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

/** A form's fields, as Twilio posts them: strings. */
const fields = (payload: Readonly<Record<string, unknown>>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(payload).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )

const basic = (credentials: Credentials) =>
  `Basic ${Buffer.from(`${credentials.accountId}:${credentials.secret}`).toString('base64')}`

/** Twilio's word on a message, as the chat keeps it. */
const STATUSES: Readonly<Record<string, SmsStatus['status']>> = {
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
  undelivered: 'failed',
}

export const twilio: SmsProvider = {
  id: 'twilio',
  label: 'Twilio',

  credentials(number, env) {
    if (!number.accountSid) return 'ACCOUNT_MISSING'
    const secret = secretOf(number, env)
    if (!secret) return 'TOKEN_MISSING'
    return { accountId: number.accountSid, secret }
  },

  addresses(publicUrl, number) {
    const inbound = `${publicUrl}/channels/twilio/${number.id}`
    return { inbound, status: `${inbound}/status` }
  },

  authentic(call, credentials) {
    const params = fields(call.payload)
    if (
      !validTwilioSignature(
        credentials.secret,
        call.url,
        params,
        call.headers['x-twilio-signature'],
      )
    ) {
      return false
    }
    // Another account's message, signed with this token, is still not this number's.
    return !params.AccountSid || params.AccountSid === credentials.accountId
  },

  inbound(payload) {
    const params = fields(payload)
    const from = phoneOf(params.From ?? '')
    const providerId = params.MessageSid ?? params.SmsSid ?? ''
    if (!from || !providerId) return null
    const count = Math.min(Number(params.NumMedia ?? 0) || 0, 10)
    const media: InboundSms['media'][number][] = []
    for (let index = 0; index < count; index++) {
      const url = params[`MediaUrl${index}`]
      if (url) media.push({ url, type: params[`MediaContentType${index}`] ?? '' })
    }
    return { from: from.phone, rcs: from.rcs, body: params.Body ?? '', providerId, media }
  },

  status(payload) {
    const params = fields(payload)
    const status = STATUSES[params.MessageStatus ?? '']
    const providerId = params.MessageSid ?? params.SmsSid
    if (!status || !providerId) return null
    return {
      providerId,
      status,
      error: status === 'failed' ? `TWILIO_${params.ErrorCode || 'UNDELIVERED'}` : null,
      // Delivered by RCS, its sender is the RCS agent's: `rcs:…`.
      rcs: /^rcs:/i.test(params.From ?? ''),
    }
  },

  // A messaging service may write by RCS, which carries files; a bare number writes SMS,
  // which carries none in Europe.
  carriesFiles: (number) => Boolean(number.messagingServiceSid),

  async send(credentials, number, message, addresses, doFetch = fetch) {
    const form = new URLSearchParams({ To: message.to, Body: message.body })
    if (number.messagingServiceSid) form.set('MessagingServiceSid', number.messagingServiceSid)
    else if (number.phone) form.set('From', number.phone)
    for (const url of message.mediaUrls) form.append('MediaUrl', url)
    form.set('StatusCallback', addresses.status)
    let response: Response
    try {
      response = await doFetch(
        `${API}/Accounts/${encodeURIComponent(credentials.accountId ?? '')}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: basic(credentials),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: form.toString(),
          signal: AbortSignal.timeout(15_000),
        },
      )
    } catch {
      throw new SmsFailure('TWILIO_UNREACHABLE', true)
    }
    const answer = (await response.json().catch(() => ({}))) as {
      sid?: string
      code?: number
      from?: string | null
    }
    if (response.ok && answer.sid) {
      // A messaging service chooses later: its status calls say RCS.
      return { providerId: answer.sid, rcs: /^rcs:/i.test(answer.from ?? '') }
    }
    const retry = response.status === 429 || response.status >= 500
    throw new SmsFailure(answer.code ? `TWILIO_${answer.code}` : `HTTP_${response.status}`, retry)
  },

  async fetchMedia(credentials, url, maxBytes, doFetch: Fetch = fetch) {
    // Twilio's own addresses only: the account's credentials go nowhere else.
    if (!/^https:\/\/api\.twilio\.com\//.test(url)) return null
    try {
      // The media redirects to a signed address of Twilio's storage: followed, without the
      // credentials, which `fetch` drops across origins.
      const response = await doFetch(url, {
        headers: { Authorization: basic(credentials) },
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) return null
      if (Number(response.headers.get('content-length') ?? 0) > maxBytes) return null
      const bytes = new Uint8Array(await response.arrayBuffer())
      return bytes.length > 0 && bytes.length <= maxBytes ? bytes : null
    } catch {
      return null
    }
  },

  answer: {
    body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    type: 'text/xml; charset=utf-8',
  },
}
