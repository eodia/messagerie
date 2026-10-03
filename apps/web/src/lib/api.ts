import type {
  Agent,
  AnalyticsSource,
  ApiDocumentation,
  ApiError,
  ApiToken,
  Attachment,
  Automation,
  AutomationButton,
  AutomationChoices,
  AutomationDefinition,
  AutomationRunList,
  BulkBody,
  BulkResult,
  CannedReply,
  CardDetailBody,
  CardLink,
  ContactDetail,
  ContactListItem,
  Conversation,
  ConversationSummary,
  CreateTokenBody,
  CreateWebhookBody,
  CreatedToken,
  CreatedWebhook,
  Dashboard,
  DashboardBody,
  DashboardFilter,
  ErrorCode,
  FeedbackBody,
  FilterValues,
  GifHit,
  InboxDirectory,
  InboxStats,
  InviteBody,
  Invited,
  KnowledgeItem,
  MessageHit,
  Metadata,
  MetadataValue,
  NotificationList,
  PageAction,
  PasswordReset,
  QueryResult,
  Question,
  QuestionDraft,
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
  Webhook,
  WebhookDelivery,
  WidgetEditor,
  WidgetEditorSite,
  WidgetSettings,
} from '@chat/contracts'
import { REQUEST_HEADER, configureSession } from './session'
import { useSession } from './store/session'

/**
 * The one module that talks to the chat server. The address is handed over at run time
 * by the layout (`CHAT_API_URL`), never frozen into the bundle at build time. Every
 * request carries the session cookie the server set at sign-in.
 */

let base = 'http://localhost:8810'

export function configureApi(url: string): void {
  base = url.replace(/\/+$/, '')
  configureSession(base)
}

export const apiAddress = (): string => base

/** A file's address: the server signs a path, read from its own host. */
export const fileUrl = (path: string): string => `${base}${path}`

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
    /** What the server said of it: the field, the problem. */
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(code)
  }
}

async function request<T>(method: string, path: string, body?: unknown, bytes = false): Promise<T> {
  const form = body instanceof FormData
  // The session is a cookie (D19); the header says the request comes from the inbox.
  const headers: Record<string, string> = { [REQUEST_HEADER]: '1' }
  // A form says its own type, with the boundary of its parts.
  if (body !== undefined && !form) headers['content-type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(`${base}/api/inbox${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    })
  } catch {
    throw new ApiFailure('UNREACHABLE', 0)
  }
  if (response.status === 204) return undefined as T
  if (bytes && response.ok) return (await response.blob()) as T
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const code = (data as ApiError | null)?.code ?? 'INTERNAL_ERROR'
    // No session (any more): the sign-in screen takes over.
    if (code === 'SESSION_INVALID') useSession.getState().signedOut()
    throw new ApiFailure(code, response.status, (data as ApiError | null)?.details ?? {})
  }
  return data as T
}

const conversation = (id: string) => `/conversations/${encodeURIComponent(id)}`

/** The reader's time zone: a day of the dashboards is theirs. */
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

