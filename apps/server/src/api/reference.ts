import { z } from 'zod'
import type { Refusal } from '../refusal.js'

/**
 * The REST API, described once: what each route takes — its parameters, its query, its body,
 * as zod schemas —, what it does, and an example of each way in and out. The routes are
 * registered from this table (`rest.ts`), the requests checked with these schemas, and the
 * documentation and the OpenAPI specification written from it (`documentation.ts`): what is
 * documented is what runs (D16).
 */

export type EndpointGroup =
  | 'token'
  | 'conversations'
  | 'actions'
  | 'contacts'
  | 'search'
  | 'directory'

type NotFound = ConstructorParameters<typeof Refusal>[0]

export interface Endpoint {
  readonly id: string
  readonly method: 'GET' | 'POST' | 'DELETE'
  /** OpenAPI's way: `/conversations/{id}`. */
  readonly path: string
  readonly group: EndpointGroup
  readonly title: string
  readonly description: string
  /** Needs a token with `write`. */
  readonly write: boolean
  /** Path parameters, and the refusal an unknown one gets. */
  readonly params?: Readonly<
    Record<string, { readonly description: string; readonly notFound: NotFound }>
  >
  readonly query?: z.ZodObject
  readonly body?: z.ZodObject
  readonly status: 200 | 201
  /** The path with its parameters filled, as the examples call it. */
  readonly example: {
    readonly path: string
    readonly body?: Readonly<Record<string, unknown>>
    readonly response: unknown
  }
}

const UUID_A = '4f1c2e8a-7b3d-4c9e-a1f0-2d5e6b7c8a90'
const UUID_CONTACT = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
const UUID_AGENT = '0c1d2e3f-4a5b-4c6d-9e8f-7a6b5c4d3e2f'
const UUID_INBOX = '01a0f647-74b7-7450-93a6-8dfe920d8934'
const UUID_SITE = '01a0f647-6c2e-7d41-8b5a-3f9e2c7d1a46'

const SUMMARY = {
  id: UUID_A,
  contact: {
    id: UUID_CONTACT,
    name: 'Léa Martin',
    email: 'lea.martin@exemple.fr',
    identified: true,
  },
  site: 'Acme Assurances',
  siteId: UUID_SITE,
  channel: 'web',
  inboxId: UUID_INBOX,
  teamId: null,
  status: 'open',
  assignee: 'Claire Dubois',
  assigneeId: UUID_AGENT,
  unread: true,
  handedOff: true,
  preview: 'Où en est le remboursement de mon sinistre ?',
  previewAuthor: 'visitor',
  previewAgent: null,
  previewFiles: 0,
  lastMessageAt: '2026-10-02T09:14:00.000Z',
  priority: 'normal',
  sentiment: 'neutral',
  tags: [{ label: 'Sinistre', color: '#f97316', byAi: true }],
}

const CONVERSATION = {
  id: UUID_A,
  status: 'open',
  site: 'Acme Assurances',
  siteId: UUID_SITE,
  channel: 'web',
  inboxId: UUID_INBOX,
  assignee: 'Claire Dubois',
  assigneeId: UUID_AGENT,
  priority: 'normal',
  sentiment: 'neutral',
  intent: 'suivi remboursement',
  summary: 'La cliente demande où en est le remboursement de son sinistre du 28 septembre.',
  tags: [{ label: 'Sinistre', color: '#f97316', byAi: true }],
  data: { contrat: 'AUTO-2291' },
  contact: {
    id: UUID_CONTACT,
    name: 'Léa Martin',
    email: 'lea.martin@exemple.fr',
    identified: true,
  },
  messages: [
    {
      id: '7d1e…',
      at: '2026-10-02T09:12:00.000Z',
      kind: 'visitor',
      body: 'Où en est le remboursement de mon sinistre ?',
      attachments: [],
    },
    {
      id: '8e2f…',
      at: '2026-10-02T09:12:04.000Z',
      kind: 'ai',
      body: 'Le remboursement est versé sous 5 à 10 jours ouvrés…',
      confidence: 0.62,
      sources: [{ title: 'Délai de remboursement', url: null }],
      feedback: null,
    },
    {
      id: '9f30…',
      at: '2026-10-02T09:14:00.000Z',
      kind: 'agent',
      author: 'Claire Dubois',
      authorId: UUID_AGENT,
      body: 'Votre dossier est **complet** : le virement part demain.',
      attachments: [],
    },
  ],
}

