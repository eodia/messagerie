import type { Conversation, ConversationSummary, Message } from '@chat/contracts'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { type Context, Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import type { Db } from '../db/client.js'
import type { Access } from '../inbox/access.js'
import { Refusal } from '../refusal.js'
import type { Settings } from '../settings/settings.js'
import { RateLimiter } from '../widget/hub.js'
import {
  type ServiceDeps,
  agentsList,
  assignTo,
  close,
  contact,
  contactsList,
  conversation,
  conversationList,
  inboxes,
  reply,
  search,
  tag,
  whoami,
} from './service.js'
import { type TokenContext, bearerToken, openToken } from './tokens.js'

/**
 * The MCP server, at `/mcp`: an agent — Claude, any MCP client — with a token of the chat
 * open to `mcp` (D16). Streamable HTTP, JSON answers, no session: each request is checked
 * anew, its token and its rights, as basedb does. The tools are the REST API's, through the
 * same service; a read-only token is not offered the others. No tool deletes, and none
 * takes an identity: a token is who it is.
 */

const VERSION = '0.1.0'

const INSTRUCTIONS = `Messagerie : la messagerie client d'un service — conversations avec des visiteurs, réponses d'une IA et de conseillers.
Commencez par whoami pour connaître les droits du jeton, puis list_conversations (non résolues par défaut) et get_conversation.
Une réponse envoyée par send_reply part au visiteur, signée du nom du jeton : relisez-la avant. add_note n'est vue que de l'équipe.`

/** Refusals, as an agent reads them: a code, and what it means. */
const MEANING: Readonly<Record<string, string>> = {
  CONVERSATION_NOT_FOUND: 'Cette conversation n’existe pas, ou ce jeton ne l’atteint pas.',
  CONTACT_NOT_FOUND: 'Ce contact n’existe pas, ou ce jeton ne l’atteint pas.',
  AGENT_NOT_FOUND: 'Ce conseiller n’existe pas ou n’est plus actif : voyez list_agents.',
  TOKEN_READ_ONLY: 'Ce jeton ne permet que la lecture.',
  EMPTY_MESSAGE: 'Le message est vide.',
  INVALID_REQUEST: 'La demande est mal formée.',
  RATE_LIMITED: 'Trop de demandes : réessayez dans une minute.',
}

type Result = { content: { type: 'text'; text: string }[]; isError?: boolean }

/** A tool's answer: its data as JSON — or, refused, the refusal as data too. */
async function answer(run: () => Promise<unknown> | unknown): Promise<Result> {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(await run(), null, 2) }] }
  } catch (error) {
    if (!(error instanceof Refusal)) throw error
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            code: error.code,
            message: MEANING[error.code] ?? 'Refusé.',
            ...(error.details ? { details: error.details } : {}),
          }),
        },
      ],
    }
  }
}

const short = (text: string, max = 240) => (text.length > max ? `${text.slice(0, max)}…` : text)

/** A conversation in a list, as an agent needs it — less than the inbox draws. */
function summaryView(s: ConversationSummary) {
  return {
    id: s.id,
    contact: s.contact.name,
    email: s.contact.email,
    status: s.status,
    inbox_id: s.inboxId,
    assignee: s.assignee,
    unread: s.unread,
    priority: s.priority,
    sentiment: s.sentiment,
    tags: s.tags.map((t) => t.label),
    last_message: { from: s.previewAuthor, text: short(s.preview) },
    last_message_at: s.lastMessageAt,
  }
}

function messageView(m: Message) {
  if (m.deleted) return { id: m.id, at: m.at, deleted: true }
  switch (m.kind) {
    case 'visitor':
      return {
        id: m.id,
        at: m.at,
        from: 'visitor',
        text: m.body,
        files: m.attachments.map((a) => a.name),
      }
    case 'agent':
      return {
        id: m.id,
        at: m.at,
        from: 'agent',
        author: m.author,
        text: m.body,
        files: m.attachments.map((a) => a.name),
      }
    case 'note':
      return { id: m.id, at: m.at, from: 'note', author: m.author, text: m.body }
    case 'ai':
      return { id: m.id, at: m.at, from: 'ai', text: m.body, confidence: m.confidence }
    case 'event':
      return { id: m.id, at: m.at, from: 'event', event: m.event }
    case 'handoff':
      return { id: m.id, at: m.at, from: 'handoff' }
  }
}

