import { createHmac } from 'node:crypto'
import type { Fetch } from '../outbound/push.js'
import type { SmsNumber } from '../settings/settings.js'

/**
 * What the chat needs of an SMS provider (D23) — Twilio, SMS Mode, the next one: its
 * credentials, the addresses it calls, how to tell its calls from anyone's, what they say,
 * and how to send. A provider is added here, in `providers.ts`, and to the choices of
 * « Fournisseur » in the model.
 */

/** The account a number sends with: its identifier, where the provider has one, and its secret. */
export interface Credentials {
  readonly accountId: string | null
  readonly secret: string
}

/** A message from a phone, as the chat keeps it. */
export interface InboundSms {
  /** `+33612345678`. */
  readonly from: string
  readonly rcs: boolean
  readonly body: string
  /** The provider's id of it: a call made twice writes it once. */
  readonly providerId: string
  /** Files the provider holds, read with the account. */
  readonly media: readonly { readonly url: string; readonly type: string }[]
}

/** What the provider says of a message it was given. */
export interface SmsStatus {
  readonly providerId: string
  readonly status: 'sent' | 'delivered' | 'read' | 'failed'
  /** Its code, when it failed: `TWILIO_21610`, `SMSMODE_UNDELIVERABLE`… */
  readonly error: string | null
  /** It went by RCS — the provider chose it over SMS. */
  readonly rcs?: boolean
}

/** A message the provider took: its id, and whether it goes by RCS — when known at once. */
export interface SentSms {
  readonly providerId: string
  readonly rcs: boolean
}

/** Where a provider calls the chat: a message that arrives, how a sent one went. */
export interface Addresses {
  readonly inbound: string
  readonly status: string
}

/** A call of a provider, as the route received it. */
export interface ProviderCall {
  /** The address it called, as the provider was given it: `CHAT_PUBLIC_URL` and the path. */
  readonly url: string
  readonly payload: Readonly<Record<string, unknown>>
  readonly headers: Readonly<Record<string, string | undefined>>
  /** The key the address carries, for a provider that signs nothing. */
  readonly key: string | null
}

export interface OutgoingSms {
  /** `+33612345678`. */
  readonly to: string
  readonly body: string
  /** Public addresses of files, for a provider and a number that carry them. */
  readonly mediaUrls: readonly string[]
}

/** Why a provider did not take a message — its code —, and whether to try again later. */
export class SmsFailure extends Error {
  constructor(
    readonly code: string,
    readonly retry: boolean,
  ) {
    super(code)
  }
}

export interface SmsProvider {
  readonly id: SmsNumber['provider']
  readonly label: string
  /** The number's credentials, or the code of what it lacks. */
  credentials(number: SmsNumber, env: NodeJS.ProcessEnv): Credentials | string
  addresses(publicUrl: string, number: SmsNumber, chatSecret: string): Addresses
  /** Whether a call is the provider's, for this number. */
  authentic(
    call: ProviderCall,
    credentials: Credentials,
    number: SmsNumber,
    chatSecret: string,
  ): boolean
  inbound(payload: Readonly<Record<string, unknown>>): InboundSms | null
  status(payload: Readonly<Record<string, unknown>>): SmsStatus | null
  /** Whether a message of this number carries files as files — else their links go in its words. */
  carriesFiles(number: SmsNumber): boolean
  /** Sends one message: the provider's id of it, and whether it went by RCS. Throws `SmsFailure`. */
  send(
    credentials: Credentials,
    number: SmsNumber,
    message: OutgoingSms,
    addresses: Addresses,
    fetch?: Fetch,
  ): Promise<SentSms>
  /** A file a visitor sent, read from the provider — `maxBytes` at most; null when it cannot be. */
  fetchMedia(
    credentials: Credentials,
    url: string,
    maxBytes: number,
    fetch?: Fetch,
  ): Promise<Uint8Array | null>
  /** What the chat answers a call that arrived. */
  readonly answer: { readonly body: string; readonly type: string }
}

/** The secret a number's addresses carry, for a provider that signs nothing — drawn from `CHAT_SECRET`. */
export const addressKey = (chatSecret: string, numberId: string): string =>
  createHmac('sha256', chatSecret).update(`sms-number:${numberId}`).digest('base64url').slice(0, 32)

/** A number as the chat keeps it — `+33612345678` — from what a provider writes, RCS or not. */
export function phoneOf(raw: string): { phone: string; rcs: boolean } | null {
  const rcs = /^rcs:/i.test(raw)
  let phone = raw.replace(/^(rcs|sms):/i, '').replace(/[\s.()-]/g, '')
  if (/^00[1-9]/.test(phone)) phone = `+${phone.slice(2)}`
  // Without its « + », an international number as some providers write it: 33612345678.
  if (/^[1-9]\d{9,14}$/.test(phone)) phone = `+${phone}`
  return /^\+[1-9]\d{6,14}$/.test(phone) ? { phone, rcs } : null
}

/** The secret, read from the variable a number names (D5) — `NAME` or `${NAME}`. */
export function secretOf(number: SmsNumber, env: NodeJS.ProcessEnv): string | null {
  const name = number.tokenEnv?.replace(/^\$\{(.+)\}$/, '$1')
  return (name && env[name]) || null
}
