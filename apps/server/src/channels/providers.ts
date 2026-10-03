import type { SmsNumber } from '../settings/settings.js'
import type { Credentials, SmsProvider } from './provider.js'
import { smsmode } from './smsmode.js'
import { twilio } from './twilio.js'

/** The SMS providers the chat speaks to (D23), by their id in « Fournisseur ». */
export const PROVIDERS: Readonly<Record<SmsNumber['provider'], SmsProvider>> = { twilio, smsmode }

export const providerOf = (number: SmsNumber): SmsProvider => PROVIDERS[number.provider]

/** A number that may send and receive: active, with its credentials — or the code of what it lacks. */
export function ready(
  number: SmsNumber | null,
  env: NodeJS.ProcessEnv,
): { number: SmsNumber; provider: SmsProvider; credentials: Credentials } | string {
  if (!number || !number.active) return 'NUMBER_UNAVAILABLE'
  const provider = providerOf(number)
  const credentials = provider.credentials(number, env)
  return typeof credentials === 'string' ? credentials : { number, provider, credentials }
}
