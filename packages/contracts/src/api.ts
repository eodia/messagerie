import type { ConversationSummary, Feedback } from './inbox.js'

/**
 * What goes over the wire between the inbox and the chat server: request bodies, the
 * error shape, and the events of the WebSocket.
 */

/** Every refusal: a stable code the interface turns into a sentence, never a sentence. */
export interface ApiError {
  readonly code: ErrorCode
  readonly details?: Readonly<Record<string, unknown>>
}

export type ErrorCode =
  | 'AUTH_NOT_CONFIGURED'
  | 'NOT_AN_AGENT'
  | 'CONVERSATION_NOT_FOUND'
  | 'MESSAGE_NOT_FOUND'
  | 'NOT_AN_AI_ANSWER'
  | 'CONVERSATION_RESOLVED'
  | 'EMPTY_MESSAGE'
  | 'INVALID_REQUEST'
  | 'INTERNAL_ERROR'

export interface SendMessageBody {
  readonly body: string
  /** `reply` reaches the visitor; `note` stays with the team. */
  readonly kind: 'reply' | 'note'
  /** Resolve the conversation once the reply is sent. */
  readonly resolve?: boolean
}

export interface FeedbackBody {
  /** `null` withdraws the agent's verdict. */
  readonly action: Feedback | null
}

/**
 * The inbox's WebSocket: signals, not state. A conversation that changed comes with its
 * new summary; a client that has its thread open reads it again (GET), as basedb's live
 * stream does — one path to the truth, whatever the event.
 */
export type InboxEvent =
  | { readonly type: 'conversation'; readonly summary: ConversationSummary }
  | { readonly type: 'ping' }
