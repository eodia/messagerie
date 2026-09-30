import type { ErrorCode } from '@chat/contracts'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

/**
 * A request the server declines, with a stable code the interface turns into a sentence
 * — as basedb's error registry does. Thrown anywhere, answered by `app.onError`.
 */
export class Refusal extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: ContentfulStatusCode,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(code)
  }
}