function conversationView(c: Conversation) {
  return {
    id: c.id,
    status: c.status,
    site: c.site,
    inbox_id: c.inboxId,
    assignee: c.assignee,
    priority: c.priority,
    sentiment: c.sentiment,
    intent: c.intent,
    tags: c.tags.map((t) => t.label),
    summary: c.summary,
    data: c.data,
    contact: {
      id: c.contact.id,
      name: c.contact.name,
      email: c.contact.email,
      phone: c.contact.phone,
      identified: c.contact.identified,
    },
    messages: c.messages.map(messageView),
  }
}

const conversationId = z.string().uuid().describe('L’identifiant de la conversation.')

/** The server for one request, its tools bound to the token that asks. */
function serverFor(deps: ServiceDeps, token: TokenContext): McpServer {
  const server = new McpServer(
    { name: 'messagerie', version: VERSION },
    { instructions: INSTRUCTIONS },
  )
  const read = { readOnlyHint: true, openWorldHint: false }

  server.registerTool(
    'whoami',
    {
      title: 'Qui suis-je',
      description:
        'Le jeton utilisé : son nom, ses droits (read ou write), les boîtes qu’il atteint.',
      annotations: read,
    },
    () => answer(() => whoami(token)),
  )
  server.registerTool(
    'list_inboxes',
    {
      title: 'Boîtes de réception',
      description: 'Les boîtes de réception que ce jeton atteint : leur identifiant et leur nom.',
      annotations: read,
    },
    () => answer(() => inboxes(deps, token)),
  )
  server.registerTool(
    'list_agents',
    {
      title: 'Conseillers',
      description: 'Les conseillers actifs, à qui une conversation peut être affectée.',
      annotations: read,
    },
    () =>
      answer(async () =>
        (await agentsList(deps)).map(({ id, name, role }) => ({ id, name, role })),
      ),
  )
  server.registerTool(
    'list_conversations',
    {
      title: 'Conversations',
      description:
        'Les conversations, les plus récentes d’abord : le contact, l’état, le conseiller, les étiquettes et le dernier message. Non résolues par défaut.',
      inputSchema: {
        status: z
          .enum(['unresolved', 'ai', 'open', 'pending', 'resolved', 'all'])
          .optional()
          .describe('unresolved (par défaut), ai : l’IA répond, open, pending, resolved, all.'),
        inbox_id: z
          .string()
          .optional()
          .describe('Une boîte de réception seulement (list_inboxes).'),
        assignee_id: z
          .string()
          .optional()
          .describe('Un conseiller (list_agents), ou « none » pour la file d’attente.'),
        limit: z.number().int().min(1).max(200).optional().describe('50 par défaut.'),
      },
      annotations: read,
    },
    (args) =>
      answer(async () =>
        (
          await conversationList(deps, token, {
            ...(args.status ? { status: args.status } : {}),
            ...(args.inbox_id ? { inbox: args.inbox_id } : {}),
            ...(args.assignee_id ? { assignee: args.assignee_id } : {}),
            ...(args.limit ? { limit: args.limit } : {}),
          })
        ).map(summaryView),
      ),
  )
  server.registerTool(
    'get_conversation',
    {
      title: 'Une conversation',
      description:
        'Une conversation entière : le contact, l’état, le résumé de l’IA, les métadonnées et tous les messages — du visiteur, de l’IA, des conseillers, les notes internes et les événements.',
      inputSchema: { conversation_id: conversationId },
      annotations: read,
    },
    (args) =>
      answer(async () => conversationView(await conversation(deps, token, args.conversation_id))),
  )
  server.registerTool(
    'search_messages',
    {
      title: 'Chercher dans les messages',
      description:
        'Les messages qui contiennent tous ces mots, accents à part, les plus récents d’abord.',
      inputSchema: { query: z.string().min(3).describe('Trois caractères au moins.') },
      annotations: read,
    },
    (args) => answer(() => search(deps, token, args.query)),
  )
  server.registerTool(
    'list_contacts',
    {
      title: 'Contacts',
      description:
        'Les contacts — visiteurs et clients —, cherchés par nom, e-mail ou identifiant client.',
      inputSchema: { query: z.string().optional().describe('Tout le monde si absent.') },
      annotations: read,
    },
    (args) => answer(() => contactsList(deps, token, args.query ?? '')),
  )
  server.registerTool(
    'get_contact',
    {
      title: 'Un contact',
      description: 'Une fiche de contact et ses conversations.',
      inputSchema: { contact_id: z.string().uuid() },
      annotations: read,
    },
    (args) => answer(() => contact(deps, token, args.contact_id)),
  )

  if (!token.write) return server
  const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }

  server.registerTool(
    'send_reply',
    {
      title: 'Répondre au visiteur',
      description:
        'Envoie une réponse au visiteur, signée du nom du jeton. Markdown léger accepté (gras, italique, listes, liens). La conversation quitte l’IA et reste dans la file.',
      inputSchema: {
        conversation_id: conversationId,
        text: z.string().min(1),
        resolve: z.boolean().optional().describe('Résoudre la conversation avec cette réponse.'),
      },
      annotations: write,
    },
    (args) =>
      answer(async () =>
        conversationView(
          await reply(deps, token, args.conversation_id, args.text, { resolve: args.resolve }),
        ),
      ),
  )
  server.registerTool(
    'add_note',
    {
      title: 'Note interne',
      description: 'Ajoute une note que seule l’équipe voit — jamais le visiteur.',
      inputSchema: { conversation_id: conversationId, text: z.string().min(1) },
      annotations: write,
    },
    (args) =>
      answer(async () =>
        conversationView(await reply(deps, token, args.conversation_id, args.text, { note: true })),
      ),
  )
  server.registerTool(
    'assign_conversation',
    {
      title: 'Affecter',
      description:
        'Confie la conversation à un conseiller (list_agents), ou la remet dans la file avec null.',
      inputSchema: {
        conversation_id: conversationId,
        agent_id: z.string().uuid().nullable(),
      },
      annotations: write,
    },
    (args) =>
      answer(async () =>
        conversationView(await assignTo(deps, token, args.conversation_id, args.agent_id)),
      ),
  )
  server.registerTool(
    'resolve_conversation',
    {
      title: 'Résoudre',
      description: 'Marque la conversation comme résolue.',
      inputSchema: { conversation_id: conversationId },
      annotations: write,
    },
    (args) => answer(async () => conversationView(await close(deps, token, args.conversation_id))),
  )
  server.registerTool(
    'add_tag',
    {
      title: 'Étiqueter',
      description: 'Pose une étiquette sur la conversation.',
      inputSchema: { conversation_id: conversationId, label: z.string().min(1).max(60) },
      annotations: write,
    },
    (args) =>
      answer(async () =>
        conversationView(await tag(deps, token, args.conversation_id, args.label)),
      ),
  )
  server.registerTool(
    'remove_tag',
    {
      title: 'Retirer une étiquette',
      description: 'Retire une étiquette de la conversation.',
      inputSchema: { conversation_id: conversationId, label: z.string().min(1) },
      annotations: write,
    },
    (args) =>
      answer(async () =>
        conversationView(await tag(deps, token, args.conversation_id, args.label, true)),
      ),
  )
  return server
}

