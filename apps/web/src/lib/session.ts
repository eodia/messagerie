import type {
  ApiError,
  AuthState,
  ChangePasswordBody,
  LinkInfo,
  SetupBody,
  SignInBody,
} from '@chat/contracts'

/**
 * Signing in (D19): the chat server's `/api/auth`, the session a cookie it sets — never
 * read here. Every request sends it (`credentials: 'include'`) and the header that says it
 * comes from the inbox's own pages, which a page elsewhere cannot add.
 */

export const REQUEST_HEADER = 'x-chat-request'

let base = 'http://localhost:8810'

export function configureSession(url: string): void {
  base = url.replace(/\/+$/, '')
}

/** A refusal of `/api/auth`, by its code. */
export class AuthFailure extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code)
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${base}/api/auth${path}`, {
      method,
      credentials: 'include',
      headers: {
        [REQUEST_HEADER]: '1',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new AuthFailure('UNREACHABLE', 0)
  }
  if (response.status === 204) return undefined as T
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new AuthFailure((data as ApiError | null)?.code ?? 'INTERNAL_ERROR', response.status)
  }
  return data as T
}

export const authState = () => call<AuthState>('GET', '/state')
export const signIn = (body: SignInBody) => call<void>('POST', '/sign-in', body)
export const setUp = (body: SetupBody) => call<void>('POST', '/setup', body)
export const signOut = () => call<void>('POST', '/sign-out', {})
export const changePassword = (body: ChangePasswordBody) => call<void>('POST', '/password', body)
export const linkInfo = (token: string) =>
  call<LinkInfo>('GET', `/links/${encodeURIComponent(token)}`)
export const redeemLink = (token: string, password: string) =>
  call<void>('POST', `/links/${encodeURIComponent(token)}`, { password })

/** Where the identity provider's sign-in starts — a page left for theirs, then back. */
export const ssoStart = (next: string) =>
  `${base}/api/auth/oidc/start?next=${encodeURIComponent(next)}`
