/**
 * What the visitor's widget exchanges with the chat server — a narrow projection of the
 * conversation: what was said to the visitor and by them, never a note, an event of the
 * team, a tool called, a confidence score or an agent's full name.
 */

/** A message as the visitor sees it. An answer of the AI always says it is one (framing). */
export type WidgetMessage =
  | {
      readonly id: string
      readonly at: string
      readonly from: 'visitor' | 'ai'
      readonly body: string
    }
  | {
      readonly id: string
      readonly at: string
      readonly from: 'agent'
      readonly body: string
      /** The agent's first name — no more. */
      readonly author: string
    }
  | {
      readonly id: string
      readonly at: string
      readonly from: 'event'
      /** An agent joined, the AI handed over, the conversation was closed. */
      readonly event: 'joined' | 'handoff' | 'resolved'
      readonly author: string | null
    }

export interface VisitorConversation {
  readonly id: string
  /** Who answers now: the AI, an agent (or the team, once handed over), or nobody. */
  readonly answeredBy: 'ai' | 'team' | 'closed'
  readonly messages: readonly WidgetMessage[]
}

export interface WidgetAvailability {
  /** Agents answer now. */
  readonly open: boolean
  /** When they next will, if not now. */
  readonly nextOpening: string | null
  /** The exceptional closure's message, when one is in force. */
  readonly closureMessage: string | null
}

export interface WidgetSite {
  readonly name: string
  readonly welcome: string | null
  /** Questions offered with a click before the visitor writes. */
  readonly suggestions: readonly string[]
  /** `#RRGGBB` */
  readonly color: string
  /** `fr`, `en`, `de`, `es` — the widget's language. */
  readonly language: string
  /** The AI answers first. */
  readonly ai: boolean
}

export interface WidgetSessionBody {
  readonly site: string
  /** The token a previous session returned, kept by the widget. */
  readonly visitor?: string
  /** The identity the site signed (HS256 JWT), for a visitor signed in to it. */
  readonly identity?: string
}

export interface WidgetSession {
  /** Keep it: it is the visitor's, and brings their conversation back. */
  readonly visitor: string
  readonly contact: { readonly name: string | null; readonly identified: boolean }
  readonly site: WidgetSite
  readonly availability: WidgetAvailability
  readonly conversation: VisitorConversation | null
}

export interface WidgetMessageBody {
  readonly body: string
}

/** The widget's WebSocket: the conversation changed (read it again), or someone is typing. */
export type WidgetEvent =
  | { readonly type: 'conversation' }
  | { readonly type: 'typing'; readonly who: 'ai' | 'agent' }
  | { readonly type: 'ping' }
