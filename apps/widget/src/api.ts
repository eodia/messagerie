import type {
  ApiError,
  Ticket,
  VisitorConversation,
  WidgetEvent,
  WidgetSession,
} from '@chat/contracts'

/**
 * The widget's calls to the chat server — the one that served its script. The visitor's
 * token is kept in the page's storage, per site: the next visit finds the conversation.
 */

/** What the widget asks of a server: the chat server's API, or the editor's preview. */
export interface Backend {
  session(identity: string | null): Promise<WidgetSession>
  conversation(): Promise<VisitorConversation | null>
  send(body: string): Promise<VisitorConversation>
  follow(onEvent: (event: WidgetEvent) => void): () => void
}

export class WidgetFailure extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code)
  }
}

export class WidgetApi implements Backend {
  private token: string | null

  constructor(
    private readonly base: string,
    private readonly site: string,
  ) {
    this.token = this.stored()
  }

  private get key(): string {
    return `messagerie:${this.site}:visitor`
  }

  private stored(): string | null {
    try {
      return window.localStorage.getItem(this.key)
    } catch {
      return null
    }
  }

  private keep(token: string | null): void {
    this.token = token
    try {
      if (token) window.localStorage.setItem(this.key, token)
      else window.localStorage.removeItem(this.key)
    } catch {
      // Blocked storage: the visitor starts afresh on their next visit, nothing worse.
    }
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${this.base}/api/widget${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new WidgetFailure('UNREACHABLE', 0)
    }
    const data: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      throw new WidgetFailure((data as ApiError | null)?.code ?? 'INTERNAL_ERROR', response.status)
    }
    return data as T
  }

  /** Opens the session — anew when the kept token is no longer good. */
  async session(identity: string | null): Promise<WidgetSession> {
    const open = () =>
      this.call<WidgetSession>('POST', '/session', {
        site: this.site,
        ...(this.token ? { visitor: this.token } : {}),
        ...(identity ? { identity } : {}),
      })
    const session = await open()
    this.keep(session.visitor)
    return session
  }

  conversation(): Promise<VisitorConversation | null> {
    return this.call('GET', '/conversation')
  }

  send(body: string): Promise<VisitorConversation> {
    return this.call('POST', '/messages', { body })
  }

  /**
   * Follows the visitor's conversation: `onEvent` for each signal, reconnecting after a
   * drop with a pause that grows to thirty seconds. Returns what stops it.
   */
  follow(onEvent: (event: WidgetEvent) => void): () => void {
    let stopped = false
    let socket: WebSocket | null = null
    let delay = 1000
    let timer: ReturnType<typeof setTimeout> | undefined

    const again = () => {
      if (stopped) return
      timer = setTimeout(connect, delay)
      delay = Math.min(delay * 2, 30_000)
    }

    const connect = async () => {
      if (stopped) return
      let ticket: string
      try {
        ;({ ticket } = await this.call<Ticket>('POST', '/ticket'))
      } catch {
        again()
        return
      }
      const url = `${this.base.replace(/^http/, 'ws')}/api/widget/events?ticket=${encodeURIComponent(ticket)}`
      const next = new WebSocket(url)
      socket = next
      next.onopen = () => {
        delay = 1000
        // Whatever was said while the socket was down came with no signal.
        onEvent({ type: 'conversation' })
      }
      next.onmessage = (message) => onEvent(JSON.parse(String(message.data)) as WidgetEvent)
      next.onclose = () => {
        if (socket === next) again()
      }
    }

    void connect()
    return () => {
      stopped = true
      clearTimeout(timer)
      socket?.close()
    }
  }
}
