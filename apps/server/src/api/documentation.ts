import type { DocSection } from '@chat/contracts'
import { z } from 'zod'
import { INSTRUCTIONS, MEANING, TOOLS, type Tool, VERSION } from './mcp.js'
import { ENDPOINTS, type Endpoint, type EndpointGroup } from './reference.js'

/**
 * The documentation of the API and the MCP server, written from what runs (D16): the
 * routes of `reference.ts`, the tools of `mcp.ts`. Sections of Markdown in basedb's closed
 * subset — `###` headings, tables, `> [!NOTE]` callouts, fences with a `title` — that the
 * inbox draws as basedb draws its own; and the OpenAPI 3.1 specification of the REST API.
 */

// ── Markdown, in basedb's subset ─────────────────────────────────────────────────────

const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/\n/g, ' ')

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [
    `| ${header.map(cell).join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n')
}

const fence = (lang: string, title: string, body: string) =>
  `\`\`\`${lang} title="${title}"\n${body}\n\`\`\``

const callout = (kind: 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING', text: string) =>
  `> [!${kind}]\n${text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')}`

const json = (value: unknown) => JSON.stringify(value, null, 2)

// ── What a schema takes ──────────────────────────────────────────────────────────────

interface Field {
  readonly name: string
  readonly type: string
  readonly required: boolean
  readonly description: string
}

type JsonSchema = {
  type?: string | string[]
  enum?: unknown[]
  anyOf?: JsonSchema[]
  format?: string
  description?: string
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  properties?: Record<string, JsonSchema>
  required?: string[]
}

function typeOf(schema: JsonSchema): string {
  if (schema.enum) return schema.enum.map((v) => `\`${String(v)}\``).join(' · ')
  if (schema.anyOf) return schema.anyOf.map(typeOf).join(' ou ')
  if (schema.type === 'null') return '`null`'
  if (schema.format === 'uuid') return 'identifiant'
  if (schema.type === 'integer' || schema.type === 'number') {
    const range =
      schema.minimum !== undefined && schema.maximum !== undefined
        ? ` (${schema.minimum} à ${schema.maximum})`
        : ''
    return `nombre${range}`
  }
  if (schema.type === 'boolean') return 'booléen'
  if (schema.type === 'string') return 'texte'
  return String(schema.type ?? 'valeur')
}

function fieldsOf(schema: z.ZodObject | z.ZodRawShape | undefined): Field[] {
  if (!schema) return []
  const object = schema instanceof z.ZodObject ? schema : z.object(schema)
  const described = z.toJSONSchema(object, { io: 'input' }) as JsonSchema
  const required = new Set(described.required ?? [])
  return Object.entries(described.properties ?? {}).map(([name, property]) => ({
    name,
    type: typeOf(property),
    required: required.has(name),
    description: property.description ?? '',
  }))
}

const fieldsTable = (fields: readonly Field[]) =>
  table(
    ['Nom', 'Type', 'Requis', 'Description'],
    fields.map((f) => [`\`${f.name}\``, f.type, f.required ? 'oui' : 'non', f.description]),
  )

// ── The REST API ─────────────────────────────────────────────────────────────────────

const GROUPS: Readonly<
  Record<EndpointGroup, { readonly slug: string; readonly title: string; readonly intro: string }>
> = {
  token: {
    slug: 'jeton',
    title: 'Le jeton',
    intro:
      'Ce que peut le jeton qui appelle — pour vérifier une configuration avant tout le reste.',
  },
  conversations: {
    slug: 'conversations',
    title: 'Conversations',
    intro:
      'Les conversations que le jeton atteint, et chacune avec tous ses messages. Une liste se lit la plus récente d’abord.',
  },
  actions: {
    slug: 'actions',
    title: 'Répondre et agir',
    intro:
      'Ce qu’un jeton en écriture peut faire d’une conversation. Chaque action rend la conversation telle qu’elle est ensuite, et l’inbox la montre aussitôt aux conseillers. Rien ne se supprime.',
  },
  contacts: {
    slug: 'contacts',
    title: 'Contacts',
    intro: 'Les visiteurs et les clients, et leurs fiches.',
  },
  search: {
    slug: 'recherche',
    title: 'Recherche',
    intro: 'Les mots des messages, dans toutes les conversations que le jeton atteint.',
  },
  directory: {
    slug: 'boites-et-conseillers',
    title: 'Boîtes et conseillers',
    intro:
      'Les boîtes de réception et les conseillers : ce qu’un filtre ou une affectation demande.',
  },
}

function examples(base: string, endpoint: Endpoint): string {
  const url = `${base}/api/v1${endpoint.example.path}`
  const body = endpoint.example.body
  const curl = [
    `curl${endpoint.method === 'GET' ? '' : ` -X ${endpoint.method}`} "${url}"`,
    '  -H "Authorization: Bearer $MESSAGERIE_TOKEN"',
    ...(body ? ['  -H "Content-Type: application/json"', `  -d '${JSON.stringify(body)}'`] : []),
  ].join(' \\\n')
  const js = [
    `const response = await fetch('${url}', {`,
    ...(endpoint.method === 'GET' ? [] : [`  method: '${endpoint.method}',`]),
    '  headers: {',
    '    Authorization: `Bearer ${process.env.MESSAGERIE_TOKEN}`,',
    ...(body ? ["    'Content-Type': 'application/json',"] : []),
    '  },',
    ...(body ? [`  body: JSON.stringify(${JSON.stringify(body)}),`] : []),
    '})',
    'const { data } = await response.json()',
  ].join('\n')
  const python = [
    'import os, requests',
    '',
    `response = requests.${endpoint.method.toLowerCase()}(`,
    `    "${url}",`,
    '    headers={"Authorization": f"Bearer {os.environ[\'MESSAGERIE_TOKEN\']}"},',
    ...(body
      ? [
          `    json=${JSON.stringify(body).replace(/true/g, 'True').replace(/false/g, 'False').replace(/null/g, 'None')},`,
        ]
      : []),
    ')',
    'data = response.json()["data"]',
  ].join('\n')
  return [
    fence('bash', 'cURL', curl),
    fence('javascript', 'JavaScript', js),
    fence('python', 'Python', python),
  ].join('\n\n')
}

function endpointMarkdown(base: string, endpoint: Endpoint): string {
  const parts = [
    `### ${endpoint.title}`,
    `\`${endpoint.method} /api/v1${endpoint.path}\` · ${endpoint.write ? '**écriture**' : 'lecture'}`,
    endpoint.description,
  ]
  const params = Object.entries(endpoint.params ?? {}).map(([name, p]) => [
    `\`${name}\``,
    'chemin',
    p.description,
  ])
  const query = fieldsOf(endpoint.query).map((f) => [
    `\`${f.name}\``,
    'requête',
    `${f.type}${f.required ? ', requis' : ''} — ${f.description}`,
  ])
  if (params.length + query.length > 0) {
    parts.push('#### Paramètres', table(['Nom', 'Où', 'Description'], [...params, ...query]))
  }
  if (endpoint.body) parts.push('#### Corps', fieldsTable(fieldsOf(endpoint.body)))
  parts.push('#### Exemple', examples(base, endpoint))
  parts.push(
    `Réponse \`${endpoint.status}\` :`,
    fence(
      'json',
      endpoint.status === 201 ? '201 Created' : '200 OK',
      json(endpoint.example.response),
    ),
  )
  return parts.join('\n\n')
}

// ── The MCP server ───────────────────────────────────────────────────────────────────

function toolMarkdown(tool: Tool): string {
  const fields = fieldsOf(tool.input)
  return [
    `### ${tool.title}`,
    `\`${tool.name}\` · ${tool.write ? '**écriture** — proposé aux jetons en écriture seulement' : 'lecture'}`,
    tool.description,
    fields.length > 0 ? `#### Arguments\n\n${fieldsTable(fields)}` : 'Sans argument.',
    '#### Appel',
    fence(
      'json',
      'tools/call',
      json({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: tool.name, arguments: tool.example ?? {} },
      }),
    ),
  ].join('\n\n')
}

// ── The sections ─────────────────────────────────────────────────────────────────────

const START = 'Démarrer'
const REST = 'API REST'
const MCP = 'MCP'

const ERRORS: readonly (readonly [string, number, string])[] = [
  [
    'TOKEN_INVALID',
    401,
    'Pas de jeton, un jeton mal formé ou inconnu, un jeton d’une autre surface, ou dont le créateur n’est plus conseiller.',
  ],
  ['TOKEN_EXPIRED', 401, 'Le jeton a dépassé sa date d’expiration.'],
  ['TOKEN_REVOKED', 401, 'Le jeton a été révoqué.'],
  ['TOKEN_READ_ONLY', 403, 'Une écriture avec un jeton en lecture seule.'],
  [
    'INVALID_REQUEST',
    400,
    'Un paramètre ou un corps mal formé : `details.issues` dit lequel et pourquoi.',
  ],
  ['EMPTY_MESSAGE', 400, 'Un message vide.'],
  [
    'CONVERSATION_NOT_FOUND',
    404,
    'Une conversation qui n’existe pas, ou que le jeton n’atteint pas.',
  ],
  ['CONTACT_NOT_FOUND', 404, 'Un contact qui n’existe pas, ou que le jeton n’atteint pas.'],
  ['AGENT_NOT_FOUND', 404, 'Un conseiller inconnu ou qui n’est plus actif.'],
  ['RATE_LIMITED', 429, 'Plus de 240 requêtes en une minute pour ce jeton.'],
  ['INTERNAL_ERROR', 500, 'Une erreur du serveur — elle est journalisée.'],
]

export function documentation(base: string): DocSection[] {
  const sections: DocSection[] = []
  const add = (id: string, group: string, title: string, ...blocks: string[]) =>
    sections.push({ id, group, title, markdown: blocks.join('\n\n') })

  add(
    'presentation',
    START,
    'Présentation',
    'La Messagerie s’ouvre aux programmes et aux agents par deux portes, avec les mêmes jetons et les mêmes droits :',
    table(
      ['Porte', 'Adresse', 'Pour'],
      [
        [
          'API REST',
          `\`${base}/api/v1\``,
          'Un programme, un script, une synchronisation : JSON, avec le jeton en en-tête.',
        ],
        [
          'Serveur MCP',
          `\`${base}/mcp\``,
          'Un agent — Claude ou tout client MCP — qui lit les conversations et y répond.',
        ],
      ],
    ),
    '### Premier appel',
    'Créez un jeton dans **Paramétrage › API et MCP**, gardez-le dans la variable d’environnement `MESSAGERIE_TOKEN`, puis demandez ce qu’il peut faire :',
    fence(
      'bash',
      'cURL',
      `curl ${base}/api/v1/me \\\n  -H "Authorization: Bearer $MESSAGERIE_TOKEN"`,
    ),
    '### Ce qu’on y trouve',
    '- les **conversations** que le jeton atteint, et chacune avec ses messages — du visiteur, de l’IA, des conseillers, les notes internes ;\n- les **actions** d’un conseiller : répondre, noter, affecter, résoudre, étiqueter ;\n- les **contacts** et la **recherche** dans les messages ;\n- les **boîtes de réception** et les **conseillers**.',
    callout(
      'NOTE',
      'Ce que fait un jeton passe par les mêmes fonctions que l’inbox : une réponse envoyée par l’API apparaît aussitôt aux conseillers, signée du nom du jeton, et part au visiteur.',
    ),
    '### Le format',
    'Tout est en JSON. Une réponse porte ses données sous `data` ; un refus porte un `code` et, parfois, des `details`, avec le statut HTTP qui le dit. Les dates sont en ISO 8601, en UTC.',
  )

  add(
    'jetons',
    START,
    'Jetons et droits',
    'Un jeton se crée dans **Paramétrage › API et MCP**, par un superviseur. Il ne s’affiche qu’une fois : copiez-le à sa création.',
    '### Sa forme',
    'Un jeton s’écrit `msg_<préfixe>_<secret>` : huit caractères gardés en clair, qui le distinguent dans la liste, puis un secret de 43 caractères. Seule son empreinte (SHA-256) est gardée : un jeton perdu ne se retrouve pas, il se remplace.',
    fence('http', 'En-tête', 'Authorization: Bearer msg_k3v9x2ma_…'),
    '### Ses droits',
    table(
      ['Droits', 'Permet'],
      [
        [
          'Lecture seule',
          'Lire les conversations, les contacts, les boîtes, les conseillers ; chercher dans les messages.',
        ],
        ['Lecture et écriture', 'Aussi répondre, noter, affecter, résoudre, étiqueter.'],
      ],
    ),
    callout('IMPORTANT', 'Aucun jeton ne supprime quoi que ce soit, et aucun ne gère les jetons.'),
    '### Ses accès',
    'Un jeton s’ouvre à l’API REST, au serveur MCP, ou aux deux. Pris sur une porte qu’il n’ouvre pas, il est refusé (`TOKEN_INVALID`).',
    '### Ses boîtes',
    'Un jeton atteint toutes les boîtes de réception de son créateur, ou seulement certaines. Une conversation d’une autre boîte n’existe pas pour lui (`CONVERSATION_NOT_FOUND`), ni un contact qui n’y a jamais écrit.',
    '### Sa vie',
    '- **Expiration** : aucune, ou 30, 90, 180 jours ou un an.\n- **Révocation** : immédiate, depuis la liste des jetons.\n- **Créateur** : si son créateur n’est plus conseiller, le jeton est refusé.\n- **Dernière utilisation** : notée, au plus toutes les cinq minutes.',
    '### Qui écrit',
    'Ce qu’écrit un jeton est signé de son nom dans le fil — « Synchronisation CRM ». Ce nom ne figure dans aucune liste de conseillers et ne reçoit aucune alerte. Une réponse envoyée par un jeton fait quitter la conversation à l’IA, mais ne lui est pas affectée : elle reste dans la file.',
    callout(
      'WARNING',
      'Gardez le jeton dans une variable d’environnement, jamais dans le code, un dépôt ou un message.',
    ),
  )

  add(
    'erreurs',
    START,
    'Erreurs',
    'Un refus est un objet JSON, avec le statut HTTP qui convient :',
    fence(
      'json',
      '400 Bad Request',
      json({
        code: 'INVALID_REQUEST',
        details: { issues: [{ field: 'status', message: 'Invalid option' }] },
      }),
    ),
    '### Les codes',
    table(
      ['Code', 'Statut', 'Sens'],
      ERRORS.map(([code, status, meaning]) => [`\`${code}\``, String(status), meaning]),
    ),
  )

  add(
    'limites',
    START,
    'Limites',
    table(
      ['Quoi', 'Limite'],
      [
        [
          'Requêtes par jeton',
          '240 par minute, sur l’API et le MCP chacun ; au-delà, `429 RATE_LIMITED`.',
        ],
        ['Conversations par liste', '50 par défaut, 200 au plus (`limit`).'],
        ['Contacts par liste', '200.'],
        ['Résultats d’une recherche', '20, les plus récents.'],
        ['Mots cherchés', '3 caractères au moins.'],
        ['Étiquette', '60 caractères.'],
      ],
    ),
  )

  for (const [group, meta] of Object.entries(GROUPS) as [
    EndpointGroup,
    (typeof GROUPS)[EndpointGroup],
  ][]) {
    const routes = ENDPOINTS.filter((e) => e.group === group)
    add(meta.slug, REST, meta.title, meta.intro, ...routes.map((e) => endpointMarkdown(base, e)))
  }

  add(
    'objets',
    REST,
    'Objets',
    'Les objets que rendent les routes, champ par champ.',
    '### Conversation dans une liste',
    table(
      ['Champ', 'Sens'],
      [
        ['`id`', 'L’identifiant de la conversation.'],
        [
          '`contact`',
          '`id`, `name`, `email`, `identified` : `true` quand le site a signé l’identité.',
        ],
        ['`site`, `inboxId`, `teamId`', 'Le site d’où elle vient, sa boîte, son équipe.'],
        ['`status`', '`ai` : l’IA répond · `open` · `pending` · `resolved`.'],
        ['`assignee`, `assigneeId`', 'Le conseiller qui l’a, ou `null` : la file.'],
        ['`unread`', 'Un message du visiteur attend.'],
        ['`preview`, `previewAuthor`', 'Le dernier message : `visitor`, `agent`, `ai`.'],
        ['`lastMessageAt`', 'Sa date.'],
        ['`priority`, `sentiment`, `tags`', 'Ce que l’IA ou un conseiller en a dit.'],
      ],
    ),
    '### Conversation',
    'Les champs d’une conversation dans une liste, et aussi :',
    table(
      ['Champ', 'Sens'],
      [
        ['`intent`, `summary`', 'L’intention et le résumé qu’en a faits l’IA.'],
        ['`data`', 'Les métadonnées que la page ou un conseiller a jointes.'],
        ['`contact`', 'La fiche entière.'],
        ['`messages`', 'Tous les messages, dans l’ordre — voir ci-dessous.'],
      ],
    ),
    '### Message',
    'Un message a un `id`, une date `at` et un `kind` :',
    table(
      ['`kind`', 'Champs'],
      [
        ['`visitor`', '`body`, `attachments` — ce qu’a écrit le visiteur.'],
        [
          '`agent`',
          '`author`, `authorId`, `body`, `attachments` — une réponse d’un conseiller ou d’un jeton.',
        ],
        ['`note`', '`author`, `authorId`, `body` — une note que seule l’équipe voit.'],
        ['`ai`', '`body`, `confidence` (0 à 1), `sources`, `feedback` — une réponse de l’IA.'],
        ['`event`', '`event` — un conseiller a repris, transféré, résolu…'],
        ['`handoff`', 'L’IA a passé la main, avec son résumé.'],
      ],
    ),
    'Un message supprimé pour tout le monde porte `deleted` (`by`, `at`) et un `body` vide. Le texte est dans le petit Markdown de la Messagerie : **gras**, *italique*, listes, liens, citations.',
  )

  add(
    'mcp',
    MCP,
    'Se connecter',
    `Le serveur MCP de la Messagerie répond à \`${base}/mcp\`, avec un jeton ouvert au MCP.`,
    callout('NOTE', INSTRUCTIONS),
    '### Claude Code',
    fence(
      'bash',
      'Claude Code',
      `claude mcp add --transport http messagerie ${base}/mcp \\\n  --header "Authorization: Bearer $MESSAGERIE_TOKEN"`,
    ),
    '### Un client qui lit un fichier de configuration',
    'Cursor, VS Code, un `.mcp.json` de projet :',
    fence(
      'json',
      'mcpServers',
      json({
        mcpServers: {
          messagerie: {
            type: 'http',
            url: `${base}/mcp`,
            headers: { Authorization: 'Bearer ${MESSAGERIE_TOKEN}' },
          },
        },
      }),
    ),
    '### Un client qui ne parle que stdio',
    'Le relais `mcp-remote` fait le lien :',
    fence(
      'json',
      'mcp-remote',
      json({
        mcpServers: {
          messagerie: {
            command: 'npx',
            args: [
              '-y',
              'mcp-remote',
              `${base}/mcp`,
              '--header',
              'Authorization:Bearer ${MESSAGERIE_TOKEN}',
            ],
            env: { MESSAGERIE_TOKEN: 'msg_…' },
          },
        },
      }),
    ),
    '### Le protocole',
    `- **Transport** : HTTP « Streamable », réponses JSON — \`POST /mcp\` seulement ; \`GET\` et \`DELETE\` répondent 405.\n- **Session** : aucune. Chaque requête vérifie le jeton et ses droits ; une révocation vaut à la requête suivante.\n- **Page web** : une requête qui porte un en-tête \`Origin\` est refusée — un client MCP est un programme.\n- **Serveur** : \`messagerie\`, version ${VERSION}.`,
    '### Les outils',
    table(
      ['Outil', 'Droits', 'Ce qu’il fait'],
      TOOLS.map((t) => [`\`${t.name}\``, t.write ? 'écriture' : 'lecture', t.title]),
    ),
  )

  add(
    'outils-lecture',
    MCP,
    'Outils de lecture',
    'Proposés à tout jeton ouvert au MCP.',
    ...TOOLS.filter((t) => !t.write).map(toolMarkdown),
  )
  add(
    'outils-ecriture',
    MCP,
    'Outils d’écriture',
    'Proposés aux jetons en lecture et écriture seulement : un jeton en lecture seule ne les voit pas.',
    callout(
      'IMPORTANT',
      'Une réponse envoyée par `send_reply` part au visiteur : relisez-la avant.',
    ),
    ...TOOLS.filter((t) => t.write).map(toolMarkdown),
  )
  add(
    'refus-des-outils',
    MCP,
    'Refus des outils',
    'Un outil refusé ne lève pas d’erreur JSON-RPC : il rend un résultat marqué `isError`, dont le texte est un objet JSON — un code, et ce qu’il veut dire.',
    fence(
      'json',
      'Résultat refusé',
      json({
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({ code: 'TOKEN_READ_ONLY', message: MEANING.TOKEN_READ_ONLY }),
          },
        ],
      }),
    ),
    table(
      ['Code', 'Sens'],
      Object.entries(MEANING).map(([code, meaning]) => [`\`${code}\``, meaning]),
    ),
    'Un jeton refusé, lui, l’est avant tout outil : une erreur JSON-RPC `-32000` avec le statut HTTP 401, et son code en message.',
  )

  return sections
}

