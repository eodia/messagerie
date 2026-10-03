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
const WEBHOOKS = 'Webhooks'

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
        [
          '`site`, `siteId`, `inboxId`, `teamId`',
          'Le site d’où elle vient — son nom à l’arrivée, puis son identifiant —, sa boîte, son équipe.',
        ],
        ['`channel`', '`web` : le widget · `sms` · `rcs` : le téléphone du visiteur.'],
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
        [
          '`pages`',
          'Les pages que le visiteur a ouvertes, la plus récente d’abord : `url`, `title`, `at`, `leftAt` (`null` tant qu’elle est ouverte).',
        ],
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
    'Une réponse (`agent`, `ai`) partie hors du widget porte `delivery` : `by` (`sms` — SMS ou RCS — ou `email`, au visiteur parti), `status` (`pending`, `sent`, `delivered`, `read`, `failed`) et, en échec, `error` — le code du fournisseur (`TWILIO_21610`…) ou de la Messagerie.',
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

  add(
    'webhooks',
    WEBHOOKS,
    'Principe',
    'Un webhook fait l’inverse de l’API : c’est la Messagerie qui appelle un autre système — un CRM, un entrepôt de données, une alerte —, dans les secondes, quand quelque chose se passe dans les conversations.',
    '### Le créer',
    'Dans **Paramétrage › API et MCP**, onglet **Webhooks** : un nom, une adresse HTTPS, les événements qui la préviennent, et les boîtes de réception qu’elle écoute. Son **secret de signature** n’est affiché qu’une fois : gardez-le du côté du système destinataire.',
    '### L’appel',
    'Un `POST` en JSON, jusqu’à 50 événements à la fois, les plus anciens en premier :',
    fence(
      'http',
      'Requête',
      [
        'POST /messagerie HTTP/1.1',
        'Content-Type: application/json',
        'User-Agent: messagerie-webhook/1',
        'X-Messagerie-Signature: t=1790930043,v1=5f2b…',
        'X-Messagerie-Delivery-Id: 1d5e…',
        'X-Messagerie-Webhook-Id: 7c0a…',
        '',
        json({
          events: [
            {
              id: '6f1c2e8a-…',
              type: 'message.created',
              occurredAt: '2026-10-02T09:14:03.512Z',
              conversation: { id: '4f1c2e8a-…', status: 'open' },
              message: { id: '9a8b7c6d-…', kind: 'visitor', body: 'Où en est mon remboursement ?' },
            },
          ],
        }),
      ].join('\n'),
    ),
    table(
      ['En-tête', 'Ce qu’il porte'],
      [
        [
          '`X-Messagerie-Signature`',
          '`t=<secondes>,v1=<hex>` : le HMAC-SHA256, avec le secret, de `<t>.<corps brut>`.',
        ],
        [
          '`X-Messagerie-Delivery-Id`',
          'L’identifiant de cet appel — un nouvel essai en a un autre.',
        ],
        ['`X-Messagerie-Webhook-Id`', 'Le webhook qui appelle.'],
      ],
    ),
    '### La réponse attendue',
    table(
      ['Réponse', 'Ce qui se passe'],
      [
        ['`2xx` en moins de 10 secondes', 'Livré.'],
        [
          '`5xx`, `408`, `429`, pas de réponse',
          'Retenté plus tard : 10 s, 30 s, 2 min, 10 min, 1 h, 6 h, 1 jour — un `Retry-After` plus long est respecté. Après le 8ᵉ essai, l’envoi est en échec.',
        ],
        ['Toute autre réponse, une redirection comprise', 'En échec, sans nouvel essai.'],
      ],
    ),
    callout(
      'IMPORTANT',
      'Répondez vite, puis traitez : au-delà de 10 secondes, l’appel compte comme un échec et sera refait.',
    ),
    '### Ordre et doublons',
    '- Les événements d’une **même conversation** arrivent dans l’ordre où ils se sont produits : tant que l’un attend un nouvel essai, les suivants l’attendent aussi. Entre conversations, aucun ordre n’est promis.\n- Un événement peut arriver **deux fois** — un appel coupé après réception, un serveur redémarré —, jamais se perdre : dédoublonnez par son `id`.\n- Ce que l’événement porte de la conversation et du message est leur état **au moment de l’envoi**, pas de l’événement.',
    '### Arrêts',
    '- Un webhook dont les **50 derniers envois** ont tous échoué s’arrête de lui-même ; il se reprend depuis l’écran, et ce qui attendait repart.\n- Un webhook supprimé n’envoie plus rien, et ce qui attendait est abandonné.\n- Le journal de chaque webhook garde ses envois 90 jours.',
    callout(
      'WARNING',
      'L’adresse doit être en HTTPS, sur le port 443, et joindre une adresse publique : un webhook ne peut pas viser le réseau où tourne la Messagerie. Toutes les adresses que donne le nom sont vérifiées, à la création et avant chaque appel.',
    ),
  )
  add(
    'webhooks-signature',
    WEBHOOKS,
    'Vérifier la signature',
    'Recalculez le HMAC sur le **corps brut** reçu — avant tout décodage JSON —, comparez-le en temps constant, et refusez un `t` de plus de cinq minutes : un appel rejoué plus tard ne passe pas.',
    fence(
      'js',
      'Node.js',
      [
        "import { createHmac, timingSafeEqual } from 'node:crypto'",
        '',
        'function authentique(header, body, secret) {',
        "  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')))",
        "  const attendu = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')",
        '  const frais = Math.abs(Date.now() / 1000 - Number(t)) < 300',
        "  return frais && timingSafeEqual(Buffer.from(v1, 'hex'), Buffer.from(attendu, 'hex'))",
        '}',
      ].join('\n'),
    ),
    fence(
      'python',
      'Python',
      [
        'import hashlib, hmac, time',
        '',
        'def authentique(header: str, body: bytes, secret: str) -> bool:',
        "    parts = dict(p.split('=', 1) for p in header.split(','))",
        "    t, v1 = parts['t'], parts['v1']",
        "    attendu = hmac.new(secret.encode(), f'{t}.'.encode() + body, hashlib.sha256).hexdigest()",
        '    return abs(time.time() - int(t)) < 300 and hmac.compare_digest(v1, attendu)',
      ].join('\n'),
    ),
    callout(
      'TIP',
      'Le bouton **Envoyer un test** d’un webhook lui envoie un événement `webhook.ping` : de quoi vérifier la signature avant le premier vrai message.',
    ),
  )
  add(
    'webhooks-evenements',
    WEBHOOKS,
    'Événements',
    'Chaque événement porte son `id`, son `type`, `occurredAt`, et la conversation telle qu’en donne la liste — le même objet que `GET /api/v1/conversations`. Ceux qui concernent un message le portent aussi, sous `message`.',
    table(
      ['Type', 'Quand', 'Porte'],
      [
        [
          '`message.created`',
          'Un message du visiteur, de l’IA ou d’un conseiller, ou une note interne.',
          '`conversation`, `message`',
        ],
        [
          '`message.deleted`',
          'Un message supprimé pour tout le monde — sans son texte.',
          '`conversation`, `message`',
        ],
        ['`conversation.created`', 'Une conversation commence.', '`conversation`'],
        [
          '`conversation.handed_off`',
          'L’IA passe la main à un conseiller.',
          '`conversation`, `message`',
        ],
        ['`conversation.assigned`', 'Le conseiller affecté change.', '`conversation`'],
        [
          '`conversation.transferred`',
          'La conversation change de boîte ou d’équipe.',
          '`conversation`',
        ],
        ['`conversation.resolved`', 'La conversation est résolue.', '`conversation`'],
        ['`conversation.reopened`', 'Une conversation résolue reprend.', '`conversation`'],
        ['`webhook.ping`', 'Un test envoyé depuis l’écran.', '`webhook`'],
      ],
    ),
    callout(
      'NOTE',
      'Les notes internes arrivent comme les autres messages, avec `kind: "note"` : filtrez-les si le système destinataire est vu des clients.',
    ),
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