/** A refusal before any tool: JSON-RPC's, with the HTTP status that says it. */
function rpcError(c: Context, status: ContentfulStatusCode, code: string) {
  if (status === 401) c.header('WWW-Authenticate', 'Bearer realm="messagerie"')
  return c.json({ jsonrpc: '2.0', error: { code: -32000, message: code }, id: null }, status)
}

export function mcpRoutes(deps: {
  readonly db: Db
  readonly settings: Settings | null
  readonly access: Access
}): Hono {
  const mcp = new Hono()
  const calls = new RateLimiter(240, 60_000)

  mcp.post('/', async (c) => {
    // An MCP client is a program, not a page: a request a browser sends is refused.
    if (c.req.header('origin')) return rpcError(c, 403, 'ORIGIN_REFUSED')
    let token: TokenContext
    try {
      token = await openToken(
        deps.db,
        deps.access,
        bearerToken(c.req.header('authorization')),
        'mcp',
      )
    } catch (error) {
      if (error instanceof Refusal) return rpcError(c, error.status, error.code)
      throw error
    }
    if (!calls.allow(token.token.id)) return rpcError(c, 429, 'RATE_LIMITED')

    const server = serverFor(deps, token)
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    await server.connect(transport)
    try {
      const response = await transport.handleRequest(c.req.raw)
      // Read whole before the server closes: JSON answers, never a stream.
      const body = await response.text()
      return new Response(body, { status: response.status, headers: response.headers })
    } finally {
      await server.close()
    }
  })
  // No session, no stream to open or close.
  mcp.on(['GET', 'DELETE'], '/', (c) => rpcError(c, 405, 'METHOD_NOT_ALLOWED'))
  return mcp
}
