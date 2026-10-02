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
  /** No session, or one that ended: sign in again. */
  | 'SESSION_INVALID'
  | 'NOT_AN_AGENT'
  | 'TICKET_INVALID'
  /** A wrong e-mail or password — never said which. */
  | 'SIGN_IN_FAILED'
  /** Ten characters at least, and not the e-mail. */
  | 'PASSWORD_WEAK'
  /** A link that does not exist, was used, or expired. */
  | 'LINK_INVALID'
  /** The first supervisor exists already: sign in. */
  | 'SETUP_DONE'
  /** The identity provider refused, or signed in someone who is not an agent here. */
  | 'SSO_FAILED'
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
  | 'CONTACT_NOT_FOUND'
  /** Reserved to supervisors. */
  | 'NOT_ALLOWED'
  | 'TOOL_NOT_FOUND'
  /** No such inbox, or an inactive one. */
  | 'INBOX_NOT_FOUND'
  /** No such team — or not one of the target inbox's teams. */
  | 'TEAM_NOT_FOUND'
  /** A settings row that no longer exists. */
  | 'ROW_NOT_FOUND'
  /** That account is an agent already. */
  | 'AGENT_EXISTS'
  /** A file refused: `details.reason` is `type` (not one the chat takes) or `size`. */
  | 'ATTACHMENT_REFUSED'
  | 'ATTACHMENT_NOT_FOUND'
  /** The AI cannot read this kind of file with the configured model. */
  | 'ATTACHMENT_NOT_ANALYZABLE'
  | 'GIFS_UNAVAILABLE'
  /** The public API and the MCP server's tokens (D16). */
  | 'TOKEN_INVALID'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_REVOKED'
  | 'TOKEN_READ_ONLY'
  | 'TOKEN_NOT_FOUND'
  | 'WEBHOOK_NOT_FOUND'
  /** The address of a webhook: HTTPS, to a public address — not a machine of the network. */
  | 'WEBHOOK_TARGET_REJECTED'
  /** An event or a handoff: part of the conversation's story, not a message to delete. */
  | 'MESSAGE_NOT_DELETABLE'
  /** On hold: only a conversation an agent has — not the AI's, not a resolved one. */
  | 'NOT_SNOOZABLE'
  | 'SPEECH_UNAVAILABLE'
  | 'GIFS_UNREACHABLE'
  | 'GIF_NOT_FOUND'
  | 'AUTOMATION_NOT_FOUND'
  | 'DASHBOARD_NOT_FOUND'
  /** A question that cannot run: `details.reason`, the database's words for SQL. */
  | 'QUERY_INVALID'
  /** Longer than fifteen seconds. */
  | 'QUERY_TIMEOUT'
  /** The database refuses the reading role: SQL questions are off on this server. */
  | 'SQL_UNAVAILABLE'
  /** An automation that cannot run as written: `details.problem`, `details.step`. */
  | 'AUTOMATION_INVALID'
  /** An automation's own address, called with a wrong key, or while it is off. */
  | 'AUTOMATION_KEY_INVALID'

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
  /** The visitor is writing in a conversation — again every few seconds while they do. */
  | { readonly type: 'typing'; readonly conversationId: string; readonly who: 'visitor' }
  | { readonly type: 'ping' }

/** How the copilot rewords a draft. */
export type Rewording = 'clearer' | 'shorter' | 'warmer' | 'correct'

export interface RephraseBody {
  readonly text: string
  readonly how: Rewording
}

/** A tool tried from the tools screen, outside any conversation. */
export interface ToolTestBody {
  /** An « Outils IA » row's id; or, with `server`, an MCP tool's name. */
  readonly tool: string
  /** The « Serveurs MCP » row's id, for one of its tools. */
  readonly server?: string
  readonly arguments: Readonly<Record<string, unknown>>
}