const REPLY_BODY = z.object({
  body: z
    .string()
    .min(1)
    .describe('Le texte, en Markdown léger : **gras**, *italique*, listes, liens.'),
  kind: z
    .enum(['reply', 'note'])
    .optional()
    .describe('`reply` (par défaut) : au visiteur. `note` : à l’équipe seule.'),
  resolve: z.boolean().optional().describe('Résoudre la conversation avec cette réponse.'),
})

const START_BODY = z.object({
  channel: z
    .enum(['sms', 'email'])
    .describe(
      '`sms` : depuis un numéro de « Numéros SMS ». `email` : par e-mail, quand le serveur en écrit.',
    ),
  contactId: z.string().uuid().optional().describe('Un contact connu.'),
  phone: z
    .string()
    .optional()
    .describe(
      'Pour `sms` : le numéro, au format international (`+33612345678`), si le contact n’en a pas.',
    ),
  email: z.string().optional().describe('Pour `email` : l’adresse, si le contact n’en a pas.'),
  name: z
    .string()
    .optional()
    .describe('Le nom d’un nouveau contact. Aucun : son numéro ou son adresse.'),
  numberId: z
    .string()
    .uuid()
    .optional()
    .describe('Pour `sms` : le numéro d’envoi. Aucun : celui du site du contact, ou le premier.'),
  siteId: z
    .string()
    .uuid()
    .optional()
    .describe('Pour `email` à une nouvelle adresse : le site. Aucun : le premier site actif.'),
  body: z.string().min(1).max(4000).describe('Le message.'),
})

