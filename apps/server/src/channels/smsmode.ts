import { timingSafeEqual } from 'node:crypto'
import type { Fetch } from '../outbound/push.js'
import {
  type Credentials,
  SmsFailure,
  type SmsProvider,
  type SmsStatus,
  addressKey,
  phoneOf,
  secretOf,
} from './provider.js'

/**
 * SMS Mode (D23), a French provider: its REST API to send (`/sms/v1/messages`, the key in
 * `X-Api-Key`), and the addresses each message gives for what comes back — a reply
 * (`callbackUrlMo`) and how it went (`callbackUrlStatus`). SMS Mode signs nothing: its
 * addresses carry a key drawn from `CHAT_SECRET`, which a call must bring.
 *
 * A number set to « Envoyer en RCS » writes through the RCS API (`/rcs/v1/messages`, the
 * account's RCS agent) first; a message that API refuses goes by SMS at once.
 *
 * What it posts is read leniently — a field under one name or another, in JSON or as a
 * form —: what is not understood is refused, never guessed.
 */

const API = 'https://rest.smsmode.com/sms/v1/messages'
const RCS_API = 'https://rest.smsmode.com/rcs/v1/messages'

const str = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''

const obj = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

/** The call's own fields — under `data`, for a provider that wraps them. */
const fieldsOf = (payload: Readonly<Record<string, unknown>>) =>
  Object.keys(obj(payload.data)).length > 0 ? obj(payload.data) : payload

const idOf = (p: Readonly<Record<string, unknown>>) =>
  str(p.messageId) || str(p.id) || str(p.moId) || str(p.smsID) || str(p.smsId)

/** SMS Mode's words on a message, as the chat keeps them. */
const STATUSES: Readonly<Record<string, SmsStatus['status']>> = {
  SCHEDULED: 'sent',
  ENROUTE: 'sent',
  SENT: 'sent',
  ACCEPTED: 'sent',
  DELIVERED: 'delivered',
  RECEIVED: 'delivered',
  UNDELIVERABLE: 'failed',
  UNDELIVERED: 'failed',
  REJECTED: 'failed',
  EXPIRED: 'failed',
  ERROR: 'failed',
  FAILED: 'failed',
  CANCELLED: 'failed',
}

/** A message SMS Mode says went, or came, by RCS. */
const isRcs = (p: Readonly<Record<string, unknown>>): boolean =>
  /rcs/i.test(str(p.channel) || str(p.channelType) || str(p.type)) ||
  /^rcs:/i.test(str(p.from) || str(obj(p.recipient).to))

/** One request to SMS Mode's API: the id of the message it took. Throws `SmsFailure`. */
async function post(
  doFetch: Fetch,
  url: string,
  credentials: Credentials,
  request: Readonly<Record<string, unknown>>,
): Promise<string> {
  let response: Response
  try {
    response = await doFetch(url, {
      method: 'POST',
      headers: {
        'X-Api-Key': credentials.secret,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new SmsFailure('SMSMODE_UNREACHABLE', true)
  }
  const answer = obj(await response.json().catch(() => ({})))
  const id = idOf(answer)
  if (response.ok && id) return id
  if (response.ok) throw new SmsFailure('SMSMODE_NO_ID', false)
  const retry = response.status === 429 || response.status >= 500
  throw new SmsFailure(`SMSMODE_${response.status}`, retry)
}

export const smsmode: SmsProvider = {
  id: 'smsmode',
  label: 'SMS Mode',

  credentials(number, env) {
    const secret = secretOf(number, env)
    return secret ? { accountId: null, secret } : 'TOKEN_MISSING'
  },

  addresses(publicUrl, number, chatSecret) {
    const inbound = `${publicUrl}/channels/smsmode/${number.id}/${addressKey(chatSecret, number.id)}`
    return { inbound, status: `${inbound}/status` }
  },

  authentic(call, _credentials, number, chatSecret) {
    const wanted = Buffer.from(addressKey(chatSecret, number.id))
    const given = Buffer.from(call.key ?? '')
    return wanted.length === given.length && timingSafeEqual(wanted, given)
  },

  inbound(payload) {
    const p = fieldsOf(payload)
    const body = obj(p.body)
    const from = phoneOf(
      str(p.from) ||
        str(p.originator) ||
        str(p.emetteur) ||
        str(p.numero) ||
        str(obj(p.recipient).from),
    )
    const providerId = idOf(p)
    if (!from || !providerId) return null
    const text = str(body.text) || str(p.text) || str(p.message) || str(p.body)
    return { from: from.phone, rcs: isRcs(p), body: text, providerId, media: [] }
  },

  status(payload) {
    const p = fieldsOf(payload)
    const value = (str(obj(p.status).value) || str(p.status) || str(p.statut)).toUpperCase()
    const status = STATUSES[value]
    const providerId = idOf(p)
    if (!status || !providerId) return null
    return {
      providerId,
      status,
      error: status === 'failed' ? `SMSMODE_${value}` : null,
      rcs: isRcs(p),
    }
  },

  carriesFiles: () => false,

  async send(credentials, number, message, addresses, doFetch = fetch) {
    // The number as SMS Mode writes it: international, without its « + ».
    const to = message.to.replace(/^\+/, '')
    const callbacks = { callbackUrlStatus: addresses.status, callbackUrlMo: addresses.inbound }
    if (number.rcs) {
      try {
        const providerId = await post(doFetch, RCS_API, credentials, {
          recipient: { to },
          body: { type: 'TEXT', text: message.body },
          ...callbacks,
        })
        return { providerId, rcs: true }
      } catch (error) {
        // Refused — no RCS for this phone, or for this account —: by SMS. A failure that
        // may pass is tried again later, by RCS still.
        if (!(error instanceof SmsFailure) || error.retry) throw error
      }
    }
    const request: Record<string, unknown> = {
      recipient: { to },
      body: { text: message.body },
      ...callbacks,
    }
    if (number.sender) request.from = number.sender
    return { providerId: await post(doFetch, API, credentials, request), rcs: false }
  },

  // SMS carries no file: its links go in the words.
  fetchMedia: async () => null,

  answer: { body: '', type: 'text/plain; charset=utf-8' },
}