// ── OpenAPI 3.1 ───────────────────────────────────────────────────────────────────────

export function openApi(base: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const endpoint of ENDPOINTS) {
    const group = GROUPS[endpoint.group]
    const params = Object.entries(endpoint.params ?? {}).map(([name, p]) => ({
      name,
      in: 'path',
      required: true,
      description: p.description,
      schema: { type: 'string' },
    }))
    const query = endpoint.query
      ? (() => {
          const described = z.toJSONSchema(endpoint.query, { io: 'input' }) as JsonSchema
          const required = new Set(described.required ?? [])
          return Object.entries(described.properties ?? {}).map(([name, schema]) => ({
            name,
            in: 'query',
            required: required.has(name),
            description: schema.description,
            schema: { ...schema, description: undefined },
          }))
        })()
      : []
    paths[endpoint.path] = {
      ...paths[endpoint.path],
      [endpoint.method.toLowerCase()]: {
        operationId: endpoint.id,
        summary: endpoint.title,
        description: endpoint.description,
        tags: [group.title],
        ...(params.length + query.length > 0 ? { parameters: [...params, ...query] } : {}),
        ...(endpoint.body
          ? {
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: z.toJSONSchema(endpoint.body, { io: 'input' }),
                    ...(endpoint.example.body ? { example: endpoint.example.body } : {}),
                  },
                },
              },
            }
          : {}),
        responses: {
          [String(endpoint.status)]: {
            description: endpoint.title,
            content: { 'application/json': { example: endpoint.example.response } },
          },
          ...(endpoint.write ? { '403': { $ref: '#/components/responses/Refused' } } : {}),
          '400': { $ref: '#/components/responses/Refused' },
          '401': { $ref: '#/components/responses/Refused' },
          '404': { $ref: '#/components/responses/Refused' },
          '429': { $ref: '#/components/responses/Refused' },
        },
      },
    }
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Messagerie — API REST',
      version: '1',
      description:
        'La messagerie client, ouverte aux programmes : conversations, réponses, contacts, recherche. Un jeton `msg_…` se crée dans Paramétrage › API et MCP.',
    },
    servers: [{ url: `${base}/api/v1` }],
    security: [{ token: [] }],
    tags: Object.values(GROUPS).map((g) => ({ name: g.title, description: g.intro })),
    paths,
    components: {
      securitySchemes: {
        token: { type: 'http', scheme: 'bearer', bearerFormat: 'msg_<préfixe>_<secret>' },
      },
      schemas: {
        Refusal: {
          type: 'object',
          required: ['code'],
          properties: {
            code: { type: 'string', enum: ERRORS.map(([code]) => code) },
            details: { type: 'object' },
          },
        },
      },
      responses: {
        Refused: {
          description: 'Un refus : son code, et parfois des détails.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Refusal' } } },
        },
      },
    },
  }
}
