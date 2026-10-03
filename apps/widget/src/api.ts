import type {
  ApiError,
  PageActionResultBody,
  PageSnapshot,
  Ticket,
  VisitorConversation,
  WidgetEvent,
  WidgetSession,
} from '@chat/contracts'
import type { Data, Profile } from './page-api'

/**
 * The widget's calls to the chat server — the one that served its script. The visitor's
 * token is kept in the page's storage, per site: the next visit finds the conversation.
 */

/** What the widget asks of a server: the chat server's API, or the editor's preview. */
export interface Backend {
  session(identity: string | null): Promise<WidgetSession>
  conversation(): Promise<VisitorConversation | null>
  /** With the metadata the page set for the conversation before it began, and the page. */
  send(body: string, data?: Data, page?: PageSnapshot): Promise<VisitorConversation>
  /** Files, with or without words. */
  sendFiles(files: readonly File[], body: string): Promise<VisitorConversation>
  /** A file's address, from the path the server signed. */
  fileUrl(path: string): string
  follow(onEvent: (event: WidgetEvent) => void): () => void
  /** The visitor is typing — the team sees it. Said at most every two seconds. */
  typing(): void
  /** `MessagerieChat.setUser`, `setContactData`. */
  updateContact(change: Profile & { readonly data?: Data }): Promise<void>
  /** `MessagerieChat.setConversationData`, once the conversation has begun. */
  updateConversation(data: Data): Promise<void>
  /** `MessagerieChat.reset()`: the current conversation left — the next message opens another. */
  resetConversation(): Promise<void>
  /** `reset({ visitor: true })`: the visitor's token forgotten — the next session, a stranger's. */
  forgetVisitor(): void
  /** The address left in the « Laissez-nous votre e-mail » card. */
  leaveEmail(email: string): Promise<void>
  /** Takes an action the AI asked of the page, to run it here — `false`: another tab did. */
  claimAction(id: string, tab: string): Promise<boolean>
  answerAction(id: string, tab: string, answer: PageActionResultBody): Promise<void>
  /** The visitor declines an action to accept. */
  refuseAction(id: string): Promise<void>
}

export class WidgetFailure extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code)
  }
}

/** The browser's time zone — where the visitor is, roughly (D18) —, or nothing. */
function timeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    return undefined
  }
}

export class WidgetApi implements Backend {
  private token: string | null
  /** The socket `follow` holds open — the way back for « I am typing ». */
  private socket: WebSocket | null = null
  private typedAt = 0

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
      // A form says its own type, with the boundary of its parts.
      const form = body instanceof FormData
      response = await fetch(`${this.base}/api/widget${path}`, {
        method,
        headers: {
          ...(body === undefined || form ? {} : { 'content-type': 'application/json' }),
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        body: body === undefined ? undefined : form ? body : JSON.stringify(body),
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
        ...(timeZone() ? { timeZone: timeZone() } : {}),
      })
    const session = await open()
    this.keep(session.visitor)
    return session
  }

  conversation(): Promise<VisitorConversation | null> {
    return this.call('GET', '/conversation')
  }

  send(body: string, data?: Data, page?: PageSnapshot): Promise<VisitorConversation> {
    return this.call('POST', '/messages', {
      body,
      ...(data ? { data } : {}),
      ...(page ? { page } : {}),
    })
  }

  async claimAction(id: string, tab: string): Promise<boolean> {
    const { taken } = await this.call<{ taken: boolean }>('POST', `/actions/${id}/claim`, { tab })
    return taken
  }

  async answerAction(id: string, tab: string, answer: PageActionResultBody): Promise<void> {
    await this.call('POST', `/actions/${id}/result`, { tab, ...answer })
  }

  async refuseAction(id: string): Promise<void> {
    await this.call('POST', `/actions/${id}/refuse`, {})
  }

  sendFiles(files: readonly File[], body: string): Promise<VisitorConversation> {
    const form = new FormData()
    for (const file of files) form.append('file', file, file.name)
    form.append('body', body)
    return this.call('POST', '/attachments', form)
  }

  fileUrl(path: string): string {
    return `${this.base}${path}`
  }

  async updateContact(change: Profile & { readonly data?: Data }): Promise<void> {
    await this.call('PATCH', '/contact', change)
  }

  async updateConversation(data: Data): Promise<void> {
    await this.call('PATCH', '/conversation', { data })
  }

  async resetConversation(): Promise<void> {
    if (this.token) await this.call('POST', '/conversation/reset')
  }

  forgetVisitor(): void {
    this.keep(null)
  }

  async leaveEmail(email: string): Promise<void> {
    await this.call('POST', '/email', { email })
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
    // The page this tab shows, said to the server once the socket is open and each time it
    // changes — its address or its title, a site of one page included (D21).
    let said = ''
    const sayPage = () => {
      if (socket?.readyState !== WebSocket.OPEN) return
      const page = { type: 'page', url: window.location.href, title: document.title }
      const text = JSON.stringify(page)
      if (text === said) return
      said = text
      socket.send(text)
    }
    const watching = setInterval(sayPage, 1500)
    window.addEventListener('popstate', sayPage)
    window.addEventListener('hashchange', sayPage)

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
      this.socket = next
      next.onopen = () => {
        delay = 1000
        // Whatever was said while the socket was down came with no signal.
        onEvent({ type: 'conversation' })
        // A new socket is a new tab for the server: the page, again.
        said = ''
        sayPage()
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
      clearInterval(watching)
      window.removeEventListener('popstate', sayPage)
      window.removeEventListener('hashchange', sayPage)
      socket?.close()
      if (this.socket === socket) this.socket = null
    }
  }

  typing(): void {
    const now = Date.now()
    if (now - this.typedAt < 2000 || this.socket?.readyState !== WebSocket.OPEN) return
    this.typedAt = now
    this.socket.send(JSON.stringify({ type: 'typing' }))
  }
}