export const api = {
  me: () => request<Agent>('GET', '/me'),
  agents: () => request<Agent[]>('GET', '/agents'),
  ticket: () => request<Ticket>('POST', '/ticket'),
  conversations: () => request<ConversationSummary[]>('GET', '/conversations'),
  conversation: (id: string) => request<Conversation>('GET', conversation(id)),
  markRead: (id: string) => request<void>('POST', `${conversation(id)}/read`),
  typing: (id: string) => request<void>('POST', `${conversation(id)}/typing`),
  /** A message read aloud by the server's AI voice, as an MP3. */
  speech: (messageId: string) =>
    request<Blob>('GET', `/messages/${encodeURIComponent(messageId)}/speech`, undefined, true),
  send: (id: string, body: SendMessageBody) =>
    request<Conversation>('POST', `${conversation(id)}/messages`, body),
  takeOver: (id: string) => request<Conversation>('POST', `${conversation(id)}/takeover`),
  resolve: (id: string) => request<Conversation>('POST', `${conversation(id)}/resolve`),
  /** The conversations ticked in the list, acted on at once. */
  bulk: (body: BulkBody) => request<BulkResult>('POST', '/bulk', body),
  snooze: (id: string, until: string) =>
    request<Conversation>('POST', `${conversation(id)}/snooze`, { until }),
  wake: (id: string) => request<Conversation>('DELETE', `${conversation(id)}/snooze`),
  assign: (id: string, assigneeId: string | null) =>
    request<Conversation>('POST', `${conversation(id)}/assign`, { assigneeId }),
  feedback: (id: string, messageId: string, body: FeedbackBody) =>
    request<Conversation>(
      'PUT',
      `${conversation(id)}/messages/${encodeURIComponent(messageId)}/feedback`,
      body,
    ),
  canned: () => request<CannedReply[]>('GET', '/canned'),
  /** Those of one site, with `site`. */
  contacts: (query: string, site: string | null = null) =>
    request<ContactListItem[]>(
      'GET',
      `/contacts?q=${encodeURIComponent(query)}${site ? `&site=${encodeURIComponent(site)}` : ''}`,
    ),
  contact: (id: string) => request<ContactDetail>('GET', `/contacts/${encodeURIComponent(id)}`),
  stats: (site: string | null = null) =>
    request<InboxStats>('GET', site ? `/stats?site=${encodeURIComponent(site)}` : '/stats'),
  knowledge: () => request<KnowledgeItem[]>('GET', '/knowledge'),
  tools: () => request<ToolsOverview>('GET', '/tools'),
  inboxes: () => request<InboxDirectory>('GET', '/inboxes'),
  tags: () => request<TagOption[]>('GET', '/tags'),
  addTag: (id: string, label: string) =>
    request<Conversation>('POST', `${conversation(id)}/tags`, { label }),
  hideMessage: (id: string, messageId: string) =>
    request<Conversation>(
      'POST',
      `${conversation(id)}/messages/${encodeURIComponent(messageId)}/hide`,
    ),
  deleteMessage: (id: string, messageId: string) =>
    request<Conversation>(
      'DELETE',
      `${conversation(id)}/messages/${encodeURIComponent(messageId)}`,
    ),
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
  /** A reply or a note with files — words optional. */
  sendFiles: (id: string, files: readonly File[], message: SendMessageBody) => {
    const form = new FormData()
    for (const file of files) form.append('file', file, file.name)
    form.append('body', message.body)
    form.append('kind', message.kind)
    if (message.resolve) form.append('resolve', 'true')
    if (message.translate) form.append('translate', 'true')
    return request<Conversation>('POST', `${conversation(id)}/attachments`, form)
  },
  gifs: (query: string, offset = 0) =>
    request<GifHit[]>('GET', `/gifs?q=${encodeURIComponent(query)}&offset=${offset}`),
  gifFile: (id: string) =>
    request<Blob>('GET', `/gifs/${encodeURIComponent(id)}/file`, undefined, true),
  tokens: () => request<ApiToken[]>('GET', '/tokens'),
  apiDocs: () => request<ApiDocumentation>('GET', '/api-docs'),
  openApiSpec: () => request<Record<string, unknown>>('GET', '/api-docs/openapi.json'),
  createToken: (body: CreateTokenBody) => request<CreatedToken>('POST', '/tokens', body),
  revokeToken: (id: string) => request<void>('DELETE', `/tokens/${encodeURIComponent(id)}`),
  webhooks: () => request<Webhook[]>('GET', '/webhooks'),
  createWebhook: (body: CreateWebhookBody) => request<CreatedWebhook>('POST', '/webhooks', body),
  setWebhookActive: (id: string, active: boolean) =>
    request<void>('PATCH', `/webhooks/${encodeURIComponent(id)}`, { active }),
  deleteWebhook: (id: string) => request<void>('DELETE', `/webhooks/${encodeURIComponent(id)}`),
  webhookDeliveries: (id: string) =>
    request<WebhookDelivery[]>('GET', `/webhooks/${encodeURIComponent(id)}/deliveries`),
  testWebhook: (id: string) => request<void>('POST', `/webhooks/${encodeURIComponent(id)}/test`),
  analyticsSources: () => request<AnalyticsSource[]>('GET', '/analytics/sources'),
  /** A question being written — under the dashboard's filters, when given. */
  runQuestion: (
    question: Question,
    under?: {
      readonly filters: readonly DashboardFilter[]
      readonly links: readonly CardLink[]
      readonly values: FilterValues
    },
  ) => request<QueryResult>('POST', '/analytics/run', { question, ...under, timeZone: zone() }),
  filterValues: (source: string, column: string) =>
    request<string[]>('POST', '/analytics/values', { source, column }),
  assistQuestion: (text: string) =>
    request<QuestionDraft>('POST', '/analytics/assist', { request: text, timeZone: zone() }),
  dashboards: () => request<Dashboard[]>('GET', '/dashboards'),
  dashboard: (id: string) => request<Dashboard>('GET', `/dashboards/${encodeURIComponent(id)}`),
  createDashboard: (body: DashboardBody) => request<Dashboard>('POST', '/dashboards', body),
  saveDashboard: (id: string, body: DashboardBody) =>
    request<Dashboard>('PUT', `/dashboards/${encodeURIComponent(id)}`, body),
  deleteDashboard: (id: string) => request<void>('DELETE', `/dashboards/${encodeURIComponent(id)}`),
  runCard: (id: string, card: string, values: FilterValues) =>
    request<QueryResult>(
      'POST',
      `/dashboards/${encodeURIComponent(id)}/cards/${encodeURIComponent(card)}/run`,
      { timeZone: zone(), values },
    ),
  cardDetail: (id: string, card: string, body: CardDetailBody) =>
    request<QueryResult>(
      'POST',
      `/dashboards/${encodeURIComponent(id)}/cards/${encodeURIComponent(card)}/detail`,
      { timeZone: zone(), ...body },
    ),
  pageActions: (siteId: string) =>
    request<PageAction[]>('GET', `/sites/${encodeURIComponent(siteId)}/page-actions`),
  setPageAction: (id: string, patch: { enabled?: boolean; confirm?: boolean }) =>
    request<PageAction>('PATCH', `/page-actions/${encodeURIComponent(id)}`, patch),
  automations: () => request<Automation[]>('GET', '/automations'),
  automationChoices: () => request<AutomationChoices>('GET', '/automations/choices'),
  createAutomation: (body: AutomationDefinition) =>
    request<Automation>('POST', '/automations', body),
  saveAutomation: (id: string, body: AutomationDefinition) =>
    request<Automation>('PUT', `/automations/${encodeURIComponent(id)}`, body),
  setAutomationActive: (id: string, active: boolean) =>
    request<Automation>('PATCH', `/automations/${encodeURIComponent(id)}`, { active }),
  renewAutomationKey: (id: string) =>
    request<Automation>('POST', `/automations/${encodeURIComponent(id)}/key`),
  deleteAutomation: (id: string) =>
    request<void>('DELETE', `/automations/${encodeURIComponent(id)}`),
  automationRuns: (id: string) =>
    request<AutomationRunList>('GET', `/automations/${encodeURIComponent(id)}/runs`),
  tryAutomation: (id: string, conversationId: string | null) =>
    request<{ runId: string }>('POST', `/automations/${encodeURIComponent(id)}/try`, {
      conversationId,
    }),
  stopAutomationRun: (runId: string) =>
    request<void>('POST', `/automation-runs/${encodeURIComponent(runId)}/stop`),
  conversationAutomations: (id: string) =>
    request<AutomationButton[]>('GET', `${conversation(id)}/automations`),
  runConversationAutomation: (id: string, automationId: string) =>
    request<{ runId: string }>(
      'POST',
      `${conversation(id)}/automations/${encodeURIComponent(automationId)}`,
    ),
  search: (query: string) => request<MessageHit[]>('GET', `/search?q=${encodeURIComponent(query)}`),
  analyzeAttachment: (id: string) =>
    request<Attachment>('POST', `/attachments/${encodeURIComponent(id)}/analysis`),
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
