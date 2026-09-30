/**
 * The agent's access token, from their basedb session (D4, B2).
 *
 * basedb hands an access token to the page that holds its session: `POST
 * /auth/session/access`, with the session cookie and, in `X-Basedb-Csrf`, the value of the
 * CSRF cookie. That cookie is readable by the scripts of basedb's HOST, and of no other:
 * the inbox must be served on the same host as basedb — another path, or another port in
 * development (cookies ignore ports). Elsewhere, no token can be had, by design.
 *
 * The token lives fifteen minutes; it is kept in memory and asked again a minute before.
 */

const CSRF_COOKIE = '__Host-basedb_csrf'

let basedbApi: string | null = null
let held: { token: string; expires: number } | null = null
let pending: Promise<string> | null = null

/** Not signed in to basedb, or the inbox is not on basedb's host. */
export class SignedOut extends Error {
  constructor() {
    super('SIGNED_OUT')
  }
}

export function configureBasedbSession(url: string | null): void {
  basedbApi = url ? url.replace(/\/+$/, '') : null
}

/** Whether the inbox authenticates through basedb — or runs without it, in development. */
export const usesBasedb = (): boolean => basedbApi !== null

function readCookie(name: string): string | null {
  const found = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null
}

/** The token to send the chat server, or null when the inbox runs without basedb. */
export async function accessToken(): Promise<string | null> {
  if (basedbApi === null) return null
  if (held && held.expires - 60_000 > Date.now()) return held.token
  pending ??= fetchToken(basedbApi).finally(() => {
    pending = null
  })
  return pending
}

/** The token the chat server refused: basedb is asked again next time. */
export function forgetToken(): void {
  held = null
}

async function fetchToken(api: string): Promise<string> {
  const csrf = readCookie(CSRF_COOKIE)
  if (csrf === null) throw new SignedOut()
  let response: Response
  try {
    response = await fetch(`${api}/auth/session/access`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'x-basedb-csrf': csrf },
    })
  } catch {
    throw new SignedOut()
  }
  if (!response.ok) throw new SignedOut()
  const { data } = (await response.json()) as { data: { token: string; expires_at: string } }
  held = { token: data.token, expires: Date.parse(data.expires_at) }
  return data.token
}
