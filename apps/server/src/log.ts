import { LlmFailure } from '@chat/ai'
import type { Context } from 'hono'
import { routePath } from 'hono/route'
import { Refusal } from './refusal.js'

const QUIET_MS = 5 * 60_000

/**
 * A failure that comes back is said once every five minutes, with how many times it came
 * back meanwhile: an outage is a line now and then, not one per conversation. The keys
 * name a cause (a queue and a status, a server), never a conversation: they stay few.
 */
export function quieted(quietMs = QUIET_MS): (key: string, say: (again: string) => void) => void {
  const said = new Map<string, { at: number; again: number }>()
  return (key, say) => {
    const now = Date.now()
    const last = said.get(key)
    if (last && now - last.at < quietMs) {
      last.again++
      return
    }
    say(last?.again ? ` (et ${last.again} fois depuis)` : '')
    said.set(key, { at: now, again: 0 })
  }
}

/**
 * A provider's failure in one line — no stack: it is not the server's fault. With what
 * `fetch failed` hides: the refused certificate, the unknown host, the closed port.
 */
export function failureOf(error: unknown): string {
  if (error instanceof LlmFailure) {
    return `IA ${error.status === 0 ? 'injoignable' : `HTTP ${error.status}`} : ${error.message.slice(0, 300)}`
  }
  if (!(error instanceof Error)) return String(error)
  const cause = error.cause instanceof Error ? error.cause : null
  const code = cause && 'code' in cause ? ` ${cause.code}` : ''
  return cause ? `${error.message} (${cause.message}${code})` : error.message
}

const refused = quieted()

/**
 * What `onError` writes: a refusal of the server's own (5xx), with its cause, once in a
 * while; any other error, with its stack. The route's pattern, not its path: a path may
 * carry a token (`/api/auth/links/:token`).
 */
export function logError(error: unknown, c: Context): void {
  const route = `${c.req.method} ${routePath(c, -1) || c.req.path}`
  if (!(error instanceof Refusal)) {
    console.error(`chat : ${route}`, error)
    return
  }
  // No AI configured is a setting, not a failure: only a provider that failed is said.
  if (error.status < 500 || (error.code === 'AI_UNAVAILABLE' && error.cause === undefined)) return
  refused(`${route} ${error.code}`, (again) =>
    console.error(
      `chat : ${route} — ${error.status} ${error.code}${error.cause === undefined ? '' : ` — ${failureOf(error.cause)}`}${again}`,
    ),
  )
}
