import type { AlertKind, ConversationSummary, Feedback } from './inbox.js'

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
  /** No token, or one basedb no longer vouches for: sign in to basedb again. */
  | 'SESSION_INVALID'
  | 'NOT_AN_AGENT'
  | 'TICKET_INVALID'
  | 'BASEDB_UNREACHABLE'
  /** The « Messagerie » base lacks a table or field the chat reads (`details.missing`). */
  | 'SETTINGS_MISMATCH'
  | 'CONVERSATION_NOT_FOUND'
  | 'MESSAGE_NOT_FOUND'
  | 'AGENT_NOT_FOUND'
  | 'NOT_AN_AI_ANSWER'
  | 'CONVERSATION_RESOLVED'
  | 'EMPTY_MESSAGE'
  | 'INVALID_REQUEST'
  | 'INTERNAL_ERROR'
  /** The widget: a site that does not exist, is inactive, or does not allow this page. */
  | 'SITE_NOT_FOUND'
  | 'ORIGIN_NOT_ALLOWED'
  | 'VISITOR_INVALID'
  | 'IDENTITY_INVALID'
  | 'RATE_LIMITED'
  /** No model is configured (CHAT_AI_API_KEY). */
  | 'AI_UNAVAILABLE'

/** Opens the inbox's WebSocket, once, within thirty seconds. */
export interface Ticket {
  readonly ticket: string
}

export interface SendMessageBody {
  readonly body: string
  /** `reply` reaches the visitor; `note` stays with the team. */
  readonly kind: 'reply' | 'note'
  /** Resolve the conversation once the reply is sent. */
  readonly resolve?: boolean
}

export interface AssignBody {
  /** An agent's id; `null` puts the conversation back in the queue. */
  readonly assigneeId: string | null
}

/** Without a conversation, every notification of the agent is marked read. */
export interface ReadNotificationsBody {
  readonly conversationId?: string
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
  | {
      readonly type: 'conversation'
      readonly summary: ConversationSummary
      /** Set when the change calls for attention; the inbox decides whether it is the reader's. */
      readonly alert?: AlertKind
    }
  /** The reader's notifications changed: read them again. Sent to that agent only. */
  | { readonly type: 'notifications' }
  | { readonly type: 'ping' }
