import type {
  Agent,
  ApiError,
  CannedReply,
  ContactDetail,
  ContactListItem,
  Conversation,
  ConversationSummary,
  ErrorCode,
  FeedbackBody,
  InboxDirectory,
  InboxStats,
  InviteBody,
  Invited,
  KnowledgeItem,
  Metadata,
  MetadataValue,
  NotificationList,
  PasswordReset,
  Rewording,
  SendMessageBody,
  SettingsOverview,
  SettingsRow,
  TagOption,
  Ticket,
  ToolTestBody,
  ToolTestResult,
  ToolsOverview,
  TransferBody,
  WidgetEditor,
  WidgetEditorSite,
  WidgetSettings,
} from '@chat/contracts'
import { SignedOut, accessToken, forgetToken } from './basedb-session'
import { useSession } from './store/session'

/**
 * The one module that talks to the chat server. The address is handed over at run time
 * by the layout (`CHAT_API_URL`), never frozen into the bundle at build time. Every
 * request carries the agent's basedb access token, when the inbox runs with basedb.
 */

let base = 'http://localhost:8810'

export function configureApi(url: string): void {
  base = url.replace(/\/+$/, '')
}

export const apiAddress = (): string => base

/** The inbox's WebSocket, on the same host as the API, opened with a one-use ticket. */
export const eventsUrl = (ticket: string): string =>
  `${base.replace(/^http/, 'ws')}/api/inbox/events?ticket=${encodeURIComponent(ticket)}`

/**
 * A refusal of the server — `UNREACHABLE` when no answer came at all, `SIGNED_OUT` when no
 * basedb session could vouch for the agent.
 */
export class ApiFailure extends Error {
  constructor(
    readonly code: ErrorCode | 'UNREACHABLE' | 'SIGNED_OUT',
    readonly status: number,
  ) {
    super(code)
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  retried = false,
): Promise<T> {
  let token: string | null
  try {
    token = await accessToken()
  } catch (error) {
    if (error instanceof SignedOut) {
      // No basedb session (any more): the sign-in screen takes over.
      useSession.getState().signedOut()
      throw new ApiFailure('SIGNED_OUT', 401)
    }
    throw error
  }
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token !== null) headers.authorization = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(`${base}/api/inbox${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiFailure('UNREACHABLE', 0)
  }
  if (response.status === 204) return undefined as T
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const code = (data as ApiError | null)?.code ?? 'INTERNAL_ERROR'
    // A token basedb no longer vouches for — signed out elsewhere, expired: one new one.
    if (code === 'SESSION_INVALID' && token !== null && !retried) {
      forgetToken()
      return request<T>(method, path, body, true)
    }
    throw new ApiFailure(code, response.status)
  }
  return data as T
}

const conversation = (id: string) => `/conversations/${encodeURIComponent(id)}`

export const api = {
  me: () => request<Agent>('GET', '/me'),
  agents: () => request<Agent[]>('GET', '/agents'),
  ticket: () => request<Ticket>('POST', '/ticket'),
  conversations: () => request<ConversationSummary[]>('GET', '/conversations'),
  conversation: (id: string) => request<Conversation>('GET', conversation(id)),
  markRead: (id: string) => request<void>('POST', `${conversation(id)}/read`),
  send: (id: string, body: SendMessageBody) =>
    request<Conversation>('POST', `${conversation(id)}/messages`, body),
  takeOver: (id: string) => request<Conversation>('POST', `${conversation(id)}/takeover`),
  resolve: (id: string) => request<Conversation>('POST', `${conversation(id)}/resolve`),
  assign: (id: string, assigneeId: string | null) =>
    request<Conversation>('POST', `${conversation(id)}/assign`, { assigneeId }),
  feedback: (id: string, messageId: string, body: FeedbackBody) =>
    request<Conversation>(
      'PUT',
      `${conversation(id)}/messages/${encodeURIComponent(messageId)}/feedback`,
      body,
    ),
  canned: () => request<CannedReply[]>('GET', '/canned'),
  contacts: (query: string) =>
    request<ContactListItem[]>('GET', `/contacts?q=${encodeURIComponent(query)}`),
  contact: (id: string) => request<ContactDetail>('GET', `/contacts/${encodeURIComponent(id)}`),
  stats: () => request<InboxStats>('GET', '/stats'),
  knowledge: () => request<KnowledgeItem[]>('GET', '/knowledge'),
  tools: () => request<ToolsOverview>('GET', '/tools'),
  inboxes: () => request<InboxDirectory>('GET', '/inboxes'),
  tags: () => request<TagOption[]>('GET', '/tags'),
  addTag: (id: string, label: string) =>
    request<Conversation>('POST', `${conversation(id)}/tags`, { label }),
  removeTag: (id: string, label: string) =>
    request<Conversation>('DELETE', `${conversation(id)}/tags/${encodeURIComponent(label)}`),
  transfer: (id: string, body: TransferBody) =>
    request<Conversation>('POST', `${conversation(id)}/transfer`, body),
  conversationData: (id: string, data: Readonly<Record<string, MetadataValue | null>>) =>
    request<{ data: Metadata }>('PATCH', `${conversation(id)}/data`, { data }),
  contactData: (id: string, data: Readonly<Record<string, MetadataValue | null>>) =>
    request<void>('PATCH', `/contacts/${encodeURIComponent(id)}/data`, { data }),
  settings: () => request<SettingsOverview>('GET', '/settings'),
  settingsRows: (table: string) =>
    request<SettingsRow[]>('GET', `/settings/${encodeURIComponent(table)}`),
  createRow: (table: string, values: Readonly<Record<string, unknown>>) =>
    request<SettingsRow>('POST', `/settings/${encodeURIComponent(table)}`, { values }),
  updateRow: (table: string, id: string, values: Readonly<Record<string, unknown>>) =>
    request<void>('PATCH', `/settings/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, {
      values,
    }),
  deleteRow: (table: string, id: string) =>
    request<void>('DELETE', `/settings/${encodeURIComponent(table)}/${encodeURIComponent(id)}`),
  inviteAgent: (body: InviteBody) => request<Invited>('POST', '/agents/invite', body),
  resetAgentPassword: (rowId: string) =>
    request<PasswordReset>('POST', `/agents/${encodeURIComponent(rowId)}/password`),
  widget: () => request<WidgetEditor>('GET', '/widget'),
  saveWidget: (site: string, settings: WidgetSettings) =>
    request<WidgetEditorSite>('PUT', `/widget/${encodeURIComponent(site)}`, settings),
  testTool: (body: ToolTestBody) => request<ToolTestResult>('POST', '/tools/test', body),
  runTool: (id: string, body: ToolTestBody) =>
    request<ToolTestResult>('POST', `${conversation(id)}/tools`, body),
  suggest: (id: string) => request<void>('POST', `${conversation(id)}/suggestions`),
  rephrase: (id: string, text: string, how: Rewording) =>
    request<{ text: string }>('POST', `${conversation(id)}/rephrase`, { text, how }),
  promote: (id: string) => request<void>('POST', `${conversation(id)}/promote`),
  notifications: () => request<NotificationList>('GET', '/notifications'),
  readNotifications: (conversationId?: string) =>
    request<void>('POST', '/notifications/read', conversationId ? { conversationId } : {}),
}
