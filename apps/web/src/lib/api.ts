import type {
  Agent,
  ApiError,
  Conversation,
  ConversationSummary,
  ErrorCode,
  FeedbackBody,
  SendMessageBody,
} from '@chat/contracts'

/**
 * The one module that talks to the chat server. The address is handed over at run time
 * by the layout (`CHAT_API_URL`), never frozen into the bundle at build time.
 */

let base = 'http://localhost:8810'

export function configureApi(url: string): void {
  base = url.replace(/\/+$/, '')
}

export const apiAddress = (): string => base

/** The inbox's WebSocket, on the same host as the API. */
export const eventsUrl = (): string => `${base.replace(/^http/, 'ws')}/api/inbox/events`

/** A refusal of the server — or `UNREACHABLE` when no answer came at all. */
export class ApiFailure extends Error {
  constructor(
    readonly code: ErrorCode | 'UNREACHABLE',
    readonly status: number,
  ) {
    super(code)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${base}/api/inbox${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiFailure('UNREACHABLE', 0)
  }
  if (response.status === 204) return undefined as T
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiFailure((data as ApiError | null)?.code ?? 'INTERNAL_ERROR', response.status)
  }
  return data as T
}

const conversation = (id: string) => `/conversations/${encodeURIComponent(id)}`

export const api = {
  me: () => request<Agent>('GET', '/me'),
  conversations: () => request<ConversationSummary[]>('GET', '/conversations'),
  conversation: (id: string) => request<Conversation>('GET', conversation(id)),
  markRead: (id: string) => request<void>('POST', `${conversation(id)}/read`),
  send: (id: string, body: SendMessageBody) =>
    request<Conversation>('POST', `${conversation(id)}/messages`, body),
  takeOver: (id: string) => request<Conversation>('POST', `${conversation(id)}/takeover`),
  resolve: (id: string) => request<Conversation>('POST', `${conversation(id)}/resolve`),
  feedback: (id: string, messageId: string, body: FeedbackBody) =>
    request<Conversation>(
      'PUT',
      `${conversation(id)}/messages/${encodeURIComponent(messageId)}/feedback`,
      body,
    ),
}
