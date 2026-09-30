import type { BasedbConfig } from '../config.js'

/**
 * What the chat asks of basedb, over its public API only (D2) — basedb 0.5.0 or later:
 * token introspection (RFC 7662), the description of the « Messagerie » base, its rows,
 * and the live stream of a table. Always with the chat's integration token.
 */

/** RFC 7662's answer, as basedb fills it (basedb, chapter 13 §11). */
export type Introspection =
  | { readonly active: false }
  | {
      readonly active: true
      readonly token_type: 'access_token' | 'integration_token'
      /** The account — the value a « Personne » field holds. */
      readonly sub: string
      readonly name?: string
      readonly email?: string
      readonly tenant: string
      readonly groups?: readonly string[]
      /** Seconds since the epoch. */
      readonly exp?: number
    }

export interface BaseDescription {
  readonly name: string
  readonly tables: readonly TableDescription[]
}

export interface TableDescription {
  readonly name: string
  readonly label: string
  readonly fields: readonly {
    readonly name: string
    readonly label: string
    readonly kind: string
    readonly options?: readonly { readonly value: string; readonly label: string }[]
  }[]
}

export type Row = Readonly<Record<string, unknown>> & { readonly _id: string }

/** basedb answered with a refusal, or did not answer. */
export class BasedbFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`basedb: ${status} ${code}`)
  }
}

export class BasedbClient {
  constructor(
    private readonly config: BasedbConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.config.url}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${this.config.token}`, ...init.headers },
      })
    } catch {
      throw new BasedbFailure(0, 'UNREACHABLE')
    }
    const body: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const code = (body as { code?: unknown } | null)?.code
      throw new BasedbFailure(response.status, typeof code === 'string' ? code : 'UNKNOWN')
    }
    return body as T
  }

  /** Whether a token handed to the chat is good, and whose it is. Never cached by basedb. */
  introspect(token: string): Promise<Introspection> {
    return this.call<Introspection>('/auth/introspect', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    })
  }

  private data(path: string): string {
    const { tenant, base } = this.config
    return `/api/v1/${encodeURIComponent(tenant)}${path.replace('{base}', encodeURIComponent(base))}`
  }

  /** The base as the token sees it: its tables and fields, labels with physical names. */
  async describe(): Promise<BaseDescription> {
    const { data } = await this.call<{ data: BaseDescription }>(this.data('/meta/bases/{base}'))
    return data
  }

  /**
   * Every row of a table that passes `filter`, page after page — relations as the ids of
   * the rows they point at.
   */
  async rows(table: string, filter?: string): Promise<Row[]> {
    const rows: Row[] = []
    let after: string | undefined
    do {
      const query = new URLSearchParams({ limit: '500', links: 'id' })
      if (filter) query.set('filter', filter)
      if (after) query.set('after', after)
      const page = await this.call<{
        data: Row[]
        meta?: { next_cursor?: string | null; has_next_page?: boolean }
      }>(this.data(`/data/{base}/${encodeURIComponent(table)}?${query}`))
      rows.push(...page.data)
      after = page.meta?.has_next_page ? (page.meta.next_cursor ?? undefined) : undefined
    } while (after)
    return rows
  }

  /** Creates a row — values by physical name. Needs a token issued with write access. */
  async create(table: string, values: Readonly<Record<string, unknown>>): Promise<Row> {
    const { data } = await this.call<{ data: Row }>(
      this.data(`/data/{base}/${encodeURIComponent(table)}`),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ values }),
      },
    )
    return data
  }

  /**
   * Changes a row — values by physical name — as `token`'s owner when given: basedb then
   * applies that person's rights and keeps their name in the row's history.
   */
  async update(
    table: string,
    id: string,
    values: Readonly<Record<string, unknown>>,
    token?: string,
  ): Promise<Row> {
    const { data } = await this.call<{ data: Row }>(
      this.data(`/data/{base}/${encodeURIComponent(table)}/${encodeURIComponent(id)}`),
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ values }),
      },
    )
    return data
  }

  /**
   * Follows a table's changes — signals, never values: `onChange` is told that rows
   * changed, and reads them again. basedb closes a stream after thirty minutes and on a
   * revoked token; it is reopened, with a pause that grows up to thirty seconds.
   */
  follow(
    table: string,
    onChange: () => void,
    onError: (error: unknown) => void = () => {},
  ): () => void {
    let stopped = false
    let controller: AbortController | null = null
    let delay = 1000

    const open = async (): Promise<void> => {
      while (!stopped) {
        controller = new AbortController()
        try {
          const query = new URLSearchParams({ base: this.config.base, table })
          const response = await this.fetchImpl(
            `${this.config.url}${this.data(`/events?${query}`)}`,
            {
              headers: {
                authorization: `Bearer ${this.config.token}`,
                accept: 'text/event-stream',
              },
              signal: controller.signal,
            },
          )
          if (!response.ok || !response.body) {
            throw new BasedbFailure(response.status, 'EVENTS_REFUSED')
          }
          delay = 1000
          // Whatever changed while the stream was down came with no signal.
          onChange()
          await readEvents(response.body, (event) => {
            if (event === 'records') onChange()
          })
        } catch (error) {
          if (stopped) return
          onError(error)
        }
        if (stopped) return
        await new Promise((done) => setTimeout(done, delay))
        delay = Math.min(delay * 2, 30_000)
      }
    }

    void open()
    return () => {
      stopped = true
      controller?.abort()
    }
  }
}

/** Reads a server-sent event stream, calling `onEvent` with each event's name. */
async function readEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string) => void,
): Promise<void> {
  const decoder = new TextDecoder()
  let buffer = ''
  let event = 'message'
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    let end = buffer.indexOf('\n')
    while (end !== -1) {
      const line = buffer.slice(0, end).replace(/\r$/, '')
      buffer = buffer.slice(end + 1)
      if (line === '') {
        onEvent(event)
        event = 'message'
      } else if (line.startsWith('event:')) {
        event = line.slice(6).trim()
      }
      end = buffer.indexOf('\n')
    }
  }
}
