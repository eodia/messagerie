import { LlmFailure } from '@chat/ai'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { failureOf, logError, quieted } from '../../src/log.js'
import { Refusal } from '../../src/refusal.js'

/** What the server writes when something fails: a line that says why, not a flood. */

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('a failure that comes back', () => {
  it('is said once in five minutes, then with how many times it came back', () => {
    vi.useFakeTimers()
    const lines: string[] = []
    const say = quieted()
    for (let i = 0; i < 4; i++) say('ai-answer 401', (again) => lines.push(`refusée${again}`))
    say('ai-answer 500', (again) => lines.push(`en panne${again}`))
    vi.advanceTimersByTime(5 * 60_000)
    say('ai-answer 401', (again) => lines.push(`refusée${again}`))
    expect(lines).toEqual(['refusée', 'en panne', 'refusée (et 3 fois depuis)'])
  })
})

describe('the cause', () => {
  it('names the provider’s status, or that it was not reached', () => {
    expect(failureOf(new LlmFailure(401, 'Unauthorized'))).toBe('IA HTTP 401 : Unauthorized')
    expect(failureOf(new LlmFailure(0, 'timeout'))).toBe('IA injoignable : timeout')
  })

  it('says what `fetch failed` hides', () => {
    const cause = Object.assign(new Error('unable to get local issuer certificate'), {
      code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    })
    expect(failureOf(new TypeError('fetch failed', { cause }))).toBe(
      'fetch failed (unable to get local issuer certificate UNABLE_TO_GET_ISSUER_CERT_LOCALLY)',
    )
  })
})

describe('an error answered by the server', () => {
  const answered = async (error: Error) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const app = new Hono()
    app.get('/api/auth/links/:token', () => {
      throw error
    })
    app.onError((e, c) => {
      logError(e, c)
      return c.text('', 500)
    })
    await app.request('/api/auth/links/s3cr3t-t0k3n')
    const lines = errors.mock.calls.map((call) => call.map(String).join(' '))
    errors.mockRestore()
    return lines
  }

  it('names the route, never the token in its path', async () => {
    const [line] = await answered(new Error('boom'))
    expect(line).toContain('chat : GET /api/auth/links/:token')
    expect(line).not.toContain('s3cr3t')
  })

  it('says a refusal of the server’s own with its cause, not a visitor’s mistake', async () => {
    const failure = new LlmFailure(503, 'overloaded')
    expect(await answered(new Refusal('AI_UNAVAILABLE', 503, undefined, failure))).toEqual([
      'chat : GET /api/auth/links/:token — 503 AI_UNAVAILABLE — IA HTTP 503 : overloaded',
    ])
    expect(await answered(new Refusal('LINK_INVALID', 404))).toEqual([])
    // No AI configured: a setting, not a failure.
    expect(await answered(new Refusal('AI_UNAVAILABLE', 503))).toEqual([])
  })
})