export const ENDPOINTS: readonly Endpoint[] = [
  {
    id: 'me',
    method: 'GET',
    path: '/me',
    group: 'token',
    title: 'Le jeton',
    description:
      'Ce que le jeton utilisé peut faire : son nom, ses droits (`read` ou `write`), ses accès (`rest`, `mcp`), les boîtes qu’il atteint (`null` : toutes celles de son créateur) et son expiration.',
    write: false,
    status: 200,
    example: {
      path: '/me',
      response: {
        data: {
          label: 'Synchronisation CRM',
          prefix: 'msg_k3v9x2ma',
          access: 'write',
          surfaces: ['rest', 'mcp'],
          inboxIds: null,
          expiresAt: null,
        },
      },
    },
  },
  {
    id: 'listConversations',
    method: 'GET',
    path: '/conversations',
    group: 'conversations',
    title: 'Lister les conversations',
    description:
      'Les conversations que le jeton atteint, la plus récente d’abord : leur contact, leur état, leur conseiller, leurs étiquettes et leur dernier message. Non résolues par défaut.',
    write: false,
    query: z.object({
      status: z
        .enum(['unresolved', 'ai', 'open', 'pending', 'resolved', 'all'])
        .optional()
        .describe(
          '`unresolved` (par défaut), `ai` : l’IA répond, `open`, `pending`, `resolved`, `all`.',
        ),
      inbox: z.string().optional().describe('Une boîte de réception seulement.'),
      assignee: z
        .string()
        .optional()
        .describe('Un conseiller, par son identifiant ; `none` pour la file d’attente.'),
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe('50 par défaut, 200 au plus.'),
    }),
    status: 200,
    example: { path: '/conversations?status=open&limit=20', response: { data: [SUMMARY] } },
  },
  {
    id: 'getConversation',
    method: 'GET',
    path: '/conversations/{id}',
    group: 'conversations',
    title: 'Lire une conversation',
    description:
      'Une conversation entière : son contact, son état, le résumé de l’IA, ses métadonnées et tous ses messages — du visiteur, de l’IA, des conseillers —, les notes internes et les événements, dans l’ordre.',
    write: false,
    params: {
      id: { description: 'L’identifiant de la conversation.', notFound: 'CONVERSATION_NOT_FOUND' },
    },
    status: 200,
    example: { path: `/conversations/${UUID_A}`, response: { data: CONVERSATION } },
  },
  {
    id: 'sendMessage',
    method: 'POST',
    path: '/conversations/{id}/messages',
    group: 'actions',
    title: 'Répondre ou noter',
    description:
      'Envoie une réponse au visiteur, signée du nom du jeton — ou, avec `kind: "note"`, une note que seule l’équipe voit. Une réponse fait quitter la conversation à l’IA ; elle reste dans la file, sans conseiller. Une conversation résolue est rouverte.',
    write: true,
    params: {
      id: { description: 'L’identifiant de la conversation.', notFound: 'CONVERSATION_NOT_FOUND' },
    },
    body: REPLY_BODY,
    status: 201,
    example: {
      path: `/conversations/${UUID_A}/messages`,
      body: { body: 'Votre dossier est **complet** : le virement part demain.', resolve: true },
      response: { data: { ...CONVERSATION, status: 'resolved' } },
    },
  },
  {
    id: 'startConversation',
    method: 'POST',
    path: '/conversations',
    group: 'actions',
    title: 'Écrire en premier',
    description:
      'Écrit le premier à un client : par SMS depuis un numéro de la messagerie, ou par e-mail. Un contact connu, ou un numéro, ou une adresse. La conversation est celle de ce téléphone sur ce numéro, ou celle du widget du contact — sinon une nouvelle, dans la boîte de son site. Elle reste dans la file, sans conseiller.',
    write: true,
    body: START_BODY,
    status: 201,
    example: {
      path: '/conversations',
      body: {
        channel: 'sms',
        phone: '+33612345678',
        body: 'Bonjour, votre attestation est prête dans votre espace client.',
      },
      response: { data: { ...CONVERSATION, channel: 'sms' } },
    },
  },
  {
    id: 'assign',
    method: 'POST',
    path: '/conversations/{id}/assign',
    group: 'actions',
    title: 'Affecter',
    description:
      'Confie la conversation à un conseiller actif — il en est averti —, ou la remet dans la file avec `null`.',
    write: true,
    params: {
      id: { description: 'L’identifiant de la conversation.', notFound: 'CONVERSATION_NOT_FOUND' },
    },
    body: z.object({
      assigneeId: z
        .string()
        .uuid()
        .nullable()
        .describe('Un conseiller (voir `GET /agents`), ou `null`.'),
    }),
    status: 200,
    example: {
      path: `/conversations/${UUID_A}/assign`,
      body: { assigneeId: UUID_AGENT },
      response: { data: CONVERSATION },
    },
  },
  {
    id: 'resolve',
    method: 'POST',
    path: '/conversations/{id}/resolve',
    group: 'actions',
    title: 'Résoudre',
    description:
      'Marque la conversation comme résolue. Un nouveau message du visiteur la rouvrira.',
    write: true,
    params: {
      id: { description: 'L’identifiant de la conversation.', notFound: 'CONVERSATION_NOT_FOUND' },
    },
    status: 200,
    example: {
      path: `/conversations/${UUID_A}/resolve`,
      response: { data: { ...CONVERSATION, status: 'resolved' } },
    },
  },
  {
    id: 'addTag',
    method: 'POST',
    path: '/conversations/{id}/tags',
    group: 'actions',
    title: 'Étiqueter',
    description:
      'Pose une étiquette sur la conversation. Une étiquette de « Réponses types › Étiquettes » prend sa couleur.',
    write: true,
    params: {
      id: { description: 'L’identifiant de la conversation.', notFound: 'CONVERSATION_NOT_FOUND' },
    },
    body: z.object({ label: z.string().min(1).max(60).describe('Le nom de l’étiquette.') }),
    status: 200,
    example: {
      path: `/conversations/${UUID_A}/tags`,
      body: { label: 'Remboursement' },
      response: { data: CONVERSATION },
    },
  },
  {
    id: 'removeTag',
    method: 'DELETE',
    path: '/conversations/{id}/tags/{label}',
    group: 'actions',
    title: 'Retirer une étiquette',
    description: 'Retire une étiquette de la conversation.',
    write: true,
    params: {
      id: { description: 'L’identifiant de la conversation.', notFound: 'CONVERSATION_NOT_FOUND' },
      label: {
        description: 'Le nom de l’étiquette, encodé pour une adresse.',
        notFound: 'INVALID_REQUEST',
      },
    },
    status: 200,
    example: { path: `/conversations/${UUID_A}/tags/Sinistre`, response: { data: CONVERSATION } },
  },
  {
    id: 'listContacts',
    method: 'GET',
    path: '/contacts',
    group: 'contacts',
    title: 'Lister les contacts',
    description:
      'Les contacts — visiteurs anonymes et clients identifiés par leur site —, le plus récent d’abord, 200 au plus. Un jeton limité à des boîtes n’atteint que ceux qui y ont écrit.',
    write: false,
    query: z.object({
      q: z.string().optional().describe('Un nom, un e-mail ou un identifiant client.'),
    }),
    status: 200,
    example: {
      path: '/contacts?q=martin',
      response: {
        data: [
          {
            id: UUID_CONTACT,
            name: 'Léa Martin',
            email: 'lea.martin@exemple.fr',
            identified: true,
            site: 'Acme Assurances',
            conversations: 3,
            lastMessageAt: '2026-10-02T09:14:00.000Z',
          },
        ],
      },
    },
  },
  {
    id: 'getContact',
    method: 'GET',
    path: '/contacts/{id}',
    group: 'contacts',
    title: 'Lire un contact',
    description:
      'La fiche d’un contact : ce que son site a transmis, ce que la page ou un conseiller a déclaré, et ses conversations.',
    write: false,
    params: { id: { description: 'L’identifiant du contact.', notFound: 'CONTACT_NOT_FOUND' } },
    status: 200,
    example: {
      path: `/contacts/${UUID_CONTACT}`,
      response: {
        data: {
          contact: {
            id: UUID_CONTACT,
            name: 'Léa Martin',
            email: 'lea.martin@exemple.fr',
            identified: true,
          },
          site: 'Acme Assurances',
          conversations: [
            {
              id: UUID_A,
              subject: 'Où en est le remboursement de mon sinistre ?',
              status: 'open',
              at: '2026-10-02T09:12:00.000Z',
            },
          ],
        },
      },
    },
  },
  {
    id: 'search',
    method: 'GET',
    path: '/search',
    group: 'search',
    title: 'Chercher dans les messages',
    description:
      'Les messages qui contiennent tous ces mots, dans n’importe quel ordre, accents et majuscules à part — les plus récents d’abord, 20 au plus.',
    write: false,
    query: z.object({ q: z.string().min(3).describe('Trois caractères au moins.') }),
    status: 200,
    example: {
      path: '/search?q=remboursement%20delai',
      response: {
        data: [
          {
            conversationId: UUID_A,
            messageId: '7d1e…',
            contactName: 'Léa Martin',
            author: 'visitor',
            at: '2026-10-02T09:12:00.000Z',
            body: 'Quel est le délai de remboursement ?',
          },
        ],
      },
    },
  },
  {
    id: 'inboxes',
    method: 'GET',
    path: '/inboxes',
    group: 'directory',
    title: 'Les boîtes de réception',
    description: 'Les boîtes actives que le jeton atteint.',
    write: false,
    status: 200,
    example: {
      path: '/inboxes',
      response: {
        data: [{ id: UUID_INBOX, name: 'Service client', description: 'Questions générales' }],
      },
    },
  },
  {
    id: 'agents',
    method: 'GET',
    path: '/agents',
    group: 'directory',
    title: 'Les conseillers',
    description:
      'Les conseillers actifs, à qui une conversation peut être affectée, avec leurs équipes.',
    write: false,
    status: 200,
    example: {
      path: '/agents',
      response: {
        data: [
          {
            id: UUID_AGENT,
            name: 'Claire Dubois',
            email: 'claire.dubois@acme.fr',
            role: 'agent',
            teamIds: ['01a0f647-7a1c-7c2e-9d3f-4b5a6c7d8e9f'],
          },
        ],
      },
    },
  },
]
