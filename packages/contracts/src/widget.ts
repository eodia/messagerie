/**
 * What the visitor's widget exchanges with the chat server — a narrow projection of the
 * conversation: what was said to the visitor and by them, never a note, an event of the
 * team, a tool called, a confidence score or an agent's full name.
 */

import type { MetadataValue } from './inbox.js'

/** A file as the visitor sees it: no analysis of the team's. */
export interface WidgetAttachment {
  readonly id: string
  readonly name: string
  readonly mime: string
  readonly size: number
  readonly url: string
}

/** A message as the visitor sees it. An answer of the AI always says it is one (framing). */
export type WidgetMessage =
  | {
      readonly id: string
      readonly at: string
      readonly from: 'visitor' | 'ai'
      readonly body: string
      readonly attachments?: readonly WidgetAttachment[]
      /** Deleted for everyone: « Ce message a été supprimé » in its place. */
      readonly deleted?: true
    }
  | {
      readonly id: string
      readonly at: string
      readonly from: 'agent'
      readonly body: string
      /** The agent's first name — no more. */
      readonly author: string
      readonly attachments?: readonly WidgetAttachment[]
      readonly deleted?: true
    }
  | {
      readonly id: string
      readonly at: string
      readonly from: 'event'
      /** An agent joined, the AI handed over, the conversation was closed. */
      readonly event: 'joined' | 'handoff' | 'resolved'
      readonly author: string | null
    }
  /** Said by the site itself — an automation's reply (D20), signed with the site's name. */
  | {
      readonly id: string
      readonly at: string
      readonly from: 'site'
      readonly body: string
      readonly attachments?: readonly WidgetAttachment[]
      readonly deleted?: true
    }
  /**
   * The AI asks the page to act (D21). `pending`: the widget runs it, once, in one tab;
   * `confirming`: the visitor accepts or declines first.
   */
  | {
      readonly id: string
      readonly at: string
      readonly from: 'action'
      readonly call: string
      readonly name: string
      readonly label: string
      readonly args: Readonly<Record<string, unknown>>
      readonly status: PageCallStatus
    }
  /**
   * « Laissez-nous votre e-mail »: nobody can answer soon. `email` is the address the
   * contact has now — none, and the card asks for it.
   */
  | {
      readonly id: string
      readonly at: string
      readonly from: 'email'
      readonly text: string | null
      readonly email: string | null
    }
  /**
   * « Enquête de satisfaction » (D20): a score to give — 1 to 5 (`csat`), 0 to 10 (`nps`)
   * — and a word, if the visitor likes. `score` once they answered: the card thanks them.
   */
  | {
      readonly id: string
      readonly at: string
      readonly from: 'survey'
      /** What the answer is sent to. */
      readonly survey: string
      readonly scale: SurveyScale
      /** The site's own question; null: the widget's. */
      readonly text: string | null
      readonly score: number | null
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

/** How the widget looks and behaves on a site: its row of « Sites ». */
export interface WidgetAppearance {
  readonly position: 'right' | 'left'
  /** Pixels from the page's side, and from its bottom. */
  readonly offsetX: number
  readonly offsetY: number
  /** A round icon, or a pill with `launcherLabel`. */
  readonly launcher: 'round' | 'label'
  readonly launcherLabel: string | null
  /** `site`: the page's own; `custom`: `customFont`, which the page already loads. */
  readonly font: 'site' | 'system' | 'rounded' | 'serif' | 'custom'
  readonly customFont: string | null
  readonly theme: 'auto' | 'light' | 'dark'
  readonly corners: 'round' | 'soft' | 'square'
  /** An https image, square, at the head of the panel. */
  readonly logo: string | null
  /** The agents' initials at the head of the panel. */
  readonly showTeam: boolean
  /** Seconds before the welcome shows beside the launcher; null: never. */
  readonly nudgeAfter: number | null
  readonly hideOnMobile: boolean
  /** No widget while neither the AI nor an agent can answer. */
  readonly hideWhenAway: boolean
  /** « Propulsé par … » at the foot of the panel. */
  readonly branding: boolean
}

export interface WidgetSite {
  readonly name: string
  /** The greeting's heading; `{prénom}` stands for a signed-in customer's first name. */
  readonly title: string | null
  /** The line under it. */
  readonly tagline: string | null
  readonly welcome: string | null
  /** Questions offered with a click before the visitor writes. */
  readonly suggestions: readonly string[]
  /** `#RRGGBB` */
  readonly color: string
  /** `fr`, `en`, `de`, `es` — the widget's language. */
  readonly language: string
  /** The AI answers first. */
  readonly ai: boolean
  /** The first names of a few agents: the people behind the AI. Empty when hidden. */
  readonly team: readonly string[]
  readonly appearance: WidgetAppearance
}

export interface WidgetSessionBody {
  readonly site: string
  /** The token a previous session returned, kept by the widget. */
  readonly visitor?: string
  /** The identity the site signed (HS256 JWT), for a visitor signed in to it. */
  readonly identity?: string
  /** The browser's time zone, `Europe/Paris`: where the visitor is, roughly (D18). */
  readonly timeZone?: string
}

export interface WidgetSession {
  /** Keep it: it is the visitor's, and brings their conversation back. */
  readonly visitor: string
  readonly contact: { readonly name: string | null; readonly identified: boolean }
  readonly site: WidgetSite
  readonly availability: WidgetAvailability
  readonly conversation: VisitorConversation | null
}

/** CSAT: 1 to 5, « satisfied » from 4. NPS: 0 to 10, a promoter from 9, a detractor to 6. */
export type SurveyScale = 'csat' | 'nps'

/** What the visitor answers in the survey card. */
export interface WidgetSurveyBody {
  readonly score: number
  /** A word on it — optional, 1000 characters at most. */
  readonly comment?: string
}

/** The address the visitor leaves in the e-mail card. */
export interface WidgetEmailBody {
  readonly email: string
}

export interface WidgetMessageBody {
  readonly body: string
  /** Metadata the page set for the conversation before it began: attached with it. */
  readonly data?: Readonly<Record<string, MetadataValue | null>>
  /** Where the visitor is, and what the page can do — read again with each message (D21). */
  readonly page?: PageSnapshot
}

/**
 * An action the page offers the AI (`MessagerieChat.registerAction`, D21): what it does, in
 * words for the model, and its parameters as a JSON schema. `read` looks something up — a
 * price, a stock — and changes nothing; `do` changes the page — a form filled, a step
 * opened. `confirm`: the visitor accepts it first.
 */
export interface PageActionDeclaration {
  readonly name: string
  /** For people: « Pré-remplir le devis ». */
  readonly label: string
  readonly description: string
  readonly parameters: Readonly<Record<string, unknown>>
  readonly kind: 'read' | 'do'
  readonly confirm: boolean
}

/** The page, as the widget sees it when the visitor writes. */
export interface PageSnapshot {
  readonly url: string
  readonly title: string
  /** `MessagerieChat.setPageContext`: what the page says of itself — a step, a cart. */
  readonly context: unknown
  readonly actions: readonly PageActionDeclaration[]
}

/** What the page's handler gave back — or why it could not. */
export interface PageActionResultBody {
  readonly ok: boolean
  readonly result?: unknown
  readonly error?: string
}

/**
 * What the page says of its visitor (`MessagerieChat.setUser`, `setContactData`). A
 * customer the site signed keeps the name and e-mail of the signature.
 */
export interface WidgetContactBody {
  readonly name?: string
  readonly email?: string
  readonly phone?: string
  readonly data?: Readonly<Record<string, MetadataValue | null>>
}

/** `MessagerieChat.setConversationData`: a key with `null` is removed. */
export interface WidgetConversationBody {
  readonly data: Readonly<Record<string, MetadataValue | null>>
}

/** The widget's WebSocket: the conversation changed (read it again), or someone is typing. */
export type PageCallStatus =
  | 'pending'
  | 'confirming'
  | 'running'
  | 'done'
  | 'failed'
  | 'refused'
  | 'expired'

export type WidgetEvent =
  | { readonly type: 'conversation' }
  | {
      readonly type: 'typing'
      readonly who: 'ai' | 'agent'
      /** The agent's first name — their avatar beside the dots. */
      readonly name?: string
    }
  | { readonly type: 'ping' }
