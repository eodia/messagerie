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

export const VERSION = '0.1.0'

export const INSTRUCTIONS = `Messagerie : la messagerie client d'un service — conversations avec des visiteurs, réponses d'une IA et de conseillers.
Commencez par whoami pour connaître les droits du jeton, puis list_conversations (non résolues par défaut) et get_conversation.
Une réponse envoyée par send_reply part au visiteur, signée du nom du jeton : relisez-la avant. add_note n'est vue que de l'équipe.`

/** Refusals, as an agent reads them: a code, and what it means. */
export const MEANING: Readonly<Record<string, string>> = {
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

/**
 * A tool, described once: the server registers it from here, and the documentation tells
 * it from here (`documentation.ts`).
 */
export interface Tool {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly input?: z.ZodRawShape
  /** Offered to a `write` token only. */
  readonly write: boolean
  /** Arguments as the documentation shows a call. */
  readonly example?: Readonly<Record<string, unknown>>
  readonly run: (deps: ServiceDeps, token: TokenContext, args: never) => unknown
}

/** A tool, its arguments typed by its schema. */
function tool<S extends z.ZodRawShape>(definition: {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly input?: S
  readonly write?: boolean
  readonly example?: Readonly<Record<string, unknown>>
  readonly run: (deps: ServiceDeps, token: TokenContext, args: z.infer<z.ZodObject<S>>) => unknown
}): Tool {
  return { ...definition, write: definition.write ?? false } as Tool
}

const SAMPLE_CONVERSATION = '4f1c2e8a-7b3d-4c9e-a1f0-2d5e6b7c8a90'

export const TOOLS: readonly Tool[] = [
  tool({
    name: 'whoami',
    title: 'Qui suis-je',
    description:
      'Le jeton utilisé : son nom, ses droits (read ou write), les boîtes qu’il atteint.',
    run: (_deps, token) => whoami(token),
  }),
  tool({
    name: 'list_inboxes',
    title: 'Boîtes de réception',
    description: 'Les boîtes de réception que ce jeton atteint : leur identifiant et leur nom.',
    run: (deps, token) => inboxes(deps, token),
  }),
  tool({
    name: 'list_agents',
    title: 'Conseillers',
    description: 'Les conseillers actifs, à qui une conversation peut être affectée.',
    run: async (deps) => (await agentsList(deps)).map(({ id, name, role }) => ({ id, name, role })),
  }),
  tool({
    name: 'list_conversations',
    title: 'Conversations',
    description:
      'Les conversations, les plus récentes d’abord : le contact, l’état, le conseiller, les étiquettes et le dernier message. Non résolues par défaut.',
    input: {
      status: z
        .enum(['unresolved', 'ai', 'open', 'pending', 'resolved', 'all'])
        .optional()
        .describe('unresolved (par défaut), ai : l’IA répond, open, pending, resolved, all.'),
      inbox_id: z.string().optional().describe('Une boîte de réception seulement (list_inboxes).'),
      assignee_id: z
        .string()
        .optional()
        .describe('Un conseiller (list_agents), ou « none » pour la file d’attente.'),
      limit: z.number().int().min(1).max(200).optional().describe('50 par défaut.'),
    },
    example: { status: 'open', limit: 10 },
    run: async (deps, token, args) =>
      (
        await conversationList(deps, token, {
          ...(args.status ? { status: args.status } : {}),
          ...(args.inbox_id ? { inbox: args.inbox_id } : {}),
          ...(args.assignee_id ? { assignee: args.assignee_id } : {}),
          ...(args.limit ? { limit: args.limit } : {}),
        })
      ).map(summaryView),
  }),
  tool({
    name: 'get_conversation',
    title: 'Une conversation',
    description:
      'Une conversation entière : le contact, l’état, le résumé de l’IA, les métadonnées et tous les messages — du visiteur, de l’IA, des conseillers, les notes internes et les événements.',
    input: { conversation_id: conversationId },
    example: { conversation_id: SAMPLE_CONVERSATION },
    run: async (deps, token, args) =>
      conversationView(await conversation(deps, token, args.conversation_id)),
  }),
  tool({
    name: 'search_messages',
    title: 'Chercher dans les messages',
    description:
      'Les messages qui contiennent tous ces mots, accents à part, les plus récents d’abord.',
    input: { query: z.string().min(3).describe('Trois caractères au moins.') },
    example: { query: 'remboursement délai' },
    run: (deps, token, args) => search(deps, token, args.query),
  }),
  tool({
    name: 'list_contacts',
    title: 'Contacts',
    description:
      'Les contacts — visiteurs et clients —, cherchés par nom, e-mail ou identifiant client.',
    input: { query: z.string().optional().describe('Tout le monde si absent.') },
    example: { query: 'martin' },
    run: (deps, token, args) => contactsList(deps, token, args.query ?? ''),
  }),
  tool({
    name: 'get_contact',
    title: 'Un contact',
    description: 'Une fiche de contact et ses conversations.',
    input: { contact_id: z.string().uuid().describe('L’identifiant du contact.') },
    example: { contact_id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d' },
    run: (deps, token, args) => contact(deps, token, args.contact_id),
  }),
  tool({
    name: 'send_reply',
    title: 'Répondre au visiteur',
    description:
      'Envoie une réponse au visiteur, signée du nom du jeton. Markdown léger accepté (gras, italique, listes, liens). La conversation quitte l’IA et reste dans la file.',
    write: true,
    input: {
      conversation_id: conversationId,
      text: z.string().min(1).describe('La réponse.'),
      resolve: z.boolean().optional().describe('Résoudre la conversation avec cette réponse.'),
    },
    example: {
      conversation_id: SAMPLE_CONVERSATION,
      text: 'Votre dossier est **complet** : le virement part demain.',
      resolve: true,
    },
    run: async (deps, token, args) =>
      conversationView(
        await reply(deps, token, args.conversation_id, args.text, { resolve: args.resolve }),
      ),
  }),
  tool({
    name: 'add_note',
    title: 'Note interne',
    description: 'Ajoute une note que seule l’équipe voit — jamais le visiteur.',
    write: true,
    input: { conversation_id: conversationId, text: z.string().min(1).describe('La note.') },
    example: { conversation_id: SAMPLE_CONVERSATION, text: 'Client fidèle depuis 2019.' },
    run: async (deps, token, args) =>
      conversationView(await reply(deps, token, args.conversation_id, args.text, { note: true })),
  }),
  tool({
    name: 'assign_conversation',
    title: 'Affecter',
    description:
      'Confie la conversation à un conseiller (list_agents), ou la remet dans la file avec null.',
    write: true,
    input: {
      conversation_id: conversationId,
      agent_id: z.string().uuid().nullable().describe('Un conseiller, ou null pour la file.'),
    },
    example: { conversation_id: SAMPLE_CONVERSATION, agent_id: null },
    run: async (deps, token, args) =>
      conversationView(await assignTo(deps, token, args.conversation_id, args.agent_id)),
  }),
  tool({
    name: 'resolve_conversation',
    title: 'Résoudre',
    description: 'Marque la conversation comme résolue.',
    write: true,
    input: { conversation_id: conversationId },
    example: { conversation_id: SAMPLE_CONVERSATION },
    run: async (deps, token, args) =>
      conversationView(await close(deps, token, args.conversation_id)),
  }),
  tool({
    name: 'add_tag',
    title: 'Étiqueter',
    description: 'Pose une étiquette sur la conversation.',
    write: true,
    input: {
      conversation_id: conversationId,
      label: z.string().min(1).max(60).describe('Le nom de l’étiquette.'),
    },
    example: { conversation_id: SAMPLE_CONVERSATION, label: 'Remboursement' },
    run: async (deps, token, args) =>
      conversationView(await tag(deps, token, args.conversation_id, args.label)),
  }),
  tool({
    name: 'remove_tag',
    title: 'Retirer une étiquette',
    description: 'Retire une étiquette de la conversation.',
    write: true,
    input: {
      conversation_id: conversationId,
      label: z.string().min(1).describe('Le nom de l’étiquette.'),
    },
    example: { conversation_id: SAMPLE_CONVERSATION, label: 'Sinistre' },
    run: async (deps, token, args) =>
      conversationView(await tag(deps, token, args.conversation_id, args.label, true)),
  }),
]

/** The server for one request, its tools bound to the token that asks. */
function serverFor(deps: ServiceDeps, token: TokenContext): McpServer {
  const server = new McpServer(
    { name: 'messagerie', version: VERSION },
    { instructions: INSTRUCTIONS },
  )
  for (const t of TOOLS) {
    if (t.write && !token.write) continue
    const meta = {
      title: t.title,
      description: t.description,
      annotations: t.write
        ? { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
        : { readOnlyHint: true, openWorldHint: false },
    }
    const run = (args: unknown) => answer(() => t.run(deps, token, args as never))
    if (t.input) server.registerTool(t.name, { ...meta, inputSchema: t.input }, (args) => run(args))
    else server.registerTool(t.name, meta, () => run({}))
  }
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
