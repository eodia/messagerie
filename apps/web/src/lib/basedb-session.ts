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

/**
 * basedb refused a sign-in or a password: its code (`CREDENTIALS_INVALID`…) or
 * `UNREACHABLE`, and for a password the policy's reason (`trop_court`…).
 */
export class SignInFailure extends Error {
  constructor(
    readonly code: string,
    readonly reason: string | null = null,
  ) {
    super(code)
  }
}

async function failureOf(response: Response): Promise<SignInFailure> {
  const body = (await response.json().catch(() => null)) as {
    code?: string
    details?: { reason?: string }
  } | null
  return new SignInFailure(body?.code ?? 'CREDENTIALS_INVALID', body?.details?.reason ?? null)
}

/**
 * Signs in to basedb from the inbox's own form — basedb's sign-in, not a copy of it: its
 * session cookies are set for the host, so the inbox and basedb share one session, and the
 * agent's token comes from it as before.
 */
export async function signIn(email: string, password: string): Promise<void> {
  if (basedbApi === null) return
  let response: Response
  try {
    response = await fetch(`${basedbApi}/auth/password/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
  } catch {
    throw new SignInFailure('UNREACHABLE')
  }
  if (!response.ok) throw await failureOf(response)
  held = null
}

/**
 * Whether basedb asks for a new password — an account created with a temporary one. Its
 * interface asks for it at the first sign-in; the inbox does too.
 */
export async function mustChangePassword(): Promise<boolean> {
  if (basedbApi === null) return false
  const response = await fetch(`${basedbApi}/auth/me`, { credentials: 'include' }).catch(() => null)
  if (!response?.ok) return false
  const { data } = (await response.json()) as { data: { must_change_password?: boolean } }
  return data.must_change_password === true
}

/** Chooses one's password; basedb keeps this session and closes the others. */
export async function changePassword(current: string, next: string): Promise<void> {
  if (basedbApi === null) return
  let response: Response
  try {
    response = await fetch(`${basedbApi}/auth/password/change`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ current, next }),
    })
  } catch {
    throw new SignInFailure('UNREACHABLE')
  }
  if (!response.ok) throw await failureOf(response)
  held = null
}

/** Ends the basedb session — the inbox's and basedb's, which are one. */
export async function signOut(): Promise<void> {
  held = null
  if (basedbApi === null) return
  await fetch(`${basedbApi}/auth/session`, { method: 'DELETE', credentials: 'include' }).catch(
    () => {},
  )
}

export interface SsoProvider {
  readonly slug: string
  readonly label: string
  /** Where the button goes: basedb's sign-in with the provider, back to this page. */
  readonly href: string
}

/**
 * The single sign-on basedb offers. basedb only sends a sign-in back to an address of its
 * own: the buttons show where the inbox shares basedb's address (D4), not elsewhere.
 */
export async function ssoProviders(): Promise<SsoProvider[]> {
  if (basedbApi === null || new URL(basedbApi).origin !== window.location.origin) return []
  const response = await fetch(`${basedbApi}/auth/oidc/providers`).catch(() => null)
  if (!response?.ok) return []
  const { data } = (await response.json()) as { data: { slug: string; label: string }[] }
  const back = encodeURIComponent(window.location.pathname)
  return data.map(({ slug, label }) => ({
    slug,
    label,
    href: `${basedbApi}/auth/oidc/${encodeURIComponent(slug)}/start?return_to=${back}`,
  }))
}

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
